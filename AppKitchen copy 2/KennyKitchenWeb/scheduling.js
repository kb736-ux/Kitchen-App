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
    // Sanitize any bad times that leaked from the old overnight +24 bug (e.g. 28:27)
    Object.keys(window.shiftData).forEach(emp => {
        window.shiftData[emp] = (window.shiftData[emp] || []).filter(s => {
            const bad = /^(\d{2}):/.test(s.startTime) && parseInt(s.startTime, 10) >= 24
                     || /^(\d{2}):/.test(s.endTime) && parseInt(s.endTime, 10) >= 24;
            if (bad) console.warn('[shiftData] Removed bad shift for', emp, s);
            return !bad;
        });
    });
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
        const todayStr = getTodayLocalYmd();
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

    if (error) {
        console.warn('[ShiftRequests] load error:', error.message, error.hint || '', error.code || '');
        container.innerHTML = `
            <div style="text-align:center;padding:40px 0;color:#e53e3e;">
                <i class="fas fa-exclamation-triangle" style="font-size:32px;margin-bottom:12px;display:block;"></i>
                Could not load requests: ${error.message || 'unknown error'}
                <br><small style="color:#a0aec0;font-size:11px;">Run rls-fix-org-members-shifts.sql in Supabase SQL Editor</small>
            </div>`;
        return;
    }

    console.log('[ShiftRequests] loaded', (requests || []).length, 'pending requests');

    // Also check ALL statuses to verify data exists at all
    const { data: allReqs, error: allErr } = await window.supabaseClient
        .from('shift_requests')
        .select('id, status, employee_name, request_type, shift_id, created_at')
        .eq('org_id', window.ORG_ID)
        .order('created_at', { ascending: false })
        .limit(10);
    console.log('[ShiftRequests] all statuses:', (allReqs || []).length, 'rows', allErr ? `ERROR: ${allErr.message}` : 'OK');
    if (allReqs?.length) console.log('[ShiftRequests] sample:', JSON.stringify(allReqs[0]));

    if (!requests || requests.length === 0) {
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
    const requestNameMap = await buildProfileDisplayLabelMap();
    if (shiftIds.length > 0) {
        const { data: shifts } = await window.supabaseClient
            .from('shifts')
            .select('id, shift_date, start_time, end_time, position, employee_name')
            .in('id', shiftIds);
        (shifts || []).forEach(s => { shiftsMap[s.id] = s; });
    }

    container.innerHTML = requests.map(req => {
        const shift = shiftsMap[req.shift_id] || {};
        const displayRequester = getEmployeeDisplayLabelFromMap(requestNameMap, req.employee_name) || req.employee_name || 'Unknown';
        const displayTarget = getEmployeeDisplayLabelFromMap(requestNameMap, req.target_employee) || req.target_employee || '';
        const typeLabel = req.request_type === 'time_off' ? '🕐 Time Off' : '🔄 Transfer';
        const typeColor = req.request_type === 'time_off' ? '#c05621' : '#2b6cb0';
        const typeBg   = req.request_type === 'time_off' ? '#fff5eb' : '#ebf8ff';

        const shiftDate = shift.shift_date
            ? new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : (req.note || 'See note');
        const shiftTime = shift.start_time
            ? `${formatTimeLabel(shift.start_time)} – ${formatTimeLabel(shift.end_time)}`
            : '';

        const ago = (() => {
            const diff = Math.floor((Date.now() - new Date(req.created_at)) / 1000);
            if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
            if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
            return `${Math.floor(diff/86400)}d ago`;
        })();

        const safeShiftId = req.shift_id || '';

        return `
            <div class="shift-request-card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px;max-width:100%;">
                    <div style="min-width:0;">
                        <span style="font-weight:700;font-size:15px;color:#2d3748;">${escapeHtml(displayRequester)}</span>
                        <span style="background:${typeBg};color:${typeColor};font-size:12px;font-weight:600;
                               padding:2px 8px;border-radius:20px;margin-left:8px;">${typeLabel}</span>
                    </div>
                    <span style="font-size:12px;color:#a0aec0;flex-shrink:0;">${ago}</span>
                </div>
                <div class="shift-request-shift-block" style="background:#f7fafc;border-radius:8px;padding:10px;margin-bottom:10px;font-size:13px;color:#4a5568;">
                    <i class="fas fa-calendar-day" style="color:#4CAF50;margin-right:6px;"></i>
                    <strong>${shiftDate}</strong>${shiftTime ? ' · ' + shiftTime : ''}
                    ${shift.position ? `<span style="margin-left:8px;background:#e8f5e9;color:#276749;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:600;">${escapeHtml(shift.position)}</span>` : ''}
                </div>
                ${req.note ? `<p style="font-size:13px;color:#718096;margin:0 0 10px;font-style:italic;max-width:100%;overflow-wrap:anywhere;">"${escapeHtml(req.note)}"</p>` : ''}
                ${req.target_employee ? `<p style="font-size:12px;color:#4a6fa5;margin:0 0 10px;max-width:100%;overflow-wrap:anywhere;">Transfer to: <strong>${escapeHtml(displayTarget)}</strong></p>` : ''}
                <div class="shift-request-actions">
                    <button type="button" onclick="approveShiftRequest('${req.id}','${safeShiftId}','${escapeHtml(req.employee_name)}','${escapeHtml(shift.position || '')}','${req.request_type}','${req.target_employee || ''}')"
                        style="background:#4CAF50;color:white;border:none;border-radius:8px;padding:9px;
                               font-weight:700;font-size:13px;cursor:pointer;">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button type="button" onclick="denyShiftRequest('${req.id}','${escapeHtml(req.employee_name)}')"
                        style="background:#fff0f0;color:#e53e3e;border:1.5px solid #fed7d7;border-radius:8px;
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

/** YYYY-MM-DD for a shift card entry (uses that week's Monday in shiftData). */
function getShiftEntryDateStr(s) {
    if (!s || !s.day || !s.weekStart) return null;
    const dayIndex = DAY_NAMES.indexOf(String(s.day).toLowerCase());
    if (dayIndex < 0) return null;
    const d = new Date(String(s.weekStart).slice(0, 10) + 'T12:00:00');
    d.setDate(d.getDate() + dayIndex);
    return formatLocalYmd(d);
}

function removeEmployeeShiftsInDateRangeLocal(employeeName, startDateStr, endDateStr) {
    if (!window.shiftData || !employeeName || !startDateStr || !endDateStr) return;
    const list = window.shiftData[employeeName];
    if (!list || !list.length) return;
    window.shiftData[employeeName] = list.filter((x) => {
        const dstr = getShiftEntryDateStr(x);
        if (!dstr) return true;
        return !(dstr >= startDateStr && dstr <= endDateStr);
    });
    persistShiftData();
}

/** True if this employee has an approved calendar time-off that covers dateStr. */
async function employeeHasApprovedTimeOffOnDate(employeeDisplayName, dateStr) {
    if (!window.supabaseClient || !window.ORG_ID || !dateStr) return false;
    const mine = normEmployeeKey(employeeDisplayName);
    const { data, error } = await window.supabaseClient
        .from('shift_requests')
        .select('employee_name, time_off_start_date, time_off_end_date')
        .eq('org_id', window.ORG_ID)
        .eq('status', 'approved')
        .eq('request_type', 'time_off');
    if (error || !data?.length) return false;
    for (const r of data) {
        if (normEmployeeKey(r.employee_name || '') !== mine) continue;
        const s = r.time_off_start_date;
        const e = r.time_off_end_date || r.time_off_start_date;
        if (!s || !e) continue;
        if (dateStr >= s && dateStr <= e) return true;
    }
    return false;
}

async function fetchSupabaseShiftsSameEmployeeSameDay(employeeDisplayName, dateStr) {
    if (!window.supabaseClient || !window.ORG_ID || !dateStr) return [];
    const { data, error } = await window.supabaseClient
        .from('shifts')
        .select('id, start_time, end_time, employee_name')
        .eq('org_id', window.ORG_ID)
        .eq('shift_date', dateStr);
    if (error || !data) return [];
    const mine = normEmployeeKey(employeeDisplayName);
    // Normalize HH:MM:SS → HH:MM and filter to this employee
    return data
        .filter((row) => normEmployeeKey(row.employee_name || '') === mine)
        .map((row) => ({
            ...row,
            start_time: String(row.start_time || '').slice(0, 5),
            end_time: String(row.end_time || '').slice(0, 5),
        }));
}

/** Overlap vs other saved shifts for same person on same day (Supabase). */
async function employeeHasSupabaseShiftOverlap(employeeDisplayName, dateStr, startTime, endTime, excludeShiftId = null) {
    const rows = await fetchSupabaseShiftsSameEmployeeSameDay(employeeDisplayName, dateStr);
    for (const row of rows) {
        if (excludeShiftId && String(row.id) === String(excludeShiftId)) continue;
        if (shiftTimeRangesOverlap(startTime, endTime, row.start_time, row.end_time)) {
            return { overlap: true, other: row };
        }
    }
    return { overlap: false };
}

/** One fetch for assign-shift recurrence (was N×260 round-trips and froze the UI). */
async function fetchApprovedTimeOffRequestsForOrg() {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const { data, error } = await window.supabaseClient
        .from('shift_requests')
        .select('employee_name, time_off_start_date, time_off_end_date')
        .eq('org_id', window.ORG_ID)
        .eq('status', 'approved')
        .eq('request_type', 'time_off');
    if (error || !data?.length) return [];
    return data;
}

function employeeCoveredByTimeOffRows(rows, employeeDisplayName, dateStr) {
    const mine = normEmployeeKey(employeeDisplayName);
    for (const r of rows || []) {
        if (normEmployeeKey(r.employee_name || '') !== mine) continue;
        const s = r.time_off_start_date;
        const e = r.time_off_end_date || r.time_off_start_date;
        if (!s || !e) continue;
        if (dateStr >= s && dateStr <= e) return true;
    }
    return false;
}

/** Shifts for one employee between two dates (inclusive), times normalized to HH:MM. */
async function fetchEmployeeShiftsInDateRange(employeeDisplayName, startYmd, endYmd) {
    if (!window.supabaseClient || !window.ORG_ID || !startYmd || !endYmd) return [];
    const { data, error } = await window.supabaseClient
        .from('shifts')
        .select('id, shift_date, start_time, end_time, employee_name')
        .eq('org_id', window.ORG_ID)
        .gte('shift_date', startYmd)
        .lte('shift_date', endYmd);
    if (error || !data) return [];
    const mine = normEmployeeKey(employeeDisplayName);
    return data
        .filter((row) => normEmployeeKey(row.employee_name || '') === mine)
        .map((row) => ({
            ...row,
            start_time: String(row.start_time || '').slice(0, 5),
            end_time: String(row.end_time || '').slice(0, 5),
        }));
}

async function approveShiftRequest(requestId, shiftId, employeeName, position, requestType, targetEmployee) {
    if (!window.supabaseClient || !window.ORG_ID) return;

    const { data: reqRow, error: fetchErr } = await window.supabaseClient
        .from('shift_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();
    if (fetchErr || !reqRow) {
        showNotification('Could not load this request: ' + (fetchErr?.message || 'not found'), 'error');
        return;
    }

    if (requestType === 'transfer' && targetEmployee) {
        // ── TRANSFER: reassign shift to the target employee ─────────────
        let previousEmployeeName = '';
        let shiftDate = '';
        if (shiftId) {
            const { data: beforeShift } = await window.supabaseClient
                .from('shifts')
                .select('employee_name, shift_date')
                .eq('id', shiftId)
                .maybeSingle();
            previousEmployeeName = (beforeShift?.employee_name || '').trim();
            shiftDate = (beforeShift?.shift_date || '').trim();
        }

        const targetId = typeof window.getEmployeeIdFromName === 'function'
            ? window.getEmployeeIdFromName(targetEmployee) : null;

        const { error: shiftErr } = await window.supabaseClient
            .from('shifts')
            .update({ employee_name: targetEmployee, employee_id: targetId })
            .eq('id', shiftId);

        if (shiftErr) {
            showNotification('Could not transfer shift: ' + shiftErr.message, 'error');
            return;
        }

        if (typeof window.transferTasksForShift === 'function') {
            const tr = await window.transferTasksForShift(shiftId, targetEmployee, targetId, {
                previousEmployeeName,
                shiftDate,
            });
            if (!tr.ok && tr.error && !/shift_id|column|does not exist|42703/i.test(tr.error)) {
                showNotification(`Shift transferred, but tasks could not be reassigned: ${tr.error}`, 'error');
            }
        }

        await window.supabaseClient
            .from('shift_requests')
            .update({ status: 'approved' })
            .eq('id', requestId);

        // Notify original employee
        await window.supabaseClient.from('notifications').insert({
            org_id: window.ORG_ID,
            employee_name: employeeName,
            type: 'request_approved',
            title: 'Transfer Approved',
            body: `Your shift has been transferred to ${targetEmployee}.`,
            read: false,
        });

        // Notify the new assignee
        await window.supabaseClient.from('notifications').insert({
            org_id: window.ORG_ID,
            employee_name: targetEmployee,
            type: 'shift_assigned',
            title: 'Shift Transferred to You',
            body: `A ${position || ''} shift has been transferred to you from ${employeeName}. Check your schedule!`.trim(),
            read: false,
        });
        sendPushToEmployee(targetEmployee, 'Shift Transferred to You',
            `A ${position || ''} shift from ${employeeName} is now yours!`.trim());

        showNotification(`Transfer approved — shift reassigned to ${targetEmployee}.`, 'success');

        // Update local shiftData for the web grid
        if (window.shiftData) {
            const empShifts = window.shiftData[employeeName] || [];
            const idx = empShifts.findIndex(s => s.shiftId === shiftId);
            if (idx >= 0) {
                const moved = empShifts.splice(idx, 1)[0];
                if (!window.shiftData[targetEmployee]) window.shiftData[targetEmployee] = [];
                window.shiftData[targetEmployee].push(moved);
                persistShiftData();
            }
        }

        await loadShiftRequests();
        if (typeof renderSchedule === 'function') renderSchedule();
        return;
    }

    // ── TIME OFF: remove shift(s) and record approved date range (blocks future scheduling) ──
    let ds = reqRow.time_off_start_date;
    let de = reqRow.time_off_end_date || reqRow.time_off_start_date;
    if (!ds || !de) {
        if (shiftId) {
            const { data: sh } = await window.supabaseClient
                .from('shifts')
                .select('shift_date')
                .eq('id', shiftId)
                .maybeSingle();
            if (sh?.shift_date) {
                ds = sh.shift_date;
                de = sh.shift_date;
            }
        }
    }

    const positionsToAnnounce = new Set();
    if (position) positionsToAnnounce.add(position);

    if (ds && de) {
        const { data: rangeShifts, error: rangeErr } = await window.supabaseClient
            .from('shifts')
            .select('id, employee_name, position')
            .eq('org_id', window.ORG_ID)
            .gte('shift_date', ds)
            .lte('shift_date', de);
        if (rangeErr) {
            showNotification('Could not load shifts for time off: ' + rangeErr.message, 'error');
            return;
        }
        const mine = normEmployeeKey(employeeName);
        const matched = (rangeShifts || []).filter((s) => normEmployeeKey(s.employee_name || '') === mine);

        for (const srow of matched) {
            const { error: delErr } = await window.supabaseClient
                .from('shifts')
                .delete()
                .eq('id', srow.id);
            if (delErr) {
                showNotification('Could not remove shift: ' + delErr.message, 'error');
                return;
            }
            if (srow.position) positionsToAnnounce.add(srow.position);
        }
        removeEmployeeShiftsInDateRangeLocal(employeeName, ds, de);
    } else if (shiftId) {
        const { data: oneShift } = await window.supabaseClient
            .from('shifts')
            .select('position')
            .eq('id', shiftId)
            .maybeSingle();
        if (oneShift?.position) positionsToAnnounce.add(oneShift.position);

        const { error: shiftErr } = await window.supabaseClient
            .from('shifts')
            .delete()
            .eq('id', shiftId);

        if (shiftErr) {
            showNotification('Could not remove shift: ' + shiftErr.message, 'error');
            return;
        }

        if (window.shiftData && window.shiftData[employeeName]) {
            window.shiftData[employeeName] = window.shiftData[employeeName].filter((s) => s.shiftId !== shiftId);
            persistShiftData();
        }
    }

    await window.supabaseClient
        .from('shift_requests')
        .update({
            status: 'approved',
            time_off_start_date: ds || reqRow.time_off_start_date,
            time_off_end_date: (de || ds) || reqRow.time_off_end_date,
        })
        .eq('id', requestId);

    await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        type: 'request_approved',
        title: 'Time Off Approved',
        body: ds && de
            ? `Your time off from ${ds} through ${de} has been approved.`
            : 'Your time off request has been approved. The shift has been removed from your schedule.',
        read: false,
    });

    let notifiedOpenShift = 0;
    for (const pos of positionsToAnnounce) {
        const { data: capable } = await window.supabaseClient
            .from('shifts')
            .select('employee_name')
            .eq('org_id', window.ORG_ID)
            .eq('position', pos)
            .neq('employee_name', employeeName)
            .not('employee_name', 'is', null);

        const uniqueEmployees = [...new Set((capable || []).map((s) => s.employee_name).filter(Boolean))];
        for (const name of uniqueEmployees) {
            await window.supabaseClient.from('notifications').insert({
                org_id: window.ORG_ID,
                employee_name: name,
                type: 'open_shift',
                title: 'Open Shift Available',
                body: `A ${pos} shift is now open. Check Open Shifts to pick it up!`,
                read: false,
            });
            sendPushToEmployee(name, 'Open Shift Available', `A ${pos} shift is now open. Check the app!`);
            notifiedOpenShift += 1;
        }
    }

    if (positionsToAnnounce.size > 0) {
        showNotification(`Time off approved — shifts removed. Open-shift notices sent (${notifiedOpenShift} notification(s)).`, 'success');
    } else {
        showNotification('Time off approved — no shifts were on the schedule for that period.', 'success');
    }

    await loadShiftRequests();
    if (typeof renderSchedule === 'function') renderSchedule();
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

// Poll badge count on load — MUST use window (supabase-config dispatches on window, not document)
window.addEventListener('supabase-ready', async () => {
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

    // Sync current week's Supabase shifts → grid so ghost/orphan shifts are visible
    await syncSupabaseShiftsToGrid();
});

/** Normalize DB/UI times to HH:MM for comparison (handles 03:19:00 vs 03:19). */
function normShiftTimeHM(t) {
    if (t == null || t === '') return '';
    const s = String(t).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return s;
    return `${String(parseInt(m[1], 10)).padStart(2, '0')}:${m[2]}`;
}

/** All shiftData rows for the same person (matches "Rohan" with "Rohan Kumar" buckets). */
function collectShiftDataRowsForSamePerson(displayName) {
    const mine = normEmployeeKey(displayName);
    const out = [];
    Object.entries(window.shiftData || {}).forEach(([key, list]) => {
        if (normEmployeeKey(key) !== mine) return;
        (list || []).forEach((s) => out.push({ ...s, _bucketKey: key }));
    });
    return out;
}

function findShiftIndexInBucket(bucket, day, weekStart, start24, end24, shiftId) {
    const rs = normShiftTimeHM;
    if (shiftId) {
        const i = bucket.findIndex((s) => s.shiftId && String(s.shiftId) === String(shiftId));
        if (i !== -1) return i;
    }
    return bucket.findIndex(
        (s) =>
            s.day === day &&
            s.weekStart === weekStart &&
            rs(s.startTime) === rs(start24) &&
            rs(s.endTime) === rs(end24)
    );
}

/**
 * Load all shifts for the displayed week from Supabase and add any that are
 * missing from the visual grid.  This exposes "ghost" duplicates that exist in
 * the DB but were never rendered (e.g. from a past session or a bug).
 */
async function syncSupabaseShiftsToGrid() {
    if (!window.supabaseClient || !window.ORG_ID) return;

    const hasGrid = document.querySelector('.day-column[data-day]');
    if (!hasGrid) {
        syncSupabaseShiftsToGrid._retries = (syncSupabaseShiftsToGrid._retries || 0) + 1;
        if (syncSupabaseShiftsToGrid._retries <= 24) {
            setTimeout(() => void syncSupabaseShiftsToGrid(), 250);
        }
        return;
    }
    syncSupabaseShiftsToGrid._retries = 0;

    const weekStart = getWeekStart(currentWeekStart);
    const mondayDate = new Date(String(weekStart).slice(0, 10) + 'T12:00:00');
    const sundayDate = new Date(mondayDate);
    sundayDate.setDate(mondayDate.getDate() + 6);
    const localYmd = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const startStr = localYmd(mondayDate);
    const endStr = localYmd(sundayDate);

    const { data: rows, error } = await window.supabaseClient
        .from('shifts')
        .select('id, shift_date, start_time, end_time, position, employee_name')
        .eq('org_id', window.ORG_ID)
        .gte('shift_date', startStr)
        .lte('shift_date', endStr)
        .order('shift_date', { ascending: true });

    if (error) {
        console.warn('[Supabase] syncSupabaseShiftsToGrid error:', error.message);
        return;
    }

    const rs = normShiftTimeHM;

    (rows || []).forEach(row => {
        if (!row.employee_name || !row.shift_date || !row.start_time || !row.end_time) return;

        const dayKey = getDayKeyForDate(row.shift_date);
        if (!dayKey) return;

        const empName = row.employee_name;
        const rS = rs(row.start_time);
        const rE = rs(row.end_time);

        // Skip if already rendered in the DOM
        if (document.querySelector(`.shift-card[data-shift-id="${row.id}"]`)) return;

        // Skip if already in shiftData for this week (prevents duplicates on initial load)
        const alreadyLocal = Object.entries(window.shiftData || {}).some(([key, list]) =>
            normEmployeeKey(key) === normEmployeeKey(empName) &&
            (list || []).some(s =>
                s.day === dayKey &&
                s.weekStart === weekStart &&
                rs(s.startTime) === rS &&
                rs(s.endTime) === rE
            )
        );
        if (alreadyLocal) return;

        // Normalize end time: Supabase stores HH:MM:SS so cap at "23:59" for display
        const rawEnd = String(row.end_time || '').slice(0, 5);
        const rawStart = String(row.start_time || '').slice(0, 5);
        const timeDisplay = formatTo12h(rawStart) + ' - ' + formatTo12h(rawEnd);
        const posSlug = String(row.position || 'line-cook').toLowerCase().replace(/\s+/g, '-');
        const posLabel = row.position || 'Line Cook';
        const hours = calculateShiftHours(rawStart, rawEnd);

        const card = createShiftCard(empName, posSlug, timeDisplay, dayKey, hours, posLabel);
        if (!card) return;

        card.dataset.shiftId = row.id;

        if (!window.shiftData[empName]) window.shiftData[empName] = [];
        window.shiftData[empName].push({
            day: dayKey,
            shiftDate: row.shift_date,
            startTime: rawStart,
            endTime: rawEnd,
            hours,
            weekStart,
            position: posLabel,
            shiftId: row.id,
        });
    });

    persistShiftData();
    console.log(`[Supabase] Grid synced for week ${startStr}–${endStr} (${(rows || []).length} shifts).`);
}

// DevTools: window.syncSupabaseShiftsFromDatabase()
window.syncSupabaseShiftsFromDatabase = syncSupabaseShiftsToGrid;

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
    const { error } = await window.supabaseClient.from('notifications').insert({
        org_id: window.ORG_ID,
        employee_name: employeeName,
        employee_id: typeof window.getEmployeeIdFromName === 'function' ? window.getEmployeeIdFromName(employeeName) : null,
        type: 'shift_assigned',
        title: 'New Shift Assigned',
        body: 'Hey, you were assigned new shifts!',
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

        await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Accept-Encoding': 'gzip, deflate',
            },
            body: JSON.stringify({
                to: data.token,
                title: 'Hey, you were assigned new shifts!',
                body: 'Check your schedule to see your new shifts.',
                sound: 'default',
                data: { type: 'shift_assigned', screen: 'Schedule' },
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
    // supabase-ready may have fired before this listener was registered; merge DB shifts after grid exists
    queueMicrotask(() => {
        if (window.supabaseClient && window.ORG_ID) void syncSupabaseShiftsToGrid();
    });
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
        prevWeekBtn.addEventListener('click', async () => {
            currentWeekStart.setDate(currentWeekStart.getDate() - 7);
            updateWeekDisplay();
            clearShiftCardsFromGrid();
            initializeEmployeeHours();
            await syncSupabaseShiftsToGrid();
        });
    }
    
    if (nextWeekBtn) {
        nextWeekBtn.addEventListener('click', async () => {
            currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            updateWeekDisplay();
            clearShiftCardsFromGrid();
            initializeEmployeeHours();
            await syncSupabaseShiftsToGrid();
        });
    }
    
    updateWeekDisplay();
}

const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Remove all shift cards from the grid so the new week starts empty. */
function clearShiftCardsFromGrid() {
    document.querySelectorAll('.shift-card').forEach(card => card.remove());
    document.querySelectorAll('.day-column').forEach(col => {
        if (!col.querySelector('.shift-card') && !col.querySelector('.empty-day')) {
            const addBtn = col.querySelector('.add-shift-btn');
            if (addBtn && !col.querySelector('.empty-day')) {
                const empty = document.createElement('div');
                empty.className = 'empty-day';
                col.insertBefore(empty, addBtn.nextSibling);
            }
        }
    });
}

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
    const todayStr = getTodayLocalYmd();
    
    // Update day headers with dates and mark current/past
    DAY_NAMES.forEach((dayKey, index) => {
        const header = document.querySelector(`.day-header[data-day="${dayKey}"]`);
        if (header) {
            const d = new Date(currentWeekStart);
            d.setDate(d.getDate() + index);
            const dateNum = d.getDate();
            const dateStr = formatLocalYmd(d);
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
            const dateStr = formatLocalYmd(d);
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

    // Save & Assign — stable handler (reads context when clicked)
    document.getElementById('shift-details-save-btn')?.addEventListener('click', async function handleShiftDetailsSave() {
        const ctx = _shiftModalContext;
        if (!ctx) return;
        if (document.getElementById('shift-details-modal')?.dataset?.pastView === '1') return;
        const { shiftCard: cardRef, displayName, day, start24, end24, posSelect, taskList } = ctx;
        const newPos = posSelect?.value;
        const newStart = document.getElementById('shift-details-start')?.value;
        const newEnd = document.getElementById('shift-details-end')?.value;
        if (!newStart || !newEnd) {
            showNotification('Please fill in both start and end times.', 'error');
            return;
        }

        const weekStart = getWeekStart(currentWeekStart);
        const empShifts = window.shiftData[displayName] || [];
        const supabaseId = cardRef?.dataset?.shiftId;
        const rs = normShiftTimeHM;

        // Exclude THIS card only by shift id + normalized times (02:06 vs 02:06:00 must match).
        const samePersonDayShifts = collectShiftDataRowsForSamePerson(displayName).filter(
            (s) => s.day === day && s.weekStart === weekStart
        );
        const othersLocal = samePersonDayShifts.filter((s) => {
            if (supabaseId && s.shiftId && String(s.shiftId) === String(supabaseId)) return false;
            if (rs(s.startTime) === rs(start24) && rs(s.endTime) === rs(end24)) return false;
            return true;
        });
        for (const s of othersLocal) {
            if (shiftTimeRangesOverlap(newStart, newEnd, s.startTime, s.endTime)) {
                showNotification(`${displayName} already has another shift this day that overlaps those times. Edit or delete the other shift first.`, 'error');
                return;
            }
        }

        const shiftDateStr = getDateForDay(day);
        if (window.supabaseClient && window.ORG_ID && shiftDateStr) {
            if (await employeeHasApprovedTimeOffOnDate(displayName, shiftDateStr)) {
                showNotification(
                    `${displayName} has approved time off that includes this day. Cannot save this shift during that period.`,
                    'error'
                );
                return;
            }
            const supOv = await employeeHasSupabaseShiftOverlap(displayName, shiftDateStr, newStart, newEnd, supabaseId);
            if (supOv.overlap) {
                const o = supOv.other || {};
                showNotification(
                    `This overlaps another shift for this person that day (${o.start_time}–${o.end_time}). Delete the duplicate or change the times.`,
                    'error'
                );
                return;
            }
        }

        const newPosLabel = posSelect?.selectedOptions?.[0]?.textContent?.trim()
            || String(newPos || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const newTimeStr = `${formatTo12h(newStart)} - ${formatTo12h(newEnd)}`;
        const newHours = calculateShiftHours(newStart, newEnd);
        const posEl = cardRef?.querySelector('.shift-position');
        const timeEl = cardRef?.querySelector('.shift-time');
        if (posEl) posEl.textContent = newPosLabel;
        if (timeEl) timeEl.textContent = newTimeStr;
        const oldPosClasses = cardRef ? Array.from(cardRef.classList).filter(c => c !== 'shift-card') : [];
        if (oldPosClasses.length && cardRef) cardRef.classList.remove(...oldPosClasses);
        if (cardRef) cardRef.classList.add(newPos || 'line-cook');
        const idx = findShiftIndexInBucket(empShifts, day, weekStart, start24, end24, supabaseId);
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
        if (supabaseId && window.supabaseClient) {
            const { error: updErr } = await window.supabaseClient.from('shifts')
                .update({ start_time: newStart, end_time: newEnd, position: newPosLabel })
                .eq('id', supabaseId);
            if (updErr) {
                showNotification('Could not update shift in database: ' + updErr.message, 'error');
                return;
            }
        }
        const taskInputs = taskList?.querySelectorAll('.task-input') || [];
        const descriptions = Array.from(taskInputs).map(i => i.value.trim()).filter(Boolean);
        let taskSyncFailed = 0;
        let taskSyncError = '';
        for (const desc of descriptions) {
            const r = await addTaskToProgress(displayName, desc, { shiftId: supabaseId || null });
            if (r && r.ok === false) {
                taskSyncFailed += 1;
                taskSyncError = r.error || 'Unknown error';
            }
        }
        if (descriptions.length) updateEmployeeShiftCards(displayName);
        _shiftModalContext = null;
        closeModal('shift-details-modal');
        if (taskSyncFailed > 0) {
            showNotification(`Shift saved, but ${taskSyncFailed} task(s) failed to save: ${taskSyncError}. In Supabase SQL Editor run the tasks RLS section in rls-fix-org-members-shifts.sql`, 'error');
        } else {
            showNotification(`Shift updated${descriptions.length ? ` and ${descriptions.length} task(s) assigned` : ''} for ${displayName}.`, 'success');
        }
    });

    wireAssignShiftRepeatControls();
    updateAssignShiftRepeatUI();
}

// Enable/disable Assign button and show message when selected day is in the past
function updateAssignShiftConfirmState() {
    const daySelect = document.getElementById('day-select');
    const confirmBtn = document.getElementById('assign-shift-confirm-btn');
    const pastDayMsg = document.getElementById('assign-shift-past-day-msg');
    if (!daySelect || !confirmBtn) return;
    const day = daySelect.value;
    const selectedDate = getDateForDay(day);
    const todayStr = getTodayLocalYmd();
    const isPast = selectedDate && selectedDate < todayStr;
    confirmBtn.disabled = !!isPast;
    if (pastDayMsg) pastDayMsg.style.display = isPast ? 'block' : 'none';
}

const DEFAULT_EMPLOYEES = [];
const EMPLOYEE_VALUE_MAP = {};

function normEmployeeKey(s) {
    return String(s || '').trim().toLowerCase();
}

/** Prefer "First Last", then display_name, then employee_name — for schedule dropdown labels */
function profileScheduleDisplayLabel(p) {
    if (!p) return '';
    const fn = (p.first_name || '').trim();
    const ln = (p.last_name || '').trim();
    const both = [fn, ln].filter(Boolean).join(' ');
    if (both) return both;
    const dn = (p.display_name || '').trim();
    if (dn) return dn;
    return (p.employee_name || '').trim() || '';
}

/** Map profile aliases to a human-friendly display label. */
async function buildProfileDisplayLabelMap() {
    const labelByKey = new Map();
    if (!window.supabaseClient || !window.ORG_ID) return labelByKey;

    const { data: profiles } = await window.supabaseClient
        .from('profiles')
        .select('employee_name, display_name, first_name, last_name')
        .eq('org_id', window.ORG_ID);

    (profiles || []).forEach((p) => {
        const label = profileScheduleDisplayLabel(p);
        if (!label) return;
        const emp = normEmployeeKey(p.employee_name);
        const display = normEmployeeKey(p.display_name);
        const first = normEmployeeKey((p.first_name || '').trim());
        if (emp) labelByKey.set(emp, label);
        if (display) labelByKey.set(display, label);
        if (first && !labelByKey.has(first)) labelByKey.set(first, label);
    });

    return labelByKey;
}

function getEmployeeDisplayLabelFromMap(labelMap, rawName) {
    const raw = String(rawName || '').trim();
    if (!raw) return '';
    const key = normEmployeeKey(raw);
    if (labelMap && labelMap.has(key)) return labelMap.get(key);
    return raw;
}

/**
 * Map normalized employee_positions.employee_name -> full display label from profiles.
 */
async function buildEmployeePositionDisplayLabelMap() {
    const labelByKey = new Map();
    if (!window.supabaseClient || !window.ORG_ID) return labelByKey;

    const [{ data: profiles }, { data: positions }] = await Promise.all([
        window.supabaseClient
            .from('profiles')
            .select('employee_name, display_name, first_name, last_name')
            .eq('org_id', window.ORG_ID),
        window.supabaseClient
            .from('employee_positions')
            .select('employee_name')
            .eq('org_id', window.ORG_ID),
    ]);

    const positionNames = [...new Set((positions || []).map((r) => r.employee_name).filter(Boolean))];
    const profList = profiles || [];

    const byEmp = new Map();
    const byDisplay = new Map();
    profList.forEach((p) => {
        const label = profileScheduleDisplayLabel(p);
        if (!label) return;
        const ek = normEmployeeKey(p.employee_name);
        if (ek) byEmp.set(ek, label);
        const dk = normEmployeeKey(p.display_name);
        if (dk) byDisplay.set(dk, label);
    });

    positionNames.forEach((posName) => {
        const k = normEmployeeKey(posName);
        let label = byEmp.get(k) || byDisplay.get(k);
        if (!label) {
            const hit = profList.find((p) => {
                const dn = (p.display_name || '').trim();
                if (!dn) return false;
                const first = dn.split(/\s+/)[0];
                return normEmployeeKey(first) === k;
            });
            if (hit) label = profileScheduleDisplayLabel(hit);
        }
        if (label) labelByKey.set(k, label);
    });

    return labelByKey;
}

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
    }
    if (names.length === 0) names = DEFAULT_EMPLOYEES;

    const labelMap = await buildEmployeePositionDisplayLabelMap();

    employeeSelect.innerHTML = '<option value="">Select Employee</option>' + names.map(n => {
        const val = EMPLOYEE_VALUE_MAP[n] || n.toLowerCase().replace(/\s+/g, '-');
        const nk = normEmployeeKey(n);
        const displayText = labelMap.get(nk) || n;
        return `<option value="${val}">${escapeHtml(displayText)}</option>`;
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
        if (modalId === 'shift-details-modal') {
            _shiftModalContext = null;
            modal.dataset.pastView = '';
        }
        
        // Reset form
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
        } else {
            // Reset individual form controls
            modal.querySelectorAll('input, select').forEach(control => {
                if (control.id === 'day-select') return;
                if (control.type === 'checkbox') {
                    control.checked = false;
                } else {
                    control.value = '';
                }
            });
        }

        if (modalId === 'shift-details-modal') {
            applyShiftDetailsPastViewUI(false);
        }

        if (modalId === 'assign-shift-modal') {
            resetAssignShiftRepeatForm();
        }
        
        // Show day selector again
        const daySelectGroup = document.getElementById('day-select-group');
        if (daySelectGroup) {
            daySelectGroup.style.display = 'block';
        }
    }
}

/** Max occurrences when "Forever" is selected (avoids inserting unbounded rows). */
const RECUR_FOREVER_WEEKLY_COUNT = 260;
const RECUR_FOREVER_MONTHLY_COUNT = 60;

function addCalendarDaysYmd(ymd, deltaDays) {
    const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00');
    d.setDate(d.getDate() + deltaDays);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function addCalendarMonthsYmd(ymd, deltaMonths) {
    const d = new Date(String(ymd).slice(0, 10) + 'T12:00:00');
    d.setMonth(d.getMonth() + deltaMonths);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * @param {string} baseYmd - First shift date YYYY-MM-DD
 * @param {{ enabled: boolean, interval: 'weekly'|'monthly', endMode: 'count'|'forever', count: string }} repeat
 */
function buildRecurringShiftDates(baseYmd, repeat) {
    if (!repeat || !repeat.enabled) return [baseYmd];
    const weekly = repeat.interval !== 'monthly';
    const forever = repeat.endMode === 'forever';
    let total;
    if (forever) {
        total = weekly ? RECUR_FOREVER_WEEKLY_COUNT : RECUR_FOREVER_MONTHLY_COUNT;
    } else {
        const raw = parseInt(String(repeat.count || '2'), 10) || 2;
        const cap = weekly ? 104 : 36;
        total = Math.min(Math.max(2, raw), cap);
    }
    const out = [];
    for (let i = 0; i < total; i++) {
        if (weekly) out.push(addCalendarDaysYmd(baseYmd, 7 * i));
        else out.push(addCalendarMonthsYmd(baseYmd, i));
    }
    return out;
}

function getAssignShiftRepeatOptionsFromDom() {
    const en = document.getElementById('assign-shift-repeat-enabled');
    const intervalEl = document.getElementById('assign-shift-repeat-interval');
    const endModeEl = document.getElementById('assign-shift-repeat-end-mode');
    const countEl = document.getElementById('assign-shift-repeat-count');
    return {
        enabled: !!(en && en.checked),
        interval: intervalEl && intervalEl.value === 'monthly' ? 'monthly' : 'weekly',
        endMode: endModeEl && endModeEl.value === 'forever' ? 'forever' : 'count',
        count: countEl ? countEl.value : '4',
    };
}

function updateAssignShiftRepeatUI() {
    const en = document.getElementById('assign-shift-repeat-enabled');
    const opts = document.getElementById('assign-shift-repeat-options');
    const wrap = document.getElementById('assign-shift-repeat-count-wrap');
    const endMode = document.getElementById('assign-shift-repeat-end-mode');
    const interval = document.getElementById('assign-shift-repeat-interval');
    const count = document.getElementById('assign-shift-repeat-count');
    const hint = document.getElementById('assign-shift-repeat-hint');
    if (!en || !opts) return;
    const on = en.checked;
    opts.hidden = !on;
    if (!on) return;
    const forever = endMode && endMode.value === 'forever';
    if (wrap) wrap.style.display = forever ? 'none' : 'block';
    if (count && interval) {
        const monthly = interval.value === 'monthly';
        count.max = monthly ? 36 : 104;
        const n = parseInt(count.value, 10);
        if (!Number.isNaN(n) && n > parseInt(count.max, 10)) count.value = String(count.max);
    }
    if (hint) {
        if (forever) {
            hint.textContent = interval && interval.value === 'monthly'
                ? `Creates ${RECUR_FOREVER_MONTHLY_COUNT} monthly rows (~5 years). Delete extras anytime.`
                : `Creates ${RECUR_FOREVER_WEEKLY_COUNT} weekly rows (~5 years). Delete extras anytime.`;
        } else {
            hint.textContent = interval && interval.value === 'monthly'
                ? 'Includes this first shift. Up to 36 occurrences.'
                : 'Includes this first shift. Up to 104 occurrences.';
        }
    }
}

function resetAssignShiftRepeatForm() {
    const en = document.getElementById('assign-shift-repeat-enabled');
    if (en) en.checked = false;
    const intervalEl = document.getElementById('assign-shift-repeat-interval');
    if (intervalEl) intervalEl.value = 'weekly';
    const endModeEl = document.getElementById('assign-shift-repeat-end-mode');
    if (endModeEl) endModeEl.value = 'count';
    const countEl = document.getElementById('assign-shift-repeat-count');
    if (countEl) {
        countEl.value = '4';
        countEl.max = 104;
    }
    updateAssignShiftRepeatUI();
}

function wireAssignShiftRepeatControls() {
    const en = document.getElementById('assign-shift-repeat-enabled');
    const interval = document.getElementById('assign-shift-repeat-interval');
    const endMode = document.getElementById('assign-shift-repeat-end-mode');
    const count = document.getElementById('assign-shift-repeat-count');
    if (!en) return;
    const refresh = () => updateAssignShiftRepeatUI();
    en.addEventListener('change', refresh);
    if (interval) interval.addEventListener('change', refresh);
    if (endMode) endMode.addEventListener('change', refresh);
    if (count) count.addEventListener('change', refresh);
}

// Shift Assignment
async function assignShift() {
    const confirmBtn = document.getElementById('assign-shift-confirm-btn');
    const prevBtnText = confirmBtn ? confirmBtn.textContent : '';
    const setWorking = (on) => {
        if (!confirmBtn) return;
        confirmBtn.disabled = !!on;
        confirmBtn.textContent = on ? 'Working…' : prevBtnText;
    };

    try {
        setWorking(true);

        const employeeSelect = document.getElementById('employee-select');
        const positionSelect = document.getElementById('position-select');
        const startTimeInput = document.getElementById('start-time');
        const endTimeInput = document.getElementById('end-time');
        const daySelect = document.getElementById('day-select');

        const employee = employeeSelect?.value;
        const position = positionSelect?.value;
        const startTime = startTimeInput?.value;
        const endTime = endTimeInput?.value;
        const day = daySelect?.value;

        if (!employee || !position || !startTime || !endTime || !day) {
            showNotification('Please fill in all fields', 'error');
            return;
        }

        const selectedDate = getDateForDay(day);
        if (!selectedDate) {
            showNotification('Could not resolve the selected day.', 'error');
            return;
        }

        const employeeName = getEmployeeDisplayName(employee);
        const repeat = getAssignShiftRepeatOptionsFromDom();
        const shiftDatesYmd = buildRecurringShiftDates(selectedDate, repeat);
        const todayStr = getTodayLocalYmd();

        let timeOffRows = [];
        /** @type {Record<string, Array<{ id: string, shift_date: string, start_time: string, end_time: string }>>|null} */
        let shiftsByDate = null;
        if (window.supabaseClient && window.ORG_ID && shiftDatesYmd.length > 0) {
            const sorted = [...shiftDatesYmd].sort();
            const rangeStart = sorted[0];
            const rangeEnd = sorted[sorted.length - 1];
            const [toRows, rangeShifts] = await Promise.all([
                fetchApprovedTimeOffRequestsForOrg(),
                fetchEmployeeShiftsInDateRange(employeeName, rangeStart, rangeEnd),
            ]);
            timeOffRows = toRows;
            shiftsByDate = {};
            for (const row of rangeShifts) {
                const d = row.shift_date;
                if (!shiftsByDate[d]) shiftsByDate[d] = [];
                shiftsByDate[d].push(row);
            }
        }

        for (const dateStr of shiftDatesYmd) {
            if (dateStr < todayStr) {
                showNotification(`Cannot assign on ${formatDateForDisplay(dateStr)} (past date).`, 'error');
                return;
            }
            if (isEmployeeDropping(employeeName, dateStr)) {
                showNotification(`${employeeName} has an approved drop on ${formatDateForDisplay(dateStr)}.`, 'error');
                return;
            }
            if (window.supabaseClient && window.ORG_ID && shiftsByDate) {
                if (employeeCoveredByTimeOffRows(timeOffRows, employeeName, dateStr)) {
                    showNotification(
                        `${employeeName} has time off on ${formatDateForDisplay(dateStr)}. Change recurrence or dates.`,
                        'error'
                    );
                    return;
                }
                const rows = shiftsByDate[dateStr] || [];
                for (const row of rows) {
                    if (shiftTimeRangesOverlap(startTime, endTime, row.start_time, row.end_time)) {
                        showNotification(
                            `${employeeName} already overlaps on ${dateStr} (${row.start_time || '?'}–${row.end_time || '?'}).`,
                            'error'
                        );
                        return;
                    }
                }
            }
            const wk = getWeekStart(new Date(dateStr + 'T12:00:00'));
            const dk = getDayKeyForDate(dateStr);
            const existingShifts = (window.shiftData[employeeName] || []).filter((s) => s.day === dk && s.weekStart === wk);
            for (const s of existingShifts) {
                if (shiftTimeRangesOverlap(startTime, endTime, s.startTime, s.endTime)) {
                    showNotification(
                        `${employeeName} already has a shift on ${formatDateForDisplay(dateStr)} (${s.startTime}–${s.endTime}).`,
                        'error'
                    );
                    return;
                }
            }
        }

        const shiftHours = calculateShiftHours(startTime, endTime);
        const weekStartFirst = getWeekStart(new Date(shiftDatesYmd[0] + 'T12:00:00'));
        const currentHours = getEmployeeWeeklyHours(employeeName, weekStartFirst);
        const newTotalHours = currentHours + shiftHours;

        if (newTotalHours > 40) {
            openOvertimeWarningModal(employeeName, currentHours, shiftHours, newTotalHours, () => {
                proceedWithShiftAssignment(employee, position, startTime, endTime, shiftHours, shiftDatesYmd);
            });
            return;
        }

        proceedWithShiftAssignment(employee, position, startTime, endTime, shiftHours, shiftDatesYmd);
    } catch (e) {
        console.error('[assignShift]', e);
        showNotification(e?.message || 'Could not assign shift. Check the console.', 'error');
    } finally {
        setWorking(false);
    }
}

/** @param {string[]} shiftDatesYmd - YYYY-MM-DD for each occurrence (first = selected day) */
function proceedWithShiftAssignment(employee, position, startTime, endTime, shiftHours, shiftDatesYmd) {
    const employeeName = getEmployeeDisplayName(employee);

    const formatTime = (time24) => {
        const [hours, minutes] = time24.split(':');
        const hour12 = hours % 12 || 12;
        const ampm = hours >= 12 ? 'pm' : 'am';
        return `${hour12}${minutes !== '00' ? ':' + minutes : ''}${ampm}`;
    };

    const formattedTime = `${formatTime(startTime)} - ${formatTime(endTime)}`;

    const POSITION_LABELS = {
        'line-cook': 'Line Cook', 'server': 'Server', 'dish': 'Dish', 'prep': 'Prep',
        'foh-manager': 'FOH Manager', 'dishwasher': 'Dishwasher', 'dessert': 'Dessert',
        'hot-foods': 'Hot Foods', 'mod': 'MOD', 'cold-foods': 'Cold Foods', 'expo': 'Expo'
    };
    const positionLabel = POSITION_LABELS[position]
        || String(position || '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const visibleWeekStartStr = getWeekStart(currentWeekStart);
    const metaByIndex = [];

    if (!window.shiftData[employeeName]) window.shiftData[employeeName] = [];

    shiftDatesYmd.forEach((shiftDate) => {
        const dayKey = getDayKeyForDate(shiftDate);
        const weekStartStr = getWeekStart(new Date(shiftDate + 'T12:00:00'));
        window.shiftData[employeeName].push({
            day: dayKey,
            shiftDate,
            startTime,
            endTime,
            hours: shiftHours,
            weekStart: weekStartStr,
            position: position
        });
        if (!window.employeeHours[employeeName]) window.employeeHours[employeeName] = {};
        if (!window.employeeHours[employeeName][weekStartStr]) window.employeeHours[employeeName][weekStartStr] = 0;
        window.employeeHours[employeeName][weekStartStr] += shiftHours;

        let card = null;
        if (weekStartStr === visibleWeekStartStr) {
            card = createShiftCard(employee, position, formattedTime, dayKey, shiftHours, positionLabel);
        }
        metaByIndex.push({ card, shiftDate, dayKey, weekStartStr });
    });
    persistShiftData();

    const gridWeekHours = window.employeeHours[employeeName][visibleWeekStartStr] || 0;
    const n = shiftDatesYmd.length;
    if (n === 1) {
        showNotification(`Shift assigned to ${employeeName}. Total hours this week: ${gridWeekHours.toFixed(1)}`, 'success');
    } else {
        showNotification(`${n} shifts assigned to ${employeeName}. Hours on the visible week: ${gridWeekHours.toFixed(1)}`, 'success');
    }

    if (window.supabaseClient && window.ORG_ID) {
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

            const empId = typeof window.getEmployeeIdFromName === 'function' ? window.getEmployeeIdFromName(employeeName) : null;
            const rows = shiftDatesYmd.map((shift_date) => ({
                org_id: window.ORG_ID,
                shift_date,
                start_time: startTime,
                end_time: endTime,
                position: positionLabel,
                employee_name: employeeName,
                employee_id: empId
            }));

            const CHUNK = 50;
            let syncError = null;
            for (let i = 0; i < rows.length; i += CHUNK) {
                const chunk = rows.slice(i, i + CHUNK);
                const { data, error } = await window.supabaseClient.from('shifts').insert(chunk).select('id, shift_date');
                if (error) {
                    syncError = error;
                    console.warn('[Supabase] Could not save shifts batch:', error.message);
                    break;
                }
                for (let j = 0; j < (data || []).length; j++) {
                    const row = data[j];
                    const globalIdx = i + j;
                    const meta = metaByIndex[globalIdx];
                    if (!meta || !row) continue;
                    const empShifts = window.shiftData[employeeName] || [];
                    const entry = empShifts.find((s) =>
                        s.shiftDate === meta.shiftDate &&
                        s.startTime === startTime &&
                        s.endTime === endTime &&
                        s.weekStart === meta.weekStartStr
                    );
                    if (entry) entry.shiftId = row.id;
                    if (meta.card) meta.card.dataset.shiftId = row.id;
                }
            }
            persistShiftData();
            if (syncError) {
                showNotification(`⚠️ Shifts saved locally but sync failed: ${syncError.message}`, 'error');
            } else {
                const day0 = getDayKeyForDate(shiftDatesYmd[0]);
                insertInAppNotification(employeeName, day0, formattedTime, null);
                sendShiftNotification(employeeName, day0, formattedTime);
            }
        })();
    }

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

/** True if two HH:MM ranges overlap (same calendar day). */
function shiftTimeRangesOverlap(startA, endA, startB, endB) {
    const toMin = (t) => {
        const [h, m] = String(t || '0:0').split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    const a0 = toMin(startA);
    const a1 = toMin(endA);
    const b0 = toMin(startB);
    const b1 = toMin(endB);
    return a0 < b1 && a1 > b0;
}

// Get week start date (Monday) as YYYY-MM-DD string (local time, no UTC drift)
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust to Monday
    d.setDate(diff);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

/** YYYY-MM-DD in the browser's local calendar (avoids UTC drift from toISOString). */
function formatLocalYmd(d) {
    const x = new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function getTodayLocalYmd() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return formatLocalYmd(t);
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
    const startStr = formatLocalYmd(first);
    const endStr = formatLocalYmd(last);
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
        const ds = formatLocalYmd(d);
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
    const isToday = dateStr === getTodayLocalYmd();
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

    // Clear hours and shiftData for this week — syncSupabaseShiftsToGrid will repopulate from DB
    Object.keys(window.employeeHours).forEach(emp => {
        if (window.employeeHours[emp] && window.employeeHours[emp][weekStart]) {
            delete window.employeeHours[emp][weekStart];
        }
    });
    Object.keys(window.shiftData || {}).forEach(emp => {
        if (window.shiftData[emp] && Array.isArray(window.shiftData[emp])) {
            window.shiftData[emp] = window.shiftData[emp].filter(s => s.weekStart !== weekStart);
        }
    });

    // Pick up any shift cards that are still in the DOM (initial page load only — cleared on nav)
    document.querySelectorAll('.shift-card').forEach(card => {
        const employeeName = card.dataset.employeeName || card.querySelector('.employee-name')?.textContent?.trim();
        const timeText = card.querySelector('.shift-time')?.textContent || '';

        if (employeeName && timeText) {
            const timeMatch = timeText.match(/(\d+)(?::(\d+))?(am|pm)\s*-\s*(\d+)(?::(\d+))?(am|pm)/i);
            if (timeMatch) {
                const startH = parseInt(timeMatch[1]);
                const startM = parseInt(timeMatch[2] || 0);
                const startPeriod = timeMatch[3].toLowerCase();
                const endH = parseInt(timeMatch[4]);
                const endM = parseInt(timeMatch[5] || 0);
                const endPeriod = timeMatch[6].toLowerCase();

                let start24 = startH + (startPeriod === 'pm' && startH !== 12 ? 12 : 0);
                if (startPeriod === 'am' && startH === 12) start24 = 0;
                let end24 = endH + (endPeriod === 'pm' && endH !== 12 ? 12 : 0);
                if (endPeriod === 'am' && endH === 12) end24 = 0;
                // Do NOT add 24 for overnight — calculateShiftHours handles that internally.
                // Storing 28:27 breaks Supabase lookups.

                const startTime = `${String(start24).padStart(2, '0')}:${String(startM).padStart(2, '0')}`;
                const endTime = `${String(end24).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

                const dayColumn = card.closest('.day-column');
                const day = dayColumn?.dataset.day;
                if (day) {
                    const hours = calculateShiftHours(startTime, endTime);
                    if (!window.shiftData[employeeName]) window.shiftData[employeeName] = [];
                    const exists = window.shiftData[employeeName].some(s =>
                        s.day === day && s.startTime === startTime && s.endTime === endTime && s.weekStart === weekStart
                    );
                    if (!exists) {
                        window.shiftData[employeeName].push({ day, startTime, endTime, hours, weekStart });
                    }
                    if (!window.employeeHours[employeeName]) window.employeeHours[employeeName] = {};
                    if (!window.employeeHours[employeeName][weekStart]) window.employeeHours[employeeName][weekStart] = 0;
                    if (!exists) window.employeeHours[employeeName][weekStart] += hours;
                }
            }
        }
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

    const colDate = dayColumn.dataset?.date;
    const isPastCol = colDate && colDate < getTodayLocalYmd();
    const hintHtml = isPastCol
        ? '<i class="fas fa-eye"></i> Click to view tasks for this shift'
        : '<i class="fas fa-pen"></i> Click to edit shift & assign tasks';
    
    shiftCard.innerHTML = `
        <div class="shift-header">
            <span class="shift-position">${prettyPos}</span>
            <span class="shift-time">${time}</span>
        </div>
        <div class="shift-employee">
            <div class="employee-avatar">${employeeNames[employee]?.charAt(0) || employee.charAt(0).toUpperCase()}</div>
            <span class="employee-name">${displayName}</span>
        </div>
        <div class="shift-card-hint">${hintHtml}</div>
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

// Combined Edit Shift + Assign Task modal — context for Save & Assign handler
let _shiftModalContext = null;

function applyShiftDetailsPastViewUI(isPast) {
    const modal = document.getElementById('shift-details-modal');
    const banner = document.getElementById('shift-details-past-banner');
    if (banner) {
        banner.hidden = !isPast;
    }
    const addTasksGroup = document.getElementById('shift-details-add-task-row')?.closest('.form-group');
    const recipesGroup = document.getElementById('shift-details-active-recipes')?.closest('.form-group');
    const commonGroup = modal?.querySelector('.common-tasks-list')?.closest('.form-group');
    const display = isPast ? 'none' : '';
    if (addTasksGroup) addTasksGroup.style.display = display;
    if (recipesGroup) recipesGroup.style.display = display;
    if (commonGroup) commonGroup.style.display = display;

    ['shift-details-position', 'shift-details-start', 'shift-details-end'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = !!isPast;
    });
    const del = document.getElementById('shift-details-delete-btn');
    const save = document.getElementById('shift-details-save-btn');
    if (del) del.style.display = isPast ? 'none' : '';
    if (save) save.style.display = isPast ? 'none' : '';

    const sections = modal?.querySelectorAll('.shift-details-section-title');
    if (sections && sections[0]) {
        sections[0].innerHTML = isPast
            ? '<i class="fas fa-clock"></i> Shift'
            : '<i class="fas fa-clock"></i> Edit Shift';
    }
    if (sections && sections[1]) {
        sections[1].innerHTML = isPast
            ? '<i class="fas fa-clipboard-list"></i> Tasks for this shift'
            : '<i class="fas fa-clipboard-list"></i> Assign Tasks';
    }
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
    const deleteBtn = document.getElementById('shift-details-delete-btn');

    if (!modal || !empInput || !taskList) return;

    const NAMES = { kenny:'Kenny', rohan:'Rohan', jake:'Jake', natalie:'Natalie',
                    sam:'Sam', sophia:'Sophia', aria:'Aria', alex:'Alex' };
    const fromCard = (shiftCard && shiftCard.dataset && shiftCard.dataset.employeeName || '').trim();
    const empKey = (employee || '').toLowerCase();
    const displayName = fromCard || NAMES[empKey] || (employee && employee.charAt(0).toUpperCase() + employee.slice(1));

    const parts = time.split('-').map(s => s.trim());
    const start24 = parts[0] ? parseTo24h(parts[0]) : '';
    const end24   = parts[1] ? parseTo24h(parts[1]) : '';

    const dayColumnEl = document.querySelector(`.day-column[data-day="${day}"]`);
    const shiftDateStr = (dayColumnEl?.dataset?.date) || getDateForDay(day) || '';
    const isPastShift = !!(shiftDateStr && shiftDateStr < getTodayLocalYmd());
    modal.dataset.pastView = isPastShift ? '1' : '';
    applyShiftDetailsPastViewUI(isPastShift);

    titleEl.innerHTML = `<i class="fas fa-user-clock"></i> ${displayName} — ${day.charAt(0).toUpperCase() + day.slice(1)}`;
    empInput.value = displayName;
    if (posSelect) posSelect.value = position;
    if (startInput) startInput.value = start24;
    if (endInput) endInput.value = end24;

    taskList.innerHTML = '';
    if (existingList) existingList.innerHTML = '';
    if (existingGroup) existingGroup.style.display = 'none';
    if (!isPastShift) {
        void loadActiveRecipesInto(recipesList, taskList);
    } else if (recipesList) {
        recipesList.innerHTML = '';
    }

    modal.dataset.employeeName = displayName;
    const cardRef = shiftCard;
    const existingShiftId = cardRef?.dataset?.shiftId || '';
    modal.dataset.shiftId = existingShiftId;
    modal.dataset.shiftDate = shiftDateStr;
    modal.dataset.startTime = start24 || '';
    modal.dataset.endTime = end24 || '';
    _shiftModalContext = { shiftCard, displayName, day, start24, end24, posSelect, taskList };

    if (existingShiftId) {
        void loadExistingTasksForEmployee(displayName, existingList, existingGroup, {
            shiftId: existingShiftId,
            shiftDate: shiftDateStr,
            startTime: start24,
            endTime: end24,
            historyView: isPastShift,
        });
    }

    const newDeleteBtn = deleteBtn.cloneNode(true);
    deleteBtn.replaceWith(newDeleteBtn);
    if (!isPastShift) {
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
    }

    if (addTaskBtn) {
        addTaskBtn.onclick = isPastShift ? null : () => addTaskRow(taskList);
    }

    openModal('shift-details-modal');
    document.body.style.overflow = 'hidden';
    if (!isPastShift) {
        startInput?.focus();
    }
}

function isRecipeMarkedActive(recipe) {
    const status = (recipe?.status || '').toString().trim().toLowerCase();
    if (status) return status === 'active';
    if (typeof recipe?.active === 'boolean') return recipe.active;
    return true;
}

async function fetchActiveRecipesFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const { data, error } = await window.supabaseClient
        .from('recipes')
        .select('name, status')
        .eq('org_id', window.ORG_ID)
        .eq('status', 'active')
        .order('name', { ascending: true });
    if (error) {
        console.warn('[Scheduling] Could not load active recipes:', error.message);
        return [];
    }
    return (data || []).filter(r => (r.name || '').trim()).map(r => ({ name: r.name, status: r.status }));
}

async function loadActiveRecipesInto(container, targetTaskList) {
    if (!container) return;
    const taskList = targetTaskList || document.getElementById('shift-details-task-list');
    let activeRecipes = [];
    if (typeof window.recipesData !== 'undefined' && Object.keys(window.recipesData).length > 0) {
        activeRecipes = Object.values(window.recipesData).filter(r => r.name && isRecipeMarkedActive(r));
    } else {
        try {
            document.querySelectorAll('.recipes-active .recipe-card').forEach(card => {
                const name = card.querySelector('.recipe-name')?.textContent?.trim();
                if (name) activeRecipes.push({ name });
            });
        } catch (e) {
            activeRecipes = [];
        }
    }
    if (activeRecipes.length === 0) {
        activeRecipes = await fetchActiveRecipesFromSupabase();
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
            const label = (card.dataset.employeeName || empEl?.textContent || '').trim();
            const empKey = label ? label.toLowerCase() : '';
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
    
    return formatLocalYmd(targetDate);
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
async function loadActiveRecipes() {
    const recipesList = document.getElementById('active-recipes-list');
    if (!recipesList) return;

    // Get recipes from global recipesData if available, or from DOM
    let activeRecipes = [];
    
    if (typeof window.recipesData !== 'undefined' && Object.keys(window.recipesData).length > 0) {
        activeRecipes = Object.values(window.recipesData).filter(r => r.name && isRecipeMarkedActive(r));
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
            activeRecipes = [];
        }
    }
    if (activeRecipes.length === 0) {
        activeRecipes = await fetchActiveRecipesFromSupabase();
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
        tasks.push(qty > 1 ? `make ${qty} ${recipeName}` : `make ${recipeName}`);
    } else if (type === 'both') {
        tasks.push(qty > 1 ? `kit ${qty} ${recipeName}` : `kit ${recipeName}`);
        tasks.push(qty > 1 ? `make ${qty} ${recipeName}` : `make ${recipeName}`);
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
    }
    if (names.length === 0) names = DEFAULT_EMPLOYEES;

    const labelMap = await buildEmployeePositionDisplayLabelMap();

    select.innerHTML = '<option value="">Select Employee</option>' + names.map(n => {
        const val = EMPLOYEE_VALUE_MAP[n] || n.toLowerCase().replace(/\s+/g, '-');
        const nk = normEmployeeKey(n);
        const displayText = labelMap.get(nk) || n;
        return `<option value="${val}">${escapeHtml(displayText)}</option>`;
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
    modal.dataset.day = day || '';
    
    if (typeof loadEmployeePositionsFromSupabase === 'function') {
        await loadEmployeePositionsFromSupabase();
    }
    await populateTaskEmployeeSelect();
    
    const val = employeeName ? (EMPLOYEE_VALUE_MAP[employeeName] || employeeName.toLowerCase().replace(/\s+/g, '-')) : '';
    const option = Array.from(employeeSelect.options).find(o => o.value === val);
    if (option) employeeSelect.value = val;
    const selectedName = getEmployeeDisplayName(employeeSelect.value) || employeeName;
    modal.dataset.employeeName = selectedName;
    
    loadExistingTasksForEmployee(selectedName, existingTasksList, existingTasksGroup);
    openModal('assign-task-modal');
    loadActiveRecipes();
    employeeSelect?.focus();
}

/** Show only open assignments in scheduling modals — not completed history. */
function kitchenTaskIsActive(task) {
    return task && !task.completed;
}

// Load existing tasks for an employee and display them in the modal.
// If a shift id is provided, only show tasks linked to that specific shift.
async function loadExistingTasksForEmployee(employeeName, container, groupElement, options = {}) {
    if (!container || !groupElement) return;
    const shiftIdFilter = options?.shiftId ? String(options.shiftId) : null;
    let allowedShiftIds = shiftIdFilter ? new Set([shiftIdFilter]) : null;
    const historyView = !!options.historyView;
    
    // Clear existing content
    container.innerHTML = '';

    if (historyView && shiftIdFilter && window.supabaseClient && window.ORG_ID) {
        try {
            const { data: dbTasks, error: dbErr } = await window.supabaseClient
                .from('tasks')
                .select('id, text, employee_name, employee_id, shift_id, status, completed_at')
                .eq('org_id', window.ORG_ID)
                .eq('shift_id', shiftIdFilter);
            if (dbErr) {
                console.warn('[ShiftDetails] History task load failed:', dbErr.message);
                groupElement.style.display = 'none';
                return;
            }
            const rows = dbTasks || [];
            if (rows.length === 0) {
                groupElement.style.display = 'none';
                return;
            }
            groupElement.style.display = 'block';
            rows.forEach((task) => {
                const nameKey =
                    (typeof window.getEmployeeNameFromId === 'function' && task.employee_id
                        ? window.getEmployeeNameFromId(task.employee_id)
                        : null) ||
                    task.employee_name ||
                    '';
                const mappedName = nameKey
                    ? ((typeof window.getEmployeeDisplayName === 'function'
                        ? window.getEmployeeDisplayName(nameKey)
                        : null) || nameKey)
                    : 'Unassigned';
                const completed = schedulingTaskRowCompleted(task);
                const item = createExistingTaskItem(
                    mappedName,
                    (task.text || '').trim(),
                    completed,
                    task.shift_id ? String(task.shift_id) : shiftIdFilter,
                    { readOnly: true }
                );
                container.appendChild(item);
            });
        } catch (e) {
            console.warn('[ShiftDetails] History task load failed:', e?.message || e);
            groupElement.style.display = 'none';
        }
        return;
    }

    if (
        allowedShiftIds &&
        window.supabaseClient &&
        window.ORG_ID &&
        options?.shiftDate &&
        options?.startTime &&
        options?.endTime
    ) {
        try {
            const { data: siblingRows, error: siblingErr } = await window.supabaseClient
                .from('shifts')
                .select('id')
                .eq('org_id', window.ORG_ID)
                .eq('shift_date', options.shiftDate)
                .eq('start_time', options.startTime)
                .eq('end_time', options.endTime)
                .eq('employee_name', employeeName);
            if (!siblingErr && siblingRows?.length) {
                allowedShiftIds = new Set(
                    siblingRows.map((row) => String(row.id)).filter(Boolean)
                );
            }
        } catch (e) {
            console.warn('[ShiftDetails] sibling shift lookup failed:', e?.message || e);
        }
    }
    
    // Get tasks from window.kitchenTasks
    const existingTasks = [];
    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length > 0) {
        window.kitchenTasks.forEach(task => {
            const taskShiftId = task.shift_id ? String(task.shift_id) : null;
            if (
                kitchenTaskIsActive(task) &&
                task.assignee &&
                assigneeMatchesEmployeeName(task.assignee, employeeName) &&
                (!allowedShiftIds || (taskShiftId && allowedShiftIds.has(taskShiftId)))
            ) {
                existingTasks.push({
                    assignee: task.assignee,
                    description: task.description,
                    shift_id: taskShiftId
                });
            }
        });
    }
    
    // Progress rows do not reliably know which shift they belong to,
    // so only use them for employee-wide task views.
    const progressList = allowedShiftIds ? null : document.querySelector('.progress-list');
    if (progressList) {
        progressList.querySelectorAll('.progress-item').forEach(item => {
            const assignee = item.dataset.employeeName || item.querySelector('.task-assignee')?.textContent?.trim();
            const description = item.dataset.taskDescription || item.querySelector('.task-text')?.textContent?.trim();
            const isCompleted = item.dataset.completed === 'true' || item.classList.contains('task-completed');
            
            if (isCompleted) return;
            if (assignee && assigneeMatchesEmployeeName(assignee, employeeName) && description) {
                // Check if already added
                const alreadyExists = existingTasks.some(t => 
                    t.assignee === assignee && t.description === description
                );
                if (!alreadyExists) {
                    existingTasks.push({
                        assignee: assignee,
                        description: description,
                        completed: isCompleted,
                        shift_id: null
                    });
                }
            }
        });
    }
    
    // Display tasks
    if (existingTasks.length > 0) {
        groupElement.style.display = 'block';
        
        existingTasks.forEach(task => {
            const taskItem = createExistingTaskItem(task.assignee, task.description, task.completed, task.shift_id || null);
            container.appendChild(taskItem);
        });
    } else {
        groupElement.style.display = 'none';
    }
}

// Create a display item for an existing task (read-only in modal)
function createExistingTaskItem(employeeName, taskDescription, isCompleted, shiftId = null, opts = {}) {
    const readOnly = !!opts.readOnly;
    const currentUser = getCurrentUser();
    const isAssignedToCurrentUser = currentUser && currentUser.toLowerCase() === employeeName.toLowerCase();
    
    const taskItem = document.createElement('div');
    taskItem.className = `existing-task-item ${isCompleted ? 'task-completed' : ''}`;
    taskItem.dataset.employeeName = employeeName;
    taskItem.dataset.taskDescription = taskDescription;
    if (shiftId) taskItem.dataset.shiftId = shiftId;

    if (readOnly) {
        const readonlyDiv = document.createElement('div');
        readonlyDiv.className = 'task-status-readonly';
        readonlyDiv.innerHTML = `
            <i class="fas ${isCompleted ? 'fa-check-circle task-status-complete' : 'fa-circle task-status-pending'} task-status-icon ${isCompleted ? 'task-status-complete' : 'task-status-pending'}"></i>
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        taskItem.appendChild(readonlyDiv);
        return taskItem;
    }
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-delete-task';
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
    deleteBtn.title = 'Remove task';
    deleteBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm(`Remove task "${taskDescription}" from ${employeeName}?`)) {
            removeTask(employeeName, taskDescription, shiftId);
            const shiftModal = document.getElementById('shift-details-modal');
            const assignModal = document.getElementById('assign-task-modal');
            let listEl, groupEl, empName, modalShiftId = null;
            if (shiftModal?.classList.contains('active')) {
                listEl = document.getElementById('shift-details-existing-tasks-list');
                groupEl = document.getElementById('shift-details-existing-tasks-group');
                empName = shiftModal.dataset.employeeName;
                modalShiftId = shiftModal.dataset.shiftId || null;
            } else if (assignModal) {
                listEl = document.getElementById('existing-tasks-list');
                groupEl = document.getElementById('existing-tasks-group');
                empName = assignModal.dataset.employeeName;
            }
            if (empName && listEl && groupEl) {
                loadExistingTasksForEmployee(empName, listEl, groupEl, {
                    shiftId: modalShiftId,
                    shiftDate: shiftModal?.dataset.shiftDate || null,
                    startTime: shiftModal?.dataset.startTime || null,
                    endTime: shiftModal?.dataset.endTime || null,
                });
            }
        }
    });
    
    if (isAssignedToCurrentUser) {
        const label = document.createElement('label');
        label.className = 'task-checkbox-label';
        label.innerHTML = `
            <input type="checkbox" class="task-checkbox" ${isCompleted ? 'checked' : ''} data-task-id="${Date.now()}">
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        
        const checkbox = label.querySelector('.task-checkbox');
        if (checkbox) {
            checkbox.addEventListener('change', function() {
                updateTaskInProgressList(employeeName, taskDescription, this.checked);
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
        const readonlyDiv = document.createElement('div');
        readonlyDiv.className = 'task-status-readonly';
        readonlyDiv.innerHTML = `
            <i class="fas ${isCompleted ? 'fa-check-circle task-status-complete' : 'fa-circle task-status-pending'} task-status-icon ${isCompleted ? 'task-status-complete' : 'task-status-pending'}"></i>
            <span class="task-text" style="${isCompleted ? 'text-decoration: line-through; opacity: 0.6;' : ''}">${escapeHtml(taskDescription)}</span>
        `;
        taskItem.appendChild(readonlyDiv);
    }
    
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

async function assignTask() {
    const modal = document.getElementById('assign-task-modal');
    const employeeSelect = document.getElementById('task-employee-select');
    // Use actual employee_name from dropdown (so mobile can match by profile.employee_name)
    const selectedOpt = employeeSelect?.options[employeeSelect?.selectedIndex];
    const rawVal = (selectedOpt?.textContent || selectedOpt?.text || '').trim()
        || (employeeSelect?.value ? getEmployeeDisplayName(employeeSelect.value) : null)
        || (modal?.dataset.employeeName || null);
    const employeeName = (rawVal && rawVal !== 'Select Employee') ? rawVal : null;
    const taskInputs = modal ? modal.querySelectorAll('.task-input') : null;
    
    if (!employeeName || !employeeSelect?.value) {
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
    
    let failed = 0;
    let lastErr = '';
    for (const desc of descriptions) {
        const r = await addTaskToProgress(employeeName, desc);
        if (r && r.ok === false) {
            failed += 1;
            lastErr = r.error || '';
        }
    }

    updateEmployeeShiftCards(employeeName);

    const existingTasksList = document.getElementById('existing-tasks-list');
    const existingTasksGroup = document.getElementById('existing-tasks-group');
    if (existingTasksList && existingTasksGroup) {
        loadExistingTasksForEmployee(employeeName, existingTasksList, existingTasksGroup);
    }

    closeModal('assign-task-modal');
    if (failed > 0) {
        showNotification(`${failed} task(s) failed to save: ${lastErr || 'database error'}. Apply tasks RLS policies in Supabase.`, 'error');
    } else {
        const message = descriptions.length === 1
            ? `Task "${descriptions[0]}" assigned to ${employeeName}.`
            : `${descriptions.length} tasks assigned to ${employeeName}.`;
        showNotification(message, 'success');
    }
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
            row.remove();
        });
    }

    listEl.appendChild(row);

    const input = row.querySelector('.task-input');
    if (input) {
        input.focus();
    }

    return input;
}

function schedulingTaskRowCompleted(task) {
    const st = (task?.status || '').toString().trim().toLowerCase();
    if (['completed', 'complete', 'done', 'archived', 'cancelled'].includes(st)) return true;
    if (task?.completed_at) return true;
    return false;
}

// Add task to Kitchen Progress section (shared function). Returns { ok, error?, skipped?, localOnly? }.
async function addTaskToProgress(employeeName, taskDescription, options = {}) {
    const shiftIdOpt = options && options.shiftId ? String(options.shiftId) : null;
    if (typeof window.kitchenTasks === 'undefined') {
        window.kitchenTasks = [];
    }

    const existing = window.kitchenTasks.find(task =>
        task.assignee === employeeName &&
        task.description === taskDescription &&
        String(task.shift_id || '') === String(shiftIdOpt || '')
    );
    const taskExists = !!existing;

    if (!window.supabaseClient || !window.ORG_ID) {
        if (!taskExists) {
            const row = {
                assignee: employeeName,
                description: taskDescription,
                timestamp: new Date().toISOString(),
                completed: false
            };
            if (shiftIdOpt) row.shift_id = shiftIdOpt;
            window.kitchenTasks.push(row);
            try {
                localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
            } catch (e) {
                console.warn('Could not save tasks to localStorage:', e);
            }
        }
        return { ok: true, localOnly: true };
    }

    const localRow = window.kitchenTasks.find(t =>
        t.assignee === employeeName &&
        t.description === taskDescription &&
        String(t.shift_id || '') === String(shiftIdOpt || '')
    );
    if (localRow?.supabase_id) {
        return { ok: true, skipped: true };
    }

    const canonicalName = typeof window.getCanonicalEmployeeName === 'function'
        ? window.getCanonicalEmployeeName(employeeName) : employeeName;
    const employeeIdForTask = typeof window.getEmployeeIdFromName === 'function'
        ? window.getEmployeeIdFromName(canonicalName || employeeName)
        : null;
    const payload = {
        org_id: window.ORG_ID,
        text: taskDescription,
        employee_name: canonicalName,
        employee_id: employeeIdForTask || null,
        status: 'todo',
        is_urgent: false
    };
    if (shiftIdOpt) payload.shift_id = shiftIdOpt;

    let { data, error } = await window.supabaseClient.from('tasks').insert(payload).select();
    if (error && /employee_name/i.test(error.message || '')) {
        const fallback = { ...payload };
        delete fallback.employee_name;
        const retry = await window.supabaseClient.from('tasks').insert(fallback).select();
        data = retry.data;
        error = retry.error;
    }
    if (error && shiftIdOpt && /shift_id|column|does not exist|42703/i.test(error.message || '')) {
        const noShift = { ...payload };
        delete noShift.shift_id;
        const retry2 = await window.supabaseClient.from('tasks').insert(noShift).select();
        data = retry2.data;
        error = retry2.error;
        if (localRow) delete localRow.shift_id;
    }
    if (error) {
        console.warn('[Supabase] Task insert failed:', error.message);
        return { ok: false, error: error.message };
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (row?.id) {
        if (localRow) {
            localRow.supabase_id = row.id;
            localRow.assignee = employeeName;
            localRow.description = taskDescription;
            localRow.timestamp = row.created_at || localRow.timestamp;
            localRow.completed = schedulingTaskRowCompleted(row);
            localRow.shift_id = row.shift_id || localRow.shift_id || null;
        } else {
            const nextRow = {
                assignee: employeeName,
                description: taskDescription,
                timestamp: row.created_at || new Date().toISOString(),
                completed: schedulingTaskRowCompleted(row),
                supabase_id: row.id
            };
            if (row.shift_id || shiftIdOpt) nextRow.shift_id = row.shift_id || shiftIdOpt;
            window.kitchenTasks.push(nextRow);
        }
        try {
            localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
        } catch (_) {}

        const progressList = document.querySelector('.progress-list');
        if (progressList) {
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
        notifyTaskAssigned(employeeName, taskDescription);
    }
    return { ok: true };
}

// Remove a task from an employee
function removeTask(employeeName, taskDescription, shiftId = null) {
    const shiftIdFilter = shiftId ? String(shiftId) : null;
    // Remove from window.kitchenTasks
    if (typeof window.kitchenTasks !== 'undefined') {
        const removedTask = window.kitchenTasks.find(t =>
            t.assignee === employeeName &&
            t.description === taskDescription &&
            (!shiftIdFilter || String(t.shift_id || '') === shiftIdFilter)
        );

        window.kitchenTasks = window.kitchenTasks.filter(task => 
            !(
                task.assignee === employeeName &&
                task.description === taskDescription &&
                (!shiftIdFilter || String(task.shift_id || '') === shiftIdFilter)
            )
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
                : query
                    .eq('text', taskDescription)
                    .eq('employee_name', employeeName)
                    .eq('shift_id', shiftIdFilter || null);
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

/**
 * True if a task assignee string refers to the same person as the schedule card / modal label.
 * Handles case differences and short roster names vs profile full names (e.g. Kenny ↔ Kenny Bae).
 */
function assigneeMatchesEmployeeName(assignee, employeeName) {
    if (!assignee || !employeeName) return false;
    const raw = assignee.trim().toLowerCase();
    const me = employeeName.trim().toLowerCase();
    if (!raw || !me) return false;
    if (raw === me) return true;
    // Same profile: roster label "Kenny" vs canonical DB employee_name / username
    if (typeof window.getCanonicalEmployeeName === 'function') {
        const canAssignee = (window.getCanonicalEmployeeName(assignee) || '').trim().toLowerCase();
        const canCard = (window.getCanonicalEmployeeName(employeeName) || '').trim().toLowerCase();
        if (canAssignee && canCard && canAssignee === canCard) return true;
        if (canAssignee && raw === canAssignee) return true;
        if (canCard && raw === canCard) return true;
        if (canAssignee && me === canAssignee) return true;
        if (canCard && me === canCard) return true;
    }
    // Full-string contains only (no "same first name" shortcut — avoids cross-matching people).
    if (raw.startsWith(`${me} `) || raw.endsWith(` ${me}`) || raw.includes(` ${me} `)) return true;
    if (me.startsWith(`${raw} `) || me.endsWith(` ${raw}`) || me.includes(` ${raw} `)) return true;
    return false;
}

/** Up to `max` task lines for shift-card preview (same matching rules as employeeHasTasks). */
function getEmployeeTasksForCardPreview(employeeName, max = 3) {
    const out = [];
    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length > 0) {
        for (const task of window.kitchenTasks) {
            if (
                kitchenTaskIsActive(task) &&
                task.assignee &&
                assigneeMatchesEmployeeName(task.assignee, employeeName) &&
                task.description
            ) {
                out.push({ text: task.description, completed: !!task.completed });
                if (out.length >= max) break;
            }
        }
    }
    return out;
}

// Check if employee has assigned tasks
function employeeHasTasks(employeeName) {
    // Check in window.kitchenTasks
    if (typeof window.kitchenTasks !== 'undefined' && window.kitchenTasks.length > 0) {
        const hasTask = window.kitchenTasks.some(task =>
            kitchenTaskIsActive(task) &&
            task.assignee &&
            assigneeMatchesEmployeeName(task.assignee, employeeName)
        );
        if (hasTask) return true;
    }

    // Also check in DOM (Kitchen Progress section) if on home page
    const progressList = document.querySelector('.progress-list');
    if (progressList) {
        const taskItems = progressList.querySelectorAll('.progress-item');
        for (const item of taskItems) {
            const isCompleted = item.dataset.completed === 'true' || item.classList.contains('task-completed');
            if (isCompleted) continue;
            const assigneeEl = item.querySelector('.task-assignee');
            if (assigneeEl && assigneeMatchesEmployeeName(assigneeEl.textContent, employeeName)) {
                return true;
            }
        }
    }

    return false;
}

// Shift cards are clean — no task warnings or previews pulled from global employee tasks.
// Tasks are managed separately; shifts and tasks are independent.
function updateShiftCardTaskIndicator(shiftCard, employeeName) {
    const existingWarning = shiftCard.querySelector('.task-warning');
    if (existingWarning) existingWarning.remove();
    const existingPreview = shiftCard.querySelector('.shift-task-preview');
    if (existingPreview) existingPreview.remove();
    shiftCard.classList.remove('no-tasks-warning');
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
        if (cardEmployeeName && assigneeMatchesEmployeeName(cardEmployeeName, employeeName)) {
            updateShiftCardTaskIndicator(card, cardEmployeeName.trim());
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

    .shift-task-preview {
        margin-top: 0.35rem;
        padding-top: 0.35rem;
        border-top: 1px solid rgba(0, 0, 0, 0.08);
        font-size: 0.72rem;
        line-height: 1.25;
        color: rgba(0, 0, 0, 0.65);
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
    }
    .shift-task-preview-line {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .shift-task-preview-line.completed {
        text-decoration: line-through;
        opacity: 0.65;
    }
`;
document.head.appendChild(notificationStyles);

// ── Supabase task sync ────────────────────────────────────────────────────────
// When Supabase is ready, treat DB task rows as the source of truth for web task UI.
window.addEventListener('supabase-ready', async function () {
    if (!window.supabaseClient || !window.ORG_ID) return;
    loadRecentAnnouncements();
    await populateEmployeeSelectFromOrg();
    await populatePositionSelect();

    if (typeof window.kitchenTasks === 'undefined') window.kitchenTasks = [];

    if (typeof loadEmployeePositionsFromSupabase === 'function') {
        await loadEmployeePositionsFromSupabase();
    }

    const { data: tasks, error } = await window.supabaseClient
        .from('tasks')
        .select('*')
        .eq('org_id', window.ORG_ID);

    if (error) { console.warn('[Supabase] Task load failed:', error.message); return; }
    const nextKitchenTasks = [];
    (tasks || []).forEach(task => {
        if (schedulingTaskRowCompleted(task)) return;
        const nameKey =
            (typeof window.getEmployeeNameFromId === 'function' ? window.getEmployeeNameFromId(task.employee_id) : null)
            || task.employee_name
            || task.assigned_to
            || null;
        const mappedName = nameKey
            ? ((typeof window.getEmployeeDisplayName === 'function'
                ? window.getEmployeeDisplayName(nameKey)
                : null) || nameKey)
            : 'Unassigned';
        const kt = {
            assignee: mappedName,
            description: task.text,
            timestamp: task.created_at,
            completed: false,
            supabase_id: task.id
        };
        if (task.shift_id) kt.shift_id = task.shift_id;
        nextKitchenTasks.push(kt);
    });

    window.kitchenTasks = nextKitchenTasks;
    localStorage.setItem('kitchenTasks', JSON.stringify(window.kitchenTasks));
    if (typeof loadStoredTasks === 'function') loadStoredTasks();
    if (typeof checkEmployeeTasks === 'function') checkEmployeeTasks();
});