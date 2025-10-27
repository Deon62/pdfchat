# PDF Chat Assistant

A modern, professional chatbot interface for chatting with PDF documents using RAG (Retrieval-Augmented Generation) technology.

## Features

- 📄 Upload and process PDF documents
- 💬 Chat with your PDFs using natural language
- 🎨 Clean, minimal UI with white and charcoal color scheme
- 📱 Responsive design for all devices
- 🔄 Multi-document support with sidebar navigation

## Setup

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Create a `.env` file** in the root directory with your API keys:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   LANGSMITH_API_KEY=your_langsmith_api_key_here
   ```

3. **Run the application:**
   ```bash
   python app.py
   ```

4. **Open your browser** and navigate to:
   ```
   http://localhost:5000
   ```

## Usage

1. Click the "Upload PDF" button in the header
2. Select a PDF file from your computer
3. Wait for the document to be processed
4. Start asking questions about the document!

## Tech Stack

- **Backend:** Flask
- **LLM:** Gemini 2.5 Flash Lite
- **Vector Store:** ChromaDB
- **Embeddings:** Google Generative AI
- **Framework:** LangChain

## Project Structure

```
ragbot/
├── app.py                 # Flask server and API endpoints
├── templates/             # HTML templates
│   └── index.html
├── ui/                    # Static files (CSS, JS)
│   ├── styles.css
│   └── script.js
├── uploads/               # Uploaded PDF files (created on run)
├── chroma_db/             # Vector database
├── data/                  # Sample documents
└── requirements.txt       # Python dependencies
```

## License

MIT
