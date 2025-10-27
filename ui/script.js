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

// Streaming helper
async function typeText(element, text, delay = 15) {
    element.textContent = '';
    for (let i = 0; i < text.length; i++) {
        element.textContent += text[i];
        chatMessages.scrollTop = chatMessages.scrollHeight;
        await new Promise(r => setTimeout(r, delay));
    }
}

function createMessage(role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';

    if (role === 'user') {
        avatarDiv.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
        `;
    } else {
        avatarDiv.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V21C3 22.11 3.89 23 5 23H19C20.11 23 21 22.11 21 21V9M19 9H14V4H5V21H19V9Z"/>
            </svg>
        `;
    }

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    return { messageDiv, contentDiv };
}

function addAssistantThinking() {
    const { messageDiv, contentDiv } = createMessage('assistant');
    contentDiv.innerHTML = `
        <span class="thinking">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="thinking-text">Thinking...</span>
        </span>
    `;
    return { messageDiv, contentDiv };
}

function addCitations(contentDiv, sources) {
    const citationsDiv = document.createElement('div');
    citationsDiv.className = 'citations';
    
    sources.forEach((source, index) => {
        const citationDiv = document.createElement('div');
        citationDiv.className = 'citation';
        
        const filename = source.source.split('/').pop().replace(/^[^-]+-/, '') || 'Document';
        
        citationDiv.innerHTML = `
            <div class="citation-header">
                <span>Source ${source.index}</span>
                <div>
                    <span class="citation-page">Page ${source.page}</span>
                    <button class="citation-toggle" onclick="toggleCitation(${index})">Show/Hide</button>
                </div>
            </div>
            <div class="citation-source">${filename}</div>
            <div class="citation-content" id="citation-${index}" style="display: none;">
                ${source.content}
            </div>
        `;
        
        citationsDiv.appendChild(citationDiv);
    });
    
    contentDiv.appendChild(citationsDiv);
}

function toggleCitation(index) {
    const citationContent = document.getElementById(`citation-${index}`);
    if (citationContent) {
        citationContent.style.display = citationContent.style.display === 'none' ? 'block' : 'none';
    }
}

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

    // Show assistant thinking placeholder
    const { contentDiv: thinkingContent } = addAssistantThinking();

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
        // Clean markdown (bold) if present
        const clean = (data.response || '').replace(/\*\*(.*?)\*\*/g, '$1');
        // Stream into the thinking bubble
        await typeText(thinkingContent, clean, 12);
        
        // Add citations if available
        if (data.sources && data.sources.length > 0) {
            addCitations(thinkingContent, data.sources);
        }
    } catch (error) {
        console.error('Chat error:', error);
        thinkingContent.textContent = 'Sorry, I encountered an error. Please try again.';
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
    
    // Create avatar
    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    
    if (role === 'user') {
        // Human icon
        avatarDiv.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
        `;
    } else {
        // AI/Robot icon
        avatarDiv.innerHTML = `
            <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                <path d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V21C3 22.11 3.89 23 5 23H19C20.11 23 21 22.11 21 21V9M19 9H14V4H5V21H19V9Z"/>
            </svg>
        `;
    }
    
    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Clean content for assistant messages (remove markdown formatting)
    let cleanContent = content;
    if (role === 'assistant') {
        cleanContent = content.replace(/\*\*(.*?)\*\*/g, '$1');
    }
    
    contentDiv.textContent = cleanContent;
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
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
        // Load chat history for the current document
        loadChatHistory();
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
        
        item.addEventListener('click', async () => {
            currentDocument = doc;
            updateDocumentList();
            await loadChatHistory();
        });
        
        documentList.appendChild(item);
    });
}

async function loadChatHistory() {
    if (!currentDocument) return;
    
    try {
        const response = await fetch(`/api/chat/history/${currentDocument.id}`);
        if (response.ok) {
            const data = await response.json();
            const messages = data.messages || [];
            
            // Clear current chat
            chatMessages.innerHTML = '';
            
            // Remove welcome message if there are actual messages
            if (messages.length > 0) {
                // Add all messages from history
                for (const msg of messages) {
                    addMessage(msg.role, msg.content);
                }
            } else {
                // Show welcome message if no history
                chatMessages.innerHTML = `
                    <div class="welcome-message">
                        <h2>Start a conversation</h2>
                        <p>You can now ask questions about "${currentDocument.name}"</p>
                    </div>
                `;
            }
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
        // Show welcome message on error
        chatMessages.innerHTML = `
            <div class="welcome-message">
                <h2>Start a conversation</h2>
                <p>You can now ask questions about "${currentDocument.name}"</p>
            </div>
        `;
    }
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
