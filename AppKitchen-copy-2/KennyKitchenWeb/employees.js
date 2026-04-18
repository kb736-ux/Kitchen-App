// Optional icons when a position name matches (custom positions use briefcase).
const POSITION_ICON_BY_NAME = {
    Server: 'fa-utensils',
    'Line Cook': 'fa-fire',
    Dishwasher: 'fa-spray-can',
    Dessert: 'fa-cookie-bite',
    'Hot Foods': 'fa-thermometer-half',
    'Cold Foods': 'fa-snowflake',
    MOD: 'fa-user-shield',
    Expo: 'fa-clipboard-check',
    Dish: 'fa-drumstick-bite',
    Prep: 'fa-cut',
    'FOH Manager': 'fa-user-tie',
};

function iconClassForPositionName(name) {
    const n = String(name || '').trim();
    return POSITION_ICON_BY_NAME[n] || 'fa-briefcase';
}

function positionCardExists(positionName) {
    const want = String(positionName || '').trim();
    if (!want) return false;
    return Array.from(document.querySelectorAll('.position-item[data-position]')).some(
        (el) => (el.dataset.position || '').trim() === want,
    );
}

/** Append a position card if missing; used for user-created positions and for names found in Supabase. */
/** User-created position names with no employees yet (survive refresh; keyed per org). */
function getExtraPositionNamesForOrg() {
    if (!window.ORG_ID) return [];
    try {
        const raw = sessionStorage.getItem(`kk_extra_positions_v1_${window.ORG_ID}`);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.map((s) => String(s || '').trim()).filter(Boolean) : [];
    } catch (_) {
        return [];
    }
}

function addExtraPositionName(name) {
    const n = String(name || '').trim();
    if (!n || !window.ORG_ID) return;
    const cur = new Set(getExtraPositionNamesForOrg());
    cur.add(n);
    sessionStorage.setItem(`kk_extra_positions_v1_${window.ORG_ID}`, JSON.stringify([...cur]));
}

function collectAllKnownPositionLabels() {
    const labels = new Set(getExtraPositionNamesForOrg());
    const posData = getEmployeePositions();
    Object.values(posData || {}).forEach((arr) => {
        (arr || []).forEach((p) => {
            const label = typeof p === 'string' ? p.trim() : String(p?.name || '').trim();
            if (label) labels.add(label);
        });
    });
    return labels;
}

/** Scheduling / Assign Shift: all position labels (extra + per-employee + DB-backed). */
window.kkGetOrgPositionLabelsForScheduling = function () {
    try {
        return [...collectAllKnownPositionLabels()].sort((a, b) => a.localeCompare(b));
    } catch (_) {
        return [];
    }
};

function appendPositionCard(positionName, opts) {
    const animate = opts && opts.animate !== false;
    const name = String(positionName || '').trim();
    if (!name || positionCardExists(name)) return;

    const positionsList = document.querySelector('.positions-list');
    if (!positionsList) return;

    const positionItem = document.createElement('div');
    positionItem.className = 'position-item';
    positionItem.dataset.position = name;
    positionItem.dataset.employees = '[]';
    const icon = iconClassForPositionName(name);
    positionItem.innerHTML = `
            <div class="position-icon">
                <i class="fas ${icon}"></i>
            </div>
            <div class="position-info">
                <span class="position-name">${escapeEmployeesHtml(name)}</span>
                <span class="position-count">0 employees capable</span>
            </div>
        `;

    positionItem.addEventListener('click', () => openPositionDetail(name));

    positionsList.appendChild(positionItem);
    if (animate) {
        positionItem.style.opacity = '0';
        positionItem.style.transform = 'translateY(10px)';
        requestAnimationFrame(() => {
            positionItem.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            positionItem.style.opacity = '1';
            positionItem.style.transform = 'translateY(0)';
        });
    }
}

// Responsibility text per position (filled when user creates/edits a position; no default org positions).
const positionResponsibilities = {};

// ── Employee → Positions (Supabase) ───────────────────────────────────────────
// Structure: { "Rohan": ["Server", "Bartend"], "Kenny": ["Server"], ... }

async function loadEmployeePositionsFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return null;
    window._profileBackedEmployeeNames = new Set();
    // Names from recent shifts (fold into profile canonicals; see filter after merge).
    const rosterSince = new Date();
    rosterSince.setFullYear(rosterSince.getFullYear() - 1);
    const rosterSinceStr = ymd(rosterSince);

    const [{ data, error }, { data: profilesData, error: profilesError }, { data: shiftsData, error: shiftsError }] = await Promise.all([
        window.supabaseClient
            .from('employee_positions')
            .select('id, employee_name, positions')
            .eq('org_id', window.ORG_ID),
        window.supabaseClient
            .from('profiles')
            .select('id, user_id, employee_name, display_name, full_name, email')
            .eq('org_id', window.ORG_ID),
        window.supabaseClient
            .from('shifts')
            .select('employee_name')
            .eq('org_id', window.ORG_ID)
            .gte('shift_date', rosterSinceStr)
            .not('employee_name', 'is', null)
            .limit(4000),
    ]);
    if (error) {
        console.warn('[Supabase] Employee positions load failed:', error.message);
        window._profileBackedEmployeeNames = new Set();
        return null;
    }
    if (profilesError) {
        console.warn('[Supabase] Profiles load failed:', profilesError.message);
    }
    if (shiftsError) {
        console.warn('[Supabase] Shifts roster names load failed:', shiftsError.message);
    }

    // Do NOT filter profiles by org_members here: with typical RLS, managers only see their *own*
    // org_members row, so allowed-user-id sets would exclude every other employee. Profiles for
    // this org are already gated by Supabase RLS (same-org roster policies).
    const positionsByEmployee = {};
    window._employeeNameToId = {};
    window._profileNameToId = {};
    window._displayNameToCanonicalEmployeeName = {};
    window._employeeIdToCanonicalName = {};
    _employeeDisplayByName = {};
    (data || []).forEach(r => {
        const en = (r.employee_name || '').trim();
        if (!en) return;
        window._employeeNameToId[en] = r.id;
        positionsByEmployee[en] = r.positions || [];
    });

    const rosterProfiles = (profilesData || []).filter(
        (p) =>
            !!p.id &&
            !!p.user_id &&
            (p.employee_name || '').trim()
    );
    const seenUserIds = new Set();
    const dedupedProfiles = [];
    rosterProfiles.forEach((p) => {
        if (!p.user_id || seenUserIds.has(p.user_id)) return;
        seenUserIds.add(p.user_id);
        dedupedProfiles.push(p);
    });

    // Build robust name->UUID lookup from roster profiles (one row per auth user).
    dedupedProfiles.forEach((p) => {
        const name = (p.employee_name || '').trim();
        const display = (p.display_name || '').trim();
        if (name) {
            window._profileNameToId[name] = p.id;
            window._employeeNameToId[name] = p.id;
            window._employeeIdToCanonicalName[p.id] = name;
        }
        if (display) {
            window._profileNameToId[display] = p.id;
            window._employeeNameToId[display] = p.id;
        }
        if (name) {
            window._displayNameToCanonicalEmployeeName[name] = name;
            if (display) window._displayNameToCanonicalEmployeeName[display] = name;
        }
    });

    let map = {};
    dedupedProfiles.forEach((p) => {
        const name = (p.employee_name || '').trim();
        map[name] = positionsByEmployee[name] || [];
        _employeeDisplayByName[name] = deriveEmployeeLabel(p, name);
    });

    // Include shift / employee_positions spellings so mergeDuplicateRosterMap can fold them into
    // the profile's canonical employee_name (e.g. "Kenneth-bae" → "Kenneth Bae"). Rows with no
    // matching profile are removed after merge (roster is auth-backed profiles only).
    Object.keys(positionsByEmployee).forEach((en) => {
        if (map[en]) return;
        map[en] = positionsByEmployee[en] || [];
        if (!_employeeDisplayByName[en]) _employeeDisplayByName[en] = en;
    });

    const shiftNamesSeen = new Set();
    (shiftsData || []).forEach((row) => {
        const en = (row.employee_name || '').trim();
        if (!en || shiftNamesSeen.has(en)) return;
        shiftNamesSeen.add(en);
        if (map[en]) return;
        map[en] = positionsByEmployee[en] || [];
        if (!_employeeDisplayByName[en]) _employeeDisplayByName[en] = en;
    });

    map = mergeDuplicateRosterMap(map, dedupedProfiles);

    const profileEmployeeNames = new Set(
        dedupedProfiles.map((p) => (p.employee_name || '').trim()).filter(Boolean)
    );
    const filteredMap = {};
    const nextAliases = {};
    Object.keys(map).forEach((canonical) => {
        const aliases = window._rosterCanonicalAliases[canonical] || [canonical];
        const backed = aliases.some((a) => profileEmployeeNames.has((a || '').trim()));
        if (!backed) return;
        filteredMap[canonical] = map[canonical];
        nextAliases[canonical] = aliases;
    });
    window._rosterCanonicalAliases = nextAliases;
    window._profileBackedEmployeeNames = new Set(Object.keys(filteredMap));
    map = filteredMap;

    _employeePositionsCache = map;
    return map;
}

// Resolve display name (e.g. "Kenny") to profile's canonical employee_name (e.g. "klb10012004")
// so mobile app (which uses profile.employee_name) can match tasks.
window.getCanonicalEmployeeName = function(displayOrAssignedName) {
    if (!displayOrAssignedName || !window._displayNameToCanonicalEmployeeName) return displayOrAssignedName;
    const key = (displayOrAssignedName || '').trim();
    if (!key) return displayOrAssignedName;
    const canonical = window._displayNameToCanonicalEmployeeName[key];
    if (canonical) return canonical;
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(window._displayNameToCanonicalEmployeeName)) {
        if ((k || '').toLowerCase() === lowerKey) return v;
    }
    return displayOrAssignedName;
};

window.getEmployeeIdFromName = function(name) {
    if (!name) return null;
    if (window._profileNameToId && window._profileNameToId[name]) return window._profileNameToId[name];
    if (!window._employeeNameToId) return null;
    // exact match
    if (window._employeeNameToId[name]) return window._employeeNameToId[name];
    // case-insensitive match
    const lowerName = name.toLowerCase();
    if (window._profileNameToId) {
        for (const [key, id] of Object.entries(window._profileNameToId)) {
            if (key.toLowerCase() === lowerName) return id;
        }
    }
    for (const [key, id] of Object.entries(window._employeeNameToId)) {
        if (key.toLowerCase() === lowerName) return id;
    }
    return null;
};

window.getEmployeeNameFromId = function(id) {
    if (!id) return null;
    if (window._employeeIdToCanonicalName && window._employeeIdToCanonicalName[id]) {
        return window._employeeIdToCanonicalName[id];
    }
    if (!window._employeeNameToId) return null;
    for (const [key, val] of Object.entries(window._employeeNameToId)) {
        if (val === id) return key;
    }
    return null;
};

async function saveEmployeePositionsToSupabase(data) {
    if (!window.supabaseClient || !window.ORG_ID || !data) return;
    for (const [employeeName, positions] of Object.entries(data)) {
        await window.supabaseClient.from('employee_positions').upsert(
            { org_id: window.ORG_ID, employee_name: employeeName, positions: positions || [], updated_at: new Date().toISOString() },
            { onConflict: 'org_id,employee_name' }
        );
    }
}

let _employeePositionsCache = null;
let _managerFlagsByName = {};
let _employeeSortOrder = 'asc'; // 'asc' = least to greatest, 'desc' = greatest to least
let _employeeDisplayByName = {};

function isEmailLike(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());
}

function prettifyEmployeeKey(value) {
    const raw = (value || '').trim();
    if (!raw) return '';
    const local = isEmailLike(raw) ? raw.split('@')[0] : raw;
    const parts = local
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    return parts
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function deriveEmployeeLabel(profile, fallbackName) {
    const display = (profile?.display_name || '').trim();
    const full = (profile?.full_name || '').trim();
    const employee = (profile?.employee_name || fallbackName || '').trim();
    const email = (profile?.email || '').trim();

    if (display && !isEmailLike(display)) return display;
    if (full && !isEmailLike(full)) return full;
    if (display && isEmailLike(display)) return prettifyEmployeeKey(display);
    if (employee && isEmailLike(employee)) return prettifyEmployeeKey(employee);
    if (email) return prettifyEmployeeKey(email);
    return display || full || prettifyEmployeeKey(employee) || employee || fallbackName;
}

/** Collapse spacing/hyphen/underscore variants (e.g. "Kenneth Bae" vs "Kenneth-bae"). */
function normalizeRosterNameForDedupe(name) {
    return String(name || '')
        .trim()
        .toLowerCase()
        .replace(/[\s\-_.]+/g, '');
}

function profileForEmployeeKey(key, dedupedProfiles) {
    const k = (key || '').trim();
    return (dedupedProfiles || []).find((p) => (p.employee_name || '').trim() === k) || null;
}

/**
 * Merge roster map keys that normalize to the same person. Does not merge when two keys map to
 * different profile user_ids (true distinct accounts with similar names).
 */
function mergeDuplicateRosterMap(map, dedupedProfiles) {
    const normalize = normalizeRosterNameForDedupe;
    const keys = Object.keys(map || {});
    const groups = new Map();
    keys.forEach((k) => {
        const norm = normalize(k);
        if (!norm) return;
        if (!groups.has(norm)) groups.set(norm, []);
        groups.get(norm).push(k);
    });

    const merged = {};
    window._rosterCanonicalAliases = {};

    function scoreKey(k) {
        let s = 0;
        const prof = profileForEmployeeKey(k, dedupedProfiles);
        if (prof) s += 200;
        const pos = map[k] || [];
        if (pos.length) s += 50 + pos.length * 5;
        if (/[a-z]\s+[a-z]/i.test(k)) s += 18;
        if (/[-_]/.test(k)) s -= 8;
        s += Math.min((k || '').length, 48) * 0.05;
        return s;
    }

    groups.forEach((variants, norm) => {
        if (variants.length === 1) {
            const c = variants[0];
            merged[c] = map[c];
            window._rosterCanonicalAliases[c] = [c];
            return;
        }
        const userIds = new Set();
        variants.forEach((k) => {
            const p = profileForEmployeeKey(k, dedupedProfiles);
            if (p?.user_id) userIds.add(p.user_id);
        });
        if (userIds.size > 1) {
            variants.forEach((v) => {
                merged[v] = map[v];
                window._rosterCanonicalAliases[v] = [v];
            });
            return;
        }
        const sorted = variants.slice().sort((a, b) => scoreKey(b) - scoreKey(a));
        const canonical = sorted[0];
        const posDedup = new Map();
        sorted.forEach((v) => {
            (map[v] || []).forEach((p) => {
                const label = typeof p === 'string' ? p.trim() : String(p?.name || '').trim();
                const lk = label.toLowerCase();
                if (lk && !posDedup.has(lk)) posDedup.set(lk, p);
            });
        });
        merged[canonical] = [...posDedup.values()];

        let bestProfile = null;
        sorted.forEach((k) => {
            const p = profileForEmployeeKey(k, dedupedProfiles);
            if (p) bestProfile = p;
        });
        if (bestProfile) {
            _employeeDisplayByName[canonical] = deriveEmployeeLabel(bestProfile, canonical);
        } else {
            _employeeDisplayByName[canonical] = _employeeDisplayByName[canonical] || prettifyEmployeeKey(canonical);
        }
        sorted.forEach((v) => {
            if (v !== canonical) {
                _employeeDisplayByName[v] = _employeeDisplayByName[canonical];
            }
            window._displayNameToCanonicalEmployeeName[v] = canonical;
        });
        window._displayNameToCanonicalEmployeeName[canonical] = canonical;

        const pid =
            window._profileNameToId[canonical] ||
            window._employeeNameToId[canonical] ||
            sorted.map((k) => window._profileNameToId[k] || window._employeeNameToId[k]).find(Boolean);
        sorted.forEach((v) => {
            if (pid) {
                window._profileNameToId[v] = pid;
                window._employeeNameToId[v] = pid;
            }
        });

        window._rosterCanonicalAliases[canonical] = sorted.slice();
    });

    return merged;
}

function getEmployeeDisplayName(employeeName) {
    return _employeeDisplayByName[employeeName] || prettifyEmployeeKey(employeeName) || employeeName;
}

window.getEmployeeDisplayName = getEmployeeDisplayName;

function loadEmployeePositions() {
    return _employeePositionsCache;
}

function saveEmployeePositions(data) {
    _employeePositionsCache = data;
    if (window.supabaseClient && window.ORG_ID && data) {
        saveEmployeePositionsToSupabase(data);
    }
}

function startOfWeekMonday(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0=Sun, 1=Mon, ...
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    return d;
}

function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
}

function ymd(date) {
    return new Date(date).toISOString().split('T')[0];
}

function hoursBetweenTimes(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const parse = (t) => {
        const parts = String(t).split(':');
        const h = parseInt(parts[0] || '0', 10);
        const m = parseInt(parts[1] || '0', 10);
        return h * 60 + m;
    };
    let startMin = parse(startTime);
    let endMin = parse(endTime);
    if (Number.isNaN(startMin) || Number.isNaN(endMin)) return 0;
    if (endMin < startMin) endMin += 24 * 60; // overnight
    return Math.max(0, (endMin - startMin) / 60);
}

function isNowWithinShift(nowMinutes, startTime, endTime) {
    const toMin = (t) => {
        const parts = String(t || '').split(':');
        const h = parseInt(parts[0] || '0', 10);
        const m = parseInt(parts[1] || '0', 10);
        if (Number.isNaN(h) || Number.isNaN(m)) return null;
        return h * 60 + m;
    };
    const startMin = toMin(startTime);
    const endMin = toMin(endTime);
    if (startMin == null || endMin == null) return false;
    if (endMin < startMin) {
        // Overnight shift: on shift if now >= start OR now < end
        return nowMinutes >= startMin || nowMinutes < endMin;
    }
    return nowMinutes >= startMin && nowMinutes < endMin;
}

async function loadOnShiftSetFromSupabase(dateYmd) {
    if (!window.supabaseClient || !window.ORG_ID) return new Set();
    const { data, error } = await window.supabaseClient
        .from('shifts')
        .select('employee_name, start_time, end_time')
        .eq('org_id', window.ORG_ID)
        .eq('shift_date', dateYmd);
    if (error) {
        console.warn('[Supabase] Shifts load failed:', error.message);
        return new Set();
    }

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const set = new Set();
    (data || []).forEach(s => {
        const name = (s.employee_name || '').trim();
        if (!name) return;
        if (isNowWithinShift(nowMinutes, s.start_time, s.end_time)) {
            set.add(name);
        }
    });
    return set;
}

async function loadWeeklyHoursFromSupabase(weekStartYmd, weekEndYmd) {
    if (!window.supabaseClient || !window.ORG_ID) return {};
    const { data, error } = await window.supabaseClient
        .from('shifts')
        .select('employee_name, shift_date, start_time, end_time')
        .eq('org_id', window.ORG_ID)
        .gte('shift_date', weekStartYmd)
        .lte('shift_date', weekEndYmd);
    if (error) {
        console.warn('[Supabase] Shifts load failed:', error.message);
        return {};
    }
    const map = {};
    (data || []).forEach(s => {
        const name = (s.employee_name || '').trim();
        if (!name) return;
        map[name] = (map[name] || 0) + hoursBetweenTimes(s.start_time, s.end_time);
    });
    return map;
}

async function renderEmployeesWithHours() {
    const list = document.querySelector('.employees-card .shift-list');
    if (!list) return;

    const posData = getEmployeePositions();
    const employeeNames = Object.keys(posData || {});

    // If there are no Supabase-backed employees, show an explicit empty state.
    if (!employeeNames.length) {
        list.innerHTML = `
            <div style="padding:14px;color:#718096;font-size:0.95rem;">
                No employees found in Supabase for this restaurant.
            </div>
        `;
        return;
    }

    const weekStart = startOfWeekMonday(new Date());
    const weekEnd = addDays(weekStart, 6);
    const weekStartStr = ymd(weekStart);
    const weekEndStr = ymd(weekEnd);

    const hoursMap = await loadWeeklyHoursFromSupabase(weekStartStr, weekEndStr);
    const todayStr = ymd(new Date());
    const onShiftSet = await loadOnShiftSetFromSupabase(todayStr);

    const rosterAliases = (canonical) =>
        (window._rosterCanonicalAliases && window._rosterCanonicalAliases[canonical]) || [canonical];

    const rows = employeeNames.map(name => {
        const aliases = rosterAliases(name);
        const hours = aliases.reduce((sum, a) => sum + (hoursMap[a] || 0), 0);
        const onShift = aliases.some((a) => onShiftSet.has(a));
        return {
            name,
            hours,
            positions: posData[name] || [],
            onShift,
        };
    });

    // Sort by hours worked, honoring the current sort order
    rows.sort((a, b) => {
        if (a.hours !== b.hours) {
            return _employeeSortOrder === 'desc'
                ? b.hours - a.hours
                : a.hours - b.hours;
        }
        // Tie-breaker: alphabetical by name
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    list.innerHTML = rows.map(r => {
        const displayName = getEmployeeDisplayName(r.name);
        const avatarLetter = displayName.charAt(0).toUpperCase();
        const hrs = (Math.round((r.hours || 0) * 10) / 10).toFixed(1);
        const statusClass = r.onShift ? 'online' : 'offline';
        const statusText = r.onShift ? 'On shift' : 'Off';
        return `
            <div class="shift-item" data-employee-name="${escapeEmployeesHtml(r.name)}">
                <div class="employee-info">
                    <div class="employee-avatar">${avatarLetter}</div>
                    <div class="employee-details">
                        <span class="employee-name">${escapeEmployeesHtml(displayName)}</span>
                        <span class="employee-hours">${hrs} hrs</span>
                        <span class="employee-role" style="display:none;"></span>
                    </div>
                </div>
                <div class="shift-status ${statusClass}">
                    <i class="fas fa-circle"></i>
                    ${statusText}
                </div>
            </div>
        `;
    }).join('');

    // Re-render tags and edit buttons on the rebuilt rows
    updatePositionsFromEmployees();
    injectEditPositionButtons();
}

function getEmployeePositions() {
    return _employeePositionsCache || {};
}

window.addEventListener('supabase-ready', async function () {
    if (!window.supabaseClient || !window.ORG_ID) return;

    // Only load employee roster from Supabase-backed data.
    const fromDb = await loadEmployeePositionsFromSupabase();
    _employeePositionsCache = fromDb || {};

    // Update tags + render dynamic hours / on-shift state
    updatePositionsFromEmployees();
    renderEmployeesWithHours();
});

function getAllPositionNames() {
    return Array.from(document.querySelectorAll('.position-item[data-position]'))
        .map(el => el.dataset.position)
        .filter(Boolean);
}

// ── Employees Page - request actions and create modals ────────────────────────
document.addEventListener('DOMContentLoaded', function() {
    setupEmployeeModals();
    setupEditPositionsModal();
    setupPositionClicks();
    const list = document.querySelector('.employees-card .shift-list');
    if (list) {
        // Hide hardcoded demo rows immediately; render once Supabase is ready.
        list.innerHTML = `
            <div style="padding:14px;color:#a0aec0;font-size:0.9rem;">
                Loading employees from Supabase...
            </div>
        `;
    }
    const sortSelect = document.getElementById('employee-sort-select');
    if (sortSelect) {
        sortSelect.addEventListener('change', function () {
            _employeeSortOrder = this.value === 'desc' ? 'desc' : 'asc';
            // Re-render with new sort order
            renderEmployeesWithHours();
        });
    }
    // If Supabase isn't ready, still render static list; once ready we'll re-render with hours.
    if (typeof setupNotificationBell === 'function') {
        setupNotificationBell();
    }
    if (window.supabaseClient && window.ORG_ID) {
        loadEmployeeShiftRequestsCard();
    }
});

// Store approved drop requests (shared with script.js)
if (typeof approvedDrops === 'undefined') {
    window.approvedDrops = {};
}


function normalizeEmployeesName(value) {
    return String(value || '').trim().toLowerCase();
}

function employeesFormatTimeLabel(t) {
    if (!t) return '';
    const [h, m] = String(t).split(':');
    const hr = parseInt(h, 10);
    if (Number.isNaN(hr)) return String(t);
    return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

async function buildEmployeesProfileDisplayLabelMap() {
    const labelByKey = new Map();
    if (!window.supabaseClient || !window.ORG_ID) return labelByKey;
    const { data: profiles } = await window.supabaseClient
        .from('profiles')
        .select('employee_name, display_name, first_name, last_name')
        .eq('org_id', window.ORG_ID);
    (profiles || []).forEach((p) => {
        const fn = (p.first_name || '').trim();
        const ln = (p.last_name || '').trim();
        const label = [fn, ln].filter(Boolean).join(' ')
            || (p.display_name || '').trim()
            || (p.employee_name || '').trim();
        if (!label) return;
        const emp = normalizeEmployeesName(p.employee_name);
        const display = normalizeEmployeesName(p.display_name);
        const first = normalizeEmployeesName(fn);
        if (emp) labelByKey.set(emp, label);
        if (display) labelByKey.set(display, label);
        if (first && !labelByKey.has(first)) labelByKey.set(first, label);
    });
    return labelByKey;
}

function employeesDisplayLabel(labelMap, rawName) {
    const raw = String(rawName || '').trim();
    if (!raw) return '';
    return labelMap.get(normalizeEmployeesName(raw)) || raw;
}

async function loadEmployeeShiftRequestsCard() {
    const listEl = document.getElementById('employees-notification-list');
    const badgeEl = document.getElementById('employees-requests-badge');
    if (!listEl || !window.supabaseClient || !window.ORG_ID) return;

    listEl.innerHTML = '<div class="notif-empty-state">Loading shift requests...</div>';

    const { data: requests, error } = await window.supabaseClient
        .from('shift_requests')
        .select('*')
        .eq('org_id', window.ORG_ID)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

    if (error) {
        listEl.innerHTML = `<div class="notif-empty-state">Could not load shift requests: ${escapeEmployeesHtml(error.message || 'Unknown error')}</div>`;
        if (badgeEl) badgeEl.style.display = 'none';
        return;
    }

    if (!requests || requests.length === 0) {
        listEl.innerHTML = '<div class="notif-empty-state"><i class="fas fa-check-circle"></i> No pending requests. Manage shift requests on the Scheduling page.</div>';
        if (badgeEl) badgeEl.style.display = 'none';
        return;
    }

    const shiftIds = [...new Set(requests.map(r => r.shift_id).filter(Boolean))];
    let shiftsMap = {};
    if (shiftIds.length > 0) {
        const { data: shifts } = await window.supabaseClient
            .from('shifts')
            .select('id, shift_date, start_time, end_time, position, employee_name')
            .in('id', shiftIds);
        (shifts || []).forEach((s) => { shiftsMap[s.id] = s; });
    }
    const nameMap = await buildEmployeesProfileDisplayLabelMap();

    listEl.innerHTML = requests.map((req) => {
        const shift = shiftsMap[req.shift_id] || {};
        const requester = employeesDisplayLabel(nameMap, req.employee_name) || req.employee_name || 'Unknown';
        const target = employeesDisplayLabel(nameMap, req.target_employee) || req.target_employee || '';
        const typeLabel = req.request_type === 'time_off' ? 'Time Off' : 'Transfer';
        const shiftDate = shift.shift_date
            ? new Date(shift.shift_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : (req.note || 'See note');
        const shiftTime = shift.start_time ? `${employeesFormatTimeLabel(shift.start_time)} – ${employeesFormatTimeLabel(shift.end_time)}` : '';
        return `
            <div class="shift-request-card">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap;gap:8px;max-width:100%;">
                    <div style="min-width:0;">
                        <span style="font-weight:700;font-size:15px;color:#2d3748;">${escapeEmployeesHtml(requester)}</span>
                        <span style="background:${req.request_type === 'time_off' ? '#fff5eb' : '#ebf8ff'};color:${req.request_type === 'time_off' ? '#c05621' : '#2b6cb0'};font-size:12px;font-weight:600;padding:2px 8px;border-radius:20px;margin-left:8px;">${typeLabel}</span>
                    </div>
                </div>
                <div class="shift-request-shift-block" style="background:#f7fafc;border-radius:8px;padding:10px;margin-bottom:10px;font-size:13px;color:#4a5568;">
                    <i class="fas fa-calendar-day" style="color:#4CAF50;margin-right:6px;"></i>
                    <strong>${shiftDate}</strong>${shiftTime ? ' · ' + shiftTime : ''}
                    ${shift.position ? `<span style="margin-left:8px;background:#e8f5e9;color:#276749;padding:1px 7px;border-radius:20px;font-size:11px;font-weight:600;">${escapeEmployeesHtml(shift.position)}</span>` : ''}
                </div>
                ${req.note ? `<p style="font-size:13px;color:#718096;margin:0 0 10px;font-style:italic;max-width:100%;overflow-wrap:anywhere;">"${escapeEmployeesHtml(req.note)}"</p>` : ''}
                ${req.target_employee ? `<p style="font-size:12px;color:#4a6fa5;margin:0 0 10px;max-width:100%;overflow-wrap:anywhere;">Transfer to: <strong>${escapeEmployeesHtml(target)}</strong></p>` : ''}
                <div class="shift-request-actions">
                    <button type="button" onclick="approveEmployeeShiftRequest('${req.id}','${req.shift_id || ''}','${escapeEmployeesHtml(req.employee_name || '')}','${escapeEmployeesHtml(shift.position || '')}','${req.request_type}','${escapeEmployeesHtml(req.target_employee || '')}')"
                        style="background:#4CAF50;color:white;border:none;border-radius:8px;padding:9px;font-weight:700;font-size:13px;cursor:pointer;">
                        <i class="fas fa-check"></i> Approve
                    </button>
                    <button type="button" onclick="denyEmployeeShiftRequest('${req.id}','${escapeEmployeesHtml(req.employee_name || '')}')"
                        style="background:#fff0f0;color:#e53e3e;border:1.5px solid #fed7d7;border-radius:8px;padding:9px;font-weight:700;font-size:13px;cursor:pointer;">
                        <i class="fas fa-times"></i> Deny
                    </button>
                </div>
            </div>
        `;
    }).join('');

    if (badgeEl) {
        badgeEl.textContent = String(requests.length);
        badgeEl.style.display = 'inline-flex';
    }
}

window.denyEmployeeShiftRequest = async function(requestId, employeeName) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const { error } = await window.supabaseClient
        .from('shift_requests')
        .update({ status: 'denied' })
        .eq('id', requestId);
    if (error) {
        showEmployeeToast(`Could not deny request: ${error.message}`, 'error');
        return;
    }
    await loadEmployeeShiftRequestsCard();
    showEmployeeToast(`Denied request for ${escapeEmployeesHtml(getEmployeeDisplayName(employeeName) || employeeName)}.`, 'error');
};

window.approveEmployeeShiftRequest = async function(requestId, shiftId, employeeName, position, requestType, targetEmployee) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        if (requestType === 'transfer' && targetEmployee) {
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
            if (shiftErr) throw shiftErr;
            if (typeof window.transferTasksForShift === 'function') {
                const tr = await window.transferTasksForShift(shiftId, targetEmployee, targetId, {
                    previousEmployeeName,
                    shiftDate,
                });
                if (!tr.ok && tr.error) {
                    console.warn('[Employees] transferTasksForShift:', tr.error);
                }
            }
            const { error: reqErr } = await window.supabaseClient
                .from('shift_requests')
                .update({ status: 'approved' })
                .eq('id', requestId);
            if (reqErr) throw reqErr;
            showEmployeeToast(`Transfer approved — shift reassigned to ${employeesDisplayLabel(await buildEmployeesProfileDisplayLabelMap(), targetEmployee) || targetEmployee}.`, 'success');
        } else {
            if (shiftId) {
                const { error: shiftErr } = await window.supabaseClient
                    .from('shifts')
                    .delete()
                    .eq('id', shiftId);
                if (shiftErr) throw shiftErr;
            }
            const { error: reqErr } = await window.supabaseClient
                .from('shift_requests')
                .update({ status: 'approved' })
                .eq('id', requestId);
            if (reqErr) throw reqErr;
            showEmployeeToast('Time off approved.', 'success');
        }
        await loadEmployeeShiftRequestsCard();
    } catch (e) {
        showEmployeeToast(e?.message || 'Could not approve request.', 'error');
    }
};

// Parse drop request text and store approved dates (same as script.js)
function parseAndStoreDropRequest(text) {
    const dropMatch = text.match(/(\w+)\s+(?:wants|to drop)\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+)(?:\s+to\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d+))?/i);
    if (!dropMatch) return;
    
    const employeeName = dropMatch[1];
    const startDay = parseInt(dropMatch[2]);
    const endDay = dropMatch[3] ? parseInt(dropMatch[3]) : startDay;
    
    const monthMatch = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i);
    if (!monthMatch) return;
    
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const monthIndex = monthNames.findIndex(m => m.toLowerCase() === monthMatch[1].toLowerCase());
    if (monthIndex === -1) return;
    
    const currentYear = new Date().getFullYear();
    const dates = [];
    
    for (let day = startDay; day <= endDay; day++) {
        const date = new Date(currentYear, monthIndex, day);
        dates.push(date.toISOString().split('T')[0]);
    }
    
    if (!window.approvedDrops[employeeName]) {
        window.approvedDrops[employeeName] = [];
    }
    window.approvedDrops[employeeName].push(...dates);
    window.approvedDrops[employeeName] = [...new Set(window.approvedDrops[employeeName])];
}

function updateEmployeesRequestBadge() {
    const requestsCard = document.querySelector('.dashboard-grid .notifications-card');
    if (!requestsCard) return;

    const notificationItems = requestsCard.querySelectorAll('.shift-request-card');
    const count = notificationItems.length;

    const cardBadge = requestsCard.querySelector('.card-badge');
    if (cardBadge) {
        cardBadge.textContent = count === 0 ? 'All Clear' : `${count} New`;
        if (count === 0) cardBadge.style.background = '#4CAF50';
    }

    const navBadge = document.querySelector('.employees-badge, .notification-badge');
    if (navBadge) {
        navBadge.textContent = count;
        navBadge.style.display = count === 0 ? 'none' : '';
    }
}

function showEmployeeToast(message, type) {
    if (typeof showNotificationToast === 'function') {
        showNotificationToast(message, type);
        return;
    }
    const longError = type === 'error' && String(message || '').length > 120;
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px;
        background: ${type === 'error' ? '#e53e3e' : '#4CAF50'};
        color: white; padding: 1rem 1.5rem; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2); z-index: 10000;
        font-weight: 600; max-width: ${longError ? 'min(92vw,520px)' : '320px'};
        line-height: 1.35; white-space: pre-wrap;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), longError ? 12000 : 3000);
}

// --- Create Employee & Create Position modals ---
function setupEmployeeModals() {
    const createEmployeeBtn = document.getElementById('btn-create-employee');
    const createPositionBtn = document.getElementById('btn-create-position');

    const employeeModal = document.getElementById('create-employee-modal');
    const positionModal = document.getElementById('create-position-modal');

    if (createEmployeeBtn && employeeModal) {
        createEmployeeBtn.addEventListener('click', () => {
            buildPositionCheckboxes('employee-position-checkboxes', []);
            openEmployeesModal(employeeModal, 'employee-full-name');
        });
    }
    const createPositionBtnScheduling = document.getElementById('create-position-btn');
    [createPositionBtn, createPositionBtnScheduling].filter(Boolean).forEach((btn) => {
        btn.addEventListener('click', () => openEmployeesModal(positionModal, 'position-name'));
    });

    // Close buttons
    const closeEmployeeBtn = document.getElementById('close-create-employee');
    const cancelEmployeeBtn = document.getElementById('cancel-create-employee');
    const submitEmployeeBtn = document.getElementById('submit-create-employee');

    const closePositionBtn = document.getElementById('close-create-position');
    const cancelPositionBtn = document.getElementById('cancel-create-position');
    const submitPositionBtn = document.getElementById('submit-create-position');

    closeEmployeeBtn?.addEventListener('click', () => closeEmployeesModal(employeeModal));
    cancelEmployeeBtn?.addEventListener('click', () => closeEmployeesModal(employeeModal));
    closePositionBtn?.addEventListener('click', () => closeEmployeesModal(positionModal));
    cancelPositionBtn?.addEventListener('click', () => closeEmployeesModal(positionModal));

    // Position detail modal handlers
    const positionDetailModal = document.getElementById('position-detail-modal');
    const closePositionDetailBtn = document.getElementById('close-position-detail');
    const cancelPositionDetailBtn = document.getElementById('cancel-position-detail');

    closePositionDetailBtn?.addEventListener('click', () => closeEmployeesModal(positionDetailModal));
    cancelPositionDetailBtn?.addEventListener('click', () => closeEmployeesModal(positionDetailModal));

    positionDetailModal?.addEventListener('click', e => {
        if (e.target === positionDetailModal) closeEmployeesModal(positionDetailModal);
    });

    submitEmployeeBtn?.addEventListener('click', handleCreateEmployeeSubmit);
    submitPositionBtn?.addEventListener('click', handleCreatePositionSubmit);

    // Overlay click closes (stopPropagation on inner .modal so backdrop clicks work)
    [employeeModal, positionModal].forEach((modal) => {
        modal?.querySelector('.modal')?.addEventListener('click', (e) => e.stopPropagation());
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) closeEmployeesModal(modal);
        });
    });

    // Escape key closes active modal
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            if (employeeModal?.classList.contains('active')) closeEmployeesModal(employeeModal);
            if (positionModal?.classList.contains('active')) closeEmployeesModal(positionModal);
            if (positionDetailModal?.classList.contains('active')) closeEmployeesModal(positionDetailModal);
        }
    });
}

function openEmployeesModal(modal, focusId) {
    if (!modal) return;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    const focusEl = document.getElementById(focusId);
    if (focusEl) {
        setTimeout(() => focusEl.focus(), 50);
    }
}

function closeEmployeesModal(modal) {
    if (!modal) return;
    modal.classList.remove('active');
    document.body.style.overflow = '';
    
    // Reset form if needed
    if (modal.id === 'create-employee-modal') {
        const nameInput = document.getElementById('employee-full-name');
        const phoneInput = document.getElementById('employee-phone');
        const hourlyRadio = document.querySelector('input[name="employee-compensation-type"][value="hourly"]');
        if (nameInput) nameInput.value = '';
        if (phoneInput) phoneInput.value = '';
        if (hourlyRadio) hourlyRadio.checked = true;
        const posCbs = document.getElementById('employee-position-checkboxes');
        if (posCbs) posCbs.innerHTML = '';
    } else if (modal.id === 'create-position-modal') {
        const nameInput = document.getElementById('position-name');
        const respInput = document.getElementById('position-responsibilities');
        if (nameInput) nameInput.value = '';
        if (respInput) respInput.value = '';
    }
    // Position detail modal doesn't need reset - it's populated dynamically
}

async function handleCreateEmployeeSubmit() {
    const nameInput = document.getElementById('employee-full-name');
    const emailInput = document.getElementById('employee-email');
    const phoneInput = document.getElementById('employee-phone');
    const isManager = !!document.getElementById('employee-is-manager')?.checked;
    const fullName = (nameInput?.value || '').trim();
    const email = (emailInput?.value || '').trim();

    if (!fullName) {
        showEmployeeToast('Please enter the employee\'s full name.', 'error');
        nameInput?.focus();
        return;
    }
    if (!email) {
        showEmployeeToast(
            'Enter an email address to send the invite. Employees are added only after they finish signup.',
            'error'
        );
        emailInput?.focus();
        return;
    }

    // Per-user pricing — no employee cap. Billing scales automatically.
    // (kkCanAddEmployee always returns true now.)

    // Read selected positions from checkboxes (stored in invite URL; applied when they finish signup).
    const selectedPositions = Array.from(
        document.querySelectorAll('#employee-position-checkboxes input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const inviteOk = await inviteEmployeeByEmail(fullName, email, isManager, selectedPositions);
    if (!inviteOk) return;

    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';
    const employeeModal = document.getElementById('create-employee-modal');
    closeEmployeesModal(employeeModal);
    showEmployeeToast(
        `Invite sent to ${email}. They will appear here after they confirm email and set a password.`,
        'success'
    );
}

// Update positions section and employee role tags from stored data
function updatePositionsFromEmployees() {
    const posData = getEmployeePositions();

    // Build position → employees map
    const positionMap = {};
    Object.entries(posData).forEach(([empName, positions]) => {
        (positions || []).forEach(pos => {
            const label = typeof pos === 'string' ? pos.trim() : String(pos?.name || '').trim();
            if (!label) return;
            if (!positionMap[label]) positionMap[label] = [];
            if (!positionMap[label].includes(empName)) positionMap[label].push(empName);
        });
    });

    // Rebuild list from DB + sessionStorage extras only (ignores stale HTML from browser cache).
    const needed = new Set(Object.keys(positionMap));
    getExtraPositionNamesForOrg().forEach((n) => needed.add(n));

    const list = document.querySelector('.positions-list');
    if (list) list.innerHTML = '';

    [...needed].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach((name) => {
        appendPositionCard(name, { animate: false });
    });

    // Update each position card
    let totalPositions = 0;
    document.querySelectorAll('.position-item[data-position]').forEach(positionItem => {
        const positionName = positionItem.dataset.position;
        const employees = positionMap[positionName] || [];
        totalPositions++;

        const countEl = positionItem.querySelector('.position-count');
        let namesEl = positionItem.querySelector('.position-names');
        if (!namesEl) {
            namesEl = document.createElement('span');
            namesEl.className = 'position-names';
            positionItem.querySelector('.position-info')?.appendChild(namesEl);
        }
        if (countEl) {
            countEl.textContent = employees.length === 1 ? '1 employee capable' : `${employees.length} employees capable`;
        }
        const employeeLabels = employees.map(getEmployeeDisplayName);
        namesEl.textContent = employeeLabels.length > 0 ? employeeLabels.join(', ') : '';
        namesEl.style.display = employees.length > 0 ? '' : 'none';
        positionItem.dataset.employees = JSON.stringify(employeeLabels);
    });

    const badge = document.querySelector('.positions-card .card-badge');
    if (badge) badge.textContent = `${totalPositions} Total`;

    // Update role display on every employee row
    document.querySelectorAll('.employees-card .shift-item').forEach(item => {
        const name = (item.dataset.employeeName || item.querySelector('.employee-name')?.textContent || '').trim();
        if (!name) return;
        const positions = posData[name] || [];
        renderEmployeeRoleTags(item, positions);
    });
}

function renderEmployeeRoleTags(shiftItem, positions) {
    // Replace .employee-role span with position tags (or keep span for no-position state)
    let roleEl = shiftItem.querySelector('.employee-role');
    let tagsEl = shiftItem.querySelector('.employee-positions-tags');

    if (positions.length === 0) {
        if (tagsEl) tagsEl.remove();
        if (!roleEl) {
            roleEl = document.createElement('span');
            roleEl.className = 'employee-role';
            shiftItem.querySelector('.employee-details')?.appendChild(roleEl);
        }
        roleEl.textContent = 'No position assigned';
        roleEl.style.display = '';
    } else {
        if (roleEl) roleEl.style.display = 'none';
        if (!tagsEl) {
            tagsEl = document.createElement('div');
            tagsEl.className = 'employee-positions-tags';
            shiftItem.querySelector('.employee-details')?.appendChild(tagsEl);
        }
        tagsEl.innerHTML = positions.map(p =>
            `<span class="emp-pos-tag">${escapeEmployeesHtml(p)}</span>`
        ).join('');
    }
}

// Inject a small "edit positions" button onto every employee row
function injectEditPositionButtons() {
    document.querySelectorAll('.employees-card .shift-item').forEach(item => {
        if (item.querySelector('.btn-edit-positions')) return; // already added
        const name = (item.dataset.employeeName || item.querySelector('.employee-name')?.textContent || '').trim();
        if (!name) return;
        const btn = document.createElement('button');
        btn.className = 'btn-edit-positions';
        btn.title = 'Manage positions';
        btn.innerHTML = '<i class="fas fa-pen"></i>';
        btn.addEventListener('click', e => { e.stopPropagation(); openEditPositionsModal(name); });
        item.appendChild(btn);
    });
}

// ── Position checkbox helpers ──────────────────────────────────────────────────

function buildPositionCheckboxes(containerId, selectedPositions) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const positions = getAllPositionNames();
    if (positions.length === 0) {
        container.innerHTML = '<span class="position-checkboxes-empty">No positions created yet.</span>';
        return;
    }
    container.innerHTML = positions.map(pos => `
        <label class="position-checkbox-label">
            <input type="checkbox" value="${escapeEmployeesHtml(pos)}" ${selectedPositions.includes(pos) ? 'checked' : ''}>
            <span>${escapeEmployeesHtml(pos)}</span>
        </label>
    `).join('');
}

// ── Edit Positions Modal ───────────────────────────────────────────────────────

let editPositionsTarget = null;

function setupEditPositionsModal() {
    const modal = document.getElementById('edit-positions-modal');
    if (!modal) return;

    document.getElementById('close-edit-positions')?.addEventListener('click', closeEditPositionsModal);
    document.getElementById('cancel-edit-positions')?.addEventListener('click', closeEditPositionsModal);
    document.getElementById('submit-edit-positions')?.addEventListener('click', saveEditPositions);
    document.getElementById('delete-edit-employee')?.addEventListener('click', deleteEmployeeFromEditModal);

    modal.addEventListener('click', e => { if (e.target === modal) closeEditPositionsModal(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeEditPositionsModal();
    });
}

function openEditPositionsModal(employeeName) {
    editPositionsTarget = employeeName;
    const posData = getEmployeePositions();
    const current = posData[employeeName] || [];

    document.getElementById('edit-positions-employee-name').textContent = getEmployeeDisplayName(employeeName);
    buildPositionCheckboxes('edit-position-checkboxes', current);

    const managerCbx = document.getElementById('edit-employee-is-manager');
    if (managerCbx) {
        managerCbx.checked = !!_managerFlagsByName[employeeName];
    }

    const modal = document.getElementById('edit-positions-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeEditPositionsModal() {
    document.getElementById('edit-positions-modal')?.classList.remove('active');
    document.body.style.overflow = '';
    editPositionsTarget = null;
}

function saveEditPositions() {
    if (!editPositionsTarget) return;
    const selected = Array.from(
        document.querySelectorAll('#edit-position-checkboxes input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const isManager = !!document.getElementById('edit-employee-is-manager')?.checked;

    const posData = getEmployeePositions();
    posData[editPositionsTarget] = selected;
    saveEmployeePositions(posData);

    _managerFlagsByName[editPositionsTarget] = isManager;
    syncEmployeeManagerAccess(editPositionsTarget, isManager);

    closeEditPositionsModal();
    updatePositionsFromEmployees();
    showEmployeeToast(`Positions updated for ${escapeEmployeesHtml(getEmployeeDisplayName(editPositionsTarget))}.`, 'success');
}

async function deleteEmployeeFromEditModal() {
    if (!editPositionsTarget) return;
    const employeeName = editPositionsTarget;
    const employeeLabel = getEmployeeDisplayName(employeeName);
    const confirmed = window.confirm(`Delete employee "${employeeLabel}"?\n\nThis will permanently remove ALL of their data (shifts, tasks, messages, etc.) and prevent them from logging in.\n\nThis cannot be undone.`);
    if (!confirmed) return;

    const deleteBtn = document.getElementById('delete-edit-employee');
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = '0.7';
        deleteBtn.textContent = 'Deleting…';
    }

    let deleteServerNotice = '';

    try {
        // Clear local/in-memory data
        const posData = getEmployeePositions();
        if (posData && Object.prototype.hasOwnProperty.call(posData, employeeName)) {
            delete posData[employeeName];
            saveEmployeePositions(posData);
        }

        if (window.employeeData && Object.prototype.hasOwnProperty.call(window.employeeData, employeeName)) {
            delete window.employeeData[employeeName];
        }
        if (_managerFlagsByName && Object.prototype.hasOwnProperty.call(_managerFlagsByName, employeeName)) {
            delete _managerFlagsByName[employeeName];
        }
        if (window.EMPLOYEE_IDS && Object.prototype.hasOwnProperty.call(window.EMPLOYEE_IDS, employeeName)) {
            delete window.EMPLOYEE_IDS[employeeName];
        }

        // Remove row immediately in UI.
        const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(employeeName) : employeeName.replace(/"/g, '\\"');
        document.querySelector(`.employees-card .shift-item[data-employee-name="${escaped}"]`)?.remove();

        // Call the Edge Function for full delete (all tables + auth user)
        if (window.supabaseClient && window.ORG_ID) {
            const normalized = employeeName.trim().toLowerCase();

            const { data: profileRows } = await window.supabaseClient
                .from('profiles')
                .select('id, user_id, employee_name')
                .eq('org_id', window.ORG_ID);
            let matchedProfile = (profileRows || []).find(
                (p) => (p.employee_name || '').trim().toLowerCase() === normalized
            );
            if (!matchedProfile) {
                const mapProfileId = window.getEmployeeIdFromName?.(employeeName) || null;
                if (mapProfileId) {
                    matchedProfile = (profileRows || []).find((p) => p.id === mapProfileId) || null;
                }
            }
            const authUserId = matchedProfile?.user_id || null;

            let edgeFunctionWorked = false;

            // Try Edge Function first (handles auth deletion + all tables)
            try {
                const { data: { session } } = await window.supabaseClient.auth.getSession();
                if (session?.access_token) {
                    const resp = await fetch(`${window.SUPABASE_URL}/functions/v1/delete-employee`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session.access_token}`,
                            'apikey': window.SUPABASE_ANON_KEY,
                        },
                        body: JSON.stringify({
                            org_id: window.ORG_ID,
                            employee_name: employeeName,
                            user_id: authUserId,
                        }),
                    });
                    if (resp.ok) {
                        const result = await resp.json();
                        console.log('[Employees] Edge Function deleted:', result.deleted);
                        if (result.auth_skip_reason) {
                            deleteServerNotice = ' ' + result.auth_skip_reason;
                        }
                        edgeFunctionWorked = true;
                    } else {
                        const errBody = await resp.text();
                        console.warn('[Employees] Edge Function failed:', resp.status, errBody);
                    }
                }
            } catch (efErr) {
                console.warn('[Employees] Edge Function not available:', efErr.message);
            }

            // Fallback: client-side cleanup if Edge Function didn't work
            if (!edgeFunctionWorked) {
                console.log('[Employees] Falling back to client-side delete');

                await Promise.all([
                    // Core employee tables
                    window.supabaseClient
                        .from('employee_positions')
                        .delete()
                        .eq('org_id', window.ORG_ID)
                        .ilike('employee_name', employeeName),
                    window.supabaseClient
                        .from('profiles')
                        .delete()
                        .eq('org_id', window.ORG_ID)
                        .ilike('employee_name', employeeName),
                    // Shifts
                    window.supabaseClient
                        .from('shifts')
                        .delete()
                        .eq('org_id', window.ORG_ID)
                        .ilike('employee_name', employeeName),
                    // Shift requests
                    window.supabaseClient
                        .from('shift_requests')
                        .delete()
                        .eq('org_id', window.ORG_ID)
                        .ilike('employee_name', employeeName)
                        .then(() => {})
                        .catch(() => {}),
                    // Notifications
                    window.supabaseClient
                        .from('notifications')
                        .delete()
                        .eq('org_id', window.ORG_ID)
                        .ilike('employee_name', employeeName)
                        .then(() => {})
                        .catch(() => {}),
                    window.supabaseClient
                        .from('tasks')
                        .delete()
                        .eq('org_id', window.ORG_ID)
                        .ilike('employee_name', employeeName)
                        .then(() => {})
                        .catch(() => {}),
                    // org_members / admin_users use auth user id, not profiles.id
                    authUserId
                        ? window.supabaseClient
                            .from('org_members')
                            .delete()
                            .eq('org_id', window.ORG_ID)
                            .eq('user_id', authUserId)
                        : Promise.resolve(),
                    authUserId
                        ? window.supabaseClient
                            .from('admin_users')
                            .delete()
                            .eq('user_id', authUserId)
                        : Promise.resolve(),
                ]);

                if (authUserId) {
                    console.warn(
                        '[Employees] Auth user still exists (cannot delete from browser). Deploy delete-employee Edge Function so login is fully revoked.'
                    );
                }
            }
        }

        closeEditPositionsModal();
        updatePositionsFromEmployees();
        await renderEmployeesWithHours();
        showEmployeeToast(
            `Deleted employee "${escapeEmployeesHtml(employeeLabel)}".` +
                (deleteServerNotice || ' All data removed from this restaurant.'),
            'success'
        );
    } catch (e) {
        console.warn('[Employees] delete employee failed:', e.message);
        showEmployeeToast(e?.message || 'Could not delete employee. Please try again.', 'error');
    } finally {
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = '1';
            deleteBtn.textContent = 'Delete Employee';
        }
    }
}


function handleCreatePositionSubmit() {
    const nameInput = document.getElementById('position-name');
    const respInput = document.getElementById('position-responsibilities');
    const positionName = (nameInput?.value || '').trim();
    const responsibilities = (respInput?.value || '').trim();

    if (!positionName) {
        showEmployeeToast('Please enter a position name.', 'error');
        nameInput?.focus();
        return;
    }

    if (collectAllKnownPositionLabels().has(positionName)) {
        showEmployeeToast('A position with that name already exists.', 'error');
        return;
    }

    positionResponsibilities[positionName] = responsibilities;
    addExtraPositionName(positionName);
    updatePositionsFromEmployees();

    const modal = document.getElementById('create-position-modal');
    closeEmployeesModal(modal);

    if (nameInput) nameInput.value = '';
    if (respInput) respInput.value = '';

    if (typeof window.kkRefreshSchedulingPositionSelects === 'function') {
        void window.kkRefreshSchedulingPositionSelects();
    }

    showEmployeeToast(`Position "${positionName}" created.`, 'success');
}

// Setup position click handlers
function setupPositionClicks() {
    document.querySelectorAll('.position-item').forEach(item => {
        item.addEventListener('click', function() {
            const positionName = this.dataset.position;
            if (positionName) {
                openPositionDetail(positionName);
            }
        });
    });
}

// Open position detail modal
function openPositionDetail(positionName) {
    const modal = document.getElementById('position-detail-modal');
    const titleEl = document.getElementById('position-detail-title');
    const employeesListEl = document.getElementById('position-employees-list');
    const responsibilitiesEl = document.getElementById('position-detail-responsibilities');
    
    if (!modal || !titleEl || !employeesListEl || !responsibilitiesEl) return;

    // Set title
    titleEl.textContent = positionName;

    // Get employees for this position
    const positionItem = document.querySelector(`[data-position="${positionName}"]`);
    let employees = [];
    if (positionItem && positionItem.dataset.employees) {
        try {
            employees = JSON.parse(positionItem.dataset.employees);
        } catch (e) {
            employees = [];
        }
    }

    // Display employees
    if (employees.length > 0) {
        employeesListEl.innerHTML = employees.map(name => `
            <div class="position-employee-item">
                <div class="employee-avatar-small">${name.charAt(0).toUpperCase()}</div>
                <span class="employee-name-small">${escapeEmployeesHtml(name)}</span>
            </div>
        `).join('');
    } else {
        employeesListEl.innerHTML = '<p style="color: #718096; font-style: italic;">No employees assigned to this position</p>';
    }

    // Set responsibilities
    responsibilitiesEl.value = positionResponsibilities[positionName] || '';

    // Store current position name for save
    modal.dataset.currentPosition = positionName;

    // Setup save handler
    const saveBtn = document.getElementById('save-position-detail');
    if (saveBtn) {
        saveBtn.onclick = () => savePositionDetail(positionName);
    }

    // Open modal
    openEmployeesModal(modal, 'position-detail-responsibilities');
}

// Save position detail changes
function savePositionDetail(positionName) {
    const responsibilitiesEl = document.getElementById('position-detail-responsibilities');
    const responsibilities = (responsibilitiesEl?.value || '').trim();

    positionResponsibilities[positionName] = responsibilities;

    const modal = document.getElementById('position-detail-modal');
    closeEmployeesModal(modal);

    showEmployeeToast(`Saved "${positionName}".`, 'success');
}

function escapeEmployeesHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ── Supabase employee sync ────────────────────────────────────────────────────
// Saves a new employee to Supabase org_members (requires the employee to have
// a Supabase auth account already — get their UUID from the Supabase dashboard).
async function addEmployeeToOrg(userId, role, position) {
    if (!window.supabaseClient || !window.ORG_ID) return null;
    const { data, error } = await window.supabaseClient
        .from('org_members')
        .insert({ org_id: window.ORG_ID, user_id: userId, role: role || 'employee', position })
        .select()
        .single();
    if (error) { console.warn('[Supabase] addEmployeeToOrg failed:', error.message); return null; }
    return data;
}
window.addEmployeeToOrg = addEmployeeToOrg;

async function syncEmployeeManagerAccess(employeeName, isManager) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const ids = window.EMPLOYEE_IDS || {};
    const userId = ids[employeeName];
    if (!userId) {
        console.warn('[Admin] No auth user mapped for employee', employeeName, '- cannot sync admin access yet.');
        return;
    }
    try {
        const payload = { user_id: userId, is_admin: !!isManager };
        const { error } = await window.supabaseClient
            .from('admin_users')
            .upsert(payload, { onConflict: 'user_id' });
        if (error) {
            console.warn('[Admin] syncEmployeeManagerAccess failed:', error.message);
        }
    } catch (e) {
        console.warn('[Admin] syncEmployeeManagerAccess error:', e.message);
    }
}

/**
 * Human-readable OTP invite failure (Supabase often returns short messages; SMTP/redirect issues need hints).
 */
function formatInviteEmailFailure(error, redirectTo) {
    const raw =
        (error && (error.message || error.msg || error.error_description)) ||
        (typeof error === 'string' ? error : '') ||
        '';
    const status = (error && (error.status || error.statusCode)) || '';
    const base = [raw.trim(), status ? `(HTTP ${status})` : ''].filter(Boolean).join(' ').trim();
    const text = base || 'Supabase did not return an error message (check Auth logs and browser console).';

    const t = text.toLowerCase();
    const hints = [];
    if (/redirect|invalid.*url|not valid/i.test(text) || t.includes('uri')) {
        hints.push(
            'Authentication → URL Configuration → add Redirect URL: ' +
                `${window.location.origin}/employee-onboard.html (wildcard e.g. https://*.netlify.app/** if supported).`
        );
    }
    if (t.includes('rate') || status === 429) {
        hints.push('Email rate limit: wait a few minutes or increase limits / use custom SMTP in Supabase.');
    }
    if (/smtp|mail sender|535|authentication failed|e-mail address is not verified|domain is not verified/i.test(text)) {
        hints.push(
            'SMTP / sender: use custom SMTP with a verified domain (e.g. Resend) and a matching From address in Supabase.'
        );
    }
    if (t.includes('signup') && (t.includes('disabled') || t.includes('not allowed'))) {
        hints.push('Enable email signups: Authentication → Providers → Email.');
    }

    const userLine = hints.length ? `${text} — ${hints[0]}` : text;
    return { userLine, text, hints, redirectTo };
}

/**
 * Send the same magic-link invite as before (signInWithOtp).
 * Does not use the invite-employee Edge Function — that path depended on JWT + deploy + invite templates
 * and broke email for many setups. Magic links use the standard "Magic link" template + SMTP.
 */
async function inviteEmployeeByEmail(employeeName, email, isManager, positionLabels) {
    if (!window.supabaseClient) {
        console.warn('[Invite] Supabase client not ready; cannot send invite for', employeeName);
        return false;
    }
    const trimmed = (email || '').trim();
    if (!trimmed) return false;

    const params = new URLSearchParams({
        org: window.ORG_ID || '',
        name: employeeName,
        manager: isManager ? '1' : '0',
    });
    const labels = Array.isArray(positionLabels)
        ? positionLabels.map((s) => String(s || '').trim()).filter(Boolean)
        : [];
    if (labels.length) params.set('pos', labels.join('|'));
    const redirectTo = `${window.location.origin}/employee-onboard.html?${params.toString()}`;

    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session?.access_token) {
            showEmployeeToast("You must be logged in to send invites", "error");
            return false;
        }

        const res = await window.fetch(`${window.SUPABASE_URL || 'https://xutxuhypqpxobujxdhfz.supabase.co'}/functions/v1/invite-employee`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`
            },
            body: JSON.stringify({
                email: trimmed,
                employee_name: employeeName,
                is_manager: isManager,
                org_id: window.ORG_ID,
                redirect_to: redirectTo
            })
        });

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errMsg = errBody.error || "Invite failed to send.";
            showEmployeeToast(errMsg, 'error');
            return false;
        }

        return true;
    } catch (e) {
        showEmployeeToast("Unexpected error sending invite.", 'error');
        return false;
    }
}

// When Supabase is ready, load org members and update the EMPLOYEE_IDS map
// so task assignment can look up UUIDs by display name.
window.addEventListener('supabase-ready', async function () {
    if (!window.supabaseClient || !window.ORG_ID) return;

    const { data: members, error } = await window.supabaseClient
        .from('org_members')
        .select('user_id, role, position, profiles(full_name, email)')
        .eq('org_id', window.ORG_ID);

    if (error) { console.warn('[Supabase] Employee load failed:', error.message); return; }
    if (!members?.length) return;

    // Update the global EMPLOYEE_IDS map so scheduling can look up UUIDs by name
    window.EMPLOYEE_IDS = window.EMPLOYEE_IDS || {};
    _managerFlagsByName = _managerFlagsByName || {};

    members.forEach(m => {
        const name = m.profiles?.full_name || m.profiles?.email || m.user_id;
        if (!name) return;
        if (m.role === 'employee' || m.role === 'manager') {
            window.EMPLOYEE_IDS[name] = m.user_id;
        }
        _managerFlagsByName[name] = (m.role === 'manager' || m.role === 'owner');
    });

    console.log('[Supabase] Loaded', members.length, 'org members. EMPLOYEE_IDS:', window.EMPLOYEE_IDS, 'Managers:', _managerFlagsByName);
});
