// Scheduling Page JavaScript

// Helper function to escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize approved drops storage if not exists
if (typeof window.approvedDrops === 'undefined') {
    window.approvedDrops = {};
}

// Initialize employee hours tracking (weekly)
// Structure: { employeeName: { weekStart: totalHours } }
if (typeof window.employeeHours === 'undefined') {
    window.employeeHours = {};
}

// Initialize shift data storage
// Structure: { employeeName: [{ day, startTime, endTime, hours, weekStart }] }
const SHIFT_DATA_KEY = 'kennyKitchen_shiftData';
if (typeof window.shiftData === 'undefined') {
    window.shiftData = {};
    try {
        const stored = localStorage.getItem(SHIFT_DATA_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed && typeof parsed === 'object') window.shiftData = parsed;
        }
    } catch (e) {
        console.warn('Could not load shiftData from localStorage:', e);
    }
}

function persistShiftData() {
    try {
        localStorage.setItem(SHIFT_DATA_KEY, JSON.stringify(window.shiftData || {}));
    } catch (e) {
        console.warn('Could not save shiftData to localStorage:', e);
    }
}

// Calendar history: shifts loaded from Supabase by date (so past days show correctly)
if (typeof window.calendarShiftsByDate === 'undefined') {
    window.calendarShiftsByDate = {};
}

// ── Announcements ─────────────────────────────────────────────────────────────
async function loadRecentAnnouncements() {
    const container = document.getElementById('recent-announcements');
    if (!container || !window.supabaseClient || !window.ORG_ID) return;

    const { data, error } = await window.supabaseClient
        .from('announcements')
        .select('*')
        .eq('org_id', window.ORG_ID)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error || !data || data.length === 0) {
        container.innerHTML = '<p style="font-size:12px;color:#a0aec0;text-align:center;margin:8px 0;">No announcements yet.</p>';
        return;
    }

    container.innerHTML = data.map(a => {
        const diff = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 1000);
        const ago = diff < 3600 ? `${Math.floor(diff/60)}m ago`
                  : diff < 86400 ? `${Math.floor(diff/3600)}h ago`
                  : `${Math.floor(diff/86400)}d ago`;
        return `
            <div id="ann-row-${a.id}" style="padding:10px 0;border-bottom:1px solid #f7f7f7;">
                <!-- View mode -->
                <div id="ann-view-${a.id}" style="display:flex;align-items:flex-start;gap:6px;">
                    <div style="flex:1;">
                        <p style="margin:0 0 3px;font-size:13px;color:#2d3748;line-height:1.4;">${escapeHtml(a.message)}</p>
                        <span style="font-size:11px;color:#a0aec0;">${escapeHtml(a.created_by || 'Manager')} · ${ago}</span>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;margin-top:2px;">
                        <button onclick="startEditAnnouncement('${a.id}', ${JSON.stringify(escapeHtml(a.message))})"
                            title="Edit"
                            style="background:#f0f4ff;border:none;border-radius:6px;width:26px;height:26px;
                                   cursor:pointer;color:#4a6fa5;font-size:12px;display:flex;align-items:center;justify-content:center;">
                            ✏️
                        </button>
                        <button onclick="deleteAnnouncement('${a.id}')"
                            title="Delete"
                            style="background:#fff0f0;border:none;border-radius:6px;width:26px;height:26px;
                                   cursor:pointer;color:#e53e3e;font-size:12px;display:flex;align-items:center;justify-content:center;">
                            🗑
                        </button>
                    </div>
                </div>
                <!-- Edit mode (hidden by default) -->
                <div id="ann-edit-${a.id}" style="display:none;">
                    <textarea id="ann-input-${a.id}"
                        style="width:100%;box-sizing:border-box;border:1.5px solid #63b3ed;border-radius:8px;
                               padding:8px 10px;font-size:13px;resize:none;height:60px;font-family:inherit;
                               color:#2d3748;background:#f0f8ff;outline:none;margin-bottom:6px;"
                    >${escapeHtml(a.message)}</textarea>
                    <div style="display:flex;gap:6px;">
                        <button onclick="saveEditAnnouncement('${a.id}')"
                            style="flex:1;background:#4CAF50;color:white;border:none;border-radius:7px;
                                   padding:6px;font-size:12px;font-weight:700;cursor:pointer;">
                            Save
                        </button>
                        <button onclick="cancelEditAnnouncement('${a.id}')"
                            style="flex:1;background:#f7fafc;color:#4a5568;border:1px solid #e2e8f0;
                                   border-radius:7px;padding:6px;font-size:12px;cursor:pointer;">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function startEditAnnouncement(id) {
    document.getElementById(`ann-view-${id}`).style.display = 'none';
    document.getElementById(`ann-edit-${id}`).style.display = 'block';
    const ta = document.getElementById(`ann-input-${id}`);
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
}

function cancelEditAnnouncement(id) {
    document.getElementById(`ann-edit-${id}`).style.display = 'none';
    document.getElementById(`ann-view-${id}`).style.display = 'flex';
}

async function saveEditAnnouncement(id) {
    const ta = document.getElementById(`ann-input-${id}`);
    const newMsg = ta?.value?.trim();
    if (!newMsg) return;

    const { error } = await window.supabaseClient
        .from('announcements')
        .update({ message: newMsg })
        .eq('id', id);

    if (error) {
        showNotification('Could not update: ' + error.message, 'error');
    } else {
        loadRecentAnnouncements();
    }
}

async function postAnnouncement() {
    const input = document.getElementById('announcement-input');
    const message = input?.value?.trim();
    if (!message) return;
    if (!window.supabaseClient || !window.ORG_ID) {
        showNotification('Supabase not ready yet.', 'error');
        return;
    }

    const { error } = await window.supabaseClient
        .from('announcements')
        .insert({ org_id: window.ORG_ID, message, created_by: 'Manager' });

    if (error) {
        showNotification('Could not post announcement: ' + error.message, 'error');
    } else {
        input.value = '';
        showNotification('Announcement posted — staff will see it on their app.', 'success');
        loadRecentAnnouncements();
    }
}

async function deleteAnnouncement(id) {
    if (!window.supabaseClient) return;
    await window.supabaseClient.from('announcements').delete().eq('id', id);
    loadRecentAnnouncements();
}

// ── Shift Requests ────────────────────────────────────────────────────────────

async function openShiftRequestsPanel() {
    document.getElementById('shift-requests-modal').classList.add('active');
    await loadShiftRequests();
}

async function cleanupPastShiftRequests() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        const todayStr = new Date().toISOString().split('T')[0];
        // Find all shifts in the past for this org
        const { data: pastShifts, error } = await window.supabaseClient
            .from('shifts')
            .select('id, shift_date')
            .eq('org_id', window.ORG_ID)
            .lt('shift_date', todayStr);
        if (error || !pastShifts || pastShifts.length === 0) return;
        const shiftIds = pastShifts.map(s => s.id).filter(Boolean);
        if (!shiftIds.length) return;
        // Delete any shift_requests tied to those past shifts (any status)
        await window.supabaseClient
            .from('shift_requests')
            .delete()
            .eq('org_id', window.ORG_ID)
            .in('shift_id', shiftIds);
    } catch (e) {
        console.warn('[ShiftRequests] cleanupPastShiftRequests failed:', e?.message || e);
    }
}

async function loadShiftRequests() {
    const container = document.getElementById('shift-requests-list');
    if (!container || !window.supabaseClient || !window.ORG_ID) return;

    // Remove any requests tied to shifts that are already in the past
    await cleanupPastShiftRequests();

    container.innerHTML = '<p style="color:#a0aec0;text-align:center;padding:20px 0;">Loading…</p>';

    const { data: requests, error } = await window.supabaseClient
        .from('shift_requests')
        .select('*')
        .eq('org_id', window.ORG_ID)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error || !requests || requests.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#a0aec0;">
                <i class="fas fa-check-circle" style="font-size:32px;color:#c6f6d5;margin-bottom:12px;display:block;"></i>
                No pending shift requests.
            </div>`;
        document.getElementById('requests-badge').style.display = 'none';
        return;
    }

    // Update badge count
    const badge = document.getElementById('requests-badge');
    badge.textContent = requests.length;
    badge.style.display = 'block';

    // Fetch the corresponding shift details for each request
    const shiftIds = [...new Set(requests.map(r => r.shift_id).filter(Boolean))];
    let shiftsMap = {};
    if (shiftIds.length > 0) {
        const { data: shifts } = await window.supabaseClient
            .from('shifts')
            .select('id, shift_date, start_time, end_time, position, employee_name')
            .in('id', shiftIds);
        (shifts || []).forEach(s => { shiftsMap[s.id] = s; });
    }

    container.innerHTML = requests.map(req => {
        const shift = shiftsMap[req.shift_id] || {};
        const typeLabel = req.request_type === 'time_off' ? '🕐 Time Off' : '🔄 Transfer';
        const typeColor = req.request_type === 'time_off' ? '#c05621' : '#2b6cb0';
        const typeBg   = req.request_type === 'time_off' ? '#fff5eb' : '#ebf8ff';

        const shiftDate = shift.shift_date
            ? new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : 'Unknown date';
        const shiftTime = shift.start_time
            ? `${formatTimeLabel(shift.start_time)} – ${formatTimeLabel(shift.end_time)}`
            : '';

        const ago = (() => {
            const diff = Math.floor((Date.now() - new Date(req.created_at)) / 1000);
            if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
            return `${Math.floor(diff/86400)}d ago`;
        })();

        return `
            <div style="border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;background:white;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                    <div>
                        <span style="font-weight:700;font-size:15px;color:#2d3748;">${escapeHtml(req.employee_name)}</span>
                        <span style="background:${typeBg};color:${typeColor};font-size:12px;font-weight:600;
                               padding:2px 8px;border-radius:20px;margin-left:8px;">${typeLabel}</span>
                    </div>
                    <span style="font-size:12px;color:#a0aec0;">${ago}</span>
                </div>
                <div style="background:#f7fafc;border-radius:8px;padding:10px;margin-bottom:10px;font-size:13px;color:#4a5568;">
                    <i class="fas fa-calendar-day" style="color:#4CAF50;margin-right:6px;"></i>
                    <strong>${shiftDate}</strong>${shiftTime ? ' · ' + shiftTime : ''}
                    ${shift.position ? `<span style="margin-left:8px;background:#e8f5e9;color:#276749;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:600;">${escapeHtml(shift.position)}</span>` : ''}
                </div>
                ${req.note ? `<p style="font-size:13px;color:#718096;margin:0 0 10px;font-style:italic;">"${escapeHtml(req.note)}"</p>` : ''}
                ${req.target_employee ? `<p style="font-size:12px;color:#4a6fa5;margin:0 0 10px;">Transfer to: <strong>${escapeHtml(req.target_employee)}</strong></p>` : ''}
                <div style="display:flex;gap:8px;">
                    <button onclick="approveShiftRequest('${req.id}','${req.shift_id}','${escapeHtml(req.employee_name)}','${escapeHtml(shift.position || '')}','${req.request_type}','${req.target_employee || ''}')"
                        style="flex:1;background:#4CAF50;color:white;border:none;border-radius:8px;padding:9px;
                               font-weight:700;font-size:13px;cursor:pointer;">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button onclick="denyShiftRequest('${req.id}','${escapeHtml(req.employee_name)}')"
                        style="flex:1;background:#fff0f0;color:#e53e3e;border:1.5px solid #fed7d7;border-radius:8px;
                               padding:9px;font-weight:700;font-size:13px;cursor:pointer;">
                        <i class="fas fa-times"></i> Deny
                    </button>
                </div>
            </div>`;
    }).join('');
}

function formatTimeLabel(t) {
    if (!t) return '';
    const [h, m] = t.split(':');
    const hr = parseInt(h);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

async function approveShiftRequest(requestId, shiftId, employeeName, position, requestType, targetEmployee) {
    if (!window.supabaseClient || !window.ORG_ID) return;

    // 1. Mark request approved
    await window.supabaseClient
        .from('shift_requests')
        .update({ status: 'approved' })
        .eq('id', requestId);

    // 2. Mark the shift as open (remove employee assignment)
    const { error: shiftErr } = await window.supabaseClient
        .from('shifts')
        .update({ status: 'open', employee_name: null })
        .eq('id', shiftId);

    if (shiftErr) {
        showNotification('Could not update shift: ' + shiftErr.message, 'error');
        return;
    }

    // 3. Notify employee their request was approved
    await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        type: 'request_approved',
        title: 'Request Approved',
        body: `Your ${requestType === 'time_off' ? 'time off' : 'transfer'} request has been approved.`,
        read: false,
    });

    // 4. Find all other employees who have worked this position and notify them
    const { data: capable } = await window.supabaseClient
        .from('shifts')
        .select('employee_name')
        .eq('org_id', window.ORG_ID)
        .eq('position', position)
        .neq('employee_name', employeeName)
        .not('employee_name', 'is', null);

    const uniqueEmployees = [...new Set((capable || []).map(s => s.employee_name).filter(Boolean))];

    for (const name of uniqueEmployees) {
        // In-app notification
        await window.supabaseClient.from('notifications').insert({
            org_id: window.ORG_ID,
            employee_name: name,
            type: 'open_shift',
            title: 'Open Shift Available',
            body: `A ${position} shift is now open. Check Open Shifts to pick it up!`,
            read: false,
        });
        // Push notification
        sendPushToEmployee(name, 'Open Shift Available', `A ${position} shift is now open. Check the app!`);
    }

    showNotification(`Request approved — shift is now open. Notified ${uniqueEmployees.length} eligible employee(s).`, 'success');
    await loadShiftRequests();
}

async function denyShiftRequest(requestId, employeeName) {
    if (!window.supabaseClient) return;

    await window.supabaseClient
        .from('shift_requests')
        .update({ status: 'denied' })
        .eq('id', requestId);

    // Notify employee their request was denied
    await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        type: 'request_denied',
        title: 'Request Denied',
        body: 'Your shift request was not approved by management.',
        read: false,
    });

    showNotification(`Request denied and employee notified.`, 'error');
    await loadShiftRequests();
}

async function sendPushToEmployee(employeeName, title, body) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const { data } = await window.supabaseClient
        .from('push_tokens')
        .select('token')
        .eq('org_id', window.ORG_ID)
        .eq('employee_name', employeeName)
        .maybeSingle();
    if (!data?.token) return;
    const payload = { to: data.token, title, body, sound: 'default' };
    if (title === 'New Task Assigned') payload.data = { type: 'task_assigned' };
    fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    }).catch((err) => console.warn('[Push] send failed:', err?.message || err));
}

// Poll badge count on load
document.addEventListener('supabase-ready', async () => {
    if (!window.supabaseClient || !window.ORG_ID) return;

    // Clean up any past-dated requests on load
    await cleanupPastShiftRequests();

    const { count } = await window.supabaseClient
        .from('shift_requests')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', window.ORG_ID)
        .eq('status', 'pending');
    if (count > 0) {
        const badge = document.getElementById('requests-badge');
        if (badge) { badge.textContent = count; badge.style.display = 'block'; }
    }
});

// ── In-app notification row ────────────────────────────────────────────────────

// Notify employee when a task is assigned (in-app + push)
async function notifyTaskAssigned(employeeName, taskDescription) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const { error } = await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        employee_id: typeof window.getEmployeeIdFromName === 'function' ? window.getEmployeeIdFromName(employeeName) : null,
        type: 'task_assigned',
        title: 'New Task Assigned',
        body: taskDescription,
        read: false,
    });
    if (error) console.warn('[Supabase] Could not insert task notification:', error.message);
    if (typeof sendPushToEmployee === 'function') {
        sendPushToEmployee(employeeName, 'New Task Assigned', `You've been assigned: ${taskDescription}`);
    }
}

// Write an in-app notification row so the mobile bell shows it immediately
async function insertInAppNotification(employeeName, day, timeStr, shiftId) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
    const { error } = await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        employee_id: typeof window.getEmployeeIdFromName === 'function' ? window.getEmployeeIdFromName(employeeName) : null,
        type: 'shift_assigned',
        title: 'New Shift Assigned',
        body: `You've been scheduled for ${dayLabel} — ${timeStr}.`,
        read: false,
        shift_id: shiftId || null,
    });
    if (error) console.warn('[Supabase] Could not insert notification:', error.message);
    else console.log('[Notifications] In-app notification created for', employeeName);
}

// Send a push notification to an employee's mobile device via Expo Push API
async function sendShiftNotification(employeeName, day, timeStr) {
    if (!window.supabaseClient || !window.ORG_ID) return;

    try {
        // Look up the employee's Expo push token stored by the mobile app
        const { data, error } = await window.supabaseClient
            .from('push_tokens')
            .select('token')
            .eq('org_id', window.ORG_ID)
            .eq('employee_name', employeeName)
            .maybeSingle();

        if (error || !data?.token) {
            console.log(`[Notifications] No push token found for ${employeeName}.`);
            return;
        }

        const dayLabel = day.charAt(0).toUpperCase() + day.slice(1);
        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
            },
            body: JSON.stringify({
                to: data.token,
                title: '📅 New Shift Assigned',
                body: `You've been scheduled for ${dayLabel} — ${timeStr}.`,
                sound: 'default',
                data: { screen: 'Schedule' },
            }),
        });
        console.log(`[Notifications] Push notification sent to ${employeeName}.`);
    } catch (e) {
        console.warn('[Notifications] Could not send push notification:', e.message);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    // Load tasks from localStorage on page load
    try {
        const storedTasks = localStorage.getItem('kitchenTasks');
        if (storedTasks) {
            window.kitchenTasks = JSON.parse(storedTasks);
        }
    } catch (e) {
        console.warn('Could not load tasks from localStorage:', e);
    }
    
    // Initialize if not exists
    if (typeof window.kitchenTasks === 'undefined') {
        window.kitchenTasks = [];
    }
    
    initializeScheduling();
    setupNotificationBell();
});

function initializeScheduling() {
    setupWeekNavigation();
    setupModalHandlers();
    setupShiftInteractions();
    setupTaskAssignment();
    animateShiftCards();
    checkEmployeeTasks();
    initializeEmployeeHours();
}

// Week Navigation
function getMondayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
let currentWeekStart = getMondayOfWeek(new Date());

function setupWeekNavigation() {
    const prevWeekBtn = document.getElementById('prev-week');
    const nextWeekBtn = document.getElementById('next-week');
    
    if (prevWeekBtn) {
        prevWeekBtn.addEventListener('click', () => {
            currentWeekStart.setDate(currentWeekStart.getDate() - 7);
            updateWeekDisplay();
            // Reinitialize hours for new week
            initializeEmployeeHours();
        });
    }
    
    if (nextWeekBtn) {
        nextWeekBtn.addEventListener('click', () => {
            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            updateWeekDisplay();
            // Reinitialize hours for new week
            initializeEmployeeHours();
        });
    }
    
    updateWeekDisplay();
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function updateWeekDisplay() {
    const weekDisplay = document.getElementById('current-week');
    if (!weekDisplay) return;
    
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    
    const startMonth = currentWeekStart.toLocaleDateString('en-US', { month: 'short' });
    const endMonth = weekEnd.toLocaleDateString('en-US', { month: 'short' });
    const startDay = currentWeekStart.getDate();
    const endDay = weekEnd.getDate();
    
    if (startMonth === endMonth) {
        weekDisplay.textContent = `Week of ${startMonth} ${startDay} - ${endDay}`;
    } else {
        weekDisplay.textContent = `Week of ${startMonth} ${startDay} - ${endMonth} ${endDay}`;
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];
    
    // Update day headers with dates and mark current/past
    DAY_NAMES.forEach((dayKey, index) => {
        const header = document.querySelector(`.day-header[data-day="${dayKey}"]`);
        if (header) {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + index);
            const dateNum = d.getDate();
            const dateStr = d.toISOString().split('T')[0];
            header.textContent = `${DAY_LABELS[index]} ${dateNum}`;
            header.classList.remove('day-header-today', 'day-header-past');
            header.removeAttribute('data-date');
            header.dataset.date = dateStr;
            if (dateStr === todayStr) {
                header.classList.add('day-header-today');
            } else if (d < today) {
                header.classList.add('day-header-past');
            }
        }
        
        const column = document.querySelector(`.day-column[data-day="${dayKey}"]`);
        if (column) {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + index);
            const dateStr = d.toISOString().split('T')[0];
            column.classList.remove('day-column-today', 'day-column-past');
            column.removeAttribute('data-date');
            column.dataset.date = dateStr;
            if (dateStr === todayStr) {
                column.classList.add('day-column-today');
            } else if (d < today) {
                column.classList.add('day-column-past');
            }
        }
    });
}

// Modal Handlers
function setupModalHandlers() {
    const assignShiftBtn = document.getElementById('assign-shift-btn');
    const createPositionBtn = document.getElementById('create-position-btn');
    
    if (assignShiftBtn) {
        assignShiftBtn.addEventListener('click', async () => {
            await populateEmployeeSelectFromOrg();
            openModal('assign-shift-modal');
        });
    }
    
    if (createPositionBtn) {
        createPositionBtn.addEventListener('click', () => {
            showComingSoon('Create Position functionality');
        });
    }
    
    // Calendar / History view — opens calendar; load shifts from Supabase so past days show
    let calendarViewMonth = new Date();
    const calendarHistoryBtn = document.getElementById('calendar-history-btn');
    if (calendarHistoryBtn) {
        calendarHistoryBtn.addEventListener('click', () => {
            calendarViewMonth = new Date();
            openModal('calendar-history-modal');
            hideDayPopup();
            renderCalendar(calendarViewMonth);
            loadCalendarShiftsFromSupabase(calendarViewMonth).then(() => renderCalendar(calendarViewMonth));
        });
    }
    const calendarPrevBtn = document.getElementById('calendar-prev-month');
    const calendarNextBtn = document.getElementById('calendar-next-month');
    if (calendarPrevBtn) {
        calendarPrevBtn.addEventListener('click', () => {
            calendarViewMonth.setMonth(calendarViewMonth.getMonth() - 1);
            loadCalendarShiftsFromSupabase(calendarViewMonth).then(() => renderCalendar(calendarViewMonth));
        });
    }
    if (calendarNextBtn) {
        calendarNextBtn.addEventListener('click', () => {
            calendarViewMonth.setMonth(calendarViewMonth.getMonth() + 1);
            loadCalendarShiftsFromSupabase(calendarViewMonth).then(() => renderCalendar(calendarViewMonth));
        });
    }
    const calendarDayPopupClose = document.getElementById('calendar-day-popup-close');
    if (calendarDayPopupClose) {
        calendarDayPopupClose.addEventListener('click', hideDayPopup);
    }
    
    // Update employee dropdown when day changes
    const daySelect = document.getElementById('day-select');
    if (daySelect) {
        daySelect.addEventListener('change', () => {
            updateEmployeeDropdownForDay();
            updateAssignShiftConfirmState();
        });
    }
    
    // Close modal when clicking outside
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal-overlay')) {
            closeModal(e.target.id);
        }
    });
    
    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const activeModal = document.querySelector('.modal-overlay.active');
            if (activeModal) {
                closeModal(activeModal.id);
            }
        }
    });
}

// Enable/disable Assign button and show message when selected day is in the past
function updateAssignShiftConfirmState() {
    const daySelect = document.getElementById('day-select');
    const confirmBtn = document.getElementById('assign-shift-confirm-btn');
    const pastDayMsg = document.getElementById('assign-shift-past-day-msg');
    if (!daySelect || !confirmBtn) return;
    const day = daySelect.value;
    const selectedDate = getDateForDay(day);
    const todayStr = new Date().toISOString().split('T')[0];
    const isPast = selectedDate && selectedDate < todayStr;
    confirmBtn.disabled = !!isPast;
    if (pastDayMsg) pastDayMsg.style.display = isPast ? 'block' : 'none';
}

// Seed employees when org has none (fallback if bootstrap hasn't run yet)
async function seedEmployeesIfEmpty() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const { data: existing } = await window.supabaseClient
        .from('employee_positions')
        .select('id')
        .eq('org_id', window.ORG_ID)
        .limit(1);
    if (existing?.length) return;
    const employees = [
        { employee_name: 'Kenny', positions: ['Server'] },
        { employee_name: 'Rohan', positions: ['Server'] },
        { employee_name: 'Natalie', positions: ['Server'] },
        { employee_name: 'Jake', positions: ['Line Cook', 'Dish'] },
        { employee_name: 'Sam', positions: ['Line Cook'] },
        { employee_name: 'Sophia', positions: ['Prep'] },
        { employee_name: 'Aria', positions: ['Line Cook'] },
        { employee_name: 'Alex', positions: ['Line Cook'] },
        { employee_name: 'Meagan', positions: ['Dishwasher'] },
        { employee_name: 'Josh', positions: ['Dessert'] },
        { employee_name: 'Ben', positions: ['Hot Foods'] },
        { employee_name: 'Justin', positions: ['MOD'] },
        { employee_name: 'Hannah', positions: ['Cold Foods'] },
        { employee_name: 'Gary', positions: ['Expo'] },
    ];
    for (const e of employees) {
        await window.supabaseClient.from('employee_positions').insert({
            org_id: window.ORG_ID,
            employee_name: e.employee_name,
            positions: e.positions,
        });
    }
}

// Default employees when DB is empty or unavailable
const DEFAULT_EMPLOYEES = ['Kenny', 'Rohan', 'Natalie', 'Jake', 'Sam', 'Sophia', 'Aria', 'Alex', 'Meagan', 'Josh', 'Ben', 'Justin', 'Hannah', 'Gary'];
const EMPLOYEE_VALUE_MAP = { 'Kenny': 'kenny', 'Rohan': 'rohan', 'Natalie': 'natalie', 'Jake': 'jake', 'Sam': 'sam', 'Sophia': 'sophia', 'Aria': 'aria', 'Alex': 'alex', 'Meagan': 'meagan', 'Josh': 'josh', 'Ben': 'ben', 'Justin': 'justin', 'Hannah': 'hannah', 'Gary': 'gary' };

// Populate employee dropdown from org's employee_positions (multi-restaurant isolation)
async function populateEmployeeSelectFromOrg() {
    const employeeSelect = document.getElementById('employee-select');
    if (!employeeSelect) return;

    let names = [];
    if (window.supabaseClient && window.ORG_ID) {
        const { data, error } = await window.supabaseClient
            .from('employee_positions')
            .select('employee_name')
            .eq('org_id', window.ORG_ID)
            .order('employee_name');
        names = (data || []).map(r => r.employee_name).filter(Boolean);
        if (names.length === 0) {
            await seedEmployeesIfEmpty();
            const res = await window.supabaseClient
                .from('employee_positions')
                .select('employee_name')
                .eq('org_id', window.ORG_ID)
                .order('employee_name');
            names = (res.data || []).map(r => r.employee_name).filter(Boolean);
        }
    }
    if (names.length === 0) names = DEFAULT_EMPLOYEES;

    employeeSelect.innerHTML = '<option value="">Select Employee</option>' + names.map(n => {
        const val = EMPLOYEE_VALUE_MAP[n] || n.toLowerCase().replace(/\s+/g, '-');
        return `<option value="${val}">${escapeHtml(n)}</option>`;
    }).join('');
    updateEmployeeDropdownForDay();
    await populatePositionSelect();
}

async function populatePositionSelect() {
    const positionSelect = document.getElementById('position-select');
    const shiftDetailsPosition = document.getElementById('shift-details-position');
    if (!positionSelect && !shiftDetailsPosition) return;

    const POSITION_SLUG_MAP = { 'Line Cook': 'line-cook', 'Server': 'server', 'Dish': 'dish', 'Prep': 'prep',
        'FOH Manager': 'foh-manager', 'Dishwasher': 'dishwasher', 'Dessert': 'dessert', 'Hot Foods': 'hot-foods',
        'MOD': 'mod', 'Cold Foods': 'cold-foods', 'Expo': 'expo' };

    let positions = new Set();
    if (window.supabaseClient && window.ORG_ID) {
        const { data } = await window.supabaseClient
            .from('employee_positions')
            .select('positions')
            .eq('org_id', window.ORG_ID);
        (data || []).forEach(r => {
            (r.positions || []).forEach(p => positions.add(typeof p === 'string' ? p : p?.name || ''));
        });
    }
    if (positions.size === 0) {
        ['Line Cook', 'Server', 'Dish', 'Prep', 'FOH Manager'].forEach(p => positions.add(p));
    }

    const opts = '<option value="">Select Position</option>' + [...positions].sort().map(p => {
        const val = POSITION_SLUG_MAP[p] || p.toLowerCase().replace(/\s+/g, '-');
        return `<option value="${val}">${escapeHtml(p)}</option>`;
    }).join('');

    if (positionSelect) positionSelect.innerHTML = opts;
    if (shiftDetailsPosition) shiftDetailsPosition.innerHTML = opts;
}

// Update employee dropdown to show which employees have approved drops
function updateEmployeeDropdownForDay() {
    const daySelect = document.getElementById('day-select');
    const employeeSelect = document.getElementById('employee-select');
    if (!daySelect || !employeeSelect) return;
    
    const selectedDay = daySelect.value;
    const selectedDate = getDateForDay(selectedDay);
    if (!selectedDate) return;
    
    // Update each option to show drop status
    Array.from(employeeSelect.options).forEach(option => {
        if (!option.value) return; // Skip "Select Employee"
        
        const employeeName = getEmployeeDisplayName(option.value);
        const hasDrop = isEmployeeDropping(employeeName, selectedDate);
        
        // Remove existing drop indicator
        option.textContent = option.textContent.replace(' (Approved Drop)', '');
        
        if (hasDrop) {
            option.textContent += ' (Approved Drop)';
            option.style.color = '#e53e3e';
            option.style.fontStyle = 'italic';
        } else {
            option.style.color = '';
            option.style.fontStyle = '';
        }
    });
}

function openModal(modalId, preselectedDay = null) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
        // If a day is preselected, set it and hide the day selector
        if (preselectedDay && modalId === 'assign-shift-modal') {
            const daySelect = document.getElementById('day-select');
            const daySelectGroup = document.getElementById('day-select-group');
            if (daySelect) {
                daySelect.value = preselectedDay;
                // Hide the day selector since it's already selected
                if (daySelectGroup) {
                    daySelectGroup.style.display = 'none';
                }
                // Update employee dropdown for this day
                updateEmployeeDropdownForDay();
            }
            updateAssignShiftConfirmState();
        } else if (modalId === 'assign-shift-modal') {
            // Show day selector if opened from button (no preselected day)
            const daySelectGroup = document.getElementById('day-select-group');
            if (daySelectGroup) {
                daySelectGroup.style.display = 'block';
            }
            // Update employee dropdown for default day
            updateEmployeeDropdownForDay();
            updateAssignShiftConfirmState();
        }
        
        // Focus first input
        const firstInput = modal.querySelector('input, select');
        if (firstInput) {
            setTimeout(() => firstInput.focus(), 100);
        }
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
        
        // Reset form
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
        } else {
            // Reset individual form controls
            modal.querySelectorAll('input, select').forEach(control => {
                if (control.id !== 'day-select') {
                    control.value = '';
                }
            });
        }
        
        // Show day selector again
        const daySelectGroup = document.getElementById('day-select-group');
        if (daySelectGroup) {
            daySelectGroup.style.display = 'block';
        }
    }
}

// Shift Assignment
function assignShift() {
    const employeeSelect = document.getElementById('employee-select');
    const positionSelect = document.getElementById('position-select');
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    const daySelect = document.getElementById('day-select');
    
    const employee = employeeSelect.value;
    const position = positionSelect.value;
    const startTime = startTimeInput.value;
    const endTime = endTimeInput.value;
    const day = daySelect.value;
    
    if (!employee || !position || !startTime || !endTime || !day) {
        showNotification('Please fill in all fields', 'error');
        return;
    }
    
    const selectedDate = getDateForDay(day);
    const todayStr = new Date().toISOString().split('T')[0];
    if (selectedDate && selectedDate < todayStr) {
        showNotification('Cannot assign a shift to a past day.', 'error');
        return;
    }
    
    // Check if employee has an approved drop for this day
    const employeeName = getEmployeeDisplayName(employee);
    
    if (isEmployeeDropping(employeeName, selectedDate)) {
        showNotification(`${employeeName} has an approved drop for ${formatDateForDisplay(selectedDate)}. Cannot schedule shift.`, 'error');
        return;
    }
    
    // Calculate hours for this shift
    const shiftHours = calculateShiftHours(startTime, endTime);
    const weekStart = getWeekStart(currentWeekStart);
    
    // Check current hours for the week
    const currentHours = getEmployeeWeeklyHours(employeeName, weekStart);
    const newTotalHours = currentHours + shiftHours;
    
    // Check for overtime warning
    if (newTotalHours > 40) {
        openOvertimeWarningModal(employeeName, currentHours, shiftHours, newTotalHours, () => {
            proceedWithShiftAssignment(employee, position, startTime, endTime, day, shiftHours, weekStart);
        });
        return;
    }
    
    // Proceed with assignment
    proceedWithShiftAssignment(employee, position, startTime, endTime, day, shiftHours, weekStart);
}

function proceedWithShiftAssignment(employee, position, startTime, endTime, day, shiftHours, weekStart) {
    const employeeName = getEmployeeDisplayName(employee);
    
    // Convert 24-hour time to 12-hour format
    const formatTime = (time24) => {
        const [hours, minutes] = time24.split(':');
        const hour12 = hours % 12 || 12;
        const ampm = hours >= 12 ? 'pm' : 'am';
        return `${hour12}${minutes !== '00' ? ':' + minutes : ''}${ampm}`;
    };
    
    const formattedTime = `${formatTime(startTime)} - ${formatTime(endTime)}`;
    
    // Store shift data
    if (!window.shiftData[employeeName]) {
        window.shiftData[employeeName] = [];
    }
    window.shiftData[employeeName].push({
        day,
        startTime,
        endTime,
        hours: shiftHours,
        weekStart: weekStart,
        position: position
    });
    persistShiftData();
    
    // Update hours tracking
    if (!window.employeeHours[employeeName]) {
        window.employeeHours[employeeName] = {};
    }
    if (!window.employeeHours[employeeName][weekStart]) {
        window.employeeHours[employeeName][weekStart] = 0;
    }
    window.employeeHours[employeeName][weekStart] += shiftHours;
    
    const POSITION_LABELS = {
        'line-cook': 'Line Cook', 'server': 'Server', 'dish': 'Dish', 'prep': 'Prep',
        'foh-manager': 'FOH Manager', 'dishwasher': 'Dishwasher', 'dessert': 'Dessert',
        'hot-foods': 'Hot Foods', 'mod': 'MOD', 'cold-foods': 'Cold Foods', 'expo': 'Expo'
    };
    const positionLabel = POSITION_LABELS[position]
        || String(position || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Create new shift card
    const card = createShiftCard(employee, position, formattedTime, day, shiftHours, positionLabel);
    
    // Show success notification
    const totalHours = window.employeeHours[employeeName][weekStart];
    showNotification(`Shift assigned to ${employeeName}. Total hours this week: ${totalHours.toFixed(1)}`, 'success');

    if (window.supabaseClient && window.ORG_ID) {
        const shiftDate = getDateForDay(day);
        // positionLabel already computed above

        // 0. Add this position to employee's capabilities if not already there (so Employees page shows correct count)
        (async () => {
            const { data: existing } = await window.supabaseClient
                .from('employee_positions')
                .select('positions')
                .eq('org_id', window.ORG_ID)
                .eq('employee_name', employeeName)
                .maybeSingle();
            const positions = existing?.positions || [];
            if (!positions.includes(positionLabel)) {
                const updated = [...positions, positionLabel];
                await window.supabaseClient.from('employee_positions').upsert(
                    { org_id: window.ORG_ID, employee_name: employeeName, positions: updated },
                    { onConflict: 'org_id,employee_name' }
                );
            }
        })();

        // 1. Insert notification immediately so the mobile bell lights up right away
        insertInAppNotification(employeeName, day, formattedTime, null);

        // 2. Sync shift to Supabase so it appears on the mobile calendar
        window.supabaseClient
            .from('shifts')
            .insert({
                org_id: window.ORG_ID,
                shift_date: shiftDate,
                start_time: startTime,
                end_time: endTime,
                position: positionLabel,
                employee_name: employeeName,
                employee_id: typeof window.getEmployeeIdFromName === 'function' ? window.getEmployeeIdFromName(employeeName) : null
            })
            .select()
            .single()
            .then(({ data, error }) => {
                if (error) {
                    console.warn('[Supabase] Could not save shift:', error.message);
                    showNotification(`⚠️ Shift saved locally but failed to sync to mobile: ${error.message}`, 'error');
                } else if (data) {
                    if (card) card.dataset.shiftId = data.id;
                    // Persist shiftId into shiftData so it survives page reload
                    const empShifts = window.shiftData[employeeName] || [];
                    const entry = empShifts.find(s =>
                        s.day === day && s.startTime === startTime && s.endTime === endTime && s.weekStart === weekStart
                    );
                    if (entry) {
                        entry.shiftId = data.id;
                        persistShiftData();
                    }
                    // Also send Expo push notification to the device
                    sendShiftNotification(employeeName, day, formattedTime);
                }
            });
    }

    // Close modal
    closeModal('assign-shift-modal');
}

// Calculate hours between start and end time
function calculateShiftHours(startTime, endTime) {
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    let startMinutes = startH * 60 + startM;
    let endMinutes = endH * 60 + endM;
    
    // Handle overnight shifts (end time is next day)
    if (endMinutes < startMinutes) {
        endMinutes += 24 * 60; // Add 24 hours
    }
    
    const diffMinutes = endMinutes - startMinutes;
    return diffMinutes / 60; // Convert to hours
}

// Get week start date (Monday) as string
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
    d.setDate(diff);
    return d.toISOString().split('T')[0];
}

// Get day key (monday..sunday) for a date string YYYY-MM-DD
function getDayKeyForDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const index = (d.getDay() + 6) % 7; // 0=Mon, 1=Tue, ...
    return DAY_NAMES[index];
}

// Load shifts from Supabase for a calendar month so Calendar / History shows past and current shifts
async function loadCalendarShiftsFromSupabase(monthDate) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const first = new Date(year, month, 1);
    const last = new Date(year, month + 1, 0);
    const startStr = first.toISOString().split('T')[0];
    const endStr = last.toISOString().split('T')[0];
    const { data: rows, error } = await window.supabaseClient
        .from('shifts')
        .select('shift_date, start_time, end_time, employee_name')
        .eq('org_id', window.ORG_ID)
        .gte('shift_date', startStr)
        .lte('shift_date', endStr)
        .order('shift_date', { ascending: true });
    if (error) {
        console.warn('[Supabase] loadCalendarShiftsFromSupabase failed:', error.message);
        return;
    }
    if (!window.calendarShiftsByDate) window.calendarShiftsByDate = {};
    for (let d = new Date(first.getTime()); d <= last; d.setDate(d.getDate() + 1)) {
        const ds = d.toISOString().split('T')[0];
        delete window.calendarShiftsByDate[ds];
    }
    (rows || []).forEach(s => {
        const dateStr = s.shift_date;
        if (!dateStr) return;
        if (!window.calendarShiftsByDate[dateStr]) window.calendarShiftsByDate[dateStr] = [];
        const hours = calculateShiftHours(s.start_time || '00:00', s.end_time || '00:00');
        window.calendarShiftsByDate[dateStr].push({
            employeeName: s.employee_name || '',
            startTime: s.start_time || '00:00',
            endTime: s.end_time || '00:00',
            hours
        });
    });
}

// Get all shifts for a given date (YYYY-MM-DD): prefer Supabase-loaded calendar cache, else shiftData
function getShiftsForDate(dateStr) {
    if (window.calendarShiftsByDate && window.calendarShiftsByDate[dateStr] && window.calendarShiftsByDate[dateStr].length > 0) {
        return window.calendarShiftsByDate[dateStr];
    }
    const weekStart = getWeekStart(new Date(dateStr + 'T12:00:00'));
    const dayKey = getDayKeyForDate(dateStr);
    const results = [];
    if (!window.shiftData) return results;
    Object.keys(window.shiftData).forEach(employeeName => {
        (window.shiftData[employeeName] || []).forEach(s => {
            if (s.weekStart === weekStart && s.day === dayKey) {
                results.push({
                    employeeName,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    hours: s.hours
                });
            }
        });
    });
    return results;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Calendar view: current month grid, Mon–Sun
const CALENDAR_DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function renderCalendar(monthDate) {
    const wrap = document.getElementById('calendar-grid-wrap');
    const titleEl = document.getElementById('calendar-month-title');
    if (!wrap || !titleEl) return;
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    titleEl.textContent = monthDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    // First day of month (0 = Sun in JS); we want Monday = 0 for grid
    const first = new Date(year, month, 1);
    let firstWeekday = first.getDay() - 1; // Mon=0, Tue=1, ..., Sun=6
    if (firstWeekday < 0) firstWeekday = 6;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    let html = '<table class="calendar-table"><thead><tr>';
    CALENDAR_DAY_NAMES.forEach(day => {
        html += `<th>${day}</th>`;
    });
    html += '</tr></thead><tbody><tr>';
    let cellIndex = 0;
    for (let i = 0; i < firstWeekday; i++) {
        html += '<td class="calendar-day calendar-day-empty"></td>';
        cellIndex++;
    }
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
        const shifts = getShiftsForDate(dateStr);
        const isToday = dateStr === todayStr;
        const hasShifts = shifts.length > 0;
        const classes = ['calendar-day', hasShifts ? 'calendar-day-has-shifts' : '', isToday ? 'calendar-day-today' : ''].filter(Boolean).join(' ');
        html += `<td class="${classes}" data-date="${dateStr}" role="button" tabindex="0">`;
        html += `<span class="calendar-day-num">${day}</span>`;
        if (hasShifts) {
            html += `<span class="calendar-day-dot" aria-hidden="true"></span>`;
        }
        html += '</td>';
        cellIndex++;
        if (cellIndex % 7 === 0 && day < daysInMonth) html += '</tr><tr>';
    }
    while (cellIndex % 7 !== 0) {
        html += '<td class="calendar-day calendar-day-empty"></td>';
        cellIndex++;
    }
    html += '</tr></tbody></table>';
    wrap.innerHTML = html;
    wrap.querySelectorAll('.calendar-day[data-date]').forEach(cell => {
        cell.addEventListener('click', () => {
            const date = cell.getAttribute('data-date');
            if (date) showDayPopup(date);
        });
        cell.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const date = cell.getAttribute('data-date');
                if (date) showDayPopup(date);
            }
        });
    });
}

function showDayPopup(dateStr) {
    const popup = document.getElementById('calendar-day-popup');
    const titleEl = document.getElementById('calendar-day-popup-title');
    const contentEl = document.getElementById('calendar-day-popup-content');
    if (!popup || !titleEl || !contentEl) return;
    const d = new Date(dateStr + 'T12:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const isToday = dateStr === today.toISOString().split('T')[0];
    titleEl.textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + (isToday ? ' (Today)' : '');
    const shifts = getShiftsForDate(dateStr);
    if (shifts.length === 0) {
        contentEl.innerHTML = '<p class="calendar-day-no-shifts">No shifts recorded for this day.</p>';
    } else {
        const formatTime12 = (time24) => {
            const [h, m] = (time24 || '00:00').split(':').map(Number);
            const h12 = h % 12 || 12;
            const ampm = h >= 12 ? 'pm' : 'am';
            return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
        };
        contentEl.innerHTML = '<ul class="calendar-day-employee-list">' + shifts.map(s => {
            const timeStr = `${formatTime12(s.startTime)} – ${formatTime12(s.endTime)}`;
            return `<li><strong>${escapeHtml(s.employeeName)}</strong> — ${timeStr} <span class="calendar-day-hours">(${Number(s.hours).toFixed(1)}h)</span></li>`;
        }).join('') + '</ul>';
    }
    popup.hidden = false;
}

function hideDayPopup() {
    const popup = document.getElementById('calendar-day-popup');
    if (popup) popup.hidden = true;
}

// Get employee's total hours for a week
function getEmployeeWeeklyHours(employeeName, weekStart) {
    if (!window.employeeHours[employeeName] || !window.employeeHours[employeeName][weekStart]) {
        return 0;
    }
    return window.employeeHours[employeeName][weekStart];
}

// Initialize hours from existing shifts on page load
function initializeEmployeeHours() {
    const weekStart = getWeekStart(currentWeekStart);

    // Save any dynamically-added shifts (non-HTML) from localStorage before clearing
    const savedDynamic = {};
    Object.keys(window.shiftData || {}).forEach(emp => {
        const weekShifts = (window.shiftData[emp] || []).filter(s => s.weekStart === weekStart);
        if (weekShifts.length > 0) savedDynamic[emp] = weekShifts;
    });

    // Clear current week so DOM becomes source of truth for hardcoded shifts
    Object.keys(window.employeeHours).forEach(emp => {
        if (window.employeeHours[emp][weekStart]) {
            delete window.employeeHours[emp][weekStart];
        }
    });
    Object.keys(window.shiftData || {}).forEach(emp => {
        if (window.shiftData[emp] && Array.isArray(window.shiftData[emp])) {
            window.shiftData[emp] = window.shiftData[emp].filter(s => s.weekStart !== weekStart);
        }
    });
    
    document.querySelectorAll('.shift-card').forEach(card => {
        const employeeName = card.dataset.employeeName || card.querySelector('.employee-name')?.textContent?.trim();
        const timeText = card.querySelector('.shift-time')?.textContent || '';
        
        if (employeeName && timeText) {
            // Parse time from "4pm - 1am" format
            const timeMatch = timeText.match(/(\d+)(?::(\d+))?(am|pm)\s*-\s*(\d+)(?::(\d+))?(am|pm)/);
            if (timeMatch) {
                const startH = parseInt(timeMatch[1]);
                const startM = parseInt(timeMatch[2] || 0);
                const startPeriod = timeMatch[3];
                const endH = parseInt(timeMatch[4]);
                const endM = parseInt(timeMatch[5] || 0);
                const endPeriod = timeMatch[6];
                
                let start24 = startH + (startPeriod === 'pm' && startH !== 12 ? 12 : 0);
                if (startPeriod === 'am' && startH === 12) start24 = 0;
                let end24 = endH + (endPeriod === 'pm' && endH !== 12 ? 12 : 0);
                if (endPeriod === 'am' && endH === 12) end24 = 0;
                
                // Handle overnight shifts
                if (end24 < start24) {
                    end24 += 24;
                }
                
                const startTime = `${String(start24).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
                const endTime = `${String(end24).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
                
                const dayColumn = card.closest('.day-column');
                const day = dayColumn?.dataset.day;
                if (day) {
                    const shiftWeekStart = getWeekStart(currentWeekStart);
                    const hours = calculateShiftHours(startTime, endTime);
                    
                    if (!window.shiftData[employeeName]) {
                        window.shiftData[employeeName] = [];
                    }
                    // Check if this shift already exists
                    const exists = window.shiftData[employeeName].some(s => 
                        s.day === day && s.startTime === startTime && s.endTime === endTime && s.weekStart === shiftWeekStart
                    );
                    if (!exists) {
                        window.shiftData[employeeName].push({
                            day,
                            startTime,
                            endTime,
                            hours,
                            weekStart: shiftWeekStart
                        });
                        persistShiftData();
                    }
                    
                    if (!window.employeeHours[employeeName]) {
                        window.employeeHours[employeeName] = {};
                    }
                    if (!window.employeeHours[employeeName][shiftWeekStart]) {
                        window.employeeHours[employeeName][shiftWeekStart] = 0;
                    }
                    // Only add if not already counted
                    if (!exists) {
                        window.employeeHours[employeeName][shiftWeekStart] += hours;
                    }
                }
            }
        }
    });

    // Restore dynamically-added shifts that were not in the HTML DOM
    Object.keys(savedDynamic).forEach(empName => {
        savedDynamic[empName].forEach(savedShift => {
            const already = (window.shiftData[empName] || []).some(s =>
                s.day === savedShift.day &&
                s.startTime === savedShift.startTime &&
                s.endTime === savedShift.endTime
            );
            if (!already) {
                // Recreate the card visually
                const timeDisplay = formatTo12h(savedShift.startTime) + ' - ' + formatTo12h(savedShift.endTime);
                const posRaw = savedShift.position || 'line-cook';
                const posSlug = String(posRaw).includes(' ')
                    ? String(posRaw).toLowerCase().replace(/\s+/g, '-')
                    : String(posRaw);
                const posLabel = String(posRaw).includes(' ')
                    ? String(posRaw)
                    : String(posRaw).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                const card = createShiftCard(empName, posSlug, timeDisplay, savedShift.day, savedShift.hours, posLabel);
                if (card && savedShift.shiftId) {
                    card.dataset.shiftId = savedShift.shiftId;
                }

                // Restore into shiftData and hours
                if (!window.shiftData[empName]) window.shiftData[empName] = [];
                window.shiftData[empName].push(savedShift);

                if (!window.employeeHours[empName]) window.employeeHours[empName] = {};
                if (!window.employeeHours[empName][weekStart]) window.employeeHours[empName][weekStart] = 0;
                window.employeeHours[empName][weekStart] += savedShift.hours || 0;
            }
        });
    });

    persistShiftData();
}

function createShiftCard(employee, position, time, day, hours = null, positionLabelOverride = null) {
    const dayColumn = document.querySelector(`.day-column[data-day="${day}"]`);
    if (!dayColumn) return;
    const emptyDay = dayColumn.querySelector('.empty-day');
    
    // Remove empty day placeholder if it exists
    if (emptyDay) {
        emptyDay.remove();
    }
    
    // Create shift card
    const shiftCard = document.createElement('div');
    shiftCard.className = `shift-card ${String(position || '').replace(/\s+/g, '-').toLowerCase()}`;
    
    const employeeNames = {
        'kenny': 'Kenny',
        'rohan': 'Rohan',
        'jake': 'Jake',
        'natalie': 'Natalie',
        'sam': 'Sam',
        'sophia': 'Sophia',
        'aria': 'Aria',
        'alex': 'Alex'
    };
    
    const positionNames = {
        'line-cook': 'Line Cook',
        'server': 'Server',
        'dish': 'Dish',
        'prep': 'Prep',
        'foh-manager': 'FOH Manager'
    };
    
    const displayName = employeeNames[employee] || employee.charAt(0).toUpperCase() + employee.slice(1);
    const prettyPos = positionLabelOverride
        || positionNames[position]
        || String(position || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    
    shiftCard.innerHTML = `
        <div class="shift-header">
            <span class="shift-position">${prettyPos}</span>
            <span class="shift-time">${time}</span>
        </div>
        <div class="shift-employee">
            <div class="employee-avatar">${employeeNames[employee]?.charAt(0) || employee.charAt(0).toUpperCase()}</div>
            <span class="employee-name">${displayName}</span>
        </div>
        <div class="shift-card-hint"><i class="fas fa-pen"></i> Click to edit shift & assign tasks</div>
    `;

    shiftCard.dataset.employeeName = displayName;

    shiftCard.addEventListener('click', () => {
        editShift(shiftCard, employee, position, time, day);
    });
    
    // Check if employee has tasks and update visual indicator
    updateShiftCardTaskIndicator(shiftCard, displayName);
    
    // Add animation
    shiftCard.style.opacity = '0';
    shiftCard.style.transform = 'translateY(20px)';

    // Ensure the day-add-btn stays at the top; insert new card after it
    const addBtn = dayColumn.querySelector('.day-add-btn');
    if (addBtn && addBtn.nextSibling) {
        dayColumn.insertBefore(shiftCard, addBtn.nextSibling);
    } else {
        dayColumn.appendChild(shiftCard);
    }
    
    // Animate in
    setTimeout(() => {
        shiftCard.style.transition = 'all 0.3s ease';
        shiftCard.style.opacity = '1';
        shiftCard.style.transform = 'translateY(0)';
    }, 100);

    return shiftCard;
}

// ── Parse a 12-hour time string like "4pm" or "1:30am" → "16:00" ─────────────
function parseTo24h(token) {
    const m = token.trim().match(/^(\d+)(?::(\d+))?(am|pm)$/i);
    if (!m) return '00:00';
    let h = parseInt(m[1]);
    const min = m[2] ? parseInt(m[2]) : 0;
    const period = m[3].toLowerCase();
    if (period === 'pm' && h !== 12) h += 12;
    if (period === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

// ── Format 24h "HH:MM" → 12h "4pm" / "1:30am" ───────────────────────────────
function formatTo12h(time24) {
    const [h, m] = time24.split(':').map(Number);
    const period = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return m ? `${h12}:${String(m).padStart(2, '0')}${period}` : `${h12}${period}`;
}

// Combined Edit Shift + Assign Task modal
function openShiftDetailsModal(shiftCard, employee, position, time, day) {
    const modal = document.getElementById('shift-details-modal');
    const titleEl = document.getElementById('shift-details-title');
    const empInput = document.getElementById('shift-details-employee');
    const posSelect = document.getElementById('shift-details-position');
    const startInput = document.getElementById('shift-details-start');
    const endInput = document.getElementById('shift-details-end');
    const taskList = document.getElementById('shift-details-task-list');
    const existingList = document.getElementById('shift-details-existing-tasks-list');
    const existingGroup = document.getElementById('shift-details-existing-tasks-group');
    const addTaskBtn = document.getElementById('shift-details-add-task-row');
    const recipesList = document.getElementById('shift-details-active-recipes');
    const saveBtn = document.getElementById('shift-details-save-btn');
    const deleteBtn = document.getElementById('shift-details-delete-btn');

    if (!modal || !empInput || !taskList) return;

    const NAMES = { kenny:'Kenny', rohan:'Rohan', jake:'Jake', natalie:'Natalie',
                    sam:'Sam', sophia:'Sophia', aria:'Aria', alex:'Alex' };
    const displayName = NAMES[employee] || employee.charAt(0).toUpperCase() + employee.slice(1);

    const parts = time.split('-').map(s => s.trim());
    const start24 = parts[0] ? parseTo24h(parts[0]) : '';
    const end24   = parts[1] ? parseTo24h(parts[1]) : '';

    titleEl.innerHTML = `<i class="fas fa-user-clock"></i> ${displayName} — ${day.charAt(0).toUpperCase() + day.slice(1)}`;
    empInput.value = displayName;
    posSelect.value = position;
    startInput.value = start24;
    endInput.value = end24;

    taskList.innerHTML = '';
    addTaskRow(taskList);
    loadExistingTasksForEmployee(displayName, existingList, existingGroup);
    loadActiveRecipesInto(recipesList, taskList);

    modal.dataset.employeeName = displayName;
    const cardRef = shiftCard;

    const newSaveBtn = saveBtn.cloneNode(true);
    saveBtn.replaceWith(newSaveBtn);
    newSaveBtn.addEventListener('click', () => {
        const newPos = posSelect.value;
        const newStart = startInput.value;
        const newEnd = endInput.value;
        if (!newStart || !newEnd) {
            showNotification('Please fill in both start and end times.', 'error');
            return;
        }

        const newPosLabel = posSelect.selectedOptions?.[0]?.textContent?.trim()
            || String(newPos || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const newTimeStr = `${formatTo12h(newStart)} - ${formatTo12h(newEnd)}`;
        const newHours = calculateShiftHours(newStart, newEnd);

        const posEl = cardRef.querySelector('.shift-position');
        const timeEl = cardRef.querySelector('.shift-time');
        if (posEl) posEl.textContent = newPosLabel;
        if (timeEl) timeEl.textContent = newTimeStr;

        const oldPosClasses = Array.from(cardRef.classList).filter(c => c !== 'shift-card');
        if (oldPosClasses.length) cardRef.classList.remove(...oldPosClasses);
        cardRef.classList.add(newPos);

        const weekStart = getWeekStart(currentWeekStart);
        const empShifts = window.shiftData[displayName] || [];
        const idx = empShifts.findIndex(s =>
            s.day === day && s.weekStart === weekStart &&
            s.startTime === start24 && s.endTime === end24
        );
        if (idx !== -1) {
            const oldHours = empShifts[idx].hours || 0;
            if (window.employeeHours[displayName]?.[weekStart] !== undefined) {
                window.employeeHours[displayName][weekStart] -= oldHours;
                window.employeeHours[displayName][weekStart] += newHours;
            }
            empShifts[idx].startTime = newStart;
            empShifts[idx].endTime = newEnd;
            empShifts[idx].hours = newHours;
            window.shiftData[displayName] = empShifts;
            persistShiftData();
        }

        const supabaseId = cardRef.dataset.shiftId;
        if (supabaseId && window.supabaseClient) {
            window.supabaseClient
                .from('shifts')
                .update({
                    start_time: newStart,
                    end_time: newEnd,
                    position: newPosLabel
                })
                .eq('id', supabaseId)
                .then(({ error }) => {
                    if (error) console.warn('[Supabase] Could not update shift:', error.message);
                });
        }

        const taskInputs = taskList.querySelectorAll('.task-input');
        const descriptions = Array.from(taskInputs).map(i => i.value.trim()).filter(Boolean);
        descriptions.forEach(desc => addTaskToProgress(displayName, desc));
        if (descriptions.length) updateEmployeeShiftCards(displayName);

        closeModal('shift-details-modal');
        showNotification(`Shift updated${descriptions.length ? ` and ${descriptions.length} task(s) assigned` : ''} for ${displayName}.`, 'success');
    });

    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.replaceWith(newDeleteBtn);
    newDeleteBtn.addEventListener('click', () => {
        if (!confirm(`Delete ${displayName}'s shift on ${day}?`)) return;

        const weekStart = getWeekStart(currentWeekStart);
        const empShifts = window.shiftData[displayName] || [];
        const idx = empShifts.findIndex(s =>
            s.day === day && s.weekStart === weekStart &&
            s.startTime === start24 && s.endTime === end24
        );
        if (idx !== -1) {
            const oldHours = empShifts[idx].hours || 0;
            if (window.employeeHours[displayName]?.[weekStart] !== undefined) {
                window.employeeHours[displayName][weekStart] -= oldHours;
            }
            empShifts.splice(idx, 1);
            window.shiftData[displayName] = empShifts;
            persistShiftData();
        }

        const supabaseId = cardRef.dataset.shiftId;
        if (supabaseId && window.supabaseClient) {
            window.supabaseClient.from('shifts').delete().eq('id', supabaseId)
                .then(({ error }) => { if (error) console.warn('[Supabase] Could not delete shift:', error.message); });
        }

        cardRef.style.transition = 'all 0.25s ease';
        cardRef.style.opacity = '0';
        cardRef.style.transform = 'scale(0.95)';
        setTimeout(() => cardRef.remove(), 250);

        closeModal('shift-details-modal');
        showNotification(`Shift for ${displayName} deleted.`, 'success');
    });

    addTaskBtn.onclick = () => addTaskRow(taskList);

    openModal('shift-details-modal');
    document.body.style.overflow = 'hidden';
    const firstInput = taskList.querySelector('.task-input');
    if (firstInput) firstInput.focus();
}

function loadActiveRecipesInto(container, targetTaskList) {
    if (!container) return;
    const taskList = targetTaskList || document.getElementById('shift-details-task-list');
    let activeRecipes = [];
    if (typeof window.recipesData !== 'undefined' && Object.keys(window.recipesData).length > 0) {
        activeRecipes = Object.values(window.recipesData).filter(r => r.name && r.active !== false);
    } else {
        try {
            document.querySelectorAll('.recipes-active .recipe-card').forEach(card => {
                const name = card.querySelector('.recipe-name')?.textContent?.trim();
                if (name) activeRecipes.push({ name });
            });
        } catch (e) {
            activeRecipes = [
                { name: 'Focaccia Kit' }, { name: 'Balsamic Glaze' }, { name: 'Smoked Salmon' },
                { name: 'Meringue' }, { name: 'Chilled Pea Soup' }, { name: 'Pickled Garlic' }
            ];
        }
    }
    container.innerHTML = '';
    activeRecipes.forEach(recipe => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recipe-select-btn';
        btn.textContent = recipe.name;
        btn.dataset.recipeName = recipe.name;
        btn.addEventListener('click', function() {
            openRecipeAssignmentModal(recipe.name, taskList);
        });
        container.appendChild(btn);
    });
}

function editShift(shiftCard, employee, position, time, day) {
    openShiftDetailsModal(shiftCard, employee, position, time, day);
}

// Shift Interactions
function setupShiftInteractions() {
    document.querySelectorAll('.shift-card').forEach(card => {
        const employeeNameEl = card.querySelector('.employee-name');
        const employeeName = employeeNameEl?.textContent.trim();
        if (employeeName && !card.dataset.employeeName) {
            card.dataset.employeeName = employeeName;
        }
        if (card.dataset.hasShiftDetailsHandler) return;
        card.dataset.hasShiftDetailsHandler = 'true';

        card.addEventListener('click', function(e) {
            if (e.target.closest('.task-warning')) return;
            const dayColumn = card.closest('.day-column');
            const cardDay = dayColumn?.dataset.day || 'monday';
            const posEl = card.querySelector('.shift-position');
            const timeEl = card.querySelector('.shift-time');
            const empEl = card.querySelector('.employee-name');
            const POS_MAP = { 'Line Cook':'line-cook', 'Server':'server',
                               'Dish':'dish', 'Prep':'prep', 'FOH Manager':'foh-manager' };
            const posLabel = posEl?.textContent.trim() || '';
            const posValue = POS_MAP[posLabel] || (posLabel ? posLabel.toLowerCase().replace(/\s+/g, '-') : 'line-cook');
            const empName = empEl?.textContent.trim() || '';
            const empKey = empName.toLowerCase();
            const timeStr = timeEl?.textContent.trim() || '';
            editShift(card, empKey, posValue, timeStr, cardDay);
        });
    });
    
    // Add click handlers to empty day slots
    document.querySelectorAll('.empty-day').forEach(emptyDay => {
        emptyDay.addEventListener('click', function() {
            // Find the parent day-column to get the day
            const dayColumn = this.closest('.day-column');
            const day = dayColumn ? dayColumn.dataset.day : null;
            openModal('assign-shift-modal', day);
        });
    });

    // Add click handlers to per-day add shift buttons
    document.querySelectorAll('.day-add-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const dayColumn = this.closest('.day-column');
            const day = dayColumn ? dayColumn.dataset.day : null;
            openModal('assign-shift-modal', day);
        });
    });
}

// Animations
function animateShiftCards() {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.animationPlayState = 'running';
            }
        });
    });
    
    document.querySelectorAll('.shift-card').forEach(card => {
        observer.observe(card);
    });
}

// Notifications
function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <div class="notification-content">
            <i class="fas fa-${getNotificationIcon(type)}"></i>
            <span>${message}</span>
        </div>
        <button class="notification-close" onclick="this.parentElement.remove()">
            <i class="fas fa-times"></i>
        </button>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: ${getNotificationColor(type)};
        color: white;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
        z-index: 10001;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        max-width: 400px;
        animation: slideInRight 0.3s ease;
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOutRight 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

function getNotificationIcon(type) {
    const icons = {
        'success': 'check-circle',
        'error': 'exclamation-circle',
        'warning': 'exclamation-triangle',
        'info': 'info-circle'
    };
    return icons[type] || 'info-circle';
}

function getNotificationColor(type) {
    const colors = {
        'success': '#4CAF50',
        'error': '#f56565',
        'warning': '#ed8936',
        'info': '#4299e1'
    };
    return colors[type] || '#4299e1';
}

// Coming Soon placeholder
function showComingSoon(feature) {
    showNotification(`${feature} coming soon!`, 'info');
}

// Check if employee has approved drop for a specific date
function isEmployeeDropping(employeeName, dateString) {
    const drops = window.approvedDrops || {};
    const employeeDrops = drops[employeeName] || [];
    return employeeDrops.includes(dateString);
}

// Get date string for a day of the week (based on current week)
function getDateForDay(dayName) {
    const dayIndex = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].indexOf(dayName.toLowerCase());
    if (dayIndex === -1) return null;
    
    // Use currentWeekStart (Monday) and add days
    const targetDate = new Date(currentWeekStart);
    targetDate.setDate(targetDate.getDate() + dayIndex);
    
    return targetDate.toISOString().split('T')[0]; // YYYY-MM-DD format
}

// Get employee display name from select value
function getEmployeeDisplayName(employeeValue) {
    const employeeNames = {
        'kenny': 'Kenny',
        'rohan': 'Rohan',
        'jake': 'Jake',
        'natalie': 'Natalie',
        'sam': 'Sam',
        'sophia': 'Sophia',
        'aria': 'Aria',
        'alex': 'Alex'
    };
    return employeeNames[employeeValue] || employeeValue.charAt(0).toUpperCase() + employeeValue.slice(1);
}

// Format date for display
function formatDateForDisplay(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Task Assignment
function setupTaskAssignment() {
    const taskList = document.getElementById('task-list');
    const addRowBtn = document.getElementById('add-task-row');

    if (taskList && addRowBtn) {
        addRowBtn.addEventListener('click', () => {
            addTaskRow(taskList);
        });
    }

    // When user changes employee in Assign Task modal, reload existing tasks
    const taskEmployeeSelect = document.getElementById('task-employee-select');
    if (taskEmployeeSelect) {
        taskEmployeeSelect.addEventListener('change', () => {
            const modal = document.getElementById('assign-task-modal');
            const existingList = document.getElementById('existing-tasks-list');
            const existingGroup = document.getElementById('existing-tasks-group');
            const employeeName = taskEmployeeSelect.value ? getEmployeeDisplayName(taskEmployeeSelect.value) : null;
            if (modal) modal.dataset.employeeName = employeeName || '';
            if (employeeName && existingList && existingGroup) {
                loadExistingTasksForEmployee(employeeName, existingList, existingGroup);
            }
        });
    }

    // Load active recipes
    loadActiveRecipes();

    // Common task buttons - use the task list from whichever modal is open
    document.querySelectorAll('.task-option-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const taskDesc = this.dataset.task;
            const shiftModal = document.getElementById('shift-details-modal');
            const listEl = shiftModal?.classList.contains('active')
                ? document.getElementById('shift-details-task-list')
                : document.getElementById('task-list');
            if (!listEl) return;

            const active = document.activeElement;
            let targetInput = active && active.classList && active.classList.contains('task-input')
                ? active
                : null;

            if (!targetInput) {
                targetInput = Array.from(listEl.querySelectorAll('.task-input'))
                    .find(input => !input.value.trim()) || null;
            }

            if (!targetInput) {
                targetInput = addTaskRow(listEl);
            }

            if (targetInput) {
                targetInput.value = taskDesc;
                targetInput.focus();
            }
        });
    });

    // Recipe assignment options modal handlers
    document.getElementById('assign-prep-only')?.addEventListener('click', () => handleRecipeAssignment('prep'));
    document.getElementById('assign-active-only')?.addEventListener('click', () => handleRecipeAssignment('active'));
    document.getElementById('assign-both')?.addEventListener('click', () => handleRecipeAssignment('both'));
}

// Load active recipes from recipes page
function loadActiveRecipes() {
    const recipesList = document.getElementById('active-recipes-list');
    if (!recipesList) return;

    // Get recipes from global recipesData if available, or from DOM
    let activeRecipes = [];
    
    if (typeof window.recipesData !== 'undefined' && Object.keys(window.recipesData).length > 0) {
        activeRecipes = Object.values(window.recipesData).filter(r => r.name && r.active !== false);
    } else {
        // Fallback: try to get from recipes page DOM if available
        try {
            const recipeCards = document.querySelectorAll('.recipes-active .recipe-card');
            recipeCards.forEach(card => {
                const name = card.querySelector('.recipe-name')?.textContent?.trim();
                if (name) {
                    activeRecipes.push({ name });
                }
            });
        } catch (e) {
            // If recipes page not loaded, use sample data
            activeRecipes = [
                { name: 'Focaccia Kit' },
                { name: 'Balsamic Glaze' },
                { name: 'Smoked Salmon' },
                { name: 'Meringue' },
                { name: 'Chilled Pea Soup' },
                { name: 'Pickled Garlic' }
            ];
        }
    }

    recipesList.innerHTML = '';
    if (activeRecipes.length === 0) {
        recipesList.innerHTML = '<p style="color: #718096; font-size: 0.9rem; padding: 0.5rem;">No active recipes available.</p>';
        return;
    }

    activeRecipes.forEach(recipe => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'recipe-select-btn';
        btn.textContent = recipe.name;
        btn.dataset.recipeName = recipe.name;
        btn.addEventListener('click', function() {
            openRecipeAssignmentModal(recipe.name);
        });
        recipesList.appendChild(btn);
    });
}

// Make loadActiveRecipes globally available so recipes.js can call it
window.loadActiveRecipes = loadActiveRecipes;

let pendingRecipeAssignment = null;
let pendingRecipeAssignmentTargetList = null; // task list to add to (assign vs edit shift)

function openRecipeAssignmentModal(recipeName, targetTaskList) {
    const modal = document.getElementById('recipe-assignment-modal');
    const titleEl = document.getElementById('recipe-assignment-title');
    const textEl = document.getElementById('recipe-assignment-text');
    
    if (!modal || !titleEl || !textEl) return;

    pendingRecipeAssignment = recipeName;
    pendingRecipeAssignmentTargetList = targetTaskList || document.getElementById('task-list');
    titleEl.textContent = `Assign ${recipeName}`;
    textEl.textContent = `What would you like to assign for ${recipeName}?`;
    const qtyInput = document.getElementById('recipe-assignment-qty');
    if (qtyInput) qtyInput.value = '1';
    
    openModal('recipe-assignment-modal');
}

function handleRecipeAssignment(type) {
    if (!pendingRecipeAssignment) return;

    const recipeName = pendingRecipeAssignment;
    const qtyInput = document.getElementById('recipe-assignment-qty');
    const qty = Math.max(1, parseInt(qtyInput?.value, 10) || 1);
    const taskList = pendingRecipeAssignmentTargetList || document.getElementById('task-list');
    if (!taskList) return;

    const tasks = [];
    
    // Determine task names based on type (include quantity for inventory sync)
    if (type === 'prep') {
        tasks.push(qty > 1 ? `kit ${qty} ${recipeName}` : `kit ${recipeName}`);
    } else if (type === 'active') {
        tasks.push(qty > 1 ? `make ${qty} ${recipeName}` : recipeName);
    } else if (type === 'both') {
        tasks.push(qty > 1 ? `kit ${qty} ${recipeName}` : `kit ${recipeName}`);
        tasks.push(qty > 1 ? `make ${qty} ${recipeName}` : recipeName);
    }

    // Add tasks to the task list
    tasks.forEach((taskDesc, index) => {
        let targetInput;
        
        if (index === 0) {
            // First task: use current input or find empty one
            const active = document.activeElement;
            targetInput = active && active.classList && active.classList.contains('task-input')
                ? active
                : null;

            if (!targetInput) {
                targetInput = Array.from(taskList.querySelectorAll('.task-input'))
                    .find(input => !input.value.trim()) || null;
            }

            if (!targetInput) {
                targetInput = addTaskRow(taskList);
            }
        } else {
            // Additional tasks: add new row
            targetInput = addTaskRow(taskList);
        }

        if (targetInput) {
            targetInput.value = taskDesc;
        }
    });

    // Focus the first added task
    const firstAdded = taskList.querySelector('.task-input');
    if (firstAdded) firstAdded.focus();

    closeModal('recipe-assignment-modal');
    pendingRecipeAssignment = null;
    pendingRecipeAssignmentTargetList = null;
}

function getRecipeData(recipeName) {
    // Try to get from global recipesData
    if (typeof window.recipesData !== 'undefined' && window.recipesData[recipeName]) {
        return window.recipesData[recipeName];
    }
    
    // Fallback: try to get from DOM
    try {
        const recipeCards = document.querySelectorAll('.recipe-card');
        for (const card of recipeCards) {
            const name = card.querySelector('.recipe-name')?.textContent?.trim();
            if (name === recipeName) {
                try {
                    const ingredients = JSON.parse(card.dataset.ingredients || '[]');
                    const steps = JSON.parse(card.dataset.steps || '[]');
                    return { name, ingredients, steps };
                } catch (e) {
                    // If data not in dataset, return basic info
                    return { name, steps: [] };
                }
            }
        }
    } catch (e) {
        // Fallback to sample data
        const samples = {
            'Focaccia Kit': { name: 'Focaccia Kit', steps: [{ prep: 'Measure flour, water, salt, yeast. Oil a large baking pan.', active: 'Mix dough, knead 10 min. Proof 1 hr. Stretch into pan, dimple, drizzle oil. Bake 220°C 25 min.' }, { prep: 'Cool rack, serving board', active: 'Cool 10 min, slice, serve with olive oil.' }] },
            'Balsamic Glaze': { name: 'Balsamic Glaze', steps: [{ prep: 'Measure vinegar and honey.', active: 'Simmer in saucepan until reduced by half, 15–20 min. Cool to room temperature.' }] },
            'Smoked Salmon': { name: 'Smoked Salmon', steps: [{ prep: 'Mix salt, sugar, pepper. Cure salmon 12 hrs. Rinse and dry.', active: 'Cold-smoke 4–6 hrs at 25°C. Rest 24 hrs in fridge, slice thin.' }] },
            'Meringue': { name: 'Meringue', steps: [{ prep: 'Bring whites to room temp. Line baking sheet. Preheat oven 100°C.', active: 'Whip whites + salt to soft peaks. Add sugar slowly. Pipe onto sheet. Bake 90 min.' }] },
            'Chilled Pea Soup': { name: 'Chilled Pea Soup', steps: [{ prep: 'Dice onion. Defrost peas. Chop mint.', active: 'Sauté onion. Add peas + stock. Simmer 5 min. Blend, stir in cream. Chill, garnish mint.' }] },
            'Pickled Garlic': { name: 'Pickled Garlic', steps: [{ prep: 'Peel garlic cloves. Sterilize jar.', active: 'Boil vinegar, water, sugar, salt. Pour over garlic. Seal, cool. Refrigerate 24 hrs.' }] }
        };
        return samples[recipeName] || null;
    }
    
    return null;
}

// Overtime Warning Modal
let overtimeConfirmCallback = null;

function openOvertimeWarningModal(employeeName, currentHours, shiftHours, newTotalHours, confirmCallback) {
    const modal = document.getElementById('overtime-warning-modal');
    const textEl = document.getElementById('overtime-warning-text');
    const confirmBtn = document.getElementById('confirm-overtime-btn');
    
    if (!modal || !textEl || !confirmBtn) return;
    
    overtimeConfirmCallback = confirmCallback;
    
    const overtimeHours = newTotalHours - 40;
    textEl.textContent = `This employee will work more than 40 hours this week. Current: ${currentHours.toFixed(1)}h + ${shiftHours.toFixed(1)}h shift = ${newTotalHours.toFixed(1)}h total (${overtimeHours.toFixed(1)}h overtime).`;
    
    // Remove existing listeners
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.replaceWith(newConfirmBtn);
    newConfirmBtn.addEventListener('click', function() {
        if (overtimeConfirmCallback) {
            overtimeConfirmCallback();
        }
        closeModal('overtime-warning-modal');
        overtimeConfirmCallback = null;
    });
    
    openModal('overtime-warning-modal');
}

async function populateTaskEmployeeSelect() {
    const select = document.getElementById('task-employee-select');
    if (!select) return;

    let names = [];
    if (window.supabaseClient && window.ORG_ID) {
        const { data, error } = await window.supabaseClient
            .from('employee_positions')
            .select('employee_name')
            .eq('org_id', window.ORG_ID)
            .order('employee_name');
        names = (data || []).map(r => r.employee_name).filter(Boolean);
        if (names.length === 0) {
            await seedEmployeesIfEmpty();
            const res = await window.supabaseClient
                .from('employee_positions')
                .select('employee_name')
                .eq('org_id', window.ORG_ID)
                .order('employee_name');
            names = (res.data || []).map(r => r.employee_name).filter(Boolean);
        }
    }
    if (names.length === 0) names = DEFAULT_EMPLOYEES;

    select.innerHTML = '<option value="">Select Employee</option>' + names.map(n => {
        const val = EMPLOYEE_VALUE_MAP[n] || n.toLowerCase().replace(/\s+/g, '-');
        return `<option value="${val}">${escapeHtml(n)}</option>`;
    }).join('');
}

async function openAssignTaskModal(employeeName, day) {
    const modal = document.getElementById('assign-task-modal');
    const titleEl = document.getElementById('assign-task-title');
    const employeeSelect = document.getElementById('task-employee-select');
    const taskList = document.getElementById('task-list');
    const existingTasksGroup = document.getElementById('existing-tasks-group');
    const existingTasksList = document.getElementById('existing-tasks-list');
    
    if (!modal || !titleEl || !employeeSelect || !taskList) return;
    
    titleEl.textContent = 'Assign Task';
    taskList.innerHTML = '';
    addTaskRow(taskList);
    modal.dataset.day = day || '';
    
    await populateTaskEmployeeSelect();
    
    const val = employeeName ? (EMPLOYEE_VALUE_MAP[employeeName] || employeeName.toLowerCase().replace(/\s+/g, '-')) : '';
    const option = Array.from(employeeSelect.options).find(o => o.value === val);
    if (option) employeeSelect.value = val;
    const selectedName = getEmployeeDisplayName(employeeSelect.value) || employeeName;
    modal.dataset.employeeName = selectedName;
    
    loadExistingTasksForEmployee(selectedName, existingTasksList, existingTasksGroup);
    openModal('assign-task-modal');
    loadActiveRecipes();
    const taskInput = taskList.querySelector('.task-input');
    if (taskInput) taskInput.focus();
}

// Load existing tasks for an employee and display them in the modal
function loadExistingTasksForEmployee(employeeName, container, groupElement) {
    if (!container || !groupElement) return;
    
    // Clear existing content
    container.innerHTML = '';
    
    // Get tasks from window.kitchenTasks
    const existingTasks = [];
    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length > 0) {
        window.kitchenTasks.forEach(task => {
            if (task.assignee && task.assignee.toLowerCase() === employeeName.toLowerCase()) {
                existingTasks.push({
                    assignee: task.assignee,
                    description: task.description
                });
            }
        });
    }
    
    // Also check tasks from the progress list on the home page
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        progressList.querySelectorAll('.progress-item').forEach(item => {
            const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
            const description = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
            const isCompleted = item.dataset.completed === 'true' || item.classList.contains('task-completed');
            
            if (assignee && assignee.toLowerCase() === employeeName.toLowerCase() && description) {
                // Check if already added
                const alreadyExists = existingTasks.some(t => 
                    t.assignee === assignee && t.description === description
                );
                if (!alreadyExists) {
                    existingTasks.push({
                        assignee: assignee,
                        description: description,
                        completed: isCompleted
                    });
                }
            }
        });
    }
    
    // Display tasks
    if (existingTasks.length > 0) {
        groupElement.style.display = 'block';
        
        existingTasks.forEach(task => {
            const taskItem = createExistingTaskItem(task.assignee, task.description, task.completed);
            container.appendChild(taskItem);
        });
    } else {
        groupElement.style.display = 'none';
    }
}

// Create a display item for an existing task (read-only in modal)
function createExistingTaskItem(employeeName, taskDescription, isCompleted) {
    const currentUser = getCurrentUser();
    const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === employeeName.toLowerCase();
    
    const taskItem = document.createElement('div');
    taskItem.className = `existing-task-item ${isCompleted ? 'task-completed' : ''}`;
    taskItem.dataset.employeeName = employeeName;
    taskItem.dataset.taskDescription = taskDescription;
    
    // Create delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-task';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
    deleteBtn.title = 'Remove task';
    deleteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm(`Remove task "${taskDescription}" from ${employeeName}?`)) {
            removeTask(employeeName, taskDescription);
            const shiftModal = document.getElementById('shift-details-modal');
            const assignModal = document.getElementById('assign-task-modal');
            let listEl, groupEl, empName;
            if (shiftModal?.classList.contains('active')) {
                listEl = document.getElementById('shift-details-existing-tasks-list');
                groupEl = document.getElementById('shift-details-existing-tasks-group');
                empName = shiftModal.dataset.employeeName;
            } else if (assignModal) {
                listEl = document.getElementById('existing-tasks-list');
                groupEl = document.getElementById('existing-tasks-group');
                empName = assignModal.dataset.employeeName;
            }
            if (empName && listEl && groupEl) {
                loadExistingTasksForEmployee(empName, listEl, groupEl);
            }
        }
    });
    
    if (isAssignedToCurrentUser) {
        // Show checkbox for assigned employee
        const label = document.createElement('label');
        label.className = 'task-checkbox-label';
        label.innerHTML = `
            <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${Date.now()}">
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        
        const checkbox = label.querySelector('.task-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', function() {
                // Update the task in the main progress list
                updateTaskInProgressList(employeeName, taskDescription, this.checked);
                // Update local display
                if (this.checked) {
                    taskItem.classList.add('task-completed');
                    const taskText = taskItem.querySelector('.task-text');
                    if (taskText) {
                        taskText.style.textDecoration = 'line-through';
                        taskText.style.opacity = '0.6';
                    }
                } else {
                    taskItem.classList.remove('task-completed');
                    const taskText = taskItem.querySelector('.task-text');
                    if (taskText) {
                        taskText.style.textDecoration = 'none';
                        taskText.style.opacity = '1';
                    }
                }
            });
        }
        
        taskItem.appendChild(label);
    } else {
        // Show read-only status for others
        const readonlyDiv = document.createElement('div');
        readonlyDiv.className = 'task-status-readonly';
        readonlyDiv.innerHTML = `
            <i class="fas ${isCompleted ? 'fa-check-circle task-status-complete' : 'fa-circle task-status-pending'} task-status-icon ${isCompleted ? 'task-status-complete' : 'task-status-pending'}"></i>
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        taskItem.appendChild(readonlyDiv);
    }
    
    // Add delete button
    taskItem.appendChild(deleteBtn);
    
    return taskItem;
}

// Update task completion status in the main progress list
function updateTaskInProgressList(employeeName, taskDescription, isCompleted) {
    const progressList = document.querySelector('.progress-list');
    if (!progressList) return;
    
    progressList.querySelectorAll('.progress-item').forEach(item => {
        const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
        const desc = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
        
        if (assignee && assignee.toLowerCase() === employeeName.toLowerCase() && 
            desc && desc === taskDescription) {
            // Update the task item
            item.dataset.completed = isCompleted ? 'true' : 'false';
            
            if (isCompleted) {
                item.classList.add('task-completed');
                item.classList.remove('in-progress');
            } else {
                item.classList.remove('task-completed');
                item.classList.add('in-progress');
            }
            
            // Update checkbox if present
            const checkbox = item.querySelector('.task-checkbox');
            if (checkbox) {
                checkbox.checked = isCompleted;
            }
            
            // Update text styling
            const taskText = item.querySelector('.task-text');
            if (taskText) {
                if (isCompleted) {
                    taskText.style.textDecoration = 'line-through';
                    taskText.style.opacity = '0.6';
                } else {
                    taskText.style.textDecoration = 'none';
                    taskText.style.opacity = '1';
                }
            }
            
            // Update read-only status icon if present
            const statusIcon = item.querySelector('.task-status-icon');
            if (statusIcon) {
                if (isCompleted) {
                    statusIcon.classList.remove('task-status-pending');
                    statusIcon.classList.add('task-status-complete');
                    statusIcon.className = 'fas fa-check-circle task-status-icon task-status-complete';
                } else {
                    statusIcon.classList.remove('task-status-complete');
                    statusIcon.classList.add('task-status-pending');
                    statusIcon.className = 'fas fa-circle task-status-icon task-status-pending';
                }
            }
            
            // Check if all tasks are complete
            if (isCompleted && typeof window.checkAllTasksComplete === 'function') {
                window.checkAllTasksComplete(employeeName);
            }
        }
    });
    
    // Also update window.kitchenTasks if it exists
    if (typeof window.kitchenTasks !== 'undefined') {
        window.kitchenTasks.forEach(task => {
            if (task.assignee && task.assignee.toLowerCase() === employeeName.toLowerCase() &&
                task.description === taskDescription) {
                task.completed = isCompleted;
            }
        });
        
        // Save to localStorage
        try {
            localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
        } catch (e) {
            console.warn('Could not save tasks to localStorage:', e);
        }
    }
}

function assignTask() {
    const modal = document.getElementById('assign-task-modal');
    const employeeSelect = document.getElementById('task-employee-select');
    const employeeName = employeeSelect?.value ? getEmployeeDisplayName(employeeSelect.value) : (modal?.dataset.employeeName || null);
    const taskInputs = modal ? modal.querySelectorAll('.task-input') : null;
    
    if (!employeeName) {
        showNotification('Please select an employee.', 'error');
        return;
    }
    
    if (!taskInputs || taskInputs.length === 0) {
        showNotification('Please add at least one task.', 'error');
        return;
    }

    const descriptions = Array.from(taskInputs)
        .map(input => input.value.trim())
        .filter(Boolean);

    if (descriptions.length === 0) {
        showNotification('Please enter at least one task description.', 'error');
        const firstInput = modal.querySelector('.task-input');
        if (firstInput) firstInput.focus();
        return;
    }
    
    // Add each task to Kitchen Progress
    descriptions.forEach(desc => {
        addTaskToProgress(employeeName, desc);
    });
    
    // Update shift card indicators for this employee
    updateEmployeeShiftCards(employeeName);
    
    // Refresh existing tasks display in modal before closing
    const existingTasksList = document.getElementById('existing-tasks-list');
    const existingTasksGroup = document.getElementById('existing-tasks-group');
    if (existingTasksList && existingTasksGroup) {
        loadExistingTasksForEmployee(employeeName, existingTasksList, existingTasksGroup);
    }
    
    // Close modal
    closeModal('assign-task-modal');
    const message = descriptions.length === 1
        ? `Task "${descriptions[0]}" assigned to ${employeeName}.`
        : `${descriptions.length} tasks assigned to ${employeeName}.`;
    showNotification(message, 'success');
}

// Helper to add a new task row to the assign-task modal
function addTaskRow(listEl) {
    const row = document.createElement('div');
    row.className = 'task-row';

    row.innerHTML = `
        <input type="text" class="form-control task-input" placeholder="e.g. Making Focaccia Kit">
        <button type="button" class="btn-remove-task" aria-label="Remove task">
            <i class="fas fa-times"></i>
        </button>
    `;

    const removeBtn = row.querySelector('.btn-remove-task');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            const allRows = listEl.querySelectorAll('.task-row');
            if (allRows.length === 1) {
                // Keep at least one row; just clear it
                const input = row.querySelector('.task-input');
                if (input) input.value = '';
                input?.focus();
            } else {
                row.remove();
            }
        });
    }

    listEl.appendChild(row);

    const input = row.querySelector('.task-input');
    if (input) {
        input.focus();
    }

    return input;
}

// Add task to Kitchen Progress section (shared function)
function addTaskToProgress(employeeName, taskDescription) {
    // Store task data globally
    if (typeof window.kitchenTasks === 'undefined') {
        window.kitchenTasks = [];
    }
    
    // Check if task already exists to avoid duplicates
    const taskExists = window.kitchenTasks.some(task => 
        task.assignee === employeeName && task.description === taskDescription
    );
    
    if (!taskExists) {
        window.kitchenTasks.push({
            assignee: employeeName,
            description: taskDescription,
            timestamp: new Date().toISOString(),
            completed: false
        });
    }
    
    // If we're on the home page, add it immediately to the progress list
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        // Check if task already exists in the DOM
        const existingTasks = Array.from(progressList.querySelectorAll('.progress-item'));
        const existsInDOM = existingTasks.some(item => {
            const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
            const desc = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
            return assignee === employeeName && desc === taskDescription;
        });
        
        if (!existsInDOM) {
            if (typeof window.createTaskItem === 'function') {
                window.createTaskItem(progressList, employeeName, taskDescription);
            } else if (typeof createTaskItem === 'function') {
                createTaskItem(progressList, employeeName, taskDescription);
            }
        }
    }
    
    // Store in localStorage for persistence across page reloads
    try {
        localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
    } catch (e) {
        console.warn('Could not save tasks to localStorage:', e);
    }

    // Sync to Supabase (use employee_name to match mobile)
    if (window.supabaseClient && window.ORG_ID && !taskExists) {
        window.supabaseClient.from('tasks').insert({
            org_id: window.ORG_ID,
            text: taskDescription,
            employee_id: typeof window.getEmployeeIdFromName === 'function' ? window.getEmployeeIdFromName(employeeName) : null,
            status: 'todo',
            is_urgent: false
        }).select().then(({ data, error }) => {
            if (error) {
                console.warn('[Supabase] Task insert failed:', error.message);
            } else if (data?.[0]) {
                const local = window.kitchenTasks.find(t =>
                    t.assignee === employeeName && t.description === taskDescription
                );
                if (local) {
                    local.supabase_id = data[0].id;
                    localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
                }
                notifyTaskAssigned(employeeName, taskDescription);
            }
        });
    }
}

// Remove a task from an employee
function removeTask(employeeName, taskDescription) {
    // Remove from window.kitchenTasks
    if (typeof window.kitchenTasks !== 'undefined') {
        const removedTask = window.kitchenTasks.find(t =>
            t.assignee === employeeName && t.description === taskDescription
        );

        window.kitchenTasks = window.kitchenTasks.filter(task => 
            !(task.assignee === employeeName && task.description === taskDescription)
        );
        
        // Save to localStorage
        try {
            localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
        } catch (e) {
            console.warn('Could not save tasks to localStorage:', e);
        }

        // Sync delete to Supabase
        if (window.supabaseClient && window.ORG_ID) {
            const query = window.supabaseClient.from('tasks').delete().eq('org_id', window.ORG_ID);
            const deletion = removedTask?.supabase_id
                ? query.eq('id', removedTask.supabase_id)
                : query.eq('text', taskDescription);
            deletion.then(({ error }) => {
                if (error) console.warn('[Supabase] Task delete failed:', error.message);
            });
        }
    }
    
    // Remove from progress list on home page
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        progressList.querySelectorAll('.progress-item').forEach(item => {
            const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
            const desc = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
            
            if (assignee === employeeName && desc === taskDescription) {
                // Animate out
                item.style.transition = 'all 0.3s ease';
                item.style.opacity = '0';
                item.style.transform = 'translateX(-20px)';
                setTimeout(() => {
                    item.remove();
                    // Update shift card indicators if on scheduling page
                    if (typeof updateEmployeeShiftCards === 'function') {
                        updateEmployeeShiftCards(employeeName);
                    }
                }, 300);
            }
        });
    }
    
    // Show notification
    if (typeof showNotification === 'function') {
        showNotification(`Task "${taskDescription}" removed from ${employeeName}.`, 'success');
    }
}

// Make removeTask globally available
window.removeTask = removeTask;

// Get current user name
function getCurrentUser() {
    return document.querySelector('.user-profile span')?.textContent?.trim() || '';
}

// Create a task item with checkboxes (only visible to assigned employee)
function createTaskItem(container, employeeName, taskDescription) {
    const taskItem = document.createElement('div');
    taskItem.className = 'progress-item in-progress';
    taskItem.dataset.employeeName = employeeName;
    taskItem.dataset.taskDescription = taskDescription;
    taskItem.dataset.completed = 'false';
    
    const currentUser = getCurrentUser();
    const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === employeeName.toLowerCase();
    
    // Check if this is a recipe-based task with steps
    const isRecipeTask = taskDescription.includes(' - Prep Step ') || taskDescription.includes(' - Active Step ');
    const recipeMatch = taskDescription.match(/^(.+?)\s*-\s*(Prep|Active)\s+Step\s+\d+:\s*(.+)$/);
    
    let taskText = '';
    if (isRecipeTask && recipeMatch) {
        const recipeName = recipeMatch[1];
        const stepType = recipeMatch[2];
        const stepDesc = recipeMatch[3];
        taskText = `${recipeName} - ${stepType} Step: ${stepDesc}`;
    } else {
        taskText = taskDescription;
    }
    
    if (isAssignedToCurrentUser) {
        // Show checkbox for assigned employee
        taskItem.innerHTML = `
            <div class="progress-indicator"></div>
            <div class="progress-content">
                <span class="task-assignee">${escapeHtml(employeeName)}</span>
                <div class="task-description">
                    <label class="task-checkbox-label">
                        <input type="checkbox" class="task-checkbox" data-task-id="${Date.now()}">
                        <span class="task-text">${escapeHtml(taskText)}</span>
                    </label>
                </div>
            </div>
        `;
        
        // Add checkbox handler
        const checkbox = taskItem.querySelector('.task-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', function() {
                handleTaskCheckboxChange(taskItem, this);
            });
        }
    } else {
        // Show read-only status for others
        taskItem.innerHTML = `
            <div class="progress-indicator"></div>
            <div class="progress-content">
                <span class="task-assignee">${escapeHtml(employeeName)}</span>
                <div class="task-description">
                    <div class="task-status-readonly">
                        <i class="fas fa-circle task-status-icon task-status-pending"></i>
                        <span class="task-text">${escapeHtml(taskText)}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    container.appendChild(taskItem);
    
    // Animate in
    taskItem.style.opacity = '0';
    taskItem.style.transform = 'translateY(10px)';
    requestAnimationFrame(() => {
        taskItem.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
        taskItem.style.opacity = '1';
        taskItem.style.transform = 'translateY(0)';
    });
}

// Handle checkbox change
function handleTaskCheckboxChange(taskItem, checkbox) {
    const employeeName = taskItem.dataset.employeeName;
    const currentUser = getCurrentUser();
    const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === employeeName.toLowerCase();
    
    // Only allow assigned employee to check/uncheck
    if (!isAssignedToCurrentUser) return;
    
    const taskDescription = taskItem.dataset.taskDescription;

    if (checkbox.checked) {
        // Mark as complete
        taskItem.dataset.completed = 'true';
        taskItem.classList.add('task-completed');
        taskItem.classList.remove('in-progress');
        const taskText = taskItem.querySelector('.task-text');
        if (taskText) {
            taskText.style.textDecoration = 'line-through';
            taskText.style.opacity = '0.6';
        }
        
        // Sync kit/make completion to inventory
        if (typeof applyTaskCompletionToInventory === 'function') {
            applyTaskCompletionToInventory(taskDescription, true);
        }
        
        // Update read-only views for other users
        updateTaskStatusForOthers(employeeName, taskDescription, true);
        
        // Check if all tasks for this employee are complete
        checkAllTasksComplete(employeeName);
    } else {
        // Mark as incomplete
        taskItem.dataset.completed = 'false';
        taskItem.classList.remove('task-completed');
        taskItem.classList.add('in-progress');
        const taskText = taskItem.querySelector('.task-text');
        if (taskText) {
            taskText.style.textDecoration = 'none';
            taskText.style.opacity = '1';
        }
        
        // Update read-only views for other users
        updateTaskStatusForOthers(employeeName, taskDescription, false);
    }

    // Sync completion status to Supabase
    if (window.supabaseClient && window.ORG_ID) {
        const newStatus = checkbox.checked ? 'completed' : 'todo';
        const localTask = (window.kitchenTasks || []).find(t =>
            t.assignee === employeeName && t.description === taskDescription
        );
        const query = window.supabaseClient.from('tasks')
            .update({
                status: newStatus,
                completed_at: checkbox.checked ? new Date().toISOString() : null
            })
            .eq('org_id', window.ORG_ID);
        const update = localTask?.supabase_id
            ? query.eq('id', localTask.supabase_id)
            : query.eq('text', taskDescription);
        update.then(({ error }) => {
            if (error) console.warn('[Supabase] Task status update failed:', error.message);
        });
    }
}

// Update read-only task status for other users
function updateTaskStatusForOthers(employeeName, taskDescription, isCompleted) {
    const allTaskItems = document.querySelectorAll('.progress-item');
    allTaskItems.forEach(item => {
        const itemEmployee = item.dataset.employeeName;
        const itemDesc = item.dataset.taskDescription;
        const currentUser = getCurrentUser();
        const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === itemEmployee?.toLowerCase();
        
        // Update matching tasks that are read-only (not assigned to current user)
        if (itemEmployee === employeeName && itemDesc === taskDescription && !isAssignedToCurrentUser) {
            const statusIcon = item.querySelector('.task-status-icon');
            if (statusIcon) {
                if (isCompleted) {
                    statusIcon.classList.remove('task-status-pending');
                    statusIcon.classList.add('task-status-complete');
                    statusIcon.className = 'fas fa-check-circle task-status-icon task-status-complete';
                    item.dataset.completed = 'true';
                    item.classList.add('task-completed');
                    const taskText = item.querySelector('.task-text');
                    if (taskText) {
                        taskText.style.textDecoration = 'line-through';
                        taskText.style.opacity = '0.6';
                    }
                } else {
                    statusIcon.classList.remove('task-status-complete');
                    statusIcon.classList.add('task-status-pending');
                    statusIcon.className = 'fas fa-circle task-status-icon task-status-pending';
                    item.dataset.completed = 'false';
                    item.classList.remove('task-completed');
                    const taskText = item.querySelector('.task-text');
                    if (taskText) {
                        taskText.style.textDecoration = 'none';
                        taskText.style.opacity = '1';
                    }
                }
            }
        }
    });
}

// Check if all tasks for an employee are complete
function checkAllTasksComplete(employeeName) {
    const employeeTasks = document.querySelectorAll(`[data-employee-name="${employeeName}"]`);
    const allChecked = Array.from(employeeTasks).every(item => {
        const checkbox = item.querySelector('.task-checkbox');
        return checkbox && checkbox.checked;
    });
    
    if (allChecked && employeeTasks.length > 0) {
        // All tasks complete - remove after delay
        setTimeout(() => {
            employeeTasks.forEach(item => {
                item.style.transition = 'all 0.4s ease';
                item.style.opacity = '0';
                item.style.transform = 'translateX(-20px)';
                setTimeout(() => {
                    item.remove();
                    // Update shift cards on scheduling page
                    if (typeof updateEmployeeShiftCards === 'function') {
                        setTimeout(() => updateEmployeeShiftCards(employeeName), 100);
                    }
                }, 400);
            });
        }, 1000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Make checkbox handlers globally available
window.handleTaskCheckboxChange = handleTaskCheckboxChange;
window.checkAllTasksComplete = checkAllTasksComplete;
window.createTaskItem = createTaskItem;
window.getCurrentUser = getCurrentUser;

// Check if employee has assigned tasks
function employeeHasTasks(employeeName) {
    // Check in window.kitchenTasks
    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length > 0) {
        const hasTask = window.kitchenTasks.some(task => 
            task.assignee && task.assignee.trim() === employeeName.trim()
        );
        if (hasTask) return true;
    }
    
    // Also check in DOM (Kitchen Progress section) if on home page
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        const taskItems = progressList.querySelectorAll('.progress-item');
        for (const item of taskItems) {
            const assigneeEl = item.querySelector('.task-assignee');
            if (assigneeEl && assigneeEl.textContent.trim() === employeeName.trim()) {
                return true;
            }
        }
    }
    
    return false;
}

// Update shift card visual indicator based on task status
function updateShiftCardTaskIndicator(shiftCard, employeeName) {
    const hasTasks = employeeHasTasks(employeeName);
    
    // Remove existing warning indicator
    const existingWarning = shiftCard.querySelector('.task-warning');
    if (existingWarning) {
        existingWarning.remove();
    }
    
    // Remove warning class
    shiftCard.classList.remove('no-tasks-warning');
    
    if (!hasTasks) {
        // Add warning class for yellow background
        shiftCard.classList.add('no-tasks-warning');
        
        // Add warning indicator
        const warningDiv = document.createElement('div');
        warningDiv.className = 'task-warning';
        warningDiv.innerHTML = `
            <i class="fas fa-exclamation-triangle"></i>
            <span class="warning-text">This employee has not been assigned any tasks</span>
        `;
        shiftCard.appendChild(warningDiv);
    }
}

// Check all shift cards for task status
function checkEmployeeTasks() {
    const shiftCards = document.querySelectorAll('.shift-card');
    shiftCards.forEach(card => {
        const employeeName = card.dataset.employeeName || card.querySelector('.employee-name')?.textContent.trim();
        if (employeeName) {
            // Store employee name if not already stored
            if (!card.dataset.employeeName) {
                card.dataset.employeeName = employeeName;
            }
            updateShiftCardTaskIndicator(card, employeeName);
        }
    });
}

// Update all shift cards for a specific employee
function updateEmployeeShiftCards(employeeName) {
    const shiftCards = document.querySelectorAll('.shift-card');
    shiftCards.forEach(card => {
        const cardEmployeeName = card.dataset.employeeName || card.querySelector('.employee-name')?.textContent.trim();
        if (cardEmployeeName && cardEmployeeName.trim() === employeeName.trim()) {
            updateShiftCardTaskIndicator(card, employeeName);
        }
    });
}

// Add CSS for notifications
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOutRight {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
    
    .notification-content {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }
    
    .notification-close {
        background: none;
        border: none;
        color: white;
        cursor: pointer;
        padding: 0.25rem;
        border-radius: 50%;
        transition: background 0.3s ease;
    }
    
    .notification-close:hover {
        background: rgba(255, 255, 255, 0.2);
    }
`;
document.head.appendChild(notificationStyles);

// ── Supabase task sync ────────────────────────────────────────────────────────
// When the Supabase client is ready:
// 1) Push any tasks in localStorage that never made it to Supabase (fixes orphaned tasks)
// 2) Pull tasks from DB and merge into window.kitchenTasks
window.addEventListener('supabase-ready', async function () {
    if (!window.supabaseClient || !window.ORG_ID) return;
    loadRecentAnnouncements();
    await populateEmployeeSelectFromOrg();
    await populatePositionSelect();

    if (typeof window.kitchenTasks === 'undefined') window.kitchenTasks = [];

    if (typeof loadEmployeePositionsFromSupabase === 'function') {
        await loadEmployeePositionsFromSupabase();
    }

    // 1) Sync localStorage tasks → Supabase (tasks assigned before insert fix)
    const toSync = window.kitchenTasks.filter(t => !t.supabase_id && !t.completed);
    for (const t of toSync) {
        const { data, error } = await window.supabaseClient.from('tasks').insert({
            org_id: window.ORG_ID,
            text: t.description,
            employee_id: (t.assignee && typeof window.getEmployeeIdFromName === 'function') ? window.getEmployeeIdFromName(t.assignee) : null,
            status: 'todo',
            is_urgent: false,
        }).select().single();
        if (!error && data) {
            t.supabase_id = data.id;
        }
    }
    if (toSync.length > 0) {
        localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
    }

    // 2) Pull from DB and merge into kitchenTasks
    const { data: tasks, error } = await window.supabaseClient
        .from('tasks')
        .select('*')
        .eq('org_id', window.ORG_ID)
        .neq('status', 'completed');

    if (error) { console.warn('[Supabase] Task load failed:', error.message); return; }
    if (!tasks?.length) return;

    let added = 0;
    tasks.forEach(task => {
        const local = window.kitchenTasks.find(t =>
            t.description === task.text && t.supabase_id === task.id
        );
        const mappedName = (typeof window.getEmployeeNameFromId === 'function' ? window.getEmployeeNameFromId(task.employee_id) : null) || 'Unassigned';
        if (!local) {
            window.kitchenTasks.push({
                assignee: mappedName,
                description: task.text,
                timestamp: task.created_at,
                completed: task.status === 'completed',
                supabase_id: task.id
            });
            added++;
        } else if (local.assignee !== mappedName) {
            local.assignee = mappedName;
            added++;
        }
    });

    if (added > 0) {
        localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
        if (typeof loadStoredTasks === 'function') loadStoredTasks();
        if (typeof checkEmployeeTasks === 'function') checkEmployeeTasks();
    }
});