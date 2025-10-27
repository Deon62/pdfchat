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
                    search_kwargs={"k": 3}
                )
                
                retrievers[doc_id] = retriever
                conversation_histories[doc_id] = ChatMessageHistory()
                
                print(f"Loaded retriever for document: {doc_id}")
        
        print(f"Loaded {len(retrievers)} existing retrievers")
    except Exception as e:
        print(f"Error loading existing retrievers: {e}")

# Load existing retrievers on startup
load_existing_retrievers()

def call_deepseek_api(message, context, conversation_history=None):
    """Direct API call to DeepSeek with conversation history"""
    url = "https://api.deepseek.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    
    # Build conversation context
    messages = []
    
    # Add system message with document context
    system_message = f"""You are a helpful assistant that answers questions based on the provided context from a document.
Answer the question using only the information from the context. If the context doesn't contain enough information, say so.
You can reference previous parts of the conversation to provide better context.

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
        "max_tokens": 2000
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

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if file and allowed_file(file.filename):
        # Generate unique ID for this document
        doc_id = str(uuid.uuid4())
        filename = secure_filename(file.filename)
        filepath = os.path.join(UPLOAD_FOLDER, f"{doc_id}_{filename}")
        
        # Save file
        file.save(filepath)
        
        # Load and process PDF
        loader = PyPDFLoader(filepath)
        docs = loader.load()
        
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            add_start_index=True,
        )
        
        chunks = text_splitter.split_documents(docs)
        
        # Create vector store for this document
        collection_name = f"doc_{doc_id}"
        vector_store = Chroma(
            collection_name=collection_name,
            embedding_function=embeddings,
            persist_directory="chroma_db",
        )
        
        # Add documents to vector store
        vector_store.add_documents(documents=chunks)
        
        # Create retriever
        retriever = vector_store.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 3}
        )
        
        retrievers[doc_id] = retriever
        
        # Initialize conversation history for this document
        conversation_histories[doc_id] = ChatMessageHistory()
        
        return jsonify({
            'id': doc_id,
            'filename': filename,
            'message': 'File uploaded and processed successfully'
        })
    
    return jsonify({'error': 'Invalid file type'}), 400

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
        
        # Retrieve relevant documents
        relevant_docs = retriever.invoke(message)
        
        # Format context from retrieved documents
        context = "\n\n".join([
            f"[Source {i+1}]\n{doc.page_content}"
            for i, doc in enumerate(relevant_docs)
        ])
        
        # Add user message to history
        chat_history.add_user_message(message)
        
        # Call DeepSeek API with conversation history
        response = call_deepseek_api(message, context, chat_history.messages)
        
        # Add AI response to history
        chat_history.add_ai_message(response)
        
        # Update conversation history
        conversation_histories[document_id] = chat_history
        
        return jsonify({
            'response': response
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
    
    for msg in chat_history.messages:
        if isinstance(msg, HumanMessage):
            messages.append({'role': 'user', 'content': msg.content})
        elif isinstance(msg, AIMessage):
            messages.append({'role': 'assistant', 'content': msg.content})
    
    return jsonify({'messages': messages})

@app.route('/api/chat/history/<document_id>', methods=['DELETE'])
def clear_chat_history(document_id):
    """Clear chat history for a specific document"""
    if document_id in conversation_histories:
        conversation_histories[document_id] = ChatMessageHistory()
        return jsonify({'message': 'Chat history cleared'})
    
    return jsonify({'error': 'Document not found'}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)