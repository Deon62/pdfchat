import os
import requests
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
# from langchain_ollama import OllamaEmbeddings
from langchain_mistralai import MistralAIEmbeddings
from langchain_chroma import Chroma
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
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

# Initialize Hugging Face embedding model (free, no API key needed)


# embeddings = OllamaEmbeddings(model="nomic-embed-text")
embeddings = MistralAIEmbeddings(model="mistral-embed")
# Store for active retrievers
retrievers = {}

def call_deepseek_api(message, context):
    """Direct API call to DeepSeek"""
    url = "https://api.deepseek.com/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {DEEPSEEK_API_KEY}"
    }
    
    prompt = f"""You are a helpful assistant that answers questions based on the provided context from a document.
Answer the question using only the information from the context. If the context doesn't contain enough information, say so.

Context from document:
{context}

Question: {message}

Answer:"""
    
    data = {
        "model": "deepseek-chat",
        "messages": [
            {"role": "user", "content": prompt}
        ],
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
        
        return jsonify({
            'id': doc_id,
            'filename': filename,
            'message': 'File uploaded and processed successfully'
        })
    
    return jsonify({'error': 'Invalid file type'}), 400

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.json
    message = data.get('message')
    document_id = data.get('documentId')
    
    if not message:
        return jsonify({'error': 'No message provided'}), 400
    
    if document_id not in retrievers:
        return jsonify({'error': 'Document not found'}), 404
    
    try:
        # Get retriever for this document
        retriever = retrievers[document_id]
        
        # Retrieve relevant documents
        relevant_docs = retriever.invoke(message)
        
        # Format context from retrieved documents
        context = "\n\n".join([
            f"[Source {i+1}]\n{doc.page_content}"
            for i, doc in enumerate(relevant_docs)
        ])
        
        # Call DeepSeek API directly
        response = call_deepseek_api(message, context)
        
        return jsonify({
            'response': response
        })
    
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': f'An error occurred: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)