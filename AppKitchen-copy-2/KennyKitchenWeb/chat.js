// Chat — list + thread. Heads first, hydrate the open thread only.
// Server rows are merged; the DOM is not rebuilt unless content changed.

class KitchenChatIds {
    static uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    static normalize(v) {
        return (v || '').trim().toLowerCase();
    }

    static isUuid(v) {
        return KitchenChatIds.uuidRe.test(KitchenChatIds.normalize(v));
    }

    static emailLocal(v) {
        return (v || '').split('@')[0].trim();
    }

    static buildSortedDmChannelId(idA, idB) {
        if (!idA || !idB) return null;
        const a = KitchenChatIds.normalize(idA);
        const b = KitchenChatIds.normalize(idB);
        return a < b ? `dm:${a}:${b}` : `dm:${b}:${a}`;
    }

    static parseDmParticipant(channelId, myIds) {
        if (!channelId || !channelId.startsWith('dm:')) return null;
        const rest = channelId.slice(3);
        const idx = rest.indexOf(':');
        if (idx < 0) return null;
        const a = rest.slice(0, idx);
        const b = rest.slice(idx + 1);
        if (!a || !b) return null;
        const aIsMe = myIds.has(KitchenChatIds.normalize(a));
        const bIsMe = myIds.has(KitchenChatIds.normalize(b));
        if (!aIsMe && !bIsMe) return null;
        if (aIsMe && bIsMe) return null;
        return aIsMe ? KitchenChatIds.normalize(b) : KitchenChatIds.normalize(a);
    }

    static channelType(id) {
        if (id === 'announcements') return 'announcements';
        if (String(id || '').startsWith('group-')) return 'group';
        return 'dm';
    }

    static groupTitle(channelId) {
        const raw = String(channelId || '').slice(6).replace(/-/g, ' ');
        return raw.split(' ').filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(' ') || 'Group';
    }

    static groupChannelId(name) {
        const slug = String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return slug ? `group-${slug}` : null;
    }
}

class KitchenChatStore {
    constructor() {
        this.threads = { announcements: [] };
        this.meta = {};
        this.insertMap = {};
        this.hydrated = { announcements: false };
        this.sidebarFingerprint = '';
        this.threadFingerprints = {};
        this.activeId = 'announcements';
        this.generation = 0;
    }

    static messageFingerprint(msg) {
        return [
            msg?.serverId || '',
            msg?.pending ? 'p' : 's',
            msg?.failed ? 'f' : '',
            msg?.senderId || '',
            msg?.ts || '',
            msg?.text || '',
        ].join('|');
    }

    static threadFingerprint(messages) {
        return (messages || []).map((m) => KitchenChatStore.messageFingerprint(m)).join('\n');
    }

    messagesFor(id) {
        return this.threads[id] || [];
    }

    keepPending(id) {
        return (this.threads[id] || []).filter((m) => m.pending);
    }

    mergeIncoming(id, incoming, extraMeta) {
        const pending = this.keepPending(id);
        const merged = (incoming || []).map((m) => ({ ...m, pending: false }));
        pending.forEach((opt) => {
            const hit = merged.find((m) => (
                m.text === opt.text
                && (!opt.senderId || !m.senderId || m.senderId === opt.senderId)
                && Math.abs(Date.parse(m.ts || 0) - Date.parse(opt.ts || 0)) < 120000
            ));
            if (!hit) merged.push(opt);
        });
        merged.sort((a, b) => Date.parse(a.ts || 0) - Date.parse(b.ts || 0));
        const prevFp = KitchenChatStore.threadFingerprint(this.threads[id]);
        const nextFp = KitchenChatStore.threadFingerprint(merged);
        this.threads[id] = merged;
        if (extraMeta) this.meta[id] = { ...(this.meta[id] || {}), ...extraMeta };
        const last = merged[merged.length - 1];
        if (last?.text) this.meta[id] = { ...(this.meta[id] || {}), preview: last.text, lastTs: last.ts };
        return prevFp !== nextFp;
    }

    // Latest-per-channel row for the sidebar. Never replaces a hydrated history
    // with a single stub — that was the flicker in PR #4.
    applyHead(id, head, extraMeta) {
        if (extraMeta) this.meta[id] = { ...(this.meta[id] || {}), ...extraMeta };
        if (head?.text) this.meta[id] = { ...(this.meta[id] || {}), preview: head.text, lastTs: head.ts };
        if (this.hydrated[id]) {
            if (!head) return false;
            const msgs = this.threads[id] || [];
            if (head.serverId && msgs.some((m) => m.serverId && m.serverId === head.serverId)) return false;
            const withoutPending = msgs.filter((m) => !m.pending);
            return this.mergeIncoming(id, [...withoutPending, head], extraMeta);
        }
        return this.mergeIncoming(id, head ? [head] : [], extraMeta);
    }

    hydrateIncoming(id, incoming, extraMeta) {
        if ((!incoming || incoming.length === 0) && (this.threads[id] || []).some((m) => !m.pending)) {
            this.hydrated[id] = true;
            return false;
        }
        const changed = this.mergeIncoming(id, incoming, extraMeta);
        this.hydrated[id] = true;
        return changed;
    }

    markHydrated(id) {
        this.hydrated[id] = true;
    }

    dropMissingServerThreads(serverIds, { complete } = {}) {
        if (!serverIds || !complete) return false;
        let changed = false;
        Object.keys(this.threads).forEach((id) => {
            if (id === 'announcements') return;
            if (serverIds.has(id)) return;
            if (this.keepPending(id).length) return;
            if (this.hydrated[id]) return;
            delete this.threads[id];
            delete this.meta[id];
            delete this.insertMap[id];
            delete this.threadFingerprints[id];
            delete this.hydrated[id];
            changed = true;
        });
        return changed;
    }

    pushLocal(id, msg, extraMeta) {
        if (!this.threads[id]) this.threads[id] = [];
        this.threads[id] = [...this.threads[id], msg];
        if (extraMeta) this.meta[id] = { ...(this.meta[id] || {}), ...extraMeta };
        delete this.threadFingerprints[id];
        this.sidebarFingerprint = '';
    }

    markFailed(id, ts, text, errorMessage) {
        const list = this.threads[id] || [];
        this.threads[id] = list.map((m) => (
            m.pending && m.ts === ts && m.text === text
                ? { ...m, failed: true, errorMessage }
                : m
        ));
        delete this.threadFingerprints[id];
    }

    sidebarItems() {
        const ids = Object.keys(this.threads).filter((id) => {
            if (id === 'announcements') return true;
            return (this.threads[id] || []).length > 0 || !!(this.meta[id]?.preview);
        });
        ids.sort((a, b) => {
            const tb = Date.parse(this.meta[b]?.lastTs || '') || KitchenChatStore.latestTs(this.threads[b]);
            const ta = Date.parse(this.meta[a]?.lastTs || '') || KitchenChatStore.latestTs(this.threads[a]);
            return tb - ta;
        });
        return ids.map((id) => {
            const messages = this.threads[id] || [];
            const last = messages[messages.length - 1];
            return {
                id,
                type: KitchenChatIds.channelType(id),
                title: this.titleFor(id),
                preview: this.meta[id]?.preview || last?.text || '',
                avatar: this.meta[id]?.avatar || null,
            };
        });
    }

    titleFor(id) {
        if (id === 'announcements') return 'Announcements';
        if (id.startsWith('group-')) return this.meta[id]?.name || KitchenChatIds.groupTitle(id);
        return this.meta[id]?.name || 'Direct Message';
    }

    static latestTs(messages) {
        if (!messages || !messages.length) return 0;
        return Math.max(...messages.map((m) => {
            const val = Date.parse(m?.ts || '');
            return Number.isNaN(val) ? 0 : val;
        }));
    }
}

class KitchenChatPermissions {
    static async canCreateGroup() {
        if (window.kkCanManageOrg === true) return true;
        const user = window.currentAdminUser;
        if (!user?.id || !window.supabaseClient) return false;
        try {
            const [{ data: adminRow }, { data: mgrRows }] = await Promise.all([
                window.supabaseClient
                    .from('admin_users')
                    .select('is_admin')
                    .eq('user_id', user.id)
                    .maybeSingle(),
                window.supabaseClient
                    .from('org_members')
                    .select('org_id, role')
                    .eq('user_id', user.id)
                    .in('role', ['manager', 'owner'])
                    .limit(8),
            ]);
            const isAdmin = !!(adminRow && adminRow.is_admin);
            const orgId = window.ORG_ID;
            const isMgr = (mgrRows || []).some((r) => !orgId || r.org_id === orgId);
            window.kkCanManageOrg = isAdmin || isMgr;
            return window.kkCanManageOrg;
        } catch (_) {
            return !!window.kkCanManageOrg;
        }
    }

    static applyCreateGroupButton(canCreate) {
        const btn = document.getElementById('btn-create-group');
        if (!btn) return;
        btn.hidden = !canCreate;
        btn.style.display = canCreate ? 'flex' : 'none';
        btn.setAttribute('aria-hidden', canCreate ? 'false' : 'true');
    }
}

class KitchenChat {
    constructor() {
        this.store = new KitchenChatStore();
        this.profiles = [];
        this.adminAvatarUrl = null;
        this.syncing = false;
        this.syncQueued = false;
        this.syncQueuedOpts = null;
        this.syncTimer = null;
        this.realtime = null;
        this.realtimeTimer = null;
        this.hydrating = {};
        this.initialized = false;
        this.meIds = new Set();
        this.senderMeta = { senderKey: 'You', senderDisplay: 'You', senderAvatar: null, employeeId: null };
    }

    static POLL_MS = 20000;
    static THREAD_LIMIT = 80;
    static ANNOUNCEMENT_LIMIT = 80;
    static HEAD_SCAN_LIMIT = 400;

    static escape(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
    }

    static initials(name) {
        return (name || 'U')
            .split(/\s+/)
            .filter(Boolean)
            .map((part) => part[0])
            .join('')
            .slice(0, 2)
            .toUpperCase();
    }

    static formatTime(date) {
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    static formatDay(ts) {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return '';
        const now = new Date();
        const sameYear = d.getFullYear() === now.getFullYear();
        return d.toLocaleDateString([], sameYear
            ? { weekday: 'short', month: 'short', day: 'numeric' }
            : { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    }

    static avatarMarkup(name, avatarUrl, className) {
        if (avatarUrl) {
            return `<img src="${KitchenChat.escape(avatarUrl)}" alt="${KitchenChat.escape(name || 'User')}" class="${className}">`;
        }
        return `<div class="${className} avatar-fallback"><span>${KitchenChat.escape(KitchenChat.initials(name))}</span></div>`;
    }

    static personName(p, fallback = '') {
        const first = (p?.first_name || '').trim();
        const last = (p?.last_name || '').trim();
        const combined = [first, last].filter(Boolean).join(' ').trim();
        return (combined || p?.display_name || p?.employee_name || fallback || '').trim();
    }

    static sendError(err) {
        if (!err) return 'Could not send message. Please try again.';
        const msg = (err.message || String(err)).toLowerCase();
        if (msg.includes('fetch') || msg.includes('network') || msg.includes('failed to fetch')) return 'Check your internet connection.';
        if (msg.includes('jwt') || msg.includes('auth') || msg.includes('session')) return 'Session expired. Please refresh the page.';
        if (msg.includes('permission') || msg.includes('rls') || msg.includes('policy')) return "You don't have permission to send that.";
        if (msg.includes('connection') || msg.includes('timeout')) return 'Could not connect. Please check your internet.';
        return err.message || 'Could not send message. Please try again.';
    }

    static toast(message, type) {
        if (typeof showNotificationToast === 'function') {
            showNotificationToast(message, type);
            return;
        }
        const toast = document.createElement('div');
        toast.className = 'chat-toast';
        const bg = (typeof SheekColors !== 'undefined' && SheekColors.toast)
            ? SheekColors.toast(type)
            : (type === 'error' ? '#A94F47' : '#52705A');
        toast.style.cssText = `position:fixed;bottom:20px;right:20px;background:${bg};color:#fff;padding:0.85rem 1.25rem;border-radius:12px;z-index:10001;font-weight:600;max-width:320px;`;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    profileById(id) {
        const needle = KitchenChatIds.normalize(id);
        if (!needle) return null;
        return this.profiles.find((p) => (
            KitchenChatIds.normalize(p.id) === needle
            || KitchenChatIds.normalize(p.user_id) === needle
        )) || null;
    }

    displayName(profileId, fallback = '') {
        return KitchenChat.personName(this.profileById(profileId), fallback);
    }

    navLabel() {
        return (document.querySelector('.user-profile span')?.textContent || 'You').trim();
    }

    refreshMe() {
        const adminId = KitchenChatIds.normalize(window.currentAdminUser?.id);
        const adminEmail = KitchenChatIds.normalize(window.currentAdminUser?.email);
        const ids = new Set();
        if (adminId) ids.add(adminId);

        const match = this.profiles.find((p) => {
            const byUser = adminId && KitchenChatIds.normalize(p.user_id) === adminId;
            const byId = adminId && KitchenChatIds.normalize(p.id) === adminId;
            const byEmail = adminEmail && KitchenChatIds.normalize(p.email) === adminEmail;
            return byUser || byId || byEmail;
        }) || null;

        if (match?.id) ids.add(KitchenChatIds.normalize(match.id));
        if (match?.user_id) ids.add(KitchenChatIds.normalize(match.user_id));

        const avatar = (match?.avatar_url || '').trim() || this.adminAvatarUrl || null;
        const resolvedDisplay = KitchenChat.personName(match, this.navLabel() || 'You');
        this.meIds = ids;
        this.senderMeta = {
            senderKey: resolvedDisplay,
            senderDisplay: resolvedDisplay,
            senderAvatar: avatar,
            employeeId: match?.id || null,
        };
        return this.senderMeta;
    }

    meAnchor() {
        const eid = KitchenChatIds.normalize(this.senderMeta.employeeId || '');
        if (eid) return eid;
        return [...this.meIds].filter(Boolean).sort()[0] || '';
    }

    isMine(msg) {
        if (msg?.senderId && this.senderMeta.employeeId && msg.senderId === this.senderMeta.employeeId) return true;
        if (msg?.senderId && this.meIds.has(KitchenChatIds.normalize(msg.senderId))) return true;
        return false;
    }

    applyNavIdentity() {
        const admin = window.currentAdminUser;
        if (!admin) return;
        if (typeof window.kkRefreshNavIdentity === 'function') {
            window.kkRefreshNavIdentity(admin).catch(() => {});
        }
    }

    async loadProfiles() {
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
                    .then((r) => ({ data: r.data }))
                : Promise.resolve({ data: null }),
            window.supabaseClient
                .from('admin_profiles')
                .select('user_id, avatar_url, display_name, first_name, last_name')
                .then((r) => ({ data: r.data || [] }))
                .catch(() => ({ data: [] })),
        ]);
        if (error) {
            console.warn('[Supabase] Profiles load failed for chat:', error.message);
            return;
        }

        const adminByUserId = {};
        (allAdminProfiles || []).forEach((a) => {
            const key = KitchenChatIds.normalize(a?.user_id);
            if (key) adminByUserId[key] = a;
        });

        this.profiles = (data || [])
            .filter((p) => !!p.id && (p.employee_name || p.display_name || p.email || p.first_name || p.last_name || '').trim())
            .map((p) => {
                const admin = adminByUserId[KitchenChatIds.normalize(p.user_id)];
                const first = (p.first_name || admin?.first_name || '').trim();
                const last = (p.last_name || admin?.last_name || '').trim();
                const row = { ...p, first_name: first, last_name: last, avatar_url: (p.avatar_url || admin?.avatar_url || '').trim() || null };
                row.display_name = KitchenChat.personName(row, p.display_name || p.employee_name || '');
                return row;
            });

        this.adminAvatarUrl = (adminData?.avatar_url || '').trim() || null;
        const admin = window.currentAdminUser;
        if (admin?.id && !this.profiles.some((p) => p.id === admin.id || p.user_id === admin.id)) {
            const adminDisplay = (adminData?.display_name || '').trim()
                || [adminData?.first_name, adminData?.last_name].filter(Boolean).join(' ').trim()
                || this.navLabel()
                || (admin.user_metadata?.full_name || admin.user_metadata?.name || '').trim()
                || (admin.email || '').split('@')[0];
            this.profiles = [...this.profiles, {
                id: admin.id,
                user_id: admin.id,
                employee_name: adminDisplay,
                display_name: adminDisplay,
                avatar_url: this.adminAvatarUrl || null,
                email: admin.email || null,
            }];
        }
        this.refreshMe();
        this.applyNavIdentity();
    }

    async populatePeoplePickers() {
        const dmSelect = document.getElementById('dm-recipient');
        const groupList = document.querySelector('.member-select-list');
        const myId = KitchenChatIds.normalize(this.senderMeta.employeeId);
        const people = this.profiles.filter((p) => p.id && KitchenChatIds.normalize(p.id) !== myId);

        if (dmSelect) {
            const previous = dmSelect.value;
            dmSelect.innerHTML = '<option value="">Select teammate…</option>';
            people.forEach((p) => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = this.displayName(p.id, p.display_name || p.employee_name);
                dmSelect.appendChild(opt);
            });
            if (previous && people.some((p) => p.id === previous)) dmSelect.value = previous;
        }

        if (groupList) {
            const checked = new Set([...groupList.querySelectorAll('input:checked')].map((el) => el.value));
            groupList.innerHTML = '';
            people.forEach((p) => {
                const label = document.createElement('label');
                label.className = 'member-checkbox';
                const input = document.createElement('input');
                input.type = 'checkbox';
                input.value = p.id;
                input.checked = checked.has(p.id);
                const span = document.createElement('span');
                span.textContent = this.displayName(p.id, p.display_name || p.employee_name);
                label.appendChild(input);
                label.appendChild(span);
                groupList.appendChild(label);
            });
        }
    }

    mapServerMessage(row, channelId) {
        const senderId = row.employee_id || null;
        const profile = senderId ? this.profileById(senderId) : null;
        const sender = KitchenChat.personName(profile, (row.sender || '').trim() || 'Unknown user');
        const created = new Date(row.created_at);
        return {
            serverId: row.id || null,
            sender,
            senderId,
            text: row.text || '',
            time: KitchenChat.formatTime(created),
            ts: created.toISOString(),
            avatar: (profile?.avatar_url || '').trim() || null,
            pending: false,
        };
    }

    classifyChannel(row) {
        const channelId = (row?.channel_id || '').trim();
        if (!channelId) return null;
        let threadId = channelId;
        let meta = null;

        if (channelId.startsWith('dm:') && channelId.indexOf(':', 3) > 3) {
            const rest = channelId.slice(3);
            const idx = rest.indexOf(':');
            const leftId = idx > -1 ? KitchenChatIds.normalize(rest.slice(0, idx)) : '';
            const rightId = idx > -1 ? KitchenChatIds.normalize(rest.slice(idx + 1)) : '';
            if (!KitchenChatIds.isUuid(leftId) || !KitchenChatIds.isUuid(rightId) || leftId === rightId) return null;
            if (!this.meIds.has(leftId) && !this.meIds.has(rightId)) return null;
            const participantId = KitchenChatIds.parseDmParticipant(channelId, this.meIds);
            if (!participantId) return null;
            const meAnchor = this.meAnchor();
            if (!meAnchor) return null;
            const canonicalId = KitchenChatIds.buildSortedDmChannelId(meAnchor, participantId);
            if (!canonicalId) return null;
            threadId = canonicalId;
            const target = this.profileById(participantId);
            meta = {
                name: this.displayName(participantId, this.store.meta[threadId]?.name || 'Direct Message'),
                avatar: (target?.avatar_url || '').trim() || this.store.meta[threadId]?.avatar || null,
            };
        } else if (channelId.startsWith('group-')) {
            meta = {
                name: this.store.meta[threadId]?.name || KitchenChatIds.groupTitle(channelId),
                avatar: null,
            };
        } else {
            return null;
        }

        return { threadId, insertChannelId: channelId, meta };
    }

    uniqueHeads(rows) {
        const seen = new Set();
        const heads = [];
        (rows || []).forEach((row) => {
            const channelId = (row?.channel_id || '').trim();
            if (!channelId || seen.has(channelId)) return;
            seen.add(channelId);
            heads.push(row);
        });
        return heads;
    }

    async fetchConversationHeadRows() {
        if (!window.supabaseClient || !window.ORG_ID) return { rows: [], complete: false };
        try {
            const rpc = await window.supabaseClient.rpc('kk_chat_conversation_heads', { p_org_id: window.ORG_ID });
            if (!rpc.error && Array.isArray(rpc.data)) {
                return { rows: rpc.data, complete: true };
            }
        } catch (_) { /* RPC not deployed — scan recent rows instead */ }

        const { data, error } = await window.supabaseClient
            .from('messages')
            .select('id, channel_id, sender, text, created_at, employee_id')
            .eq('org_id', window.ORG_ID)
            .order('created_at', { ascending: false })
            .limit(KitchenChat.HEAD_SCAN_LIMIT);
        if (error) {
            console.warn('[Supabase] Chat heads load failed:', error.message);
            return { rows: [], complete: false };
        }
        return { rows: this.uniqueHeads(data), complete: false };
    }

    applyConversationHeads(rows, complete) {
        this.refreshMe();
        const serverIds = new Set();
        const seenThread = new Set();
        const ordered = (rows || []).slice().sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
        ordered.forEach((m) => {
            const classified = this.classifyChannel(m);
            if (!classified) return;
            if (seenThread.has(classified.threadId)) return;
            seenThread.add(classified.threadId);
            serverIds.add(classified.threadId);
            this.store.insertMap[classified.threadId] = classified.insertChannelId;
            this.store.applyHead(
                classified.threadId,
                this.mapServerMessage(m, classified.threadId),
                classified.meta
            );
        });
        if (complete && this.meIds.size > 0) {
            this.store.dropMissingServerThreads(serverIds, { complete: true });
        }
    }

    async fetchAnnouncementRows() {
        if (!window.supabaseClient || !window.ORG_ID) return null;
        const selectFull = 'id, created_by, created_by_id, message, created_at';
        const selectLite = 'id, created_by, message, created_at';
        let { data, error } = await window.supabaseClient
            .from('announcements')
            .select(selectFull)
            .eq('org_id', window.ORG_ID)
            .order('created_at', { ascending: false })
            .limit(KitchenChat.ANNOUNCEMENT_LIMIT);
        if (error && /created_by_id/i.test(error.message || '')) {
            const fallback = await window.supabaseClient
                .from('announcements')
                .select(selectLite)
                .eq('org_id', window.ORG_ID)
                .order('created_at', { ascending: false })
                .limit(KitchenChat.ANNOUNCEMENT_LIMIT);
            data = fallback.data;
            error = fallback.error;
        }
        if (error) {
            console.warn('[Supabase] Announcements load failed:', error.message);
            return null;
        }
        return (data || []).slice().reverse();
    }

    applyAnnouncements(rows) {
        if (!rows) return;
        const incoming = rows.map((a) => {
            const profile = this.profileById(a.created_by_id);
            const created = new Date(a.created_at);
            return {
                serverId: a.id || null,
                sender: KitchenChat.personName(profile, (a.created_by || '').trim() || 'Unknown user'),
                senderId: a.created_by_id || null,
                text: a.message || '',
                time: KitchenChat.formatTime(created),
                ts: created.toISOString(),
                avatar: (profile?.avatar_url || '').trim() || null,
                pending: false,
            };
        });
        this.store.mergeIncoming('announcements', incoming, { name: 'Announcements' });
        this.store.markHydrated('announcements');
    }

    async loadAnnouncements() {
        const rows = await this.fetchAnnouncementRows();
        this.applyAnnouncements(rows);
    }

    threadChannelIds(id) {
        const mapped = this.store.insertMap[id] || id;
        return mapped && mapped !== id ? [mapped, id] : [id];
    }

    async loadActiveThread(id = this.store.activeId) {
        if (!id || id === 'announcements') {
            await this.loadAnnouncements();
            return;
        }
        if (!window.supabaseClient || !window.ORG_ID) return;
        if (this.hydrating[id]) return this.hydrating[id];
        this.hydrating[id] = (async () => {
            const channelIds = this.threadChannelIds(id);
            let query = window.supabaseClient
                .from('messages')
                .select('id, channel_id, sender, text, created_at, employee_id')
                .eq('org_id', window.ORG_ID)
                .order('created_at', { ascending: false })
                .limit(KitchenChat.THREAD_LIMIT);
            query = channelIds.length === 1
                ? query.eq('channel_id', channelIds[0])
                : query.in('channel_id', channelIds);
            const { data, error } = await query;
            if (error) {
                console.warn('[Supabase] Thread load failed:', error.message);
                return;
            }
            const chronological = (data || []).slice().reverse();
            this.store.hydrateIncoming(id, chronological.map((m) => this.mapServerMessage(m, id)));
        })().finally(() => { delete this.hydrating[id]; });
        return this.hydrating[id];
    }

    async hydrateActive() {
        const id = this.store.activeId || 'announcements';
        await this.loadActiveThread(id);
        this.renderSidebar();
        if (this.store.activeId === id) this.renderActiveThread();
    }

    async sync(opts = {}) {
        const { profiles = false, hydrate = true } = opts;
        if (this.syncing) {
            this.syncQueued = true;
            this.syncQueuedOpts = {
                profiles: !!(this.syncQueuedOpts?.profiles || profiles),
                hydrate: this.syncQueuedOpts?.hydrate !== false && hydrate,
            };
            return;
        }
        this.syncing = true;
        try {
            const needProfiles = profiles || !this.profiles.length;
            const profilesP = needProfiles ? this.loadProfiles() : Promise.resolve(this.refreshMe());
            const headsP = this.fetchConversationHeadRows();
            const annP = this.fetchAnnouncementRows();
            await profilesP;
            const [headResult, annRows] = await Promise.all([headsP, annP]);
            this.applyConversationHeads(headResult.rows, headResult.complete);
            if (annRows) this.applyAnnouncements(annRows);
            this.renderSidebar();
            this.renderActiveThread();
            if (hydrate && this.store.activeId && this.store.activeId !== 'announcements') {
                await this.loadActiveThread(this.store.activeId);
                this.renderSidebar();
                this.renderActiveThread();
            }
        } finally {
            this.syncing = false;
            if (this.syncQueued) {
                this.syncQueued = false;
                const queued = this.syncQueuedOpts || {};
                this.syncQueuedOpts = null;
                this.sync(queued);
            }
        }
    }

    subscribeRealtime() {
        if (!window.supabaseClient || !window.ORG_ID || this.realtime) return;
        const bump = () => {
            clearTimeout(this.realtimeTimer);
            this.realtimeTimer = setTimeout(() => this.sync({ hydrate: true }), 250);
        };
        this.realtime = window.supabaseClient
            .channel(`kitchen-chat-${window.ORG_ID}`)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `org_id=eq.${window.ORG_ID}` }, bump)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `org_id=eq.${window.ORG_ID}` }, bump)
            .subscribe();
    }

    renderSidebar() {
        const list = document.querySelector('.conversations-list');
        if (!list) return;
        const items = this.store.sidebarItems();
        const fp = items.map((i) => `${i.id}|${i.title}|${i.preview}`).join('\n');
        if (fp === this.store.sidebarFingerprint && list.querySelectorAll('.conversation-item').length === items.length) {
            this.markActive();
            return;
        }
        this.store.sidebarFingerprint = fp;
        const existing = new Map([...list.querySelectorAll('.conversation-item')].map((el) => [el.dataset.chatId, el]));
        const used = new Set();
        items.forEach((item, idx) => {
            let el = existing.get(item.id);
            if (!el) el = this.buildSidebarItem(item);
            else this.updateSidebarItem(el, item);
            used.add(item.id);
            const current = list.children[idx];
            if (current !== el) list.insertBefore(el, current || null);
        });
        existing.forEach((el, id) => { if (!used.has(id)) el.remove(); });
        this.markActive();
    }

    buildSidebarItem(item) {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'conversation-item';
        el.dataset.chatType = item.type;
        el.dataset.chatId = item.id;
        this.updateSidebarItem(el, item);
        return el;
    }

    updateSidebarItem(el, item) {
        el.dataset.chatType = item.type;
        el.dataset.chatId = item.id;
        let media = '';
        if (item.type === 'dm') media = KitchenChat.avatarMarkup(item.title, item.avatar, 'conversation-avatar');
        else if (item.type === 'group') media = '<span class="conversation-icon" aria-hidden="true"><i class="fas fa-users"></i></span>';
        else media = '<span class="conversation-icon" aria-hidden="true"><i class="fas fa-bullhorn"></i></span>';
        el.innerHTML = `
            ${media}
            <span class="conversation-info">
                <span class="conversation-name">${KitchenChat.escape(item.title)}</span>
                <span class="conversation-preview">${KitchenChat.escape(item.preview)}</span>
            </span>
        `;
    }

    markActive() {
        const activeId = this.store.activeId;
        document.querySelectorAll('.conversation-item').forEach((el) => {
            el.classList.toggle('active', el.dataset.chatId === activeId);
        });
    }

    openConversation(id, { forceScroll } = {}) {
        if (!id) return;
        const switched = this.store.activeId !== id;
        this.store.activeId = id;
        this.markActive();
        this.renderHeader();
        this.renderActiveThread({ forceScroll: forceScroll || switched });
        const input = document.getElementById('chat-message-input');
        if (input) input.focus();
        this.hydrateActive();
    }

    renderHeader() {
        const titleEl = document.getElementById('chat-title');
        if (!titleEl) return;
        const id = this.store.activeId;
        const type = KitchenChatIds.channelType(id);
        const title = this.store.titleFor(id);
        if (type === 'announcements') {
            titleEl.innerHTML = '<i class="fas fa-bullhorn"></i><span>Announcements</span>';
        } else if (type === 'group') {
            titleEl.innerHTML = `<i class="fas fa-users"></i><span>${KitchenChat.escape(title)}</span>`;
        } else {
            const participantId = KitchenChatIds.parseDmParticipant(id, this.meIds);
            const profile = participantId ? this.profileById(participantId) : null;
            const avatar = profile?.avatar_url
                ? `<img src="${KitchenChat.escape(profile.avatar_url)}" alt="" class="chat-title-avatar">`
                : '<i class="fas fa-user"></i>';
            titleEl.innerHTML = `${avatar}<span>${KitchenChat.escape(title)}</span>`;
        }
        const thread = document.getElementById('chat-thread');
        if (thread) thread.dataset.chatKind = type;
    }

    nearBottom(thread) {
        if (!thread) return true;
        return thread.scrollHeight - thread.scrollTop - thread.clientHeight < 96;
    }

    scrollToBottom(thread) {
        if (!thread) return;
        const go = () => { thread.scrollTop = thread.scrollHeight; };
        go();
        requestAnimationFrame(() => requestAnimationFrame(go));
    }

    renderActiveThread({ forceScroll } = {}) {
        const thread = document.getElementById('chat-thread');
        if (!thread) return;
        const id = this.store.activeId || 'announcements';
        const messages = this.store.messagesFor(id);
        const fp = KitchenChatStore.threadFingerprint(messages);
        const already = thread.dataset.renderedId === id && this.store.threadFingerprints[id] === fp;
        if (already) {
            if (forceScroll) this.scrollToBottom(thread);
            return;
        }
        const stick = forceScroll || this.nearBottom(thread) || thread.dataset.renderedId !== id;
        const prevScroll = thread.scrollTop;
        this.store.threadFingerprints[id] = fp;
        thread.dataset.renderedId = id;
        thread.dataset.chatKind = KitchenChatIds.channelType(id);
        thread.innerHTML = this.buildThreadHtml(id, messages);
        if (stick) this.scrollToBottom(thread);
        else thread.scrollTop = prevScroll;
        this.renderHeader();
    }

    buildThreadHtml(id, messages) {
        if (!messages || messages.length === 0) {
            const empty = id === 'announcements' ? 'No announcements yet.' : 'No messages yet.';
            return `<div class="chat-empty">${KitchenChat.escape(empty)}</div>`;
        }
        const type = KitchenChatIds.channelType(id);
        const showSender = type !== 'dm';
        let lastDay = '';
        const html = [];
        messages.forEach((msg) => {
            const ts = Date.parse(msg.ts || '');
            const dayKey = Number.isNaN(ts) ? '' : new Date(ts).toISOString().split('T')[0];
            if (dayKey && dayKey !== lastDay) {
                lastDay = dayKey;
                html.push(`<div class="chat-day-divider"><span>${KitchenChat.escape(KitchenChat.formatDay(ts))}</span></div>`);
            }
            const mine = this.isMine(msg);
            const avatar = (mine ? this.senderMeta.senderAvatar : msg.avatar) || null;
            const fail = msg.failed ? `<span class="chat-bubble-error-text">${KitchenChat.escape(msg.errorMessage || 'Not sent')}</span>` : '';
            html.push(`
                <div class="chat-message ${mine ? 'chat-message--mine' : ''} ${msg.pending ? 'chat-message--pending' : ''} ${msg.failed ? 'chat-message--failed' : ''}">
                    ${KitchenChat.avatarMarkup(msg.sender, avatar, 'chat-avatar')}
                    <div class="chat-bubble-wrap">
                        <div class="chat-bubble${msg.failed ? ' chat-bubble--error' : ''}">
                            ${showSender && !mine ? `<span class="chat-sender">${KitchenChat.escape(msg.sender)}</span>` : ''}
                            <p class="chat-text">${KitchenChat.escape(msg.text)}</p>
                            <span class="chat-time">${KitchenChat.escape(msg.time)}${msg.pending && !msg.failed ? ' · Sending' : ''}</span>
                            ${fail}
                        </div>
                    </div>
                </div>
            `);
        });
        return html.join('');
    }

    openModal(modal, focusId) {
        if (!modal) return;
        modal.classList.add('active');
        const focusEl = document.getElementById(focusId);
        if (focusEl) setTimeout(() => focusEl.focus(), 50);
    }

    closeModal(modal) {
        if (!modal) return;
        modal.classList.remove('active');
        if (modal.id === 'new-message-modal') {
            const recipient = document.getElementById('dm-recipient');
            const message = document.getElementById('dm-message');
            if (recipient) recipient.value = '';
            if (message) message.value = '';
        } else if (modal.id === 'create-group-modal') {
            const name = document.getElementById('group-name');
            if (name) name.value = '';
            modal.querySelectorAll('input[type="checkbox"]').forEach((cb) => { cb.checked = false; });
        }
    }

    async sendDmFromModal() {
        const recipientSelect = document.getElementById('dm-recipient');
        const messageTextarea = document.getElementById('dm-message');
        const recipient = (recipientSelect?.value || '').trim();
        const message = (messageTextarea?.value || '').trim();
        if (!recipient) {
            KitchenChat.toast('Please select a teammate.', 'error');
            recipientSelect?.focus();
            return;
        }
        if (!message) {
            KitchenChat.toast('Please enter a message.', 'error');
            messageTextarea?.focus();
            return;
        }
        if (!KitchenChatIds.isUuid(recipient)) {
            KitchenChat.toast('Recipient must have a profile.', 'error');
            return;
        }
        this.refreshMe();
        if (!this.senderMeta.employeeId) {
            KitchenChat.toast('Your profile is not loaded. Please refresh.', 'error');
            return;
        }
        const chatId = KitchenChatIds.buildSortedDmChannelId(this.senderMeta.employeeId, recipient);
        if (!chatId) {
            KitchenChat.toast('Could not start that conversation.', 'error');
            return;
        }
        const recipientName = recipientSelect.options[recipientSelect.selectedIndex]?.text || this.displayName(recipient, 'Direct Message');
        this.store.insertMap[chatId] = chatId;
        this.closeModal(document.getElementById('new-message-modal'));
        await this.sendToChannel(chatId, 'dm', message, {
            name: recipientName,
            avatar: this.profileById(recipient)?.avatar_url || null,
        });
        this.notifyPush({
            chatType: 'dm',
            chatId,
            message,
            recipientUuid: recipient,
            recipientName,
        });
    }

    async createGroupFromModal() {
        const allowed = await KitchenChatPermissions.canCreateGroup();
        KitchenChatPermissions.applyCreateGroupButton(allowed);
        if (!allowed) {
            KitchenChat.toast('Only managers can create group chats.', 'error');
            return;
        }
        const nameInput = document.getElementById('group-name');
        const groupName = (nameInput?.value || '').trim();
        const selected = [...document.querySelectorAll('#create-group-modal input[type="checkbox"]:checked')].map((cb) => cb.value);
        if (!groupName) {
            KitchenChat.toast('Please enter a group name.', 'error');
            nameInput?.focus();
            return;
        }
        const groupId = KitchenChatIds.groupChannelId(groupName);
        if (!groupId) {
            KitchenChat.toast('Please enter a group name.', 'error');
            return;
        }
        this.refreshMe();
        if (!this.senderMeta.employeeId) {
            KitchenChat.toast('Your profile is not loaded. Please refresh.', 'error');
            return;
        }
        this.closeModal(document.getElementById('create-group-modal'));
        await this.sendToChannel(groupId, 'group', `${groupName} created`, { name: groupName, avatar: null });
        this.notifyPush({
            chatType: 'group',
            chatId: groupId,
            message: `${groupName} created`,
            memberIds: selected,
        });
    }

    async handleComposerSend() {
        const input = document.getElementById('chat-message-input');
        const message = (input?.value || '').trim();
        if (!message) return;
        const chatId = this.store.activeId || 'announcements';
        const chatType = KitchenChatIds.channelType(chatId);
        if (input) {
            input.value = '';
            const sendBtn = document.getElementById('chat-send-btn');
            if (sendBtn) sendBtn.disabled = true;
        }
        await this.sendToChannel(chatId, chatType, message);
        this.notifyPush({ chatType, chatId, message });
    }

    async sendToChannel(chatId, chatType, message, extraMeta) {
        this.refreshMe();
        const now = new Date();
        const local = {
            serverId: null,
            sender: this.senderMeta.senderDisplay,
            senderId: this.senderMeta.employeeId || null,
            text: message,
            time: KitchenChat.formatTime(now),
            ts: now.toISOString(),
            avatar: this.senderMeta.senderAvatar,
            pending: true,
        };
        this.store.pushLocal(chatId, local, extraMeta);
        this.store.activeId = chatId;
        this.renderSidebar();
        this.renderActiveThread({ forceScroll: true });

        if (!window.supabaseClient || !window.ORG_ID) {
            KitchenChat.toast(chatType === 'announcements' ? 'Announcement posted!' : 'Message sent.', 'success');
            return;
        }

        if (chatType === 'announcements') {
            let { error } = await window.supabaseClient
                .from('announcements')
                .insert({
                    org_id: window.ORG_ID,
                    message,
                    created_by: this.senderMeta.senderDisplay,
                    created_by_id: this.senderMeta.employeeId || null,
                });
            if (error && /created_by_id/i.test(error.message || '')) {
                const fallback = await window.supabaseClient
                    .from('announcements')
                    .insert({ org_id: window.ORG_ID, message, created_by: this.senderMeta.senderDisplay });
                error = fallback.error;
            }
            if (error) {
                this.store.markFailed(chatId, local.ts, message, KitchenChat.sendError(error));
                this.renderActiveThread({ forceScroll: true });
                KitchenChat.toast(KitchenChat.sendError(error), 'error');
                return;
            }
            KitchenChat.toast('Announcement sent.', 'success');
            await this.sync({ hydrate: true });
            return;
        }

        const insertChatId = this.store.insertMap[chatId] || chatId;
        const { error } = await window.supabaseClient.from('messages').insert({
            org_id: window.ORG_ID,
            channel_id: insertChatId,
            sender: this.senderMeta.senderKey,
            employee_id: this.senderMeta.employeeId,
            text: message,
        });
        if (error) {
            this.store.markFailed(chatId, local.ts, message, KitchenChat.sendError(error));
            this.renderActiveThread({ forceScroll: true });
            KitchenChat.toast(KitchenChat.sendError(error), 'error');
            return;
        }
        await this.sync({ hydrate: true });
    }

    async notifyPush({ chatType, chatId, message, recipientUuid, recipientName, memberIds }) {
        if (!window.supabaseClient || !window.ORG_ID) return;
        try {
            const { data: tokens, error } = await window.supabaseClient
                .from('push_tokens')
                .select('token, employee_name')
                .eq('org_id', window.ORG_ID);
            if (error || !tokens) return;
            const pushTokens = [];
            if (chatType === 'dm') {
                const name = (this.profileById(recipientUuid)?.employee_name || recipientName || this.store.titleFor(chatId) || '').trim().toLowerCase();
                const row = tokens.find((t) => (t.employee_name || '').trim().toLowerCase() === name);
                if (row?.token) pushTokens.push(row.token);
            } else {
                const selectedNames = new Set((memberIds || []).map((id) => this.displayName(id, '').toLowerCase()).filter(Boolean));
                tokens.forEach((row) => {
                    const key = (row.employee_name || '').toLowerCase();
                    if (!row.token) return;
                    if (key && key === this.senderMeta.senderDisplay.toLowerCase()) return;
                    if (selectedNames.size && !selectedNames.has(key)) return;
                    pushTokens.push(row.token);
                });
            }
            const title = chatType === 'announcements'
                ? `Announcement from ${this.senderMeta.senderDisplay}`
                : chatType === 'group'
                    ? `New message in ${this.store.titleFor(chatId)}`
                    : `New message from ${this.senderMeta.senderDisplay}`;
            pushTokens.forEach((token) => {
                fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { Accept: 'application/json', 'Accept-encoding': 'gzip, deflate', 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: token,
                        sound: 'default',
                        priority: 'high',
                        channelId: 'default',
                        title,
                        body: message,
                        data: { type: 'chat_message', channelId: chatId },
                    }),
                }).catch(() => {});
            });
        } catch (e) {
            console.warn('[Push] notify failed:', e);
        }
    }

    bindUi() {
        if (this.uiBound) return;
        this.uiBound = true;

        const list = document.querySelector('.conversations-list');
        if (list && !list.dataset.kkBound) {
            list.dataset.kkBound = '1';
            list.addEventListener('click', (e) => {
                const item = e.target.closest('.conversation-item');
                if (item?.dataset.chatId) this.openConversation(item.dataset.chatId);
            });
        }

        const newMessageBtn = document.getElementById('btn-new-message');
        const createGroupBtn = document.getElementById('btn-create-group');
        const newMessageModal = document.getElementById('new-message-modal');
        const createGroupModal = document.getElementById('create-group-modal');

        newMessageBtn?.addEventListener('click', () => this.openModal(newMessageModal, 'dm-recipient'));
        createGroupBtn?.addEventListener('click', async () => {
            const allowed = await KitchenChatPermissions.canCreateGroup();
            KitchenChatPermissions.applyCreateGroupButton(allowed);
            if (!allowed) {
                KitchenChat.toast('Only managers can create group chats.', 'error');
                return;
            }
            this.openModal(createGroupModal, 'group-name');
        });

        document.getElementById('close-new-message')?.addEventListener('click', () => this.closeModal(newMessageModal));
        document.getElementById('cancel-new-message')?.addEventListener('click', () => this.closeModal(newMessageModal));
        document.getElementById('close-create-group')?.addEventListener('click', () => this.closeModal(createGroupModal));
        document.getElementById('cancel-create-group')?.addEventListener('click', () => this.closeModal(createGroupModal));
        document.getElementById('send-dm')?.addEventListener('click', () => this.sendDmFromModal());
        document.getElementById('create-group')?.addEventListener('click', () => this.createGroupFromModal());

        [newMessageModal, createGroupModal].forEach((modal) => {
            modal?.addEventListener('click', (e) => { if (e.target === modal) this.closeModal(modal); });
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (newMessageModal?.classList.contains('active')) this.closeModal(newMessageModal);
            if (createGroupModal?.classList.contains('active')) this.closeModal(createGroupModal);
        });

        const input = document.getElementById('chat-message-input');
        const sendBtn = document.getElementById('chat-send-btn');
        if (input && sendBtn) {
            input.value = '';
            sendBtn.disabled = true;
            sendBtn.addEventListener('click', () => this.handleComposerSend());
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleComposerSend();
                }
            });
            input.addEventListener('input', () => {
                sendBtn.disabled = !(input.value || '').trim().length;
            });
        }
    }

    async init() {
        const dc = document.querySelector('.dashboard-container');
        if (dc) {
            dc.style.height = '100vh';
            dc.style.maxHeight = '100vh';
            dc.style.overflow = 'hidden';
        }
        document.body.style.overflow = 'hidden';
        document.body.style.height = '100vh';

        this.bindUi();
        this.renderSidebar();
        this.renderActiveThread();
        const permP = KitchenChatPermissions.canCreateGroup().then((canCreate) => {
            KitchenChatPermissions.applyCreateGroupButton(canCreate);
        });
        await this.sync({ profiles: true, hydrate: true });
        this.populatePeoplePickers();
        this.subscribeRealtime();
        if (!this.syncTimer) this.syncTimer = setInterval(() => this.sync({ hydrate: true }), KitchenChat.POLL_MS);
        if (!this.initialized && typeof setupNotificationBell === 'function') setupNotificationBell();
        this.initialized = true;
        await permP;
    }
}

if (typeof window !== 'undefined') {
    window.KitchenChat = KitchenChat;
    window.KitchenChatStore = KitchenChatStore;
    window.KitchenChatPermissions = KitchenChatPermissions;
}

if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        const app = new KitchenChat();
        window.kitchenChat = app;
        const boot = () => app.init();
        window.addEventListener('supabase-ready', boot);
        window.addEventListener('kk-admin-authenticated', boot);
        KitchenChatPermissions.applyCreateGroupButton(false);
        app.bindUi();
        if (window.supabaseClient && window.ORG_ID) boot();
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { KitchenChatIds, KitchenChatStore, KitchenChatPermissions, KitchenChat };
}
