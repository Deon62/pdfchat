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
    
    // Generate unique message ID
    const messageId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    messageDiv.setAttribute('data-message-id', messageId);

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

    return { messageDiv, contentDiv, messageId };
}

function addAssistantThinking() {
    const { messageDiv, contentDiv, messageId } = createMessage('assistant');
    contentDiv.innerHTML = `
        <span class="thinking">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="thinking-text">Thinking...</span>
        </span>
    `;
    return { messageDiv, contentDiv, messageId };
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

// Feedback system functions
function addFeedbackSection(contentDiv, messageId) {
    const feedbackDiv = document.createElement('div');
    feedbackDiv.className = 'feedback-section';
    feedbackDiv.innerHTML = `
        <div class="feedback-prompt">Rate how accurate this answer was:</div>
        <div class="star-rating" id="star-rating-${messageId}">
            <span class="star" data-rating="1">★</span>
            <span class="star" data-rating="2">★</span>
            <span class="star" data-rating="3">★</span>
            <span class="star" data-rating="4">★</span>
            <span class="star" data-rating="5">★</span>
        </div>
        <div class="feedback-actions" id="feedback-actions-${messageId}" style="display: none;">
            <textarea 
                class="feedback-comment" 
                placeholder="Optional: Add a comment about this answer..."
                id="comment-${messageId}"
            ></textarea>
            <button class="submit-feedback-btn" onclick="submitFeedback('${messageId}')">
                Submit
            </button>
        </div>
        <div class="feedback-thanks" id="feedback-thanks-${messageId}" style="display: none;">
            Thank you for your feedback!
        </div>
    `;
    
    contentDiv.appendChild(feedbackDiv);
    
    // Add event listeners to stars
    const stars = feedbackDiv.querySelectorAll('.star');
    stars.forEach((star, index) => {
        star.addEventListener('click', () => {
            setRating(messageId, index + 1);
        });
        
        star.addEventListener('mouseenter', () => {
            highlightStars(messageId, index + 1);
        });
    });
    
    // Reset stars on mouse leave
    const starRating = feedbackDiv.querySelector('.star-rating');
    starRating.addEventListener('mouseleave', () => {
        const currentRating = getCurrentRating(messageId);
        if (currentRating) {
            highlightStars(messageId, currentRating);
        } else {
            clearStars(messageId);
        }
    });
}

function setRating(messageId, rating) {
    // Store the rating
    window[`rating_${messageId}`] = rating;
    
    // Update visual state
    highlightStars(messageId, rating);
    
    // Show feedback actions
    const actions = document.getElementById(`feedback-actions-${messageId}`);
    if (actions) {
        actions.style.display = 'flex';
    }
}

function highlightStars(messageId, rating) {
    const stars = document.querySelectorAll(`#star-rating-${messageId} .star`);
    stars.forEach((star, index) => {
        if (index < rating) {
            star.classList.add('active');
        } else {
            star.classList.remove('active');
        }
    });
}

function clearStars(messageId) {
    const stars = document.querySelectorAll(`#star-rating-${messageId} .star`);
    stars.forEach(star => {
        star.classList.remove('active');
    });
}

function getCurrentRating(messageId) {
    return window[`rating_${messageId}`] || null;
}

async function submitFeedback(messageId) {
    const rating = getCurrentRating(messageId);
    const comment = document.getElementById(`comment-${messageId}`).value;
    
    if (!rating) {
        alert('Please select a rating');
        return;
    }
    
    if (!currentDocument) {
        alert('No document selected');
        return;
    }
    
    try {
        const response = await fetch('/api/feedback', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                documentId: currentDocument.id,
                messageId: messageId,
                rating: rating,
                comment: comment
            })
        });
        
        if (response.ok) {
            // Show success message
            const actions = document.getElementById(`feedback-actions-${messageId}`);
            const thanks = document.getElementById(`feedback-thanks-${messageId}`);
            
            if (actions) actions.style.display = 'none';
            if (thanks) thanks.style.display = 'flex';
            
            // Mark stars as rated
            const stars = document.querySelectorAll(`#star-rating-${messageId} .star`);
            stars.forEach(star => {
                star.classList.add('rated');
                star.style.cursor = 'default';
            });
        } else {
            alert('Failed to submit feedback. Please try again.');
        }
    } catch (error) {
        console.error('Error submitting feedback:', error);
        alert('Failed to submit feedback. Please try again.');
    }
}

// File upload functions
function openFileInput() {
    document.getElementById('pdfInput').click();
}

async function handleFileUpload(event) {
    console.log('File upload triggered'); // Debug log
    const file = event.target.files[0];
    if (!file) {
        console.log('No file selected'); // Debug log
        return;
    }

    console.log('File selected:', file.name, 'Type:', file.type); // Debug log

    if (file.type !== 'application/pdf') {
        alert('Please upload a PDF file');
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    showLoading('Uploading and processing your document...');

    try {
        console.log('Sending upload request...'); // Debug log
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });

        console.log('Upload response status:', response.status); // Debug log

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Upload failed:', errorText); // Debug log
            throw new Error(`Upload failed: ${errorText}`);
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
        alert(`Failed to upload document: ${error.message}`);
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
    const { contentDiv: thinkingContent, messageId } = addAssistantThinking();

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
        
        // Check if this is a summarization response
        if (data.is_summarization) {
            // Replace the thinking bubble with summary mode
            const messageDiv = thinkingContent.closest('.message');
            messageDiv.classList.add('summary-mode');
            
            // Create summary content
            const clean = (data.response || '').replace(/\*\*(.*?)\*\*/g, '$1');
            thinkingContent.innerHTML = `
                <div class="summary-header">
                    <div class="summary-icon">📋</div>
                    <span>Summary Mode</span>
                    ${data.section_number ? `<span class="summary-section-badge">Section ${data.section_number}</span>` : ''}
                </div>
                <div class="summary-content">${clean}</div>
            `;
        } else {
            // Regular response
            const clean = (data.response || '').replace(/\*\*(.*?)\*\*/g, '$1');
            // Stream into the thinking bubble
            await typeText(thinkingContent, clean, 12);
        }
        
        // Add citations if available
        if (data.sources && data.sources.length > 0) {
            addCitations(thinkingContent, data.sources);
        }
        
        // Add feedback section for AI responses
        addFeedbackSection(thinkingContent, messageId);
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

    const { messageDiv, contentDiv, messageId } = createMessage(role);
    
    // Clean content for assistant messages (remove markdown formatting)
    let cleanContent = content;
    if (role === 'assistant') {
        cleanContent = content.replace(/\*\*(.*?)\*\*/g, '$1');
    }
    
    contentDiv.textContent = cleanContent;
    
    // Add feedback section for AI responses
    if (role === 'assistant') {
        addFeedbackSection(contentDiv, messageId);
    }
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
