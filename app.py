import os
import io
import requests
import json
from flask import Flask, render_template, request, jsonify, Response, stream_with_context, send_file

from flask_cors import CORS
from dotenv import load_dotenv
from langchain_mistralai import MistralAIEmbeddings
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.documents import Document
import uuid
from werkzeug.utils import secure_filename
try:
    import fitz  # PyMuPDF
    import pytesseract
    from PIL import Image
except Exception:
    # Optional dependencies; OCR will be skipped if not available
    fitz = None
    pytesseract = None
    Image = None

load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='ui', static_url_path='/ui')
CORS(app)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")


UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)



embeddings = MistralAIEmbeddings(model="mistral-embed")

retrievers = {}
conversation_histories = {} 

def load_existing_retrievers():
    """Load existing retrievers from Chroma database on startup"""
    try:
       
        import chromadb
        client = chromadb.PersistentClient(path="chroma_db")
        collections = client.list_collections()
        
        for collection in collections:
            collection_name = collection.name
            if collection_name.startswith("doc_"):
                doc_id = collection_name[4:]  
                
               
                vector_store = Chroma(
                    collection_name=collection_name,
                    embedding_function=embeddings,
                    persist_directory="chroma_db",
                )
                
                retriever = vector_store.as_retriever(
                    search_type="similarity",
                    search_kwargs={
                        "k": 5  
                    }
                )
                
                retrievers[doc_id] = retriever
                conversation_histories[doc_id] = ChatMessageHistory()
                
                print(f"Loaded retriever for document: {doc_id}")
        
        print(f"Loaded {len(retrievers)} existing retrievers")
    except Exception as e:
        print(f"Error loading existing retrievers: {e}")


load_existing_retrievers()

def is_summarization_request(message):
    """Check if the message is a summarization request"""
    summarization_keywords = [
        'summarize', 'summary', 'summarise', 'summaries',
        'section', 'chapter', 'part', 'subsection',
        'overview', 'brief', 'outline', 'key points'
    ]
    message_lower = message.lower()
    return any(keyword in message_lower for keyword in summarization_keywords)

def is_chapter_count_request(message):
    """Check if the message is asking for chapter count or document structure"""
    chapter_keywords = [
        'how many chapters', 'total chapters', 'number of chapters',
        'how many sections', 'total sections', 'number of sections',
        'document structure', 'table of contents', 'chapters in this',
        'sections in this', 'parts in this'
    ]
    message_lower = message.lower()
    return any(keyword in message_lower for keyword in chapter_keywords)

def is_opinion_request(message):
    """Check if the message is asking for an opinion or analysis"""
    opinion_keywords = [
        'what do you think', 'your opinion', 'your thoughts',
        'what is your view', 'do you agree', 'what is your take',
        'analyze this', 'evaluate this', 'critique this',
        'assess this', 'judge this', 'rate this'
    ]
    message_lower = message.lower()
    return any(keyword in message_lower for keyword in opinion_keywords)

def extract_section_number(message):
    """Extract section/chapter number from the message"""
    import re
    
    patterns = [
        r'section\s+(\d+)',
        r'chapter\s+(\d+)',
        r'part\s+(\d+)',
        r'subsection\s+(\d+)',
        r'(\d+)(?:st|nd|rd|th)?\s+section',
        r'(\d+)(?:st|nd|rd|th)?\s+chapter'
    ]
    
    for pattern in patterns:
        match = re.search(pattern, message.lower())
        if match:
            return int(match.group(1))
    return None

def format_response_text(text):
    """Convert markdown formatting to proper HTML and clean up text"""
    import re
    
    if not text:
        return text
    
    
    text = re.sub(r'^# (.+)$', r'<h1>\1</h1>', text, flags=re.MULTILINE)
    text = re.sub(r'^## (.+)$', r'<h2>\1</h2>', text, flags=re.MULTILINE)
    text = re.sub(r'^### (.+)$', r'<h3>\1</h3>', text, flags=re.MULTILINE)
    text = re.sub(r'^#### (.+)$', r'<h4>\1</h4>', text, flags=re.MULTILINE)
    
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    
  
    text = re.sub(r'\*(.*?)\*', r'<em>\1</em>', text)
    

    lines = text.split('\n')
    formatted_lines = []
    in_list = False
    
    for line in lines:
        stripped = line.strip()
        
      
        if stripped.startswith('- ') or stripped.startswith('* '):
            if not in_list:
                formatted_lines.append('<ul>')
                in_list = True
            item_text = stripped[2:].strip()
            formatted_lines.append(f'<li>{item_text}</li>')
        elif stripped.startswith(('1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ')):
            if not in_list:
                formatted_lines.append('<ol>')
                in_list = True
          
            match = re.match(r'^(\d+)\.\s*(.+)$', stripped)
            if match:
                item_text = match.group(2).strip()
                formatted_lines.append(f'<li>{item_text}</li>')
        else:
            if in_list:
                formatted_lines.append('</ul>' if any(line.startswith(('1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ')) for line in lines[lines.index(line):lines.index(line)+3]) else '</ul>')
                in_list = False
            
      
            if stripped:
                formatted_lines.append(f'<p>{line}</p>')
            else:
                formatted_lines.append('<br>')
    
 
    if in_list:
        formatted_lines.append('</ul>')
    formatted_text = '\n'.join(formatted_lines)
    
    formatted_text = re.sub(r'(<br>\s*){3,}', '<br><br>', formatted_text)
    
    # Clean up empty paragraphs
    formatted_text = re.sub(r'<p>\s*</p>', '', formatted_text)
    
    return formatted_text

def _configure_tesseract():
    """Configure pytesseract path from env on Windows if provided."""
    if pytesseract is None:
        return
    cmd = os.getenv('TESSERACT_CMD')
    if cmd and os.path.exists(cmd):
        pytesseract.pytesseract.tesseract_cmd = cmd
    else:
        # Best-effort default path on Windows
        default_win = r"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
        if os.name == 'nt' and os.path.exists(default_win):
            pytesseract.pytesseract.tesseract_cmd = default_win

def ocr_images_from_pdf(pdf_path):
    """Extract text from images in a PDF using PyMuPDF + Tesseract.
    Returns a list of LangChain Document objects with OCR text.
    """
    if fitz is None or pytesseract is None or Image is None:
        print("OCR dependencies not installed; skipping image OCR")
        return []

    _configure_tesseract()
    try:
        doc = fitz.open(pdf_path)
    except Exception as e:
        print(f"Failed to open PDF for OCR: {e}")
        return []

    ocr_docs = []
    for page_index, page in enumerate(doc):
        try:
            images = page.get_images(full=True)
        except Exception as e:
            print(f"Failed to enumerate images on page {page_index+1}: {e}")
            continue
        if not images:
            continue
        for img_index, img in enumerate(images):
            try:
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image.get("image")
                if not image_bytes:
                    continue
                pil_img = Image.open(io.BytesIO(image_bytes))
                ocr_text = pytesseract.image_to_string(pil_img) or ""
                ocr_text = ocr_text.strip()
                if not ocr_text:
                    continue
                content = f"[Image OCR on page {page_index+1}]\n{ocr_text}"
                ocr_docs.append(
                    Document(
                        page_content=content,
                        metadata={
                            'page': page_index + 1,
                            'source': pdf_path,
                            'type': 'image_ocr',
                            'image_index': img_index + 1
                        }
                    )
                )
            except Exception as e:
                print(f"OCR failed on page {page_index+1} image {img_index+1}: {e}")
                continue
    print(f"OCR produced {len(ocr_docs)} image-derived snippets")
    return ocr_docs

def call_deepseek_api(message, context, conversation_history=None, is_summarization=False, section_number=None, is_chapter_count=False, is_opinion=False):
    """Direct API call to DeepSeek with conversation history"""
    url = "https://api.deepseek.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    
    
    messages = []
    
    
    if is_summarization and section_number:
        system_message = f"""You are an intelligent assistant that creates comprehensive summaries of specific sections from documents.
Create a detailed summary of the requested section, organizing the information clearly and highlighting key points.
Use bullet points, headings, and clear structure to make the summary easy to read.
Focus only on the content from the specified section.

Context from document (Section {section_number}):
{context}"""
    elif is_chapter_count:
        system_message = f"""You are an intelligent assistant that analyzes document structure and content.
Analyze the provided context to determine the document's structure, including chapters, sections, and overall organization.
Look for patterns like "Chapter X", "Section Y", numbered headings, or table of contents information.
Provide a clear count of chapters/sections and describe the document's structure.

Context from document:
{context}"""
    elif is_opinion:
        system_message = f"""You are an intelligent assistant with deep knowledge and analytical capabilities.
Based on the provided context, give your thoughtful opinion and analysis. Be insightful, critical when appropriate, and provide valuable perspectives.
Draw from your knowledge while staying grounded in the provided context. Be confident in your analysis but acknowledge limitations.
Provide nuanced, intelligent commentary that adds value beyond just summarizing.

Context from document:
{context}"""
    else:
        system_message = f"""You are an intelligent assistant that provides comprehensive answers based on document context.
Answer questions thoroughly using the provided context. Be insightful and analytical.
If the context doesn't contain enough information, acknowledge this and provide what you can.
Reference previous conversation context when relevant for better continuity.

Context from document:
{context}"""
    
    messages.append({"role": "system", "content": system_message})
    
    
    if conversation_history:
        for msg in conversation_history:
            if isinstance(msg, HumanMessage):
                messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                messages.append({"role": "assistant", "content": msg.content})
    
   
    messages.append({"role": "user", "content": message})
    
    data = {
        "model": "deepseek-chat",
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 3000 if is_summarization else 2000
    }
    
    response = requests.post(url, headers=headers, json=data)
    if response.status_code == 200:
        return response.json()["choices"][0]["message"]["content"]
    else:
        raise Exception(f"API call failed: {response.status_code} - {response.text}")

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    # Serve landing page
    return render_template('page.html')

@app.route('/app')
def app_main():
    # Serve the existing main application UI
    return render_template('index.html')

@app.route('/uploads/<path:filename>')
def serve_uploaded_file(filename):
    """Serve uploaded PDF files for PDF.js viewer."""
    print(f"UPLOAD_FOLDER is: {UPLOAD_FOLDER}")
    target_path = os.path.normpath(os.path.join(UPLOAD_FOLDER, filename))
    print(f"Requested file: {filename}, resolved path: {target_path}, exists: {os.path.isfile(target_path)}")
    if not os.path.isfile(target_path):
        return jsonify({'error': 'File not found'}), 404
    return send_file(target_path, mimetype='application/pdf')

@app.route('/api/test', methods=['GET'])
def test():
    return jsonify({'status': 'ok', 'message': 'API is working'})

@app.route('/api/debug/<document_id>', methods=['GET'])
def debug_document(document_id):
    """Debug endpoint to test document retrieval"""
    if document_id not in retrievers:
        return jsonify({'error': 'Document not found'}), 404
    
    retriever = retrievers[document_id]
    
    try:

        test_docs = retriever.invoke("test")
        return jsonify({
            'document_id': document_id,
            'retriever_type': str(type(retriever)),
            'test_results': len(test_docs),
            'has_vectorstore': hasattr(retriever, 'vectorstore'),
            'vectorstore_type': str(type(retriever.vectorstore)) if hasattr(retriever, 'vectorstore') else None
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    try:
        print("Upload endpoint called")  
        if 'file' not in request.files:
            print("No file in request") 
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        print(f"File received: {file.filename}")  
        if file.filename == '':
            print("Empty filename")  
            return jsonify({'error': 'No file selected'}), 400
        
        if file and allowed_file(file.filename):
            print(f"File validation passed: {file.filename}")  
            doc_id = str(uuid.uuid4())
            original_filename = secure_filename(file.filename)
            filename = f"{doc_id}_{original_filename}"
            filepath = os.path.join(UPLOAD_FOLDER, filename)
            
            print(f"Saving file as: {filename}")  # Debug line
            
          
            try:
                file.save(filepath)
                print(f"File saved to: {filepath}")
            except Exception as e:
                print(f"Error saving file: {e}")  
                return jsonify({'error': f'Failed to save file: {str(e)}'}), 500
            
            try:
                loader = PyPDFLoader(filepath)
                docs = loader.load()
                print(f"PDF loaded, {len(docs)} pages") 
            except Exception as e:
                print(f"Error loading PDF: {e}")  
                return jsonify({'error': f'Failed to load PDF: {str(e)}'}), 500
            
            try:
                text_splitter = RecursiveCharacterTextSplitter(
                    chunk_size=1000,
                    chunk_overlap=200,
                    add_start_index=True,
                )
                
                chunks = text_splitter.split_documents(docs)
                print(f"PDF split into {len(chunks)} chunks") 
                # Append OCR text extracted from images to the chunks so the retriever can answer about images
                try:
                    ocr_docs = ocr_images_from_pdf(filepath)
                    if ocr_docs:
                        chunks.extend(ocr_docs)
                        print(f"Appended {len(ocr_docs)} OCR chunks; total chunks now {len(chunks)}")
                except Exception as e:
                    print(f"Skipping OCR due to error: {e}")
            except Exception as e:
                print(f"Error splitting PDF: {e}")  
                return jsonify({'error': f'Failed to process PDF: {str(e)}'}), 500
            
           
            try:
                collection_name = f"doc_{doc_id}"
                vector_store = Chroma(
                    collection_name=collection_name,
                    embedding_function=embeddings,
                    persist_directory="chroma_db",
                )
                print(f"Vector store created: {collection_name}") 
                
              
                vector_store.add_documents(documents=chunks)
                print("Documents added to vector store") 
                
                
                retriever = vector_store.as_retriever(
                    search_type="similarity",
                    search_kwargs={
                        "k": 5  
                    }
                )
                
                retrievers[doc_id] = retriever
                
               
                conversation_histories[doc_id] = ChatMessageHistory()
                
                print(f"Upload successful for: {original_filename}")
                return jsonify({
                    'id': doc_id,
                    'filename': original_filename,
                    'server_filename': filename,
                    'message': 'File uploaded and processed successfully'
                })
            except Exception as e:
                print(f"Error creating vector store: {e}")  
                return jsonify({'error': f'Failed to create vector store: {str(e)}'}), 500
        
        return jsonify({'error': 'Invalid file type'}), 400
    
    except Exception as e:
        print(f"Unexpected error in upload: {e}") 
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    print("Chat endpoint called")  
    data = request.json
    print(f"Request data: {data}") 
    message = data.get('message')
    document_id = data.get('documentId')
    
    if not message:
        return jsonify({'error': 'No message provided'}), 400
    
    if document_id not in retrievers:
        print(f"Document {document_id} not found in retrievers: {list(retrievers.keys())}")  # Debug print
        return jsonify({'error': 'Document not found'}), 404
    
    try:
        retriever = retrievers[document_id]
        chat_history = conversation_histories.get(document_id, ChatMessageHistory())
        is_summarization = is_summarization_request(message)
        is_chapter_count = is_chapter_count_request(message)
        is_opinion = is_opinion_request(message)
        section_number = extract_section_number(message) if is_summarization else None
        
        
        if is_chapter_count:
            
            search_queries = [
                message,
                "table of contents",
                "chapter",
                "section",
                "part",
                "introduction",
                "conclusion"
            ]
            all_docs = []
            for query in search_queries:
                docs = retriever.invoke(query)
                all_docs.extend(docs)

            seen_content = set()
            relevant_docs = []
            for doc in all_docs:
                if doc.page_content not in seen_content:
                    seen_content.add(doc.page_content)
                    relevant_docs.append(doc)
        else:
            # Regular retrieval
            print(f"Performing regular retrieval for query: '{message}'")
            relevant_docs = retriever.invoke(message)
            print(f"Initial retrieval found {len(relevant_docs)} documents")
        
        # Fallback: if no documents retrieved, try with lower threshold
        if not relevant_docs:
            print("No relevant docs were retrieved using the relevance score threshold")
            print("Trying fallback retrieval with similarity search...")
            # Create a fallback retriever with regular similarity search
            try:
                # Access the vectorstore from the retriever
                vectorstore = retriever.vectorstore
                fallback_retriever = vectorstore.as_retriever(
                    search_type="similarity",
                    search_kwargs={"k": 5}  # Get more documents in fallback
                )
                relevant_docs = fallback_retriever.invoke(message)
                print(f"Fallback retrieval found {len(relevant_docs)} documents")
            except Exception as e:
                print(f"Fallback retrieval failed: {e}")
                # If fallback also fails, try to get any documents at all
                try:
                    print("Trying emergency fallback - getting any documents...")
                    emergency_retriever = vectorstore.as_retriever(
                        search_type="similarity",
                        search_kwargs={"k": 10}  # Get even more documents
                    )
                    relevant_docs = emergency_retriever.invoke("document content")
                    print(f"Emergency fallback found {len(relevant_docs)} documents")
                except Exception as e2:
                    print(f"Emergency fallback also failed: {e2}")
                    relevant_docs = []
        
        # Format context from retrieved documents with metadata
        context_parts = []
        sources = []
        
        print(f"Processing {len(relevant_docs)} retrieved documents...")
        
        for i, doc in enumerate(relevant_docs):
            source_info = {
                'index': i + 1,
                'content': doc.page_content,
                'page': doc.metadata.get('page', 'Unknown'),
                'source': doc.metadata.get('source', 'Unknown')
            }
            sources.append(source_info)
            context_parts.append(f"[Source {i+1}]\n{doc.page_content}")
            print(f"Added source {i+1}: {len(doc.page_content)} characters")
        
        context = "\n\n".join(context_parts)
        print(f"Total context length: {len(context)} characters")
        
        # Add user message to history
        chat_history.add_user_message(message)
        
        # Call DeepSeek API with conversation history
        response = call_deepseek_api(message, context, chat_history.messages, is_summarization, section_number, is_chapter_count, is_opinion)
        
        # Format the response text to convert markdown to HTML
        formatted_response = format_response_text(response)
        
        # Add AI response to history with metadata
        ai_message = AIMessage(content=formatted_response)
        # Store additional metadata as a custom attribute
        ai_message.additional_kwargs = {
            'sources': sources,
            'is_summarization': is_summarization,
            'section_number': section_number,
            'is_chapter_count': is_chapter_count,
            'is_opinion': is_opinion
        }
        chat_history.add_message(ai_message)
        
        # Update conversation history
        conversation_histories[document_id] = chat_history
        
        return jsonify({
            'response': formatted_response,
            'sources': sources,
            'is_summarization': is_summarization,
            'section_number': section_number,
            'is_chapter_count': is_chapter_count,
            'is_opinion': is_opinion
        })
    
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': f'An error occurred: {str(e)}'}), 500

@app.route('/api/chat/stream', methods=['POST'])
def chat_stream():
    """Stream tokens for chat responses while preserving retrieval and sources."""
    data = request.json
    message = data.get('message')
    document_id = data.get('documentId')

    if not message:
        return jsonify({'error': 'No message provided'}), 400
    if document_id not in retrievers:
        return jsonify({'error': 'Document not found'}), 404

    try:
        retriever = retrievers[document_id]
        chat_history = conversation_histories.get(document_id, ChatMessageHistory())

        is_summarization = is_summarization_request(message)
        is_chapter_count = is_chapter_count_request(message)
        is_opinion = is_opinion_request(message)
        section_number = extract_section_number(message) if is_summarization else None

        # Retrieval
        relevant_docs = retriever.invoke(message)
        if not relevant_docs:
            vectorstore = retriever.vectorstore
            fallback = vectorstore.as_retriever(search_type="similarity", search_kwargs={"k": 5})
            relevant_docs = fallback.invoke(message)

        context_parts = []
        sources = []
        for i, doc in enumerate(relevant_docs):
            sources.append({
                'index': i + 1,
                'content': doc.page_content,
                'page': doc.metadata.get('page', 'Unknown'),
                'source': doc.metadata.get('source', 'Unknown')
            })
            context_parts.append(f"[Source {i+1}]\n{doc.page_content}")
        context = "\n\n".join(context_parts)

        # Build DeepSeek payload with streaming
        url = "https://api.deepseek.com/v1/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
        }

        # Build messages like call_deepseek_api
        system_message = f"""You are an intelligent assistant that provides comprehensive answers based on document context.
Answer questions thoroughly using the provided context. Be insightful and analytical.
If the context doesn't contain enough information, acknowledge this and provide what you can.
Reference previous conversation context when relevant for better continuity.

Context from document:
{context}"""
        if is_summarization and section_number:
            system_message = f"""You are an intelligent assistant that creates comprehensive summaries of specific sections from documents.
Create a detailed summary of the requested section, organizing the information clearly and highlighting key points.
Use bullet points, headings, and clear structure to make the summary easy to read.
Focus only on the content from the specified section.

Context from document (Section {section_number}):
{context}"""
        elif is_chapter_count:
            system_message = f"""You are an intelligent assistant that analyzes document structure and content.
Analyze the provided context to determine the document's structure, including chapters, sections, and overall organization.
Look for patterns like "Chapter X", "Section Y", numbered headings, or table of contents information.
Provide a clear count of chapters/sections and describe the document's structure.

Context from document:
{context}"""
        elif is_opinion:
            system_message = f"""You are an intelligent assistant with deep knowledge and analytical capabilities.
Based on the provided context, give your thoughtful opinion and analysis. Be insightful, critical when appropriate, and provide valuable perspectives.
Draw from your knowledge while staying grounded in the provided context. Be confident in your analysis but acknowledge limitations.
Provide nuanced, intelligent commentary that adds value beyond just summarizing.

Context from document:
{context}"""

        messages = [{"role": "system", "content": system_message}]
        for msg in chat_history.messages:
            if isinstance(msg, HumanMessage):
                messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                messages.append({"role": "assistant", "content": msg.content})
        messages.append({"role": "user", "content": message})

        payload = {
            "model": "deepseek-chat",
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 2000,
            "stream": True,
        }

        def generate():
            buffer = []
            try:
                with requests.post(url, headers=headers, json=payload, stream=True) as r:
                    r.raise_for_status()
                    for line in r.iter_lines(decode_unicode=True):
                        if not line:
                            continue
                        if line.startswith('data: '):
                            data_str = line[len('data: '):].strip()
                        else:
                            data_str = line.strip()
                        if data_str == '[DONE]':
                            break
                        try:
                            obj = json.loads(data_str)
                            # OpenAI-style delta
                            delta = obj.get('choices', [{}])[0].get('delta', {})
                            content = delta.get('content', '')
                            if content:
                                buffer.append(content)
                                yield content
                        except Exception:
                            # If not JSON, yield raw text
                            buffer.append(data_str)
                            yield data_str
            except Exception as e:
                yield f"\n[Stream error: {str(e)}]"

            # After stream completes: save to history and emit sources marker
            full_text = ''.join(buffer)
            try:
                formatted = format_response_text(full_text)
                ai_message = AIMessage(content=formatted)
                ai_message.additional_kwargs = {
                    'sources': sources,
                    'is_summarization': is_summarization,
                    'section_number': section_number,
                    'is_chapter_count': is_chapter_count,
                    'is_opinion': is_opinion
                }
                chat_history.add_user_message(message)
                chat_history.add_message(ai_message)
                conversation_histories[document_id] = chat_history
            except Exception:
                pass

            yield "\n[[SOURCES]]" + json.dumps({
                'sources': sources,
                'is_summarization': is_summarization,
                'section_number': section_number,
                'is_chapter_count': is_chapter_count,
                'is_opinion': is_opinion
            })

        headers_out = {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        }
        return Response(stream_with_context(generate()), headers=headers_out)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/chat/history/<document_id>', methods=['GET'])
def get_chat_history(document_id):
    """Get chat history for a specific document"""
    if document_id not in conversation_histories:
        return jsonify({'messages': []})
    
    chat_history = conversation_histories[document_id]
    messages = []
    
    for i, msg in enumerate(chat_history.messages):
        if isinstance(msg, HumanMessage):
            messages.append({
                'role': 'user', 
                'content': msg.content,
                'messageId': f'msg_history_{i}_{document_id}'
            })
        elif isinstance(msg, AIMessage):
            # Extract metadata if available
            metadata = getattr(msg, 'additional_kwargs', {})
            messages.append({
                'role': 'assistant', 
                'content': msg.content,
                'messageId': f'msg_history_{i}_{document_id}',
                'sources': metadata.get('sources', []),
                'is_summarization': metadata.get('is_summarization', False),
                'section_number': metadata.get('section_number', None),
                'is_chapter_count': metadata.get('is_chapter_count', False),
                'is_opinion': metadata.get('is_opinion', False)
            })
    
    return jsonify({'messages': messages})

@app.route('/api/chat/history/<document_id>', methods=['DELETE'])
def clear_chat_history(document_id):
    """Clear chat history for a specific document"""
    if document_id in conversation_histories:
        conversation_histories[document_id] = ChatMessageHistory()
        return jsonify({'message': 'Chat history cleared'})
    
    return jsonify({'error': 'Document not found'}), 404

@app.route('/api/documents/<document_id>', methods=['DELETE'])
def delete_document(document_id):
    """Delete a document and its associated data"""
    try:
        # Check if document exists in retrievers
        if document_id not in retrievers:
            return jsonify({'error': 'Document not found'}), 404
        
        # Remove from retrievers
        del retrievers[document_id]
        
        # Remove conversation history
        if document_id in conversation_histories:
            del conversation_histories[document_id]
        
        # Delete the Chroma collection
        try:
            import chromadb
            client = chromadb.PersistentClient(path="chroma_db")
            collection_name = f"doc_{document_id}"
            client.delete_collection(collection_name)
            print(f"Deleted Chroma collection: {collection_name}")
        except Exception as e:
            print(f"Error deleting Chroma collection: {e}")
        
        # Delete the uploaded file
        try:
            import glob
            file_pattern = os.path.join(UPLOAD_FOLDER, f"{document_id}_*")
            files = glob.glob(file_pattern)
            for file_path in files:
                if os.path.exists(file_path):
                    os.remove(file_path)
                    print(f"Deleted file: {file_path}")
        except Exception as e:
            print(f"Error deleting file: {e}")
        
        print(f"Successfully deleted document: {document_id}")
        return jsonify({'message': 'Document deleted successfully'})
        
    except Exception as e:
        print(f"Error deleting document: {e}")
        return jsonify({'error': f'Failed to delete document: {str(e)}'}), 500

@app.route('/api/feedback', methods=['POST'])
def submit_feedback():
    """Submit user feedback for an answer"""
    data = request.json
    document_id = data.get('documentId')
    message_id = data.get('messageId')
    rating = data.get('rating')
    comment = data.get('comment', '')
    
    if not all([document_id, message_id, rating]):
        return jsonify({'error': 'Missing required fields'}), 400
    
    if not (1 <= rating <= 5):
        return jsonify({'error': 'Rating must be between 1 and 5'}), 400
    
    # Store feedback (in a real app, you'd save to a database)
    feedback_data = {
        'document_id': document_id,
        'message_id': message_id,
        'rating': rating,
        'comment': comment,
        'timestamp': str(uuid.uuid4())  # Simple timestamp for now
    }
    
    # For now, just log the feedback (in production, save to database)
    print(f"Feedback received: {feedback_data}")
    
    return jsonify({
        'message': 'Feedback submitted successfully',
        'feedback_id': feedback_data['timestamp']
    })

if __name__ == '__main__':
    # Configure Flask for better Windows compatibility
    app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size
    app.run(debug=True, port=5000, use_reloader=False, threaded=True)