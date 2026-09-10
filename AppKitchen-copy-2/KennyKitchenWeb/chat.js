// Chat Page - Direct Messages & Group Chats
// Display names and avatars are ALWAYS resolved from profiles (source of truth).
// Message history sender strings are never used for display.

const CHAT_STORAGE_KEY = 'kennyKitchen_chatMessages';
const CHAT_CONVOS_KEY = 'kennyKitchen_chatConvos';
const CHAT_SYNC_INTERVAL_MS = 8000;
let chatProfiles = [];
let chatAdminAvatarUrl = null;
let dmChannelInsertMap = {};
let dmChannelMeta = {};

function applyResolvedNavIdentity() {
    const admin = window.currentAdminUser;
    if (!admin) return;
    if (typeof window.kkRefreshNavIdentity === 'function') {
        // auth.js owns top-right identity resolution; avoid chat-specific overrides.
        window.kkRefreshNavIdentity(admin).catch(() => {});
        return;
    }
    const byId = (chatProfiles || []).find(p => p.id === admin.id) || null;
    const byEmail = (chatProfiles || []).find(p =>
        normalizeChatKey(p.email) && normalizeChatKey(p.email) === normalizeChatKey(admin.email || '')
    ) || null;
    const profile = byId || byEmail;
    const resolvedName = (
        profile?.display_name ||
        profile?.employee_name ||
        (document.querySelector('.user-profile span')?.textContent || '').trim() ||
        (admin.email || '').trim()
    ).trim();
    const resolvedAvatar = (
        (profile?.avatar_url || '').trim() ||
        (chatAdminAvatarUrl || '').trim() ||
        null
    );

    const label = document.querySelector('.nav-user .user-profile span');
    if (label && resolvedName) label.textContent = resolvedName;
    if (resolvedAvatar) {
        document.querySelectorAll('.nav-user .user-avatar').forEach((img) => {
            img.src = resolvedAvatar;
        });
    }
}

function normalizeChatKey(v) {
    return (v || '').trim().toLowerCase();
}

function normalizeChatLoose(v) {
    return normalizeChatKey(v).replace(/[^a-z0-9]/g, '');
}

function emailLocalPart(v) {
    return (v || '').split('@')[0].trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function buildSortedDmChannelId(idA, idB) {
    if (!idA || !idB) return null;
    const a = (idA || '').trim().toLowerCase();
    const b = (idB || '').trim().toLowerCase();
    return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
}

function parseDmParticipantWeb(channelId, myIds) {
    if (!channelId || !channelId.startsWith('dm:')) return null;
    const rest = channelId.slice(3);
    const idx = rest.indexOf(':');
    if (idx < 0) return null;
    const a = rest.slice(0, idx);
    const b = rest.slice(idx + 1);
    if (!a || !b) return null;
    const aIsMe = myIds.has(normalizeChatKey(a));
    const bIsMe = myIds.has(normalizeChatKey(b));
    if (!aIsMe && !bIsMe) return null;
    if (aIsMe && bIsMe) return null;
    return aIsMe ? normalizeChatKey(b) : normalizeChatKey(a);
}

/** Stable "me" UUID for canonical DM channel strings (merges auth uid + profile id). */
function canonicalMeAnchorForDm(myIds, currentSender) {
    const eid = normalizeChatKey(currentSender?.employeeId || '');
    if (eid) return eid;
    const sorted = [...myIds].filter(Boolean).sort();
    return sorted[0] || '';
}

function getMyWebProfileIds() {
    const ids = new Set();
    const adminId = normalizeChatKey(window.currentAdminUser?.id);
    const adminEmail = normalizeChatKey(window.currentAdminUser?.email);
    if (adminId) ids.add(adminId);
    const meta = resolveCurrentSenderMeta();
    if (meta.employeeId) ids.add(normalizeChatKey(meta.employeeId));
    const myDisplayLoose = normalizeChatLoose(meta.senderDisplay || '');
    (chatProfiles || []).forEach(p => {
        const matchById = normalizeChatKey(p.user_id) === adminId || normalizeChatKey(p.id) === adminId;
        const matchByEmail = adminEmail && normalizeChatKey(p.email) === adminEmail;
        const matchByName = myDisplayLoose && (
            normalizeChatLoose(p.display_name) === myDisplayLoose ||
            normalizeChatLoose(p.employee_name) === myDisplayLoose ||
            normalizeChatLoose(buildProfileDisplayName(p)) === myDisplayLoose
        );
        if (matchById || matchByEmail || matchByName) {
            if (p.id) ids.add(normalizeChatKey(p.id));
            if (p.user_id) ids.add(normalizeChatKey(p.user_id));
        }
    });
    return ids;
}

function buildProfileDisplayName(p, fallback = '') {
    const first = (p?.first_name || '').trim();
    const last = (p?.last_name || '').trim();
    const combined = [first, last].filter(Boolean).join(' ').trim();
    return (combined || p?.display_name || p?.employee_name || fallback || '').trim();
}

function looksLikeCurrentUser(rawSender, currentSender) {
    const s = normalizeChatKey(rawSender);
    if (!s) return false;
    const a = normalizeChatKey(currentSender?.senderDisplay || '');
    const b = normalizeChatKey(currentSender?.senderKey || '');
    const al = normalizeChatLoose(currentSender?.senderDisplay || '');
    const bl = normalizeChatLoose(currentSender?.senderKey || '');
    return (
        s === a ||
        s === b ||
        normalizeChatLoose(rawSender) === al ||
        normalizeChatLoose(rawSender) === bl ||
        s === 'you'
    );
}

function getInitials(name) {
    return (name || 'U')
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
}

function renderAvatarMarkup(name, avatarUrl, className) {
    if (avatarUrl) {
        return `<img src="${escapeChatHtml(avatarUrl)}" alt="${escapeChatHtml(name || 'User')}" class="${className}">`;
    }
    return `<div class="${className} avatar-fallback"><span>${escapeChatHtml(getInitials(name))}</span></div>`;
}

async function loadChatProfiles() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const [{ data, error }, { data: adminData }, { data: allAdminProfiles }] = await Promise.all([
        window.supabaseClient
            .from('profiles')
            .select('id, user_id, employee_name, display_name, first_name, last_name, avatar_url, email')
            .eq('org_id', window.ORG_ID),
        window.currentAdminUser?.id
            ? window.supabaseClient
                .from('admin_profiles')
                .select('user_id, avatar_url, display_name, first_name, last_name')
                .eq('user_id', window.currentAdminUser.id)
                .maybeSingle()
                .then(r => ({ data: r.data }))
            : Promise.resolve({ data: null }),
        window.supabaseClient
            .from('admin_profiles')
            .select('user_id, avatar_url, display_name, first_name, last_name')
            .then(r => ({ data: r.data || [] }))
            .catch(() => ({ data: [] })),
    ]);
    if (error) {
        console.warn('[Supabase] Profiles load failed for chat:', error.message);
        return;
    }
    const adminByUserId = {};
    (allAdminProfiles || []).forEach((a) => {
        const key = normalizeChatKey(a?.user_id);
        if (!key) return;
        adminByUserId[key] = a;
    });

    chatProfiles = (data || [])
        .filter(p => !!p.id && (p.employee_name || p.display_name || p.email || p.first_name || p.last_name || '').trim())
        .map((p) => ({
            ...p,
            first_name: (p.first_name || adminByUserId[normalizeChatKey(p.user_id)]?.first_name || '').trim(),
            last_name: (p.last_name || adminByUserId[normalizeChatKey(p.user_id)]?.last_name || '').trim(),
            avatar_url: (p.avatar_url || adminByUserId[normalizeChatKey(p.user_id)]?.avatar_url || '').trim() || null,
            display_name: buildProfileDisplayName({
                ...p,
                first_name: p.first_name || adminByUserId[normalizeChatKey(p.user_id)]?.first_name || '',
                last_name: p.last_name || adminByUserId[normalizeChatKey(p.user_id)]?.last_name || '',
                display_name: p.display_name || adminByUserId[normalizeChatKey(p.user_id)]?.display_name || '',
            }, p.display_name || p.employee_name || ''),
        }));
    chatAdminAvatarUrl = (adminData?.avatar_url || '').trim() || null;

    const withAvatars = chatProfiles.filter(p => !!p.avatar_url);
    console.log(`[Chat] Loaded ${chatProfiles.length} profiles, ${withAvatars.length} have avatar_url.`,
        withAvatars.length === 0 ? 'Upload profile pictures in Supabase profiles.avatar_url to see them here.' : '');
    if (withAvatars.length > 0) {
        console.log('[Chat] Profiles with avatars:', withAvatars.map(p => `${p.display_name || p.employee_name}: ${p.avatar_url}`));
    }

    // Merge current admin into chatProfiles so we can resolve their display name by UUID
    const admin = window.currentAdminUser;
    if (admin?.id) {
        const adminDisplay = (adminData?.display_name || '').trim()
            || [adminData?.first_name, adminData?.last_name].filter(Boolean).join(' ').trim()
            || (document.querySelector('.user-profile span')?.textContent || '').trim()
            || (admin.user_metadata?.full_name || admin.user_metadata?.name || '').trim()
            || (admin.email || '').split('@')[0];
        const existing = chatProfiles.find(p => p.id === admin.id);
        if (!existing) {
            chatProfiles = [...chatProfiles, {
                id: admin.id,
                employee_name: adminDisplay,
                display_name: adminDisplay,
                avatar_url: chatAdminAvatarUrl || null,
                email: admin.email || null,
            }];
        } else if (adminDisplay && !existing.display_name) {
            chatProfiles = chatProfiles.map(p =>
                p.id === admin.id ? { ...p, display_name: adminDisplay, avatar_url: chatAdminAvatarUrl || p.avatar_url } : p
            );
        }
    }
    applyResolvedNavIdentity();
}

function resolveProfileById(id) {
    if (!id) return null;
    const needle = normalizeChatKey(id);
    return (chatProfiles || []).find(p =>
        normalizeChatKey(p.id) === needle || normalizeChatKey(p.user_id) === needle
    ) || null;
}

/** Always use profile as source of truth. Never use message-history sender strings. */
function resolveDisplayName(profileId, fallback = '') {
    const p = resolveProfileById(profileId);
    return buildProfileDisplayName(p, fallback);
}

function resolveProfileByAny(raw) {
    const key = normalizeChatKey(raw);
    const loose = normalizeChatLoose(raw);
    if (!key) return null;
    return (chatProfiles || []).find((p) => {
        const employee = normalizeChatKey(p.employee_name);
        const display = normalizeChatKey(p.display_name);
        const email = normalizeChatKey(p.email);
        const emailLocal = normalizeChatKey(emailLocalPart(p.email));
        const combined = normalizeChatKey(buildProfileDisplayName(p));
        return (
            key === employee ||
            key === display ||
            key === email ||
            key === emailLocal ||
            key === combined ||
            loose === normalizeChatLoose(p.employee_name) ||
            loose === normalizeChatLoose(p.display_name) ||
            loose === normalizeChatLoose(emailLocalPart(p.email)) ||
            loose === normalizeChatLoose(buildProfileDisplayName(p))
        );
    }) || null;
}

/** Resolve sender display and avatar. Always from profile when we have UUID. */
function resolveSenderMeta(rawSender, employeeId = null) {
    const pid = employeeId || null;
    const rawFallback = (rawSender || '').trim() || 'Unknown user';
    if (pid && /^[0-9a-fA-F-]{36}$/.test(pid)) {
        const p = resolveProfileById(pid);
        return {
            sender: resolveDisplayName(pid, rawFallback),
            avatar: (p?.avatar_url || '').trim() || null,
        };
    }
    const key = normalizeChatKey(rawSender);
    const looseKey = normalizeChatLoose(rawSender);
    if (!key) {
        return { sender: rawFallback, avatar: null };
    }
    const match = (chatProfiles || []).find(p => {
        const employeeKey = normalizeChatKey(p.employee_name);
        const displayKey = normalizeChatKey(p.display_name);
        const combinedKey = normalizeChatKey(buildProfileDisplayName(p));
        const emailKey = normalizeChatKey(p.email);
        const emailLocal = normalizeChatKey(emailLocalPart(p.email));
        const employeeLoose = normalizeChatLoose(p.employee_name);
        const displayLoose = normalizeChatLoose(p.display_name);
        return (
            key === employeeKey ||
            key === displayKey ||
            key === combinedKey ||
            key === emailKey ||
            key === emailLocal ||
            looseKey === employeeLoose ||
            looseKey === displayLoose ||
            looseKey === normalizeChatLoose(emailLocalPart(p.email)) ||
            looseKey === normalizeChatLoose(buildProfileDisplayName(p))
        );
    });
    return {
        sender: buildProfileDisplayName(match, rawFallback),
        avatar: (match?.avatar_url || '').trim() || null,
    };
}

function resolveCurrentSenderMeta() {
    const label = getCurrentChatUser();
    const key = normalizeChatKey(label);
    const loose = normalizeChatLoose(label);
    const currentEmail = normalizeChatKey(window.currentAdminUser?.email || '');

    const match = (chatProfiles || []).find((p) => {
        const employee = normalizeChatKey(p.employee_name);
        const display = normalizeChatKey(p.display_name);
        const email = normalizeChatKey(p.email);
        const emailLocal = normalizeChatKey(emailLocalPart(p.email));
        const combined = normalizeChatKey(buildProfileDisplayName(p));
        return (
            key === employee ||
            key === display ||
            key === combined ||
            loose === normalizeChatLoose(p.employee_name) ||
            loose === normalizeChatLoose(p.display_name) ||
            loose === normalizeChatLoose(buildProfileDisplayName(p)) ||
            (!!currentEmail && (currentEmail === email || currentEmail === emailLocal))
        );
    }) || null;

    const avatar = (match?.avatar_url || '').trim() || chatAdminAvatarUrl || null;
    const resolvedDisplay = buildProfileDisplayName(match, label || 'You');
    return {
        senderKey: resolvedDisplay,
        senderDisplay: resolvedDisplay,
        senderAvatar: avatar || null,
        employeeId: match?.id || null,
    };
}

async function populateChatEmployees() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        const { data: profiles } = await window.supabaseClient
            .from('profiles')
            .select('id, employee_name, display_name')
            .eq('org_id', window.ORG_ID);

        const data = (profiles || []).filter(p => !!p.id && (p.employee_name || '').trim());
        if (!data.length) return;

        const dmSelect = document.getElementById('dm-recipient');
        if (dmSelect) {
            dmSelect.innerHTML = '<option value="">Select recipient...</option>';
            data.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id || p.employee_name;
                opt.dataset.employeeName = p.employee_name || '';
                opt.textContent = resolveDisplayName(p.id, p.display_name || p.employee_name);
                dmSelect.appendChild(opt);
            });
        }

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
                span.textContent = resolveDisplayName(p.id, p.display_name || p.employee_name);
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
        .select('channel_id, sender, text, created_at, employee_id')
        .eq('org_id', window.ORG_ID)
        .order('created_at', { ascending: true });
    if (error) {
        console.warn('[Supabase] Chat load failed:', error.message);
        return;
    }
    const prevDmMeta = { ...dmChannelMeta };
    dmChannelInsertMap = {};
    dmChannelMeta = {};
    Object.keys(conversationMessages).forEach((k) => {
        if (k !== 'announcements') delete conversationMessages[k];
    });
    const byChannel = {};
    const currentSender = resolveCurrentSenderMeta();

    const myIds = getMyWebProfileIds();

    (data || []).forEach(m => {
        const channelId = (m.channel_id || '').trim();
        if (!channelId) return;
        const d = new Date(m.created_at);
        let threadId = channelId;
        let insertChannelId = channelId;
        let senderId = m.employee_id || null;
        if (!senderId && m.sender) {
            const senderProfile = resolveProfileByAny(m.sender);
            senderId = senderProfile?.id || null;
        }

        if (channelId.startsWith('dm:') && channelId.indexOf(':', 3) > 3) {
            const rest = channelId.slice(3);
            const idx = rest.indexOf(':');
            const leftId = idx > -1 ? normalizeChatKey(rest.slice(0, idx)) : '';
            const rightId = idx > -1 ? normalizeChatKey(rest.slice(idx + 1)) : '';
            if (!UUID_RE.test(leftId) || !UUID_RE.test(rightId)) return;
            if (leftId === rightId) return;
            // Privacy: only load DMs where this browser user's profile/auth ids match one side of the channel.
            // Never guess "the other person" by display name — that showed other employees' DMs to managers.
            const amInDm = myIds.has(leftId) || myIds.has(rightId);
            if (!amInDm) return;

            let participantId = parseDmParticipantWeb(channelId, myIds);
            if (!participantId) {
                participantId = myIds.has(leftId) ? rightId : leftId;
            }
            if (!participantId) return;
            if (myIds.has(participantId)) return;
            const meAnchor = canonicalMeAnchorForDm(myIds, currentSender);
            if (!meAnchor) return;
            const canonicalId = buildSortedDmChannelId(meAnchor, participantId);
            if (!canonicalId) return;
            threadId = canonicalId;
            insertChannelId = canonicalId;
            const targetProfile = resolveProfileById(participantId);
            const resolvedName = resolveDisplayName(participantId, '');
            const prev =
                prevDmMeta[threadId] ||
                prevDmMeta[channelId] ||
                null;
            const senderIsMe = !!senderId && myIds.has(normalizeChatKey(senderId));
            const senderMetaForFallback = resolveSenderMeta(m.sender || '', senderId || null);
            const fallbackNameFromSender = senderIsMe ? '' : (senderMetaForFallback.sender || '').trim();
            const fallbackAvatarFromSender = senderIsMe ? null : (senderMetaForFallback.avatar || null);
            dmChannelMeta[threadId] = {
                name:
                    resolvedName ||
                    (prev?.name && prev.name !== 'Direct Message' ? prev.name : '') ||
                    fallbackNameFromSender ||
                    'Direct Message',
                avatar:
                    (targetProfile?.avatar_url || '').trim() ||
                    prev?.avatar ||
                    fallbackAvatarFromSender ||
                    null,
            };
        } else if (!channelId.startsWith('group-')) {
            return;
        }

        const senderMeta = resolveSenderMeta(m.sender || '', senderId);

        if (!byChannel[threadId]) byChannel[threadId] = [];
        dmChannelInsertMap[threadId] = insertChannelId;
        byChannel[threadId].push({
            sender: senderMeta.sender,
            senderId: senderId || null,
            text: m.text,
            time: formatChatTime(d),
            ts: d.toISOString(),
            avatar: senderMeta.avatar,
        });
    });
    Object.keys(byChannel).forEach(ch => {
        conversationMessages[ch] = byChannel[ch];
    });
}

async function loadAnnouncementsFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    let { data, error } = await window.supabaseClient
        .from('announcements')
        .select('created_by, created_by_id, message, created_at')
        .eq('org_id', window.ORG_ID)
        .order('created_at', { ascending: true });
    if (error && /created_by_id/i.test(error.message || '')) {
        const fallback = await window.supabaseClient
            .from('announcements')
            .select('created_by, message, created_at')
            .eq('org_id', window.ORG_ID)
            .order('created_at', { ascending: true });
        data = fallback.data;
        error = fallback.error;
    }
    if (error) {
        console.warn('[Supabase] Announcements load failed:', error.message);
        return;
    }
    conversationMessages['announcements'] = (data || []).map(a => {
        const senderMeta = resolveSenderMeta(a.created_by || '', a.created_by_id || null);
        return {
            sender: senderMeta.sender,
            senderId: a.created_by_id || null,
            text: a.message || '',
            time: formatChatTime(new Date(a.created_at)),
            ts: new Date(a.created_at).toISOString(),
            avatar: senderMeta.avatar,
        };
    });
}

function loadChatMessages() { return null; }
function saveChatMessages() { if (!window.supabaseClient || !window.ORG_ID) return; }
function loadExtraConvos() { return []; }
function saveExtraConvos() {}

const conversationMessages = { 'announcements': [] };
let chatSyncTimer = null;
let chatSyncInitialized = false;

function clearSeededChatUI() {
    const list = document.querySelector('.conversations-list');
    if (list) list.innerHTML = '';
    const thread = document.getElementById('chat-thread');
    if (thread) thread.innerHTML = '';
}

async function initChatSync() {
    if (chatSyncInitialized) return;
    chatSyncInitialized = true;
    await syncChatFromSupabase();
    await populateChatEmployees();
    const active = document.querySelector('.conversation-item.active');
    if (active) switchConversation(active);
    if (!chatSyncTimer) {
        chatSyncTimer = setInterval(syncChatFromSupabase, CHAT_SYNC_INTERVAL_MS);
    }
}

document.addEventListener('DOMContentLoaded', function () {
    const dc = document.querySelector('.dashboard-container');
    if (dc) { dc.style.height = '100vh'; dc.style.maxHeight = '100vh'; dc.style.overflow = 'hidden'; }
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100vh';

    clearSeededChatUI();
    window.addEventListener('supabase-ready', initChatSync, { once: true });
    if (window.supabaseClient && window.ORG_ID) initChatSync();

    checkManagerStatus();
    setupChatModals();
    setupConversationSwitching();
    setupChatInput();
    scrollChatToBottom();
    if (typeof setupNotificationBell === 'function') setupNotificationBell();
});

async function syncChatFromSupabase() {
    await loadChatProfiles();
    await loadChatMessagesFromSupabase();
    await loadAnnouncementsFromSupabase();
    rebuildConversationsFromSupabase();
    const active = document.querySelector('.conversation-item.active');
    if (active) switchConversation(active);
}

function getLatestPreview(messages) {
    return (messages && messages.length > 0) ? (messages[messages.length - 1]?.text || '') : '';
}

function getMessageTimestamp(message) {
    const ts = message?.ts || message?.created_at || null;
    if (!ts) return 0;
    const val = Date.parse(ts);
    return Number.isNaN(val) ? 0 : val;
}

function getLatestConversationTimestamp(chatId) {
    const messages = conversationMessages[chatId] || [];
    return messages.length ? Math.max(...messages.map(getMessageTimestamp)) : 0;
}

function titleFromChannelId(channelId) {
    if (!channelId) return 'Chat';
    if (channelId === 'announcements') return 'Announcements';
    if (channelId.startsWith('dm:') && channelId.indexOf(':', 3) > 3) {
        const meta = dmChannelMeta[channelId];
        if (meta?.name && meta.name !== 'Direct Message') return meta.name;
        const myIds = getMyWebProfileIds();
        const participantId = parseDmParticipantWeb(channelId, myIds);
        return participantId ? resolveDisplayName(participantId, 'Direct Message') : (meta?.name || 'Direct Message');
    }
    if (channelId.startsWith('group-')) {
        const raw = channelId.slice(6).replace(/-/g, ' ');
        return raw.split(' ').filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || 'Group Chat';
    }
    return channelId;
}

function rebuildConversationsFromSupabase() {
    const list = document.querySelector('.conversations-list');
    if (!list) return;
    const activeId = document.querySelector('.conversation-item.active')?.dataset?.chatId || null;
    list.querySelectorAll('.conversation-item').forEach(item => item.remove());

    const idsInOrder = Object.keys(conversationMessages)
        .filter(id => !!id && (id === 'announcements' || (conversationMessages[id] || []).length > 0))
        .sort((a, b) => getLatestConversationTimestamp(b) - getLatestConversationTimestamp(a));

    idsInOrder.forEach((id) => {
        const type = id === 'announcements' ? 'announcements' : (id.startsWith('group-') ? 'group' : 'dm');
        addConversationToSidebar(type, id, titleFromChannelId(id), getLatestPreview(conversationMessages[id]), true);
    });

    const nextActive = (activeId && document.querySelector(`.conversation-item[data-chat-id="${activeId}"]`))
        || document.querySelector('.conversation-item');
    if (nextActive) switchConversation(nextActive);
}

function scrollChatToBottom() {
    scrollChatThreadToBottom(document.getElementById('chat-thread'));
}

/**
 * Scroll chat to the latest message without fighting the layout engine.
 * Avoids scrollIntoView (scrolls wrong ancestors / jitters) and avoids many
 * staggered timeouts that visibly "nudge" the scroll position.
 */
function scrollChatThreadToBottom(thread) {
    if (!thread) return;
    const go = () => {
        thread.scrollTop = thread.scrollHeight;
    };
    let rafOnce = null;
    const afterPaint = () => {
        if (rafOnce) return;
        rafOnce = requestAnimationFrame(() => {
            rafOnce = null;
            go();
        });
    };
    go();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            go();
            thread.querySelectorAll('.chat-message img').forEach((img) => {
                if (img.complete) return;
                img.addEventListener('load', afterPaint, { once: true });
                img.addEventListener('error', afterPaint, { once: true });
            });
        });
    });
}

function checkManagerStatus() {
    const currentUser = document.querySelector('.user-profile span')?.textContent || '';
    let isManager = currentUser.toLowerCase() === 'admin';
    if (!isManager && window.getEmployeeIdFromName) {
        const positionsCache = typeof loadEmployeePositions === 'function' ? loadEmployeePositions() : null;
        if (positionsCache && positionsCache[currentUser]) {
            isManager = positionsCache[currentUser].includes('MOD') || positionsCache[currentUser].includes('FOH Manager');
        }
    }
    const createGroupBtn = document.getElementById('btn-create-group');
    if (createGroupBtn) createGroupBtn.style.display = isManager ? 'flex' : 'none';
}

function setupChatModals() {
    const newMessageBtn = document.getElementById('btn-new-message');
    const createGroupBtn = document.getElementById('btn-create-group');
    const newMessageModal = document.getElementById('new-message-modal');
    const createGroupModal = document.getElementById('create-group-modal');

    newMessageBtn?.addEventListener('click', () => openChatModal(newMessageModal, 'dm-recipient'));
    createGroupBtn?.addEventListener('click', () => openChatModal(createGroupModal, 'group-name'));

    document.getElementById('close-new-message')?.addEventListener('click', () => closeChatModal(newMessageModal));
    document.getElementById('cancel-new-message')?.addEventListener('click', () => closeChatModal(newMessageModal));
    document.getElementById('close-create-group')?.addEventListener('click', () => closeChatModal(createGroupModal));
    document.getElementById('cancel-create-group')?.addEventListener('click', () => closeChatModal(createGroupModal));

    document.getElementById('send-dm')?.addEventListener('click', handleSendDM);
    document.getElementById('create-group')?.addEventListener('click', handleCreateGroup);

    [newMessageModal, createGroupModal].forEach(modal => {
        modal?.addEventListener('click', e => { if (e.target === modal) closeChatModal(modal); });
    });

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
    if (focusEl) setTimeout(() => focusEl.focus(), 50);
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

    const selectedOpt = recipientSelect.options[recipientSelect.selectedIndex];
    const recipientName = selectedOpt?.text || recipient;
    const recipientUuid = (recipient && /^[0-9a-fA-F-]{36}$/.test(recipient)) ? recipient : null;
    if (!recipientUuid) {
        showChatToast('Recipient must have a UUID profile.', 'error');
        return;
    }
    const currentSenderForDm = resolveCurrentSenderMeta();
    if (!currentSenderForDm.employeeId) {
        showChatToast('Your profile is not loaded. Please refresh.', 'error');
        return;
    }
    const chatId = buildSortedDmChannelId(currentSenderForDm.employeeId, recipientUuid);
    if (!chatId) {
        showChatToast('Could not build DM channel.', 'error');
        return;
    }
    const recipientThreadId = chatId;

    const existingItem = document.querySelector(`[data-chat-id="${recipientThreadId}"]`);
    if (existingItem) switchConversation(existingItem);

    if (!conversationMessages[recipientThreadId]) conversationMessages[recipientThreadId] = [];

    const currentSender = resolveCurrentSenderMeta();
    const now = new Date();
    conversationMessages[recipientThreadId].push({
        sender: currentSender.senderDisplay,
        senderId: currentSender.employeeId || null,
        text: message,
        time: formatChatTime(now),
        ts: now.toISOString(),
        avatar: currentSender.senderAvatar,
    });

    dmChannelInsertMap[recipientThreadId] = chatId;
    dmChannelMeta[recipientThreadId] = { name: recipientName, avatar: resolveProfileById(recipientUuid)?.avatar_url || null };
    addConversationToSidebar('dm', recipientThreadId, recipientName, message);
    rebuildConversationsFromSupabase();

    const activeChat = document.querySelector('.conversation-item.active');
    const bubble = (activeChat && activeChat.dataset.chatId === recipientThreadId)
        ? addMessageToThread(currentSender.senderDisplay, message, formatChatTime(now), currentSender.senderAvatar, now.toISOString(), true)
        : null;

    if (window.supabaseClient && window.ORG_ID) {
        window.supabaseClient.from('messages').insert({
            org_id: window.ORG_ID,
            channel_id: chatId,
            sender: currentSender.senderKey,
            employee_id: currentSender.employeeId,
            text: message,
        }).then(async ({ error }) => {
            if (error) {
                const friendly = formatSendError(error);
                if (bubble) markMessageAsFailed(bubble, friendly);
                showChatToast(friendly, 'error');
            } else {
                showChatToast(`Message sent to ${recipientName}.`, 'success');
                try {
                    if (window.ORG_ID) {
                        const { data: tokenRows, error: tokenErr } = await window.supabaseClient
                            .from('push_tokens')
                            .select('token, employee_name')
                            .eq('org_id', window.ORG_ID);
                        const tokenRow = !tokenErr
                            ? (tokenRows || []).find(row => {
                                const key = (row.employee_name || '').trim().toLowerCase();
                                const byValue = (resolveProfileById(recipientUuid)?.employee_name || recipientName || '').trim().toLowerCase();
                                return key === byValue;
                            })
                            : null;
                        if (tokenRow?.token) {
                            fetch('https://exp.host/--/api/v2/push/send', {
                                method: 'POST',
                                headers: { 'Accept': 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    to: tokenRow.token,
                                    sound: 'default',
                                    priority: 'high',
                                    channelId: 'default',
                                    title: `New message from ${currentSender.senderDisplay}`,
                                    body: message,
                                    data: { type: 'chat_message', channelId: recipientThreadId }
                                })
                            }).catch(err => console.warn('[Push] DM send failed:', err?.message || err));
                        }
                    }
                } catch (e) { console.warn('[Supabase] Failed to notify recipient (DM):', e); }
            }
        });
    } else {
        showChatToast(`Message sent to ${recipientName}.`, 'success');
    }

    closeChatModal(document.getElementById('new-message-modal'));
}

function formatSendError(err) {
    if (!err) return 'Could not send message. Please try again.';
    const msg = (err.message || String(err)).toLowerCase();
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) return 'Check your internet connection.';
    if (msg.includes('jwt') || msg.includes('auth') || msg.includes('session')) return 'Session expired. Please refresh the page.';
    if (msg.includes('permission') || msg.includes('rls') || msg.includes('policy')) return "You don't have permission to send messages.";
    if (msg.includes('connection') || msg.includes('timeout')) return 'Could not connect. Please check your internet.';
    return err.message || 'Could not send message. Please try again.';
}

function markMessageAsFailed(bubbleEl, errorMessage) {
    if (!bubbleEl) return;
    bubbleEl.classList.add('chat-bubble--error');
    const errSpan = document.createElement('span');
    errSpan.className = 'chat-bubble-error-text';
    errSpan.textContent = errorMessage;
    bubbleEl.appendChild(errSpan);
}

function formatChatDayLabel(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '';
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleDateString([], sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

function renderThreadMessages(thread, messages, emptyLabel) {
    if (!thread) return;
    thread.style.display = 'flex';
    thread.style.flexDirection = 'column';
    thread.style.justifyContent = 'flex-start';
    if (!messages || messages.length === 0) {
        thread.innerHTML = `
            <div class="chat-message">
                ${renderAvatarMarkup('System', null, 'chat-avatar')}
                <div class="chat-bubble-wrap">
                    <div class="chat-bubble">
                        <span class="chat-sender">System</span>
                        <p class="chat-text">${escapeChatHtml(emptyLabel || 'No messages yet.')}</p>
                        <span class="chat-time">Just now</span>
                    </div>
                </div>
            </div>
        `;
        scrollChatThreadToBottom(thread);
        return;
    }

    let lastDayKey = '';
    const html = ['<div class="chat-thread-spacer" aria-hidden="true"></div>'];
    const currentSender = resolveCurrentSenderMeta();
    messages.forEach(msg => {
        const ts = getMessageTimestamp(msg);
        const dayKey = ts ? new Date(ts).toISOString().split('T')[0] : '';
        const senderLooksLikeMe =
            looksLikeCurrentUser(msg.sender, currentSender);
        const isMine = (!!msg.senderId && !!currentSender.employeeId && msg.senderId === currentSender.employeeId) || senderLooksLikeMe;
        if (dayKey && dayKey !== lastDayKey) {
            lastDayKey = dayKey;
            html.push(`<div class="chat-day-divider"><span>${escapeChatHtml(formatChatDayLabel(ts))}</span></div>`);
        }
        const avatar = (isMine ? currentSender.senderAvatar : msg.avatar) || null;
        html.push(`
            <div class="chat-message ${isMine ? 'chat-message--mine' : ''}">
                ${renderAvatarMarkup(msg.sender, avatar, 'chat-avatar')}
                <div class="chat-bubble-wrap">
                    <div class="chat-bubble">
                        <span class="chat-sender">${escapeChatHtml(msg.sender)}</span>
                        <p class="chat-text">${escapeChatHtml(msg.text)}</p>
                        <span class="chat-time">${escapeChatHtml(msg.time)}</span>
                    </div>
                </div>
            </div>
        `);
    });
    thread.innerHTML = html.join('');
    scrollChatThreadToBottom(thread);
}

function addMessageToThread(sender, text, time, avatar, ts, forceMine = false) {
    const thread = document.getElementById('chat-thread');
    if (!thread) return null;

    const messageAvatar = avatar || null;
    const parsedTs = ts ? Date.parse(ts) : Date.now();
    const dayKey = Number.isNaN(parsedTs) ? '' : new Date(parsedTs).toISOString().split('T')[0];
    const lastDayKey = thread.querySelector('.chat-message:last-of-type')?.dataset?.dayKey || '';

    if (dayKey && dayKey !== lastDayKey) {
        const divider = document.createElement('div');
        divider.className = 'chat-day-divider';
        divider.innerHTML = `<span>${escapeChatHtml(formatChatDayLabel(parsedTs))}</span>`;
        thread.appendChild(divider);
    }

    const messageEl = document.createElement('div');
    if (dayKey) messageEl.dataset.dayKey = dayKey;
    messageEl.className = `chat-message ${(forceMine || isMyChatMessage(sender)) ? 'chat-message--mine' : ''}`.trim();
    messageEl.innerHTML = `
        ${renderAvatarMarkup(sender, messageAvatar, 'chat-avatar')}
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
    const currentSender = resolveCurrentSenderMeta();

    if (window.supabaseClient && window.ORG_ID) {
        window.supabaseClient.from('messages').insert({
            org_id: window.ORG_ID,
            channel_id: groupId,
            sender: currentSender.senderKey,
            employee_id: currentSender.employeeId,
            text: `${groupName} created`,
        }).then(({ error }) => {
            if (error) {
                showChatToast(formatSendError(error), 'error');
                return;
            }
            if (!conversationMessages[groupId]) conversationMessages[groupId] = [];
            const now = new Date();
            conversationMessages[groupId].push({
                sender: currentSender.senderDisplay,
                senderId: currentSender.employeeId || null,
                text: `${groupName} created`,
                time: formatChatTime(now),
                ts: now.toISOString(),
                avatar: null,
            });
            addConversationToSidebar('group', groupId, groupName, `${selectedMembers.length} members`);
            rebuildConversationsFromSupabase();
            closeChatModal(document.getElementById('create-group-modal'));
            showChatToast(`Group "${groupName}" created.`, 'success');
        });
        return;
    }

    addConversationToSidebar('group', groupId, groupName, `${selectedMembers.length} members`);
    closeChatModal(document.getElementById('create-group-modal'));
    showChatToast(`Group "${groupName}" created.`, 'success');
}

function addConversationToSidebar(type, id, name, preview, skipSave = false) {
    const conversationsList = document.querySelector('.conversations-list');
    if (!conversationsList) return;

    if (document.querySelector(`[data-chat-id="${id}"]`)) return;

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
        let dmAvatar = null;
        if (id.startsWith('dm:') && id.indexOf(':', 3) > 3) {
            const myIds = getMyWebProfileIds();
            const pid = parseDmParticipantWeb(id, myIds);
            dmAvatar = (pid && resolveProfileById(pid)?.avatar_url) || dmChannelMeta[id]?.avatar || null;
        }
        item.innerHTML = `
            ${renderAvatarMarkup(name, dmAvatar, 'conversation-avatar')}
            <div class="conversation-info">
                <span class="conversation-name">${escapeChatHtml(name)}</span>
                <span class="conversation-preview">${escapeChatHtml(preview)}</span>
            </div>
        `;
    } else if (type === 'group') {
        item.innerHTML = `
            <i class="fas fa-users"></i>
            <div class="conversation-info">
                <span class="conversation-name">${escapeChatHtml(name)}</span>
                <span class="conversation-preview">${escapeChatHtml(preview)}</span>
            </div>
        `;
    } else {
        item.innerHTML = `
            <i class="fas fa-bullhorn"></i>
            <div class="conversation-info">
                <span class="conversation-name">${escapeChatHtml(name || 'Announcements')}</span>
                <span class="conversation-preview">${escapeChatHtml(preview)}</span>
            </div>
        `;
    }

    conversationsList.appendChild(item);
    item.addEventListener('click', () => switchConversation(item));
}

function setupConversationSwitching() {
    document.querySelectorAll('.conversation-item').forEach(item => {
        item.addEventListener('click', function () { switchConversation(this); });
    });
}

function switchConversation(item) {
    document.querySelectorAll('.conversation-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const chatType = item.dataset.chatType;
    const chatId = item.dataset.chatId || 'announcements';
    let chatTitle = item.querySelector('.conversation-name')?.textContent || 'Chat';
    if (chatType === 'dm' && (!chatTitle || chatTitle === 'Direct Message')) {
        chatTitle = titleFromChannelId(chatId);
    }

    const titleEl = document.getElementById('chat-title');
    if (titleEl) {
        if (chatType === 'announcements') {
            titleEl.innerHTML = '<i class="fas fa-bullhorn"></i> Announcements';
        } else if (chatType === 'group') {
            titleEl.innerHTML = `<i class="fas fa-users"></i> ${escapeChatHtml(chatTitle)}`;
        } else {
            const myIds = getMyWebProfileIds();
            const pid = chatId.startsWith('dm:') ? parseDmParticipantWeb(chatId, myIds) : null;
            const participantProfile = pid ? resolveProfileById(pid) : null;
            const avatarHtml = participantProfile?.avatar_url
                ? `<img src="${escapeChatHtml(participantProfile.avatar_url)}" class="chat-title-avatar" style="width:28px;height:28px;border-radius:50%;margin-right:8px;vertical-align:middle;">`
                : '<i class="fas fa-user"></i> ';
            titleEl.innerHTML = `${avatarHtml}${escapeChatHtml(chatTitle)}`;
        }
    }

    const thread = document.getElementById('chat-thread');
    if (!thread) return;

    if (chatType === 'announcements') {
        renderThreadMessages(thread, conversationMessages['announcements'] || [], 'No announcements yet.');
    } else {
        renderThreadMessages(thread, conversationMessages[chatId] || [], chatType === 'group' ? 'Group chat started' : 'Conversation started');
    }
}

function showChatToast(message, type) {
    if (typeof showNotificationToast === 'function') {
        showNotificationToast(message, type);
        return;
    }
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${type === 'error' ? SheekColors.error : SheekColors.success};
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

function getCurrentChatUser() {
    return (document.querySelector('.user-profile span')?.textContent || 'You').trim();
}

function isMyChatMessage(sender) {
    const me = getCurrentChatUser().toLowerCase();
    const s = (sender || '').trim().toLowerCase();
    if (!s) return false;
    return s === me || s === 'you';
}

function setupChatInput() {
    const input = document.getElementById('chat-message-input');
    const sendBtn = document.getElementById('chat-send-btn');

    if (!input || !sendBtn) return;

    input.value = '';
    setTimeout(() => { if (input) input.value = ''; }, 100);
    setTimeout(() => { if (input) input.value = ''; }, 500);

    sendBtn.addEventListener('click', handleSendMessage);

    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    input.addEventListener('input', function () {
        sendBtn.disabled = !(this.value || '').trim().length;
    });

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
    const insertChatId = dmChannelInsertMap[chatId] || chatId;
    const currentSender = resolveCurrentSenderMeta();

    if (chatType === 'announcements') {
        const now = new Date();
        const timestamp = formatChatTime(now);
        if (!Array.isArray(conversationMessages['announcements'])) conversationMessages['announcements'] = [];
        conversationMessages['announcements'].push({
            sender: currentSender.senderDisplay,
            senderId: currentSender.employeeId || null,
            text: message,
            time: timestamp,
            ts: now.toISOString(),
            avatar: null,
        });
        const bubble = addMessageToThread(currentSender.senderDisplay, message, timestamp, null, now.toISOString(), true);
        rebuildConversationsFromSupabase();
        if (input) {
            input.value = '';
            document.getElementById('chat-send-btn').disabled = true;
        }
        const previewEl = activeChat.querySelector('.conversation-preview');
        if (previewEl) previewEl.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;

        if (window.supabaseClient && window.ORG_ID) {
            window.supabaseClient
                .from('announcements')
                .insert({ org_id: window.ORG_ID, message, created_by: currentSender.senderDisplay, created_by_id: currentSender.employeeId || null })
                .then(async ({ error }) => {
                    if (error && /created_by_id/i.test(error.message || '')) {
                        const fallback = await window.supabaseClient
                            .from('announcements')
                            .insert({ org_id: window.ORG_ID, message, created_by: currentSender.senderDisplay });
                        error = fallback.error;
                    }
                    if (error) {
                        markMessageAsFailed(bubble, formatSendError(error));
                        showChatToast(formatSendError(error), 'error');
                    } else {
                        showChatToast('Announcement sent to all staff!', 'success');
                    }
                });
        } else {
            showChatToast('Announcement posted!', 'success');
        }
        return;
    }

    if (!conversationMessages[chatId]) conversationMessages[chatId] = [];

    const now = new Date();
    const timestamp = formatChatTime(now);
    conversationMessages[chatId].push({
        sender: currentSender.senderDisplay,
        senderId: currentSender.employeeId || null,
        text: message,
        time: timestamp,
        ts: now.toISOString(),
        avatar: currentSender.senderAvatar,
    });

    const bubble = addMessageToThread(currentSender.senderDisplay, message, timestamp, currentSender.senderAvatar, now.toISOString(), true);
    rebuildConversationsFromSupabase();

    if (window.supabaseClient && window.ORG_ID) {
        window.supabaseClient.from('messages').insert({
            org_id: window.ORG_ID,
            channel_id: insertChatId,
            sender: currentSender.senderKey,
            employee_id: currentSender.employeeId,
            text: message,
        }).then(async ({ error }) => {
            if (error) {
                markMessageAsFailed(bubble, formatSendError(error));
                showChatToast(formatSendError(error), 'error');
            } else {
                try {
                    const { data: tokens, error: tokensError } = await window.supabaseClient
                        .from('push_tokens')
                        .select('token, employee_name')
                        .eq('org_id', window.ORG_ID);

                    if (!tokensError && tokens) {
                        let pushTokens = [];
                        if (chatType === 'dm') {
                            const myIds = getMyWebProfileIds();
                            const participantUuid = parseDmParticipantWeb(chatId, myIds);
                            const recipientName = participantUuid
                                ? (resolveProfileById(participantUuid)?.employee_name || '')
                                : '';
                            const recipientTokenRow = recipientName
                                ? tokens.find(p => (p.employee_name || '').toLowerCase() === recipientName.toLowerCase())
                                : null;
                            if (recipientTokenRow?.token) pushTokens.push(recipientTokenRow.token);
                        } else if (chatType === 'group' || chatType === 'announcements') {
                            tokens.forEach(p => {
                                if (p.token && (p.employee_name || '').toLowerCase() !== currentSender.senderDisplay.toLowerCase()) {
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
                                    priority: 'high',
                                    channelId: 'default',
                                    title: chatType === 'group' || chatType === 'announcements' ? `New message in ${chatType === 'group' ? 'group' : 'announcements'} from ${currentSender.senderDisplay}` : `New message from ${currentSender.senderDisplay}`,
                                    body: message,
                                    data: { type: 'chat_message', channelId: chatId }
                                })
                            });
                        });
                    }
                } catch (e) { console.warn(e); }
            }
        });
    }

    if (input) {
        input.value = '';
        input.focus();
        document.getElementById('chat-send-btn').disabled = true;
    }

    const previewEl = activeChat.querySelector('.conversation-preview');
    if (previewEl) previewEl.textContent = message.length > 30 ? message.substring(0, 30) + '...' : message;
}
