// Chat Page - Direct Messages & Group Chats

const CHAT_STORAGE_KEY = 'kennyKitchen_chatMessages';
const CHAT_CONVOS_KEY  = 'kennyKitchen_chatConvos';

// Seed data removed, dynamically pulled from Supabase instead

async function populateChatEmployees() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        const { data } = await window.supabaseClient.from('profiles').select('employee_name, display_name').eq('org_id', window.ORG_ID);
        if (!data || data.length === 0) return;
        
        // Populate DM dropdown
        const dmSelect = document.getElementById('dm-recipient');
        if (dmSelect) {
            dmSelect.innerHTML = '<option value="">Select recipient...</option>';
            data.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.employee_name;
                opt.textContent = p.display_name || p.employee_name;
                dmSelect.appendChild(opt);
            });
        }

        // Populate Group Create checkboxes
        const groupList = document.querySelector('.member-select-list');
        if (groupList) {
            groupList.innerHTML = '';
            data.forEach(p => {
                const label = document.createElement('label');
                label.className = 'member-checkbox';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = p.employee_name;
                const span = document.createElement('span');
                span.textContent = p.display_name || p.employee_name;
                label.appendChild(input);
                label.appendChild(span);
                groupList.appendChild(label);
            });
        }
    } catch (e) {
        console.warn('Could not populate chat employees', e);
    }
}

async function loadChatMessagesFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const { data, error } = await window.supabaseClient
        .from('messages')
        .select('channel_id, sender, text, created_at')
        .eq('org_id', window.ORG_ID)
        .order('created_at', { ascending: true });
    if (error) {
        console.warn('[Supabase] Chat load failed:', error.message);
        return;
    }
    const byChannel = {};
    (data || []).forEach(m => {
        if (!byChannel[m.channel_id]) byChannel[m.channel_id] = [];
        const d = new Date(m.created_at);
        byChannel[m.channel_id].push({
            sender: m.sender,
            text: m.text,
            time: formatChatTime(d),
            avatar: null,
        });
    });
    Object.keys(byChannel).forEach(ch => {
        if (ch !== 'announcements') {
            conversationMessages[ch] = byChannel[ch];
        }
    });
}

function loadChatMessages() {
    return null;
}

function saveChatMessages() {
    if (!window.supabaseClient || !window.ORG_ID) return;
}

function loadExtraConvos() {
    try {
        const raw = localStorage.getItem(CHAT_CONVOS_KEY);
        if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
}

function saveExtraConvos(convos) {
    try { localStorage.setItem(CHAT_CONVOS_KEY, JSON.stringify(convos)); } catch (e) {}
}

const conversationMessages = { 'announcements': null };

document.addEventListener('DOMContentLoaded', function() {
    const announcementsThread = document.getElementById('chat-thread');
    if (announcementsThread) {
        conversationMessages['announcements'] = announcementsThread.innerHTML;
    }

    window.addEventListener('supabase-ready', async function () {
        await loadChatMessagesFromSupabase();
        await populateChatEmployees();
        const active = document.querySelector('.conversation-item.active');
        if (active) switchConversation(active);
    });

    loadExtraConvos().forEach(c => {
        if (!document.querySelector(`[data-chat-id="${c.id}"]`)) {
            addConversationToSidebar(c.type, c.id, c.name, c.preview, true);
        }
    });

    checkManagerStatus();
    setupChatModals();
    setupConversationSwitching();
    setupChatInput();
    scrollChatToBottom();
    if (typeof setupNotificationBell === 'function') {
        setupNotificationBell();
    }
});

// Scroll chat thread to bottom (newest messages)
function scrollChatToBottom() {
    const thread = document.getElementById('chat-thread');
    if (thread) {
        thread.scrollTop = thread.scrollHeight;
    }
}

// Check if current user is a manager (Admin or MOD role)
function checkManagerStatus() {
    const currentUser = document.querySelector('.user-profile span')?.textContent || '';
    // We now rely on the user having admin scope or MOD scope in the EmployeePositions cache
    let isManager = currentUser.toLowerCase() === 'admin';
    if (!isManager && window.getEmployeeIdFromName) {
        const positionsCache = typeof loadEmployeePositions === 'function' ? loadEmployeePositions() : null;
        if (positionsCache && positionsCache[currentUser]) {
            isManager = positionsCache[currentUser].includes('MOD') || positionsCache[currentUser].includes('FOH Manager');
        }
    }
    
    if (isManager) {
        const createGroupBtn = document.getElementById('btn-create-group');
        if (createGroupBtn) {
            createGroupBtn.style.display = 'flex';
        }
    }
}

// Setup modals for New Message and Create Group
function setupChatModals() {
    const newMessageBtn = document.getElementById('btn-new-message');
    const createGroupBtn = document.getElementById('btn-create-group');
    const newMessageModal = document.getElementById('new-message-modal');
    const createGroupModal = document.getElementById('create-group-modal');

    newMessageBtn?.addEventListener('click', () => openChatModal(newMessageModal, 'dm-recipient'));
    createGroupBtn?.addEventListener('click', () => openChatModal(createGroupModal, 'group-name'));

    // Close buttons
    document.getElementById('close-new-message')?.addEventListener('click', () => closeChatModal(newMessageModal));
    document.getElementById('cancel-new-message')?.addEventListener('click', () => closeChatModal(newMessageModal));
    document.getElementById('close-create-group')?.addEventListener('click', () => closeChatModal(createGroupModal));
    document.getElementById('cancel-create-group')?.addEventListener('click', () => closeChatModal(createGroupModal));

    // Submit buttons
    document.getElementById('send-dm')?.addEventListener('click', handleSendDM);
    document.getElementById('create-group')?.addEventListener('click', handleCreateGroup);

    // Overlay click closes
    [newMessageModal, createGroupModal].forEach(modal => {
        modal?.addEventListener('click', e => {
            if (e.target === modal) closeChatModal(modal);
        });
    });

    // Escape key closes active modal
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (newMessageModal?.classList.contains('active')) closeChatModal(newMessageModal);
            if (createGroupModal?.classList.contains('active')) closeChatModal(createGroupModal);
        }
    });
}

function openChatModal(modal, focusId) {
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const focusEl = document.getElementById(focusId);
    if (focusEl) {
        setTimeout(() => focusEl.focus(), 50);
    }
}

function closeChatModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    resetChatModal(modal);
}

function resetChatModal(modal) {
    if (modal.id === 'new-message-modal') {
        const recipient = document.getElementById('dm-recipient');
        const message = document.getElementById('dm-message');
        if (recipient) recipient.value = '';
        if (message) message.value = '';
    } else if (modal.id === 'create-group-modal') {
        const name = document.getElementById('group-name');
        const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
        if (name) name.value = '';
        checkboxes.forEach(cb => cb.checked = false);
    }
}

// Handle sending a direct message
function handleSendDM() {
    const recipientSelect = document.getElementById('dm-recipient');
    const messageTextarea = document.getElementById('dm-message');
    const recipient = (recipientSelect?.value || '').trim();
    const message = (messageTextarea?.value || '').trim();

    if (!recipient) {
        showChatToast('Please select a recipient.', 'error');
        recipientSelect?.focus();
        return;
    }
    if (!message) {
        showChatToast('Please enter a message.', 'error');
        messageTextarea?.focus();
        return;
    }

    const recipientName = recipientSelect.options[recipientSelect.selectedIndex].text;
    const chatId = `dm-${recipient}`;
    
    // Initialize conversation if it doesn't exist
    if (!conversationMessages[chatId]) {
        conversationMessages[chatId] = [];
    }
    
    // Add the sent message to conversation data
    const currentUser = document.querySelector('.user-profile span')?.textContent || 'You';
    const currentUserAvatar = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face';
    conversationMessages[chatId].push({
        sender: currentUser,
        text: message,
        time: formatChatTime(new Date()),
        avatar: currentUserAvatar
    });

    addConversationToSidebar('dm', chatId, recipientName, message);

    const activeChat = document.querySelector('.conversation-item.active');
    const bubble = (activeChat && activeChat.dataset.chatId === chatId)
        ? addMessageToThread(currentUser, message, formatChatTime(new Date()), currentUserAvatar)
        : null;

    if (window.supabaseClient && window.ORG_ID) {
        window.supabaseClient.from('messages').insert({
            org_id: window.ORG_ID,
            channel_id: chatId,
            sender: currentUser,
            text: message,
        }).then(async ({ error }) => {
            if (error) {
                const friendly = formatSendError(error);
                if (bubble) markMessageAsFailed(bubble, friendly);
                showChatToast(friendly, 'error');
            } else {
                showChatToast(`Message sent to ${recipientName}.`, 'success');
                // Notify recipient on mobile via push_tokens table
                try {
                    if (window.ORG_ID) {
                        const { data: tokenRow, error: tokenErr } = await window.supabaseClient
                            .from('push_tokens')
                            .select('token, employee_name')
                            .eq('org_id', window.ORG_ID)
                            .eq('employee_name', recipient)
                            .maybeSingle();
                        if (!tokenErr && tokenRow?.token) {
                            fetch('https://exp.host/--/api/v2/push/send', {
                                method: 'POST',
                                headers: { 'Accept': 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    to: tokenRow.token,
                                    sound: 'default',
                                    title: `New message from ${currentUser}`,
                                    body: message,
                                    data: { type: 'chat_message', channelId: chatId }
                                })
                            }).catch(err => console.warn('[Push] DM send failed:', err?.message || err));
                        }
                    }
                } catch (e) {
                    console.warn('[Supabase] Failed to notify recipient (DM):', e);
                }
            }
        });
    } else {
        showChatToast(`Message sent to ${recipientName}.`, 'success');
    }

    closeChatModal(document.getElementById('new-message-modal'));
}

// Convert Supabase/network errors to user-friendly messages
function formatSendError(err) {
    if (!err) return 'Could not send message. Please try again.';
    const msg = (err.message || String(err)).toLowerCase();
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) return 'Check your internet connection.';
    if (msg.includes('jwt') || msg.includes('auth') || msg.includes('session')) return 'Session expired. Please refresh the page.';
    if (msg.includes('permission') || msg.includes('rls') || msg.includes('policy')) return "You don't have permission to send messages.";
    if (msg.includes('connection') || msg.includes('timeout')) return 'Could not connect. Please check your internet.';
    return err.message || 'Could not send message. Please try again.';
}

// Mark a message bubble as failed and show error text
function markMessageAsFailed(bubbleEl, errorMessage) {
    if (!bubbleEl) return;
    bubbleEl.classList.add('chat-bubble--error');
    const errSpan = document.createElement('span');
    errSpan.className = 'chat-bubble-error-text';
    errSpan.textContent = errorMessage;
    bubbleEl.appendChild(errSpan);
}

// Add a new message to the chat thread (at bottom). Returns the bubble element for error handling.
function addMessageToThread(sender, text, time, avatar) {
    const thread = document.getElementById('chat-thread');
    if (!thread) return null;

    const avatars = {
        'You': 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face',
        'Admin': 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face',
        'Rohan': 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=96&h=96&fit=crop&crop=face',
        'Kenny': 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face',
        'Natalie': 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=96&h=96&fit=crop&crop=face'
    };
    const messageAvatar = avatar || avatars[sender] || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face';

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    messageEl.innerHTML = `
        <img src="${messageAvatar}" alt="${escapeChatHtml(sender)}" class="chat-avatar">
        <div class="chat-bubble-wrap">
            <div class="chat-bubble">
                <span class="chat-sender">${escapeChatHtml(sender)}</span>
                <p class="chat-text">${escapeChatHtml(text)}</p>
                <span class="chat-time">${escapeChatHtml(time)}</span>
            </div>
        </div>
    `;
    
    thread.appendChild(messageEl);
    scrollChatToBottom();
    return messageEl.querySelector('.chat-bubble');
}

// Handle creating a group chat
function handleCreateGroup() {
    const nameInput = document.getElementById('group-name');
    const checkboxes = document.querySelectorAll('#create-group-modal input[type="checkbox"]:checked');
    const groupName = (nameInput?.value || '').trim();
    const selectedMembers = Array.from(checkboxes).map(cb => cb.value);

    if (!groupName) {
        showChatToast('Please enter a group name.', 'error');
        nameInput?.focus();
        return;
    }
    if (selectedMembers.length === 0) {
        showChatToast('Please select at least one member.', 'error');
        return;
    }

    const groupId = `group-${groupName.toLowerCase().replace(/\s+/g, '-')}`;
    addConversationToSidebar('group', groupId, groupName, `${selectedMembers.length} members`);
    closeChatModal(document.getElementById('create-group-modal'));
    showChatToast(`Group "${groupName}" created.`, 'success');
}

// Add conversation to sidebar
function addConversationToSidebar(type, id, name, preview, skipSave = false) {
    const conversationsList = document.querySelector('.conversations-list');
    if (!conversationsList) return;

    // Check if conversation already exists
    if (document.querySelector(`[data-chat-id="${id}"]`)) {
        return;
    }

    // Persist new conversation so it survives refresh
    if (!skipSave) {
        const existing = loadExtraConvos().filter(c => c.id !== id);
        existing.push({ type, id, name, preview });
        saveExtraConvos(existing);
    }

    const item = document.createElement('div');
    item.className = 'conversation-item';
    item.dataset.chatType = type;
    item.dataset.chatId = id;

    if (type === 'dm') {
        const avatars = {
            rohan: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=40&h=40&fit=crop&crop=face',
            kenny: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop&crop=face',
            natalie: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=40&h=40&fit=crop&crop=face',
            meagan: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=40&h=40&fit=crop&crop=face',
            josh: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=40&h=40&fit=crop&crop=face',
            ben: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=40&h=40&fit=crop&crop=face',
            justin: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=40&h=40&fit=crop&crop=face',
            hannah: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=40&h=40&fit=crop&crop=face',
            gary: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=40&h=40&fit=crop&crop=face'
        };
        const avatar = avatars[id.split('-')[1]] || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=40&h=40&fit=crop&crop=face';
        item.innerHTML = `
            <img src="${avatar}" alt="${name}" class="conversation-avatar">
            <div class="conversation-info">
                <span class="conversation-name">${escapeChatHtml(name)}</span>
                <span class="conversation-preview">${escapeChatHtml(preview)}</span>
            </div>
        `;
    } else {
        item.innerHTML = `
            <i class="fas fa-users"></i>
            <div class="conversation-info">
                <span class="conversation-name">${escapeChatHtml(name)}</span>
                <span class="conversation-preview">${escapeChatHtml(preview)}</span>
            </div>
        `;
    }

    conversationsList.insertBefore(item, conversationsList.firstChild.nextSibling);
    item.addEventListener('click', () => switchConversation(item));
}

// Switch between conversations
function setupConversationSwitching() {
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.addEventListener('click', function() {
            switchConversation(this);
        });
    });
}

function switchConversation(item) {
    // Remove active class from all
    document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const chatType = item.dataset.chatType;
    const chatId = item.dataset.chatId || 'announcements';
    const chatTitle = item.querySelector('.conversation-name')?.textContent || 'Chat';

    // Update header
    const titleEl = document.getElementById('chat-title');
    if (titleEl) {
        if (chatType === 'announcements') {
            titleEl.innerHTML = '<i class="fas fa-bullhorn"></i> Announcements';
        } else if (chatType === 'group') {
            titleEl.innerHTML = `<i class="fas fa-users"></i> ${escapeChatHtml(chatTitle)}`;
        } else {
            titleEl.innerHTML = `<i class="fas fa-user"></i> ${escapeChatHtml(chatTitle)}`;
        }
    }

    // Load the appropriate messages
    const thread = document.getElementById('chat-thread');
    if (!thread) return;

    if (chatType === 'announcements') {
        // Restore original announcements
        if (conversationMessages['announcements']) {
            thread.innerHTML = conversationMessages['announcements'];
        }
    } else {
        // Load messages for this conversation
        const messages = conversationMessages[chatId] || [];
        if (messages.length > 0) {
            thread.innerHTML = messages.map(msg => `
                <div class="chat-message">
                    <img src="${msg.avatar || 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face'}" alt="${escapeChatHtml(msg.sender)}" class="chat-avatar">
                    <div class="chat-bubble-wrap">
                        <div class="chat-bubble">
                            <span class="chat-sender">${escapeChatHtml(msg.sender)}</span>
                            <p class="chat-text">${escapeChatHtml(msg.text)}</p>
                            <span class="chat-time">${escapeChatHtml(msg.time)}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        } else {
            // Empty conversation
            thread.innerHTML = `
                <div class="chat-message">
                    <img src="https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face" alt="You" class="chat-avatar">
                    <div class="chat-bubble-wrap">
                        <div class="chat-bubble">
                            <span class="chat-sender">You</span>
                            <p class="chat-text">${chatType === 'group' ? 'Group chat started' : 'Conversation started'}</p>
                            <span class="chat-time">Just now</span>
                        </div>
                    </div>
                </div>
            `;
        }
    }

    // Scroll to bottom after switching
    setTimeout(() => scrollChatToBottom(), 100);
}

function showChatToast(message, type) {
    if (typeof showNotificationToast === 'function') {
        showNotificationToast(message, type);
        return;
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${type === 'error' ? '#e53e3e' : '#4CAF50'};
        color: white; padding: 1rem 1.5rem; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 10001;
        font-weight: 600; max-width: 320px;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function escapeChatHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatChatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Setup chat input (type and send messages)
function setupChatInput() {
    const input = document.getElementById('chat-message-input');
    const sendBtn = document.getElementById('chat-send-btn');
    
    if (!input || !sendBtn) return;

    // Send on button click
    sendBtn.addEventListener('click', handleSendMessage);
    
    // Send on Enter key
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Update send button state based on input
    input.addEventListener('input', function() {
        const hasText = (this.value || '').trim().length > 0;
        sendBtn.disabled = !hasText;
    });

    // Initial state
    sendBtn.disabled = true;
}

function handleSendMessage() {
    const input = document.getElementById('chat-message-input');
    const message = (input?.value || '').trim();
    
    if (!message) return;

    const activeChat = document.querySelector('.conversation-item.active');
    if (!activeChat) return;

    const chatType = activeChat.dataset.chatType;
    const chatId = activeChat.dataset.chatId || 'announcements';
    const currentUser = document.querySelector('.user-profile span')?.textContent || 'You';

    // Manager can post to announcements; save to Supabase and broadcast to staff
    if (chatType === 'announcements') {
        const timestamp = formatChatTime(new Date());
        const bubble = addMessageToThread(currentUser, message, timestamp, null);
        if (input) {
            input.value = '';
            document.getElementById('chat-send-btn').disabled = true;
        }
        const previewEl = activeChat.querySelector('.conversation-preview');
        if (previewEl) previewEl.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;

        if (window.supabaseClient && window.ORG_ID) {
            window.supabaseClient
                .from('announcements')
                .insert({ org_id: window.ORG_ID, message, created_by: currentUser })
                .then(({ error }) => {
                    if (error) {
                        const friendly = formatSendError(error);
                        markMessageAsFailed(bubble, friendly);
                        showChatToast(friendly, 'error');
                    } else {
                        showChatToast('Announcement sent to all staff!', 'success');
                    }
                });
        } else {
            showChatToast('Announcement posted!', 'success');
        }
        return;
    }

    if (!conversationMessages[chatId]) {
        conversationMessages[chatId] = [];
    }

    const currentUserAvatar = 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=96&h=96&fit=crop&crop=face';
    const timestamp = formatChatTime(new Date());
    conversationMessages[chatId].push({
        sender: currentUser,
        text: message,
        time: timestamp,
        avatar: currentUserAvatar
    });

    const bubble = addMessageToThread(currentUser, message, timestamp, currentUserAvatar);

    if (window.supabaseClient && window.ORG_ID) {
        window.supabaseClient.from('messages').insert({
            org_id: window.ORG_ID,
            channel_id: chatId,
            sender: currentUser,
            text: message,
        }).then(async ({ error }) => {
            if (error) {
                const friendly = formatSendError(error);
                markMessageAsFailed(bubble, friendly);
                showChatToast(friendly, 'error');
            } else {
                // Determine recipient or group members for notification
                try {
                    const { data: tokens, error: tokensError } = await window.supabaseClient
                        .from('push_tokens')
                        .select('token, employee_name')
                        .eq('org_id', window.ORG_ID);
                    
                    if (!tokensError && tokens) {
                        let pushTokens = [];
                        if (chatType === 'dm') {
                            const recipientId = chatId.replace('dm-', '');
                            const recipientTokenRow = tokens.find(p => 
                                (p.employee_name || '').toLowerCase() === recipientId.toLowerCase()
                            );
                            if (recipientTokenRow && recipientTokenRow.token) {
                                pushTokens.push(recipientTokenRow.token);
                            }
                        } else if (chatType === 'group' || chatType === 'announcements') {
                            // Notify everyone except sender (simple implementation)
                            tokens.forEach(p => {
                                if (p.token && (p.employee_name || '').toLowerCase() !== currentUser.toLowerCase()) {
                                    pushTokens.push(p.token);
                                }
                            });
                        }
                        
                        pushTokens.forEach(token => {
                            fetch('https://exp.host/--/api/v2/push/send', {
                                method: 'POST',
                                headers: { 'Accept': 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    to: token,
                                    sound: 'default',
                                    title: chatType === 'group' || chatType === 'announcements' ? `New message in ${chatType === 'group' ? 'group' : 'announcements'} from ${currentUser}` : `New message from ${currentUser}`,
                                    body: message,
                                    data: { type: 'chat_message', channelId: chatId }
                                })
                            });
                        });
                    }
                } catch(e) { console.warn(e); }
            }
        });
    }

    // Clear input
    if (input) {
        input.value = '';
        input.focus();
        document.getElementById('chat-send-btn').disabled = true;
    }

    // Update conversation preview in sidebar
    const previewEl = activeChat.querySelector('.conversation-preview');
    if (previewEl) {
        previewEl.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;
    }
}
