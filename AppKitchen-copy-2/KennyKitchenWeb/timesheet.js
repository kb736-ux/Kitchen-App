// Timesheet page — clock settings + weekly punch log (managers/owners).

function escapeHtml(text) {
    const d = document.createElement('div');
    d.textContent = String(text ?? '');
    return d.innerHTML;
}

function getMondayOfWeek(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

let currentWeekStart = getMondayOfWeek(new Date());
/** Last loaded sessions for CSV export. */
let _timesheetSessionsCache = [];

function updateWeekTitle() {
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
}

function setupWeekNavigation() {
    document.getElementById('prev-week')?.addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() - 7);
        updateWeekTitle();
        void loadTimesheetForCurrentWeek({ force: true });
    });
    document.getElementById('next-week')?.addEventListener('click', () => {
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
        updateWeekTitle();
        void loadTimesheetForCurrentWeek({ force: true });
    });
}

function setClockSettingsStatus(text, tone = '') {
    const el = document.getElementById('clock-settings-status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-ok', tone === 'ok');
    el.classList.toggle('is-err', tone === 'err');
}

function applyClockSettingsFormState() {
    const enabledEl = document.getElementById('clock-settings-enabled');
    const card = document.getElementById('clock-settings-card');
    const earlyNo = document.getElementById('clock-early-nolimit');
    const lateNo = document.getElementById('clock-late-nolimit');
    const earlyMin = document.getElementById('clock-early-minutes');
    const lateMin = document.getElementById('clock-late-minutes');
    const enabled = !!(enabledEl && enabledEl.checked);
    if (card) card.classList.toggle('clock-settings-disabled', !enabled);
    if (earlyMin) earlyMin.disabled = !enabled || !!(earlyNo && earlyNo.checked);
    if (lateMin) lateMin.disabled = !enabled || !!(lateNo && lateNo.checked);
}

function readClockLimitFromForm(noLimitId, minutesId, fallbackWhenEnabling) {
    const noLimit = document.getElementById(noLimitId);
    const minutesEl = document.getElementById(minutesId);
    if (noLimit && noLimit.checked) return null;
    const raw = minutesEl ? Number(minutesEl.value) : NaN;
    if (!Number.isFinite(raw) || raw < 0) return fallbackWhenEnabling;
    return Math.min(720, Math.floor(raw));
}

function fillClockSettingsForm({
    enabled,
    earlyLimitMinutes,
    lateLimitMinutes,
    latitude,
    longitude,
    radiusMeters,
    address,
}) {
    const enabledEl = document.getElementById('clock-settings-enabled');
    const earlyNo = document.getElementById('clock-early-nolimit');
    const lateNo = document.getElementById('clock-late-nolimit');
    const earlyMin = document.getElementById('clock-early-minutes');
    const lateMin = document.getElementById('clock-late-minutes');
    const summaryEl = document.getElementById('clock-gps-summary');
    if (enabledEl) enabledEl.checked = !!enabled;
    if (earlyNo) earlyNo.checked = earlyLimitMinutes == null;
    if (lateNo) lateNo.checked = lateLimitMinutes == null;
    if (earlyMin) earlyMin.value = String(earlyLimitMinutes == null ? 10 : earlyLimitMinutes);
    if (lateMin) lateMin.value = String(lateLimitMinutes == null ? 30 : lateLimitMinutes);

    const latOk = latitude != null && Number.isFinite(Number(latitude));
    const lngOk = longitude != null && Number.isFinite(Number(longitude));
    const r =
        radiusMeters == null || !Number.isFinite(Number(radiusMeters))
            ? 150
            : Math.floor(Number(radiusMeters));
    const addr = String(address || '').trim();
    window.__clockAddress = addr;
    window.__clockRadiusMeters = r;
    window.__clockGpsReady = !!(latOk && lngOk);

    const inlineInput = document.getElementById('clock-address-inline-input');
    const inlineRadius = document.getElementById('clock-address-inline-radius');
    if (inlineInput && addr && !inlineInput.dataset.dirty) {
        inlineInput.value = addr;
    }
    if (inlineRadius) inlineRadius.value = String(r);

    if (summaryEl) {
        if (latOk && lngOk) {
            summaryEl.textContent = addr
                ? `Saved: ${addr} · ${r}m clock-in radius`
                : `Address pin saved · ${r}m clock-in radius`;
        } else {
            summaryEl.textContent =
                'No address saved yet — type the restaurant address below, pick a match, then Save address.';
        }
    }
    applyClockSettingsFormState();
}

async function loadClockSettings() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    try {
        let { data, error } = await window.supabaseClient
            .from('orgs')
            .select(
                'clock_in_out_enabled, clock_in_early_limit_minutes, clock_out_late_limit_minutes, clock_latitude, clock_longitude, clock_radius_meters, clock_address'
            )
            .eq('id', window.ORG_ID)
            .maybeSingle();
        if (error && /clock_address/i.test(error.message || '')) {
            ({ data, error } = await window.supabaseClient
                .from('orgs')
                .select(
                    'clock_in_out_enabled, clock_in_early_limit_minutes, clock_out_late_limit_minutes, clock_latitude, clock_longitude, clock_radius_meters'
                )
                .eq('id', window.ORG_ID)
                .maybeSingle());
            if (!error && data) data = { ...data, clock_address: null };
        }
        if (error && /clock_latitude|clock_longitude|clock_radius/i.test(error.message || '')) {
            ({ data, error } = await window.supabaseClient
                .from('orgs')
                .select('clock_in_out_enabled, clock_in_early_limit_minutes, clock_out_late_limit_minutes')
                .eq('id', window.ORG_ID)
                .maybeSingle());
            if (!error) {
                fillClockSettingsForm({
                    enabled: !!data?.clock_in_out_enabled,
                    earlyLimitMinutes:
                        data?.clock_in_early_limit_minutes == null
                            ? null
                            : Number(data.clock_in_early_limit_minutes),
                    lateLimitMinutes:
                        data?.clock_out_late_limit_minutes == null
                            ? null
                            : Number(data.clock_out_late_limit_minutes),
                    latitude: null,
                    longitude: null,
                    radiusMeters: 150,
                    address: '',
                });
                setClockSettingsStatus(
                    'Run supabase/clock-in-out.sql in Supabase to unlock restaurant address for clock-in.',
                    'err'
                );
                return;
            }
        }
        if (error && /clock_in_early_limit|clock_out_late_limit/i.test(error.message || '')) {
            ({ data, error } = await window.supabaseClient
                .from('orgs')
                .select('clock_in_out_enabled')
                .eq('id', window.ORG_ID)
                .maybeSingle());
            if (!error) {
                fillClockSettingsForm({
                    enabled: !!data?.clock_in_out_enabled,
                    earlyLimitMinutes: 10,
                    lateLimitMinutes: null,
                    latitude: null,
                    longitude: null,
                    radiusMeters: 150,
                    address: '',
                });
                setClockSettingsStatus(
                    'Run supabase/clock-in-out.sql in Supabase to unlock early/late minute limits and address.',
                    'err'
                );
                return;
            }
        }
        if (error) {
            setClockSettingsStatus(error.message || 'Could not load clock settings.', 'err');
            return;
        }
        fillClockSettingsForm({
            enabled: !!data?.clock_in_out_enabled,
            earlyLimitMinutes:
                data?.clock_in_early_limit_minutes == null
                    ? null
                    : Number(data.clock_in_early_limit_minutes),
            lateLimitMinutes:
                data?.clock_out_late_limit_minutes == null
                    ? null
                    : Number(data.clock_out_late_limit_minutes),
            latitude: data?.clock_latitude,
            longitude: data?.clock_longitude,
            radiusMeters: data?.clock_radius_meters == null ? 150 : Number(data.clock_radius_meters),
            address: data?.clock_address || '',
        });
        setClockSettingsStatus('');
    } catch (e) {
        setClockSettingsStatus(e?.message || 'Could not load clock settings.', 'err');
    }
}

async function saveRestaurantAddressFromPicker(picked) {
    if (!picked || !window.supabaseClient || !window.ORG_ID) return false;
    const payload = {
        clock_latitude: picked.latitude,
        clock_longitude: picked.longitude,
        clock_radius_meters: picked.radiusMeters,
        clock_address: picked.address,
    };
    let { error } = await window.supabaseClient.from('orgs').update(payload).eq('id', window.ORG_ID);
    if (error && /clock_address/i.test(error.message || '')) {
        const { clock_address, ...withoutAddress } = payload;
        ({ error } = await window.supabaseClient
            .from('orgs')
            .update(withoutAddress)
            .eq('id', window.ORG_ID));
        if (!error) {
            setClockSettingsStatus(
                'Address pin saved. Run supabase/clock-in-out.sql to also store the address text.',
                'ok'
            );
        }
    }
    if (error) {
        setClockSettingsStatus(error.message || 'Could not save address.', 'err');
        return false;
    }
    fillClockSettingsForm({
        enabled: !!document.getElementById('clock-settings-enabled')?.checked,
        earlyLimitMinutes: readClockLimitFromForm('clock-early-nolimit', 'clock-early-minutes', 10),
        lateLimitMinutes: readClockLimitFromForm('clock-late-nolimit', 'clock-late-minutes', null),
        latitude: picked.latitude,
        longitude: picked.longitude,
        radiusMeters: picked.radiusMeters,
        address: picked.address,
    });
    return true;
}

async function promptAndSaveRestaurantAddress() {
    // Prefer the inline Timesheet field if a place is already selected there.
    if (window.__clockInlineSelected) {
        const radiusEl = document.getElementById('clock-address-inline-radius');
        let radiusMeters = Number(radiusEl?.value);
        if (!Number.isFinite(radiusMeters) || radiusMeters < 25) radiusMeters = 150;
        radiusMeters = Math.min(2000, Math.floor(radiusMeters));
        let place = window.__clockInlineSelected;
        try {
            if (typeof window.kkResolveRestaurantPlace === 'function') {
                place = await window.kkResolveRestaurantPlace(place);
            }
        } catch (e) {
            setClockSettingsStatus(e?.message || 'Could not resolve address.', 'err');
            return false;
        }
        const ok = await saveRestaurantAddressFromPicker({
            address: place.label,
            latitude: place.latitude,
            longitude: place.longitude,
            radiusMeters,
        });
        if (ok) {
            window.__clockInlineSelected = null;
            const input = document.getElementById('clock-address-inline-input');
            if (input) {
                input.value = place.label;
                delete input.dataset.dirty;
            }
            setClockSettingsStatus('Restaurant address saved for clock-in.', 'ok');
        }
        return ok;
    }

    if (typeof window.kkPromptRestaurantAddress !== 'function') {
        setClockSettingsStatus('Enter the restaurant address in the field below, then Save address.', 'err');
        document.getElementById('clock-address-inline-input')?.focus();
        return false;
    }
    const picked = await window.kkPromptRestaurantAddress({
        initialAddress: window.__clockAddress || '',
        initialRadius: window.__clockRadiusMeters || 150,
    });
    if (!picked) return false;
    const ok = await saveRestaurantAddressFromPicker(picked);
    if (ok) {
        const input = document.getElementById('clock-address-inline-input');
        if (input) {
            input.value = picked.address;
            delete input.dataset.dirty;
        }
        setClockSettingsStatus('Restaurant address saved for clock-in.', 'ok');
    }
    return ok;
}

function setupInlineAddressPicker() {
    const input = document.getElementById('clock-address-inline-input');
    const list = document.getElementById('clock-address-inline-suggestions');
    const pickedEl = document.getElementById('clock-address-inline-picked');
    const saveBtn = document.getElementById('clock-address-save-btn');
    if (!input || !list || !saveBtn) return;

    let results = [];
    let searchTimer = null;
    window.__clockInlineSelected = null;

    function escapeHtml(text) {
        const d = document.createElement('div');
        d.textContent = String(text ?? '');
        return d.innerHTML;
    }

    function setSelected(place) {
        window.__clockInlineSelected = place || null;
        saveBtn.disabled = !place;
        if (pickedEl) {
            if (place) {
                pickedEl.hidden = false;
                pickedEl.innerHTML = `<strong>Selected:</strong> ${escapeHtml(place.label)}`;
            } else {
                pickedEl.hidden = true;
                pickedEl.textContent = '';
            }
        }
    }

    function renderSuggestions(items) {
        results = items || [];
        if (!results.length) {
            list.hidden = true;
            list.innerHTML = '';
            return;
        }
        list.hidden = false;
        list.innerHTML = results
            .map(
                (item, i) =>
                    `<li><button type="button" data-idx="${i}">${escapeHtml(item.label)}</button></li>`
            )
            .join('');
    }

    input.addEventListener('input', () => {
        input.dataset.dirty = '1';
        setSelected(null);
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const q = input.value || '';
            if (typeof window.kkSearchRestaurantAddresses !== 'function') {
                renderSuggestions([]);
                return;
            }
            try {
                const items = await window.kkSearchRestaurantAddresses(q);
                renderSuggestions(items);
            } catch (e) {
                renderSuggestions([]);
                setClockSettingsStatus(e?.message || 'Address search failed.', 'err');
            }
        }, 320);
    });

    list.addEventListener('click', async (e) => {
        const btn = e.target.closest('button[data-idx]');
        if (!btn) return;
        const item = results[Number(btn.getAttribute('data-idx'))];
        if (!item) return;
        list.hidden = true;
        input.value = item.label;
        try {
            const resolved =
                typeof window.kkResolveRestaurantPlace === 'function'
                    ? await window.kkResolveRestaurantPlace(item)
                    : item;
            input.value = resolved.label;
            setSelected(resolved);
        } catch (err) {
            setSelected(null);
            setClockSettingsStatus(err?.message || 'Could not resolve that place.', 'err');
        }
    });

    saveBtn.addEventListener('click', () => {
        void promptAndSaveRestaurantAddress();
    });
}

async function saveClockSettings() {
    if (!window.supabaseClient || !window.ORG_ID) {
        setClockSettingsStatus('Sign in to save clock settings.', 'err');
        return;
    }
    const enabledEl = document.getElementById('clock-settings-enabled');
    const enabled = !!(enabledEl && enabledEl.checked);
    const earlyLimitMinutes = enabled
        ? readClockLimitFromForm('clock-early-nolimit', 'clock-early-minutes', 10)
        : readClockLimitFromForm('clock-early-nolimit', 'clock-early-minutes', null);
    const lateLimitMinutes = enabled
        ? readClockLimitFromForm('clock-late-nolimit', 'clock-late-minutes', null)
        : readClockLimitFromForm('clock-late-nolimit', 'clock-late-minutes', null);

    if (enabled && !window.__clockGpsReady) {
        if (enabledEl) enabledEl.checked = false;
        applyClockSettingsFormState();
        setClockSettingsStatus(
            'Save a restaurant address below before turning clock in/out on.',
            'err'
        );
        document.getElementById('clock-address-inline-input')?.focus();
        document.getElementById('clock-address-field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    const payload = {
        clock_in_out_enabled: enabled,
        clock_in_early_limit_minutes: earlyLimitMinutes,
        clock_out_late_limit_minutes: lateLimitMinutes,
    };

    setClockSettingsStatus('Saving…');
    const { error } = await window.supabaseClient
        .from('orgs')
        .update(payload)
        .eq('id', window.ORG_ID);
    if (error) {
        const msg = error.message || 'Could not save.';
        if (/clock_in_early_limit|clock_out_late_limit|clock_in_out_enabled/i.test(msg)) {
            setClockSettingsStatus(
                `${msg} Run supabase/clock-in-out.sql in Supabase, then try again.`,
                'err'
            );
        } else {
            setClockSettingsStatus(msg, 'err');
        }
        return;
    }
    setClockSettingsStatus('Saved. Staff will see updates on next Home refresh.', 'ok');
    void loadTimesheetForCurrentWeek({ force: true });
}

function setupClockSettingsControls() {
    const ids = [
        'clock-settings-enabled',
        'clock-early-nolimit',
        'clock-late-nolimit',
        'clock-early-minutes',
        'clock-late-minutes',
    ];
    ids.forEach((id) => {
        document.getElementById(id)?.addEventListener('change', applyClockSettingsFormState);
    });
    // Toggle ON/OFF should persist immediately — managers often flip the switch and leave.
    document.getElementById('clock-settings-enabled')?.addEventListener('change', () => {
        void saveClockSettings();
    });
    document.getElementById('clock-settings-save-btn')?.addEventListener('click', () => {
        void saveClockSettings();
    });
    setupInlineAddressPicker();
}

function timesheetPersonKey(punch) {
    if (punch?.employee_id) return `id:${punch.employee_id}`;
    const n = String(punch?.employee_name || '').trim().toLowerCase();
    if (n) return `name:${n}`;
    if (punch?.user_id) return `user:${punch.user_id}`;
    return 'unknown';
}

function formatTimesheetClock(iso) {
    if (!iso) return '—';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (_) {
        return '—';
    }
}

function formatTimesheetDate(isoOrYmd) {
    if (!isoOrYmd) return '—';
    try {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd)
            ? new Date(isoOrYmd + 'T12:00:00')
            : new Date(isoOrYmd);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } catch (_) {
        return '—';
    }
}

function localYmdFromIso(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function timesheetSessionFromPunches(inPunch, outPunch, label, note, hours = null) {
    const anchor = inPunch || outPunch;
    return {
        employeeLabel: label,
        employeeName: anchor?.employee_name || '',
        employeeId: anchor?.employee_id || null,
        userId: anchor?.user_id || null,
        inId: inPunch?.id || null,
        outId: outPunch?.id || null,
        dateYmd: localYmdFromIso(anchor?.punched_at),
        clockInAt: inPunch?.punched_at || null,
        clockOutAt: outPunch?.punched_at || null,
        hours,
        note: note || '',
    };
}

function buildTimesheetSessions(punches) {
    const byPerson = new Map();
    (punches || []).forEach((p) => {
        const key = timesheetPersonKey(p);
        if (!byPerson.has(key)) byPerson.set(key, []);
        byPerson.get(key).push(p);
    });

    const sessions = [];
    byPerson.forEach((list) => {
        list.sort((a, b) => String(a.punched_at || '').localeCompare(String(b.punched_at || '')));
        let openIn = null;
        list.forEach((p) => {
            const type = String(p.punch_type || '').toLowerCase();
            const label =
                (typeof getEmployeeDisplayName === 'function' && p.employee_name
                    ? getEmployeeDisplayName(p.employee_name)
                    : null) ||
                p.employee_name ||
                'Employee';
            if (type === 'in') {
                if (openIn) {
                    sessions.push(timesheetSessionFromPunches(openIn, null, label, openIn.is_early ? 'Early in · missing out' : 'Missing clock out'));
                }
                openIn = p;
                return;
            }
            if (type === 'break_start' || type === 'break_end') {
                return;
            }
            if (type === 'out') {
                if (openIn) {
                    const startMs = new Date(openIn.punched_at).getTime();
                    const endMs = new Date(p.punched_at).getTime();
                    const hours =
                        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
                            ? Math.round(((endMs - startMs) / 3600000) * 10) / 10
                            : null;
                    sessions.push(timesheetSessionFromPunches(openIn, p, label, openIn.is_early ? 'Early clock in' : '', hours));
                    openIn = null;
                } else {
                    sessions.push(timesheetSessionFromPunches(null, p, label, 'Missing clock in'));
                }
            }
        });
        if (openIn) {
            const label =
                (typeof getEmployeeDisplayName === 'function' && openIn.employee_name
                    ? getEmployeeDisplayName(openIn.employee_name)
                    : null) ||
                openIn.employee_name ||
                'Employee';
            sessions.push(
                timesheetSessionFromPunches(
                    openIn,
                    null,
                    label,
                    openIn.is_early ? 'Early in · still clocked in' : 'Still clocked in'
                )
            );
        }
    });

    sessions.sort((a, b) => {
        const d = String(a.dateYmd || '').localeCompare(String(b.dateYmd || ''));
        if (d !== 0) return d;
        return String(a.clockInAt || a.clockOutAt || '').localeCompare(
            String(b.clockInAt || b.clockOutAt || '')
        );
    });
    return sessions;
}

function renderTimesheetSessions(sessions, emptyMessage) {
    const tbody = document.getElementById('timesheet-table-body');
    if (!tbody) return;
    _timesheetSessionsCache = Array.isArray(sessions) ? sessions.slice() : [];
    if (!sessions.length) {
        tbody.innerHTML = `<tr class="timesheet-empty-row"><td colspan="7">${escapeHtml(
            emptyMessage || 'No clock in/out punches this week.'
        )}</td></tr>`;
        return;
    }
    tbody.innerHTML = sessions
        .map((s, index) => {
            const hours = s.hours == null ? '—' : `${s.hours}`;
            const noteClass = s.clockOutAt && s.clockInAt && !s.note ? '' : 'timesheet-note-warn';
            return `<tr>
                <td>${escapeHtml(s.employeeLabel || 'Employee')}</td>
                <td>${escapeHtml(formatTimesheetDate(s.dateYmd || s.clockInAt || s.clockOutAt))}</td>
                <td>${escapeHtml(formatTimesheetClock(s.clockInAt))}</td>
                <td>${escapeHtml(formatTimesheetClock(s.clockOutAt))}</td>
                <td class="timesheet-hours">${escapeHtml(hours)}</td>
                <td class="${noteClass}">${escapeHtml(s.note || '—')}</td>
                <td class="timesheet-edit-cell">
                    <button type="button" class="timesheet-row-edit" data-edit-session="${index}" aria-label="Edit ${escapeHtml(s.employeeLabel || 'employee')}">
                        <i class="fas fa-pen"></i>
                    </button>
                </td>
            </tr>`;
        })
        .join('');
}

async function loadTimesheetForCurrentWeek(opts = {}) {
    const tbody = document.getElementById('timesheet-table-body');
    if (!tbody) return;
    if (!window.supabaseClient || !window.ORG_ID) {
        renderTimesheetSessions([], 'Sign in to load timesheet.');
        return;
    }

    const monday = new Date(currentWeekStart);
    monday.setHours(0, 0, 0, 0);
    const sundayEnd = new Date(monday);
    sundayEnd.setDate(monday.getDate() + 7);
    const rangeStartIso = monday.toISOString();
    const rangeEndIso = sundayEnd.toISOString();

    if (!opts.force && tbody.dataset.loadedRange === `${rangeStartIso}|${rangeEndIso}`) {
        return;
    }

    tbody.innerHTML =
        '<tr class="timesheet-empty-row"><td colspan="7">Loading timesheet…</td></tr>';

    const { data, error } = await window.supabaseClient
        .from('time_punches')
        .select(
            'id, employee_id, employee_name, user_id, punch_type, punched_at, shift_id, is_early'
        )
        .eq('org_id', window.ORG_ID)
        .gte('punched_at', rangeStartIso)
        .lt('punched_at', rangeEndIso)
        .order('punched_at', { ascending: true });

    if (error) {
        const missing = /relation|does not exist|schema cache|time_punches/i.test(error.message || '');
        renderTimesheetSessions(
            [],
            missing
                ? 'Timesheet needs the time_punches table. Run supabase/clock-in-out.sql in Supabase.'
                : `Could not load punches: ${error.message}`
        );
        return;
    }

    const sessions = buildTimesheetSessions(data || []);
    renderTimesheetSessions(
        sessions,
        (data || []).length
            ? 'No complete sessions this week.'
            : 'No clock in/out punches this week yet.'
    );
    tbody.dataset.loadedRange = `${rangeStartIso}|${rangeEndIso}`;
}

function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

function weekRangeLabelForFile() {
    const start = new Date(currentWeekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const ymd = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${ymd(start)}_to_${ymd(end)}`;
}

function orgNameForExport() {
    try {
        const sel = document.querySelector('#kk-org-switcher select');
        if (sel?.selectedOptions?.[0]?.textContent) return sel.selectedOptions[0].textContent.trim();
        const label = document.querySelector('#kk-org-switcher span');
        if (label?.textContent) return label.textContent.trim();
    } catch (_) {}
    return 'Sheek';
}

function downloadCsv(filename, csvText) {
    // BOM helps Excel open UTF-8 correctly
    const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function isoToLocalTime(iso) {
    if (!iso) return '';
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
    } catch (_) {
        return '';
    }
}

function exportTimesheetDetailCsv() {
    const sessions = _timesheetSessionsCache || [];
    if (!sessions.length) {
        setClockSettingsStatus('Nothing to export for this week.', 'err');
        return;
    }
    const restaurant = orgNameForExport();
    const headers = [
        'Restaurant',
        'Employee',
        'Date',
        'Clock In',
        'Clock Out',
        'Hours',
        'Notes',
        'Clock In ISO',
        'Clock Out ISO',
    ];
    const rows = sessions.map((s) => [
        restaurant,
        s.employeeLabel || 'Employee',
        s.dateYmd || localYmdFromIso(s.clockInAt || s.clockOutAt) || '',
        isoToLocalTime(s.clockInAt),
        isoToLocalTime(s.clockOutAt),
        s.hours == null ? '' : String(s.hours),
        s.note || '',
        s.clockInAt || '',
        s.clockOutAt || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const safeOrg = restaurant.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'Sheek';
    downloadCsv(`timesheet_${safeOrg}_${weekRangeLabelForFile()}.csv`, csv);
    setClockSettingsStatus(`Exported ${sessions.length} row(s) to CSV.`, 'ok');
}

function exportTimesheetTotalsCsv() {
    const sessions = _timesheetSessionsCache || [];
    if (!sessions.length) {
        setClockSettingsStatus('Nothing to export for this week.', 'err');
        return;
    }
    const restaurant = orgNameForExport();
    const byEmp = new Map();
    sessions.forEach((s) => {
        const name = s.employeeLabel || 'Employee';
        if (!byEmp.has(name)) byEmp.set(name, { hours: 0, shifts: 0, incomplete: 0 });
        const row = byEmp.get(name);
        if (s.hours != null && Number.isFinite(Number(s.hours))) {
            row.hours += Number(s.hours);
            row.shifts += 1;
        } else {
            row.incomplete += 1;
        }
    });
    const headers = ['Restaurant', 'Employee', 'Total Hours', 'Complete Shifts', 'Incomplete Punches', 'Week Start', 'Week End'];
    const start = new Date(currentWeekStart);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const ymd = (d) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const weekStart = ymd(start);
    const weekEnd = ymd(end);
    const rows = [...byEmp.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
        .map(([name, agg]) => [
            restaurant,
            name,
            (Math.round(agg.hours * 10) / 10).toFixed(1),
            String(agg.shifts),
            String(agg.incomplete),
            weekStart,
            weekEnd,
        ]);
    const csv = [headers, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
    const safeOrg = restaurant.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'Sheek';
    downloadCsv(`timesheet_totals_${safeOrg}_${weekRangeLabelForFile()}.csv`, csv);
    setClockSettingsStatus(`Exported totals for ${rows.length} employee(s).`, 'ok');
}

function toDatetimeLocalValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
}

async function fetchTimesheetEmployees() {
    if (typeof loadEmployeePositionsFromSupabase === 'function') {
        try {
            await loadEmployeePositionsFromSupabase();
        } catch (_) {}
    }
    const byId = window._employeeIdToCanonicalName || {};
    const authIds = window._employeeIdToAuthUserId || {};
    const display = window._employeeDisplayByName || {};
    const list = Object.entries(byId)
        .map(([id, name]) => ({
            id,
            name,
            userId: authIds[id] || null,
            label: display[name] || name,
        }))
        .filter((row) => row.name);
    if (list.length) {
        list.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
        return list;
    }
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const { data, error } = await window.supabaseClient
        .from('profiles')
        .select('id, user_id, employee_name, display_name')
        .eq('org_id', window.ORG_ID);
    if (error) return [];
    return (data || [])
        .filter((p) => p.id && String(p.employee_name || '').trim())
        .map((p) => ({
            id: p.id,
            name: String(p.employee_name).trim(),
            userId: p.user_id || null,
            label: String(p.display_name || p.employee_name).trim(),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}

function ensureTimesheetEditor() {
    let modal = document.getElementById('timesheet-editor-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'timesheet-editor-modal';
    modal.className = 'timesheet-editor-modal';
    modal.innerHTML = `
        <div class="timesheet-editor-card" role="dialog" aria-modal="true" aria-labelledby="timesheet-editor-title">
            <h3 id="timesheet-editor-title">Edit shift</h3>
            <p class="timesheet-editor-desc" id="timesheet-editor-desc"></p>
            <label class="timesheet-editor-label" for="timesheet-editor-employee">Employee</label>
            <select id="timesheet-editor-employee"></select>
            <label class="timesheet-editor-label" for="timesheet-editor-in">Clock in</label>
            <input id="timesheet-editor-in" type="datetime-local" />
            <label class="timesheet-editor-label" for="timesheet-editor-out">Clock out</label>
            <input id="timesheet-editor-out" type="datetime-local" />
            <p class="timesheet-editor-hint">Leave clock out empty if they are still on the clock.</p>
            <p id="timesheet-editor-error" class="timesheet-editor-error" hidden></p>
            <div class="timesheet-editor-actions">
                <button type="button" class="btn-secondary btn-sm" id="timesheet-editor-cancel">Cancel</button>
                <button type="button" class="btn-primary btn-sm" id="timesheet-editor-save">Save</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function punchIdentity(employee) {
    return {
        org_id: window.ORG_ID,
        employee_id: employee?.id || null,
        employee_name: employee?.name || null,
        user_id: employee?.userId || null,
    };
}

function timesheetWriteError(error) {
    const msg = error?.message || 'Could not save.';
    if (/row-level security|permission|not allowed|42501/i.test(msg)) {
        return `${msg} Run supabase/clock-in-out.sql in Supabase so managers can add and edit punches.`;
    }
    return msg;
}

async function saveTimesheetShift({ session, employee, clockInIso, clockOutIso }) {
    const client = window.supabaseClient;
    const identity = punchIdentity(employee);

    async function insertPunch(punchType, punchedAt) {
        const { error } = await client.from('time_punches').insert({
            ...identity,
            punch_type: punchType,
            punched_at: punchedAt,
            is_early: false,
        });
        if (error) throw error;
    }

    async function updatePunch(id, punchedAt) {
        const { error } = await client
            .from('time_punches')
            .update({ ...identity, punched_at: punchedAt })
            .eq('id', id)
            .eq('org_id', window.ORG_ID);
        if (error) throw error;
    }

    if (!session) {
        await insertPunch('in', clockInIso);
        if (clockOutIso) await insertPunch('out', clockOutIso);
        return;
    }

    if (session.inId) {
        await updatePunch(session.inId, clockInIso);
    } else {
        await insertPunch('in', clockInIso);
    }

    if (session.outId && clockOutIso) {
        await updatePunch(session.outId, clockOutIso);
    } else if (session.outId && !clockOutIso) {
        const { error } = await client
            .from('time_punches')
            .delete()
            .eq('id', session.outId)
            .eq('org_id', window.ORG_ID);
        if (error) throw error;
    } else if (!session.outId && clockOutIso) {
        await insertPunch('out', clockOutIso);
    }
}

async function openTimesheetEditor(session) {
    const modal = ensureTimesheetEditor();
    const title = modal.querySelector('#timesheet-editor-title');
    const desc = modal.querySelector('#timesheet-editor-desc');
    const employeeEl = modal.querySelector('#timesheet-editor-employee');
    const inEl = modal.querySelector('#timesheet-editor-in');
    const outEl = modal.querySelector('#timesheet-editor-out');
    const errEl = modal.querySelector('#timesheet-editor-error');
    const saveBtn = modal.querySelector('#timesheet-editor-save');
    const cancelBtn = modal.querySelector('#timesheet-editor-cancel');
    const adding = !session;

    title.textContent = adding ? 'Add shift' : 'Edit shift';
    desc.textContent = adding
        ? 'Add a clock-in and optional clock-out for an employee.'
        : `Update punches for ${session.employeeLabel || 'this employee'}.`;
    errEl.hidden = true;
    errEl.textContent = '';

    const employees = await fetchTimesheetEmployees();
    const options = employees.slice();
    if (session?.employeeId && !options.some((row) => row.id === session.employeeId)) {
        options.unshift({
            id: session.employeeId,
            name: session.employeeName || session.employeeLabel || 'Employee',
            userId: session.userId || null,
            label: session.employeeLabel || session.employeeName || 'Employee',
        });
    }
    employeeEl.innerHTML = options.length
        ? options
              .map(
                  (row) =>
                      `<option value="${escapeHtml(row.id)}">${escapeHtml(row.label)}</option>`
              )
              .join('')
        : '<option value="">No employees on the roster</option>';
    if (session?.employeeId) employeeEl.value = session.employeeId;
    inEl.value = toDatetimeLocalValue(session?.clockInAt) || toDatetimeLocalValue(new Date().toISOString());
    outEl.value = toDatetimeLocalValue(session?.clockOutAt);

    function close() {
        modal.classList.remove('is-open');
        saveBtn.onclick = null;
        cancelBtn.onclick = null;
    }

    cancelBtn.onclick = close;
    modal.onclick = (e) => {
        if (e.target === modal) close();
    };
    saveBtn.onclick = async () => {
        const clockInIso = fromDatetimeLocalValue(inEl.value);
        const clockOutIso = fromDatetimeLocalValue(outEl.value);
        if (!clockInIso) {
            errEl.hidden = false;
            errEl.textContent = 'Clock in time is required.';
            return;
        }
        if (clockOutIso && new Date(clockOutIso).getTime() < new Date(clockInIso).getTime()) {
            errEl.hidden = false;
            errEl.textContent = 'Clock out must be after clock in.';
            return;
        }
        const employee = options.find((row) => row.id === employeeEl.value);
        if (!employee) {
            errEl.hidden = false;
            errEl.textContent = 'Choose an employee.';
            return;
        }
        saveBtn.disabled = true;
        try {
            await saveTimesheetShift({ session: adding ? null : session, employee, clockInIso, clockOutIso });
            close();
            setClockSettingsStatus(adding ? 'Shift added.' : 'Shift updated.', 'ok');
            await loadTimesheetForCurrentWeek({ force: true });
        } catch (e) {
            errEl.hidden = false;
            errEl.textContent = timesheetWriteError(e);
        } finally {
            saveBtn.disabled = false;
        }
    };

    modal.classList.add('is-open');
}

function initTimesheetPage() {
    updateWeekTitle();
    setupWeekNavigation();
    setupClockSettingsControls();
    document.getElementById('timesheet-refresh-btn')?.addEventListener('click', () => {
        void loadTimesheetForCurrentWeek({ force: true });
    });
    document.getElementById('timesheet-add-shift-btn')?.addEventListener('click', () => {
        void openTimesheetEditor(null);
    });
    document.getElementById('timesheet-table-body')?.addEventListener('click', (event) => {
        const btn = event.target.closest('[data-edit-session]');
        if (!btn) return;
        const index = Number(btn.getAttribute('data-edit-session'));
        const session = _timesheetSessionsCache[index];
        if (!session) return;
        void openTimesheetEditor(session);
    });
    document.getElementById('timesheet-export-btn')?.addEventListener('click', () => {
        exportTimesheetDetailCsv();
    });
    document.getElementById('timesheet-export-totals-btn')?.addEventListener('click', () => {
        exportTimesheetTotalsCsv();
    });

    const boot = async () => {
        if (typeof loadEmployeePositionsFromSupabase === 'function') {
            try {
                await loadEmployeePositionsFromSupabase();
            } catch (_) {}
        }
        await loadClockSettings();
        await loadTimesheetForCurrentWeek({ force: true });
    };

    if (window.supabaseClient && window.ORG_ID) {
        void boot();
    } else {
        window.addEventListener('supabase-ready', () => {
            void boot();
        });
    }
}

document.addEventListener('DOMContentLoaded', initTimesheetPage);
