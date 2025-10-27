import os
import requests
import json
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from langchain_mistralai import MistralAIEmbeddings
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.messages import HumanMessage, AIMessage
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_community.chat_message_histories import ChatMessageHistory
import uuid
from werkzeug.utils import secure_filename

load_dotenv()

app = Flask(__name__, template_folder='templates', static_folder='ui', static_url_path='/ui')
CORS(app)

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")

# Configuration
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)



embeddings = MistralAIEmbeddings(model="mistral-embed")

retrievers = {}
conversation_histories = {}  # Store chat histories per document

def load_existing_retrievers():
    """Load existing retrievers from Chroma database on startup"""
    try:
        # Get all collection names from the Chroma database
        import chromadb
        client = chromadb.PersistentClient(path="chroma_db")
        collections = client.list_collections()
        
        for collection in collections:
            collection_name = collection.name
            if collection_name.startswith("doc_"):
                doc_id = collection_name[4:]  # Remove "doc_" prefix
                
                # Create retriever for this document
                vector_store = Chroma(
                    collection_name=collection_name,
                    embedding_function=embeddings,
                    persist_directory="chroma_db",
                )
                
                retriever = vector_store.as_retriever(
                    search_type="similarity",
                    search_kwargs={
                        "k": 5  # Get more documents for better context
                    }
                )
                
                retrievers[doc_id] = retriever
                conversation_histories[doc_id] = ChatMessageHistory()
                
                print(f"Loaded retriever for document: {doc_id}")
        
        print(f"Loaded {len(retrievers)} existing retrievers")
    except Exception as e:
        print(f"Error loading existing retrievers: {e}")

# Load existing retrievers on startup
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
    # Look for patterns like "section 9", "chapter 3", "part 2", etc.
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
    
    # Convert markdown headers to HTML headers
    text = re.sub(r'^# (.+)$', r'<h1>\1</h1>', text, flags=re.MULTILINE)
    text = re.sub(r'^## (.+)$', r'<h2>\1</h2>', text, flags=re.MULTILINE)
    text = re.sub(r'^### (.+)$', r'<h3>\1</h3>', text, flags=re.MULTILINE)
    text = re.sub(r'^#### (.+)$', r'<h4>\1</h4>', text, flags=re.MULTILINE)
    
    # Convert bold text (**text** to <strong>text</strong>)
    text = re.sub(r'\*\*(.*?)\*\*', r'<strong>\1</strong>', text)
    
    # Convert italic text (*text* to <em>text</em>)
    text = re.sub(r'\*(.*?)\*', r'<em>\1</em>', text)
    
    # Convert bullet points (- item to <li>item</li>)
    lines = text.split('\n')
    formatted_lines = []
    in_list = False
    
    for line in lines:
        stripped = line.strip()
        
        # Check for bullet points
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
            # Extract number and text
            match = re.match(r'^(\d+)\.\s*(.+)$', stripped)
            if match:
                item_text = match.group(2).strip()
                formatted_lines.append(f'<li>{item_text}</li>')
        else:
            if in_list:
                formatted_lines.append('</ul>' if any(line.startswith(('1. ', '2. ', '3. ', '4. ', '5. ', '6. ', '7. ', '8. ', '9. ')) for line in lines[lines.index(line):lines.index(line)+3]) else '</ul>')
                in_list = False
            
            # Regular paragraph
            if stripped:
                formatted_lines.append(f'<p>{line}</p>')
            else:
                formatted_lines.append('<br>')
    
    # Close any remaining list
    if in_list:
        formatted_lines.append('</ul>')
    
    # Join lines and clean up
    formatted_text = '\n'.join(formatted_lines)
    
    # Clean up multiple consecutive <br> tags
    formatted_text = re.sub(r'(<br>\s*){3,}', '<br><br>', formatted_text)
    
    # Clean up empty paragraphs
    formatted_text = re.sub(r'<p>\s*</p>', '', formatted_text)
    
    return formatted_text

def call_deepseek_api(message, context, conversation_history=None, is_summarization=False, section_number=None, is_chapter_count=False, is_opinion=False):
    """Direct API call to DeepSeek with conversation history"""
    url = "https://api.deepseek.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    
    # Build conversation context
    messages = []
    
    # Add system message with document context
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
    
    # Add conversation history
    if conversation_history:
        for msg in conversation_history:
            if isinstance(msg, HumanMessage):
                messages.append({"role": "user", "content": msg.content})
            elif isinstance(msg, AIMessage):
                messages.append({"role": "assistant", "content": msg.content})
    
    # Add current message
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
    return render_template('index.html')

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
        # Test basic retrieval
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
        print("Upload endpoint called")  # Debug print
        if 'file' not in request.files:
            print("No file in request")  # Debug print
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        print(f"File received: {file.filename}")  # Debug print
        if file.filename == '':
            print("Empty filename")  # Debug print
            return jsonify({'error': 'No file selected'}), 400
        
        if file and allowed_file(file.filename):
            print(f"File validation passed: {file.filename}")  # Debug print
            # Generate unique ID for this document
            doc_id = str(uuid.uuid4())
            filename = secure_filename(file.filename)
            filepath = os.path.join(UPLOAD_FOLDER, f"{doc_id}_{filename}")
            
            # Save file
            try:
                file.save(filepath)
                print(f"File saved to: {filepath}")  # Debug print
            except Exception as e:
                print(f"Error saving file: {e}")  # Debug print
                return jsonify({'error': f'Failed to save file: {str(e)}'}), 500
            
            # Load and process PDF
            try:
                loader = PyPDFLoader(filepath)
                docs = loader.load()
                print(f"PDF loaded, {len(docs)} pages")  # Debug print
            except Exception as e:
                print(f"Error loading PDF: {e}")  # Debug print
                return jsonify({'error': f'Failed to load PDF: {str(e)}'}), 500
            
            try:
                text_splitter = RecursiveCharacterTextSplitter(
                    chunk_size=1000,
                    chunk_overlap=200,
                    add_start_index=True,
                )
                
                chunks = text_splitter.split_documents(docs)
                print(f"PDF split into {len(chunks)} chunks")  # Debug print
            except Exception as e:
                print(f"Error splitting PDF: {e}")  # Debug print
                return jsonify({'error': f'Failed to process PDF: {str(e)}'}), 500
            
            # Create vector store for this document
            try:
                collection_name = f"doc_{doc_id}"
                vector_store = Chroma(
                    collection_name=collection_name,
                    embedding_function=embeddings,
                    persist_directory="chroma_db",
                )
                print(f"Vector store created: {collection_name}")  # Debug print
                
                # Add documents to vector store
                vector_store.add_documents(documents=chunks)
                print("Documents added to vector store")  # Debug print
                
                # Create retriever with regular similarity search for now
                retriever = vector_store.as_retriever(
                    search_type="similarity",
                    search_kwargs={
                        "k": 5  # Get more documents for better context
                    }
                )
                
                retrievers[doc_id] = retriever
                
                # Initialize conversation history for this document
                conversation_histories[doc_id] = ChatMessageHistory()
                
                print(f"Upload successful for: {filename}")  # Debug print
                return jsonify({
                    'id': doc_id,
                    'filename': filename,
                    'message': 'File uploaded and processed successfully'
                })
            except Exception as e:
                print(f"Error creating vector store: {e}")  # Debug print
                return jsonify({'error': f'Failed to create vector store: {str(e)}'}), 500
        
        return jsonify({'error': 'Invalid file type'}), 400
    
    except Exception as e:
        print(f"Unexpected error in upload: {e}")  # Debug print
        return jsonify({'error': f'Upload failed: {str(e)}'}), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    print("Chat endpoint called")  # Debug print
    data = request.json
    print(f"Request data: {data}")  # Debug print
    message = data.get('message')
    document_id = data.get('documentId')
    
    if not message:
        return jsonify({'error': 'No message provided'}), 400
    
    if document_id not in retrievers:
        print(f"Document {document_id} not found in retrievers: {list(retrievers.keys())}")  # Debug print
        return jsonify({'error': 'Document not found'}), 404
    
    try:
        # Get retriever and conversation history for this document
        retriever = retrievers[document_id]
        chat_history = conversation_histories.get(document_id, ChatMessageHistory())
        
        # Check what type of request this is
        is_summarization = is_summarization_request(message)
        is_chapter_count = is_chapter_count_request(message)
        is_opinion = is_opinion_request(message)
        section_number = extract_section_number(message) if is_summarization else None
        
        # Retrieve relevant documents with better search
        if is_chapter_count:
            # For chapter count requests, search for structural information
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
            # Remove duplicates and get unique documents
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