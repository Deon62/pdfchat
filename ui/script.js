// State management
let currentDocument = null;
let documents = [];

// DOM elements
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const documentList = document.getElementById('documentList');
const loadingOverlay = document.getElementById('loadingOverlay');

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    loadDocuments();
});

// File upload functions
function openFileInput() {
    document.getElementById('pdfInput').click();
}

async function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    showLoading('Uploading and processing your document...');

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Upload failed');
        }

        const data = await response.json();
        const newDoc = {
            id: data.id,
            name: file.name,
            date: new Date().toISOString()
        };

        documents.push(newDoc);
        currentDocument = newDoc;
        saveDocuments();
        updateDocumentList();
        addMessage('assistant', `Successfully uploaded "${file.name}". You can now ask questions about it.`);
    } catch (error) {
        console.error('Upload error:', error);
        alert('Failed to upload document. Please try again.');
    } finally {
        hideLoading();
    }
}

// Message handling
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    if (!currentDocument) {
        alert('Please upload a PDF document first');
        return;
    }

    // Add user message
    addMessage('user', message);
    messageInput.value = '';
    
    // Disable input while waiting for response
    messageInput.disabled = true;
    sendBtn.disabled = true;

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                documentId: currentDocument.id
            })
        });

        if (!response.ok) {
            throw new Error('Chat request failed');
        }

        const data = await response.json();
        addMessage('assistant', data.response);
    } catch (error) {
        console.error('Chat error:', error);
        addMessage('assistant', 'Sorry, I encountered an error. Please try again.');
    } finally {
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function addMessage(role, content) {
    // Remove welcome message if it exists
    const welcomeMsg = chatMessages.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    messageDiv.textContent = content;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Document management
function loadDocuments() {
    const stored = localStorage.getItem('pdfDocuments');
    if (stored) {
        documents = JSON.parse(stored);
    }
    
    if (documents.length > 0) {
        currentDocument = documents[documents.length - 1];
    }
    
    updateDocumentList();
}

function saveDocuments() {
    localStorage.setItem('pdfDocuments', JSON.stringify(documents));
}

function updateDocumentList() {
    documentList.innerHTML = '';
    
    if (documents.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.textContent = 'No documents uploaded yet';
        emptyMsg.style.padding = '1rem';
        emptyMsg.style.color = '#666';
        emptyMsg.style.fontSize = '0.9rem';
        documentList.appendChild(emptyMsg);
        return;
    }

    documents.forEach(doc => {
        const item = document.createElement('div');
        item.className = 'document-item';
        if (currentDocument && doc.id === currentDocument.id) {
            item.classList.add('active');
        }
        
        item.innerHTML = `
            <div class="document-name">${doc.name}</div>
            <div class="document-date">${formatDate(doc.date)}</div>
        `;
        
        item.addEventListener('click', () => {
            currentDocument = doc;
            updateDocumentList();
            clearChat();
        });
        
        documentList.appendChild(item);
    });
}

function clearChat() {
    chatMessages.innerHTML = `
        <div class="welcome-message">
            <h2>Start a conversation</h2>
            <p>You can now ask questions about "${currentDocument.name}"</p>
        </div>
    `;
}

// Utility functions
function showLoading(message) {
    const overlay = document.getElementById('loadingOverlay');
    if (message) {
        overlay.querySelector('p').textContent = message;
    }
    overlay.style.display = 'flex';
}

function hideLoading() {
    document.getElementById('loadingOverlay').style.display = 'none';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    });
}
