// State management
let currentDocument = null;
let documents = [];

// DOM elements
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const documentList = document.getElementById('documentList');
const loadingOverlay = document.getElementById('loadingOverlay');
const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');

// Auto-scroll to bottom during streaming
function scrollToBottomSmooth() {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

// Scroll to Bottom Button
function updateScrollButton() {
    const hasMessages = chatMessages && chatMessages.children.length > 0 && !chatMessages.querySelector('.welcome-message');
    if (!hasMessages) {
        scrollToBottomBtn.style.display = 'none';
        return;
    }
    const isAtBottom = chatMessages.scrollHeight - chatMessages.scrollTop <= chatMessages.clientHeight + 10;
    scrollToBottomBtn.style.display = isAtBottom ? 'none' : 'flex';
}

scrollToBottomBtn.addEventListener('click', () => {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
});

// Monitor scroll to show/hide button
chatMessages?.addEventListener('scroll', updateScrollButton);
const sidebar = document.querySelector('.sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const toastEl = document.getElementById('toast');

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    loadDocuments();
    // Ensure scroll-to-bottom button listener is attached
    const btn = document.getElementById('scrollToBottomBtn');
    if (btn) {
        btn.addEventListener('click', () => {
            const chat = document.getElementById('chatMessages');
            let scrollable = chat;
            // Find the actually scrolling parent
            while (scrollable && scrollable.scrollHeight <= scrollable.clientHeight) {
                scrollable = scrollable.parentElement;
            }
            if (scrollable) {
                console.log('Scrolling element to bottom:', scrollable.scrollHeight);
                scrollable.scrollTo({ top: scrollable.scrollHeight, behavior: 'smooth' });
            } else {
                console.error('No scrollable container found');
            }
        });
    }
    if (hamburgerBtn) {
        hamburgerBtn.addEventListener('click', () => {
            if (sidebar && sidebar.classList.contains('open')) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }
    if (sidebarOverlay) {
        sidebarOverlay.addEventListener('click', () => closeSidebar());
    }
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

// Toast utility
function showToast(message, type = 'success', duration = 2200) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = `toast ${type} show`;
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => {
        toastEl.classList.remove('show');
    }, duration);
}

function openSidebar() {
    if (!sidebar) return;
    if (window.innerWidth <= 768) {
        sidebar.classList.add('open');
        if (sidebarOverlay) {
            sidebarOverlay.style.display = 'block';
            // delay to allow CSS transition
            requestAnimationFrame(() => sidebarOverlay.classList.add('show'));
        }
        // prevent background scroll while menu is open
        document.body.style.overflow = 'hidden';
    }
}

function closeSidebar() {
    if (!sidebar) return;
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
        if (sidebarOverlay) {
            sidebarOverlay.classList.remove('show');
            setTimeout(() => {
                sidebarOverlay.style.display = 'none';
            }, 200);
        }
        // restore background scroll
        document.body.style.overflow = '';
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

function attachCopyButton(messageDiv, contentDiv, role) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.setAttribute('aria-label', 'Copy');
    btn.title = 'Copy';
    btn.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
    `;

    btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
            let text = '';
            if (role === 'assistant') {
                const clone = contentDiv.cloneNode(true);
                clone.querySelectorAll('.citations, .feedback-section').forEach(el => el.remove());
                text = clone.innerText.trim();
            } else {
                text = contentDiv.innerText.trim();
            }
            await navigator.clipboard.writeText(text);
            showToast('Copied to clipboard', 'success');
        } catch (err) {
            showToast('Copy failed', 'error');
        }
    });

    messageDiv.appendChild(btn);
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

    // optimistic add
    const tempId = 'temp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const tempDoc = {
        id: tempId,
        name: file.name,
        date: new Date().toISOString(),
        status: 'indexing'
    };
    documents.push(tempDoc);
    currentDocument = tempDoc;
    saveDocuments();
    updateDocumentList();
    addMessage('assistant', `"${file.name}" added. I'm indexing it now — you can start chatting.`);
    closeSidebar();
    hideLoading();
    // immediate success toast for perceived speed
    showToast('Upload completed — now indexing', 'success');

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
        const realId = data.id;
        const serverFilename = data.server_filename;
        const idx = documents.findIndex(d => d.id === tempId);
        if (idx !== -1) {
            documents[idx].id = realId;
            documents[idx].status = 'ready';
            documents[idx].server_filename = serverFilename;
        }
        if (currentDocument && currentDocument.id === tempId) {
            currentDocument.id = realId;
            currentDocument.status = 'ready';
            currentDocument.server_filename = serverFilename;
        }
        saveDocuments();
        updateDocumentList();
        addMessage('assistant', `"${file.name}" is ready. Ask your question.`);
    } catch (error) {
        console.error('Upload error:', error);
        // rollback temp doc
        documents = documents.filter(d => d.id !== tempId);
        if (currentDocument && currentDocument.id === tempId) {
            currentDocument = documents[documents.length - 1] || null;
        }
        saveDocuments();
        updateDocumentList();
        showToast('Upload failed. Please try again.', 'error');
    } finally {
        hideLoading();
    }
}

// Message handling
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    if (!currentDocument) {
        promptUploadFirst();
        return;
    }

    if ((currentDocument.id && currentDocument.id.startsWith('temp_')) || currentDocument.status === 'indexing') {
        addMessage('assistant', 'I\'m still indexing this document. You can ask now; answers may be partial until indexing completes.');
        return;
    }

    // Add user message
    addMessage('user', message);
    messageInput.value = '';
    
    // Disable input while waiting for response
    messageInput.disabled = true;
    sendBtn.disabled = true;

    // Create assistant placeholder we will stream into (start with thinking UI)
    const { messageDiv: streamMsgDiv, contentDiv: streamContent, messageId } = createMessage('assistant');
    streamContent.innerHTML = `
        <span class="thinking">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="thinking-text">Thinking...</span>
        </span>
    `;

    try {
        // Try streaming endpoint first
        const resp = await fetch('/api/chat/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, documentId: currentDocument.id })
        });

        if (!resp.ok || !resp.body) {
            throw new Error('Stream not available');
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let buffer = '';
        let sourcesMeta = null;
        let started = false;

        while (!done) {
            const { value, done: streamDone } = await reader.read();
            done = streamDone;
            if (value) {
                const chunk = decoder.decode(value, { stream: true });
                buffer += chunk;
                const markerIndex = buffer.indexOf('[[SOURCES]]');
                if (markerIndex !== -1) {
                    const textPart = buffer.substring(0, markerIndex);
                    const metaPart = buffer.substring(markerIndex + '[[SOURCES]]'.length).trim();
                    try {
                        const meta = JSON.parse(metaPart);
                        sourcesMeta = meta;
                    } catch {}
                    // Render final content with markdown-lite formatting
                    streamContent.innerHTML = renderMarkdownLite(textPart);
                    scrollToBottomSmooth();
                    break;
                } else {
                    // Progressive update with markdown-lite formatting
                    if (!started) {
                        // switch from thinking UI to plain text container
                        streamContent.textContent = '';
                        started = true;
                    }
                    streamContent.innerHTML = renderMarkdownLite(buffer);
                    scrollToBottomSmooth();
                }
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        }

        // If no marker encountered but stream ended, finalize
        if (!sourcesMeta) {
            streamContent.innerHTML = renderMarkdownLite(buffer);
        }
        scrollToBottomSmooth();

        // Attach citations and feedback if metadata present
        if (sourcesMeta && sourcesMeta.sources && sourcesMeta.sources.length > 0) {
            addCitations(streamContent, sourcesMeta.sources);
        }
        addFeedbackSection(streamContent, messageId);
        attachCopyButton(streamMsgDiv, streamContent, 'assistant');
    } catch (error) {
        console.error('Chat error:', error);
        // Fallback to non-streaming call
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, documentId: currentDocument.id })
            });
            if (!response.ok) throw new Error('Chat request failed');
            const data = await response.json();
            const formattedResponse = data.response || '';
            // data.response from backend is already HTML; keep as-is
            streamContent.innerHTML = formattedResponse;
            if (data.sources && data.sources.length > 0) {
                addCitations(streamContent, data.sources);
            }
            addFeedbackSection(streamContent, messageId);
            attachCopyButton(streamMsgDiv, streamContent, 'assistant');
        } catch (e2) {
            streamContent.textContent = 'Sorry, I encountered an error. Please try again.';
        }
    } finally {
        messageInput.disabled = false;
        sendBtn.disabled = false;
        messageInput.focus();
    }
}

// Lightweight markdown renderer for streaming (headings, bold/italic, lists, paragraphs)
function renderMarkdownLite(text) {
    if (!text) return '';
    const escape = (s) => s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    let src = escape(text);
    // headings
    src = src.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
             .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
             .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
             .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
    // bold/italic
    src = src.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
             .replace(/\*(.*?)\*/g, '<em>$1</em>');
    // lists (simple, continuous blocks)
    const lines = src.split('\n');
    let out = [];
    let inUL = false, inOL = false;
    const closeLists = () => {
        if (inUL) { out.push('</ul>'); inUL = false; }
        if (inOL) { out.push('</ol>'); inOL = false; }
    };
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (/^<h[1-4]>/.test(trimmed)) { // already converted heading
            closeLists();
            out.push(trimmed);
            continue;
        }
        const ulMatch = /^[-*]\s+(.*)/.exec(trimmed);
        const olMatch = /^(\d+)\.\s+(.*)/.exec(trimmed);
        if (ulMatch) {
            if (!inUL) { closeLists(); out.push('<ul>'); inUL = true; }
            out.push(`<li>${ulMatch[1]}</li>`);
            continue;
        }
        if (olMatch) {
            if (!inOL) { closeLists(); out.push('<ol>'); inOL = true; }
            out.push(`<li>${olMatch[2]}</li>`);
            continue;
        }
        if (trimmed === '') {
            closeLists();
            out.push('<br>');
        } else {
            closeLists();
            out.push(`<p>${trimmed}</p>`);
        }
    }
    closeLists();
    return out.join('\n');
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
        attachCopyButton(messageDiv, contentDiv, 'assistant');
    } else {
        attachCopyButton(messageDiv, contentDiv, 'user');
    }
    updateScrollButton();
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
            <div class="document-info">
                <div class="document-name">${doc.name}</div>
                <div class="document-date">${formatDate(doc.date)}</div>
            </div>
            <button class="document-menu-btn" aria-label="More options" aria-haspopup="menu" aria-expanded="false">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="1"></circle>
                    <circle cx="12" cy="5" r="1"></circle>
                    <circle cx="12" cy="19" r="1"></circle>
                </svg>
            </button>
            <div class="document-menu" role="menu">
                <button class="document-menu-item view-pdf" role="menuitem">View PDF</button>
                <button class="document-menu-item delete" role="menuitem">Delete</button>
            </div>
        `;
        
        item.addEventListener('click', async (e) => {
            // Prevent opening doc when clicking menu
            if (e.target.closest('.document-menu-btn') || e.target.closest('.document-menu')) return;
            currentDocument = doc;
            updateDocumentList();
            await loadChatHistory();
            closeSidebar();
        });
        
        // Menu toggle
        const menuBtn = item.querySelector('.document-menu-btn');
        const menu = item.querySelector('.document-menu');
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.classList.contains('show');
            // Close all other menus
            document.querySelectorAll('.document-menu.show').forEach(m => {
                m.classList.remove('show');
                m.previousElementSibling.setAttribute('aria-expanded', 'false');
            });
            if (!isOpen) {
                menu.classList.add('show');
                menuBtn.setAttribute('aria-expanded', 'true');
            }
        });
        
        // Menu actions
        const viewBtn = menu.querySelector('.view-pdf');
        const deleteBtn = menu.querySelector('.delete');
        viewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.remove('show');
            menuBtn.setAttribute('aria-expanded', 'false');
            openPdfViewer(doc);
        });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            menu.classList.remove('show');
            menuBtn.setAttribute('aria-expanded', 'false');
            deleteDocument(doc.id, e);
        });
        
        documentList.appendChild(item);
    });
}

// Close menus when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.document-menu-btn') && !e.target.closest('.document-menu')) {
        document.querySelectorAll('.document-menu.show').forEach(menu => {
            menu.classList.remove('show');
            const btn = menu.previousElementSibling;
            if (btn && btn.classList.contains('document-menu-btn')) {
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    }
});

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
                    if (msg.role === 'user') {
                        addMessage(msg.role, msg.content);
                    } else if (msg.role === 'assistant') {
                        // Create assistant message with proper structure
                        const { messageDiv, contentDiv, messageId } = createMessage('assistant');
                        
                        // Check if this was a summarization response
                        if (msg.is_summarization) {
                            messageDiv.classList.add('summary-mode');
                            
                            contentDiv.innerHTML = `
                                <div class="summary-header">
                                    <div class="summary-icon">📋</div>
                                    <span>Summary Mode</span>
                                    ${msg.section_number ? `<span class="summary-section-badge">Section ${msg.section_number}</span>` : ''}
                                </div>
                                <div class="summary-content">${msg.content}</div>
                            `;
                        } else {
                            // Regular response - display formatted HTML content immediately
                            contentDiv.innerHTML = msg.content;
                        }
                        
                        // Add citations if available
                        if (msg.sources && msg.sources.length > 0) {
                            addCitations(contentDiv, msg.sources);
                        }
                        
                        // Add feedback section for AI responses
                        addFeedbackSection(contentDiv, messageId);
                        attachCopyButton(messageDiv, contentDiv, 'assistant');
                    }
                    if (msg.role === 'user') {
                        const { messageDiv: uDiv, contentDiv: uContent } = createMessage('user');
                        uContent.textContent = msg.content;
                        attachCopyButton(uDiv, uContent, 'user');
                    }
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
    updateScrollButton();
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

// In-page confirmation modal for document deletion
let __pendingDeleteId = null;

function openConfirmModal(title, text, onConfirm, options = {}) {
    const overlay = document.getElementById('confirmOverlay');
    const titleEl = document.getElementById('confirmTitle');
    const textEl = document.getElementById('confirmText');
    const btnCancel = document.getElementById('confirmCancel');
    const btnConfirm = document.getElementById('confirmConfirm');

    if (!overlay || !btnCancel || !btnConfirm) return;

    titleEl.textContent = title || 'Confirm action';
    textEl.textContent = text || 'Are you sure?';
    const confirmLabel = options.confirmLabel || 'Confirm';
    const cancelLabel = options.cancelLabel || 'Cancel';
    btnConfirm.textContent = confirmLabel;
    btnCancel.textContent = cancelLabel;

    const close = () => {
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        btnCancel.onclick = null;
        btnConfirm.onclick = null;
        document.body.style.overflow = '';
    };

    btnCancel.onclick = close;
    btnConfirm.onclick = async () => {
        try {
            await onConfirm();
            close();
        } catch (e) {
            close();
        }
    };

    overlay.classList.add('show');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
}

// Document deletion function using modal
async function deleteDocument(docId, event) {
    // Prevent the document click event from firing
    if (event) event.stopPropagation();
    __pendingDeleteId = docId;

    openConfirmModal(
        'Delete document?',
        'Are you sure you want to delete this document? This action cannot be undone.',
        async () => {
            const id = __pendingDeleteId;
            __pendingDeleteId = null;
            try {
                const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Failed to delete document');
                // Remove from local documents array
                documents = documents.filter(doc => doc.id !== id);
                // If this was the current document, clear it
                if (currentDocument && currentDocument.id === id) {
                    currentDocument = null;
                    chatMessages.innerHTML = `
                        <div class="welcome-message">
                            <h2>Start a conversation</h2>
                            <p>Upload a PDF document to begin chatting with it</p>
                        </div>
                    `;
                }
                saveDocuments();
                updateDocumentList();
                showToast('Document deleted', 'success');
            } catch (error) {
                console.error('Error deleting document:', error);
                showToast('Failed to delete document', 'error');
            }
        },
        { confirmLabel: 'Delete', cancelLabel: 'Cancel' }
    );
}

// Prompt to upload when trying to send without a PDF
function promptUploadFirst() {
    openConfirmModal(
        'No document yet',
        'Upload a PDF to start chatting.',
        () => {
            openFileInput();
        },
        { confirmLabel: 'Upload PDF', cancelLabel: 'Cancel' }
    );
}

// PDF Viewer
let __currentPdfDoc = null;
let __currentPdfPageNum = 1;
let __pdfViewerContainer = null;
let __pdfPages = [];

// Configure PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

async function openPdfViewer(doc) {
    const overlay = document.getElementById('pdfViewerOverlay');
    const titleEl = document.getElementById('pdfViewerTitle');
    const bodyEl = document.getElementById('pdfViewerBody');
    const closeBtn = document.getElementById('pdfViewerClose');
    const pdfViewerContainer = document.getElementById('pdfViewerContainer');
    const prevBtn = document.getElementById('pdfViewerPrev');
    const nextBtn = document.getElementById('pdfViewerNext');
    const pageNumInput = document.getElementById('pdfViewerPageNum');
    const pageCountEl = document.getElementById('pdfViewerPageCount');
    const askPrompt = document.getElementById('pdfAskPrompt');
    const askInput = document.getElementById('pdfAskInput');
    const askCancel = document.getElementById('pdfAskCancel');
    const askSend = document.getElementById('pdfAskSend');

    if (!overlay || !titleEl || !bodyEl || !closeBtn || !pdfViewerContainer) return;

    titleEl.textContent = doc.name;
    __pdfViewerContainer = pdfViewerContainer;
    pdfViewerContainer.innerHTML = '<div class="pdfViewer" id="pdfViewer"></div>';

    const close = () => {
        overlay.style.display = 'none';
        overlay.setAttribute('aria-hidden', 'true');
        closeBtn.onclick = null;
        prevBtn.onclick = null;
        nextBtn.onclick = null;
        pageNumInput.onchange = null;
        askCancel.onclick = null;
        askSend.onclick = null;
        __currentPdfDoc = null;
        __pdfPages = [];
        __pdfViewerContainer = null;
        document.body.style.overflow = '';
    };

    const goToPage = (num) => {
        if (!__currentPdfDoc || num < 1 || num > __currentPdfDoc.numPages) return;
        __currentPdfPageNum = num;
        pageNumInput.value = num;
        prevBtn.disabled = num <= 1;
        nextBtn.disabled = num >= __currentPdfDoc.numPages;
        // Scroll the page into view
        const pageEl = document.getElementById(`pdfPage${num}`);
        if (pageEl) pageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const hideAskPrompt = () => {
        askPrompt.style.display = 'none';
        askInput.value = '';
    };

    const showAskPromptAt = (x, y, selectedText) => {
        // Preserve selection range
        const sel = document.getSelection();
        const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        askPrompt.style.left = `${Math.min(Math.max(x, 8), pdfViewerContainer.offsetWidth - askPrompt.offsetWidth - 8)}px`;
        askPrompt.style.top = `${Math.min(Math.max(y, 8), pdfViewerContainer.offsetHeight - askPrompt.offsetHeight - 8)}px`;
        askPrompt.style.display = 'block';
        askInput.focus();
        // Restore selection after focus
        if (range) {
            setTimeout(() => {
                sel.removeAllRanges();
                sel.addRange(range);
            }, 0);
        }
        askSend.onclick = () => {
            const q = askInput.value.trim();
            if (!q) return;
            hideAskPrompt();
            overlay.style.display = 'none';
            overlay.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
            // Close viewer and switch to chat with context
            if (currentDocument && currentDocument.id === doc.id) {
                // Already the active doc; just send the question with context
                messageInput.value = `${q}\n\nContext from PDF: "${selectedText}"`;
                sendMessage();
            } else {
                // Switch to the document and send
                currentDocument = doc;
                updateDocumentList();
                loadChatHistory().then(() => {
                    messageInput.value = `${q}\n\nContext from PDF: "${selectedText}"`;
                    sendMessage();
                });
            }
        };
    };

    // Text selection handling
    let selectionTimeout = null;
    pdfViewerContainer.addEventListener('mouseup', (e) => {
        clearTimeout(selectionTimeout);
        selectionTimeout = setTimeout(() => {
            const sel = document.getSelection();
            const text = sel.toString().trim();
            if (text && text.length > 3) {
                const rect = pdfViewerContainer.getBoundingClientRect();
                showAskPromptAt(e.clientX - rect.left, e.clientY - rect.top, text);
            } else {
                hideAskPrompt();
            }
        }, 200);
    });

    // Hide prompt when clicking away
    document.addEventListener('mousedown', (e) => {
        if (!askPrompt.contains(e.target)) {
            hideAskPrompt();
        }
    });

    askCancel.onclick = hideAskPrompt;

    closeBtn.onclick = close;
    prevBtn.onclick = () => goToPage(__currentPdfPageNum - 1);
    nextBtn.onclick = () => goToPage(__currentPdfPageNum + 1);
    pageNumInput.onchange = () => goToPage(parseInt(pageNumInput.value, 10) || 1);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    }, { once: true });

    // Show fullscreen
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    // Load and render PDF
    try {
        let serverFilename = doc.server_filename;
        // Fallback for legacy documents: reconstruct server filename from id and name
        if (!serverFilename && doc.id && doc.name) {
            serverFilename = `${doc.id}_${doc.name}`;
        }
        if (!serverFilename) {
            pdfViewerContainer.innerHTML = '<p>File not found on server.</p>';
            return;
        }
        const url = `/uploads/${serverFilename}`;
        const loadingTask = pdfjsLib.getDocument(url);
        const pdfDoc = await loadingTask.promise;
        __currentPdfDoc = pdfDoc;
        pageCountEl.textContent = pdfDoc.numPages;

        // Render all pages as text-only for easy selection
        const pdfViewer = document.getElementById('pdfViewer');
        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
            const page = await pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();

            const pageContainer = document.createElement('div');
            pageContainer.className = 'page';
            pageContainer.id = `pdfPage${pageNum}`;

            // Build HTML string from text items for natural selection
            let html = '';
            textContent.items.forEach(item => {
                const txt = item.str;
                if (txt) {
                    // Escape HTML
                    const escaped = txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                    // Detect possible headings: bold font, all caps (reasonable length), ending with colon, or larger font
                    const isHeading = (
                        (item.fontName && item.fontName.includes('Bold')) ||
                        (txt === txt.toUpperCase() && txt.length > 5 && txt.length < 80) ||
                        (txt.endsWith(':') && txt.length < 80) ||
                        (item.fontSize && item.fontSize > 16)
                    );
                    const tag = isHeading ? 'h3' : 'span';
                    if (item.hasEOL) {
                        html += `<${tag}>${escaped}</${tag}>`;
                    } else {
                        html += `<${tag}>${escaped}</${tag}>`;
                    }
                }
            });
            pageContainer.innerHTML = html;
            pdfViewer.appendChild(pageContainer);
            __pdfPages.push({ pageNum, element: pageContainer });
        }
        await goToPage(1);
    } catch (e) {
        console.error('Failed to load PDF:', e);
        pdfViewerContainer.innerHTML = '<p>Failed to load PDF.</p>';
    }
}
