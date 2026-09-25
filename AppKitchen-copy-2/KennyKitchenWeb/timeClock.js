/**
 * Manager timesheet: clock in/out for the visible week.
 * Hidden until the org clock-in toggle is on.
 * Flags open punches via MissingClockOut (missingClockOut.js).
 */
(function () {
  const LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
  let visibleWeekStart = mondayOf(new Date());
  let currentRows = [];
  let editing = null;
  let uiBound = false;

  function mondayOf(date) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start;
  }

  function weekBounds(start) {
    const weekStart = new Date(start);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    return { weekStart, weekEnd };
  }

  function ymd(date) {
    const d = new Date(date);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function weekLabel(start) {
    const { weekStart, weekEnd } = weekBounds(start);
    const last = new Date(weekEnd.getTime() - 1);
    const api = window.MissingClockOut;
    if (!api) return '';
    const startLabel = api.formatClockDate(weekStart).replace(/^\w+ /, '');
    const endLabel = api.formatClockDate(last).replace(/^\w+ /, '');
    const sameMonth = weekStart.getMonth() === last.getMonth();
    return sameMonth ? `${startLabel} – ${last.getDate()}` : `${startLabel} – ${endLabel}`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toDatetimeLocal(value) {
    if (!value) return '';
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function fetchEnabled(orgId) {
    const { data, error } = await window.supabaseClient
      .from('orgs')
      .select('clock_in_out_enabled')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      console.warn('[Clock] org flag:', error.message);
      return false;
    }
    return !!data?.clock_in_out_enabled;
  }

  function renderRows(rows) {
    const body = document.getElementById('timesheet-body');
    const empty = document.getElementById('clock-punches-empty');
    const warning = document.getElementById('timesheet-flag-warning');
    const scroll = document.querySelector('#clock-punches-card .timesheet-scroll');
    const api = window.MissingClockOut;
    if (!body || !api) return;
    body.innerHTML = '';
    if (scroll) scroll.hidden = rows.length === 0;
    if (empty) empty.style.display = rows.length ? 'none' : 'block';
    const message = api.missingClockOutWarning(rows);
    if (warning) {
      warning.textContent = message;
      warning.hidden = !message;
    }
    rows.forEach((row, index) => {
      const tr = document.createElement('tr');
      tr.className = row.missingClockOut ? 'timesheet-row timesheet-row-missing' : 'timesheet-row';
      const noteClass = row.missingClockOut
        ? 'timesheet-note-missing'
        : (row.open ? 'timesheet-note-open' : '');
      const hours = row.hours == null ? '—' : api.formatExportHours(row.hours);
      const clockOut = row.clockOutLabel || (row.open ? '—' : '');
      tr.innerHTML = `
        <td>${escapeHtml(row.employee)}</td>
        <td>${escapeHtml(row.dateLabel)}</td>
        <td>${escapeHtml(row.clockInLabel || '—')}</td>
        <td>${escapeHtml(clockOut)}</td>
        <td>${escapeHtml(hours)}</td>
        <td class="${noteClass}">${escapeHtml(row.note)}</td>
        <td>
          <button type="button" class="timesheet-edit-btn" data-row="${index}" aria-label="Edit punch for ${escapeHtml(row.employee)}">
            <i class="fas fa-pencil"></i>
          </button>
        </td>
      `;
      body.appendChild(tr);
    });
  }

  function downloadCsv(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function confirmExport() {
    const api = window.MissingClockOut;
    const message = api ? api.missingClockOutWarning(currentRows) : '';
    if (!message) return true;
    return window.confirm(message);
  }

  function exportCsv() {
    const api = window.MissingClockOut;
    if (!api || !confirmExport()) return;
    downloadCsv(`sheek-timesheet-${ymd(visibleWeekStart)}.csv`, api.timesheetCsv(currentRows));
  }

  function exportTotals() {
    const api = window.MissingClockOut;
    if (!api || !confirmExport()) return;
    downloadCsv(`sheek-timesheet-totals-${ymd(visibleWeekStart)}.csv`, api.totalsCsv(currentRows));
  }

  function showEditError(message) {
    const el = document.getElementById('timesheet-edit-error');
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
  }

  function closeEdit() {
    const modal = document.getElementById('timesheet-edit-modal');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
    editing = null;
    showEditError('');
  }

  function openEdit(index) {
    const row = currentRows[index];
    const modal = document.getElementById('timesheet-edit-modal');
    if (!row || !modal) return;
    editing = row;
    const who = document.getElementById('timesheet-edit-who');
    const hint = document.getElementById('timesheet-edit-hint');
    const inEl = document.getElementById('timesheet-edit-in');
    const outEl = document.getElementById('timesheet-edit-out');
    if (who) who.textContent = `${row.employee} · ${row.dateLabel}`;
    if (hint) hint.hidden = !row.missingClockOut;
    if (inEl) {
      inEl.value = row.pair.in ? toDatetimeLocal(row.pair.in.punched_at) : '';
      inEl.required = !!row.pair.in;
    }
    if (outEl) outEl.value = row.pair.out ? toDatetimeLocal(row.pair.out.punched_at) : '';
    showEditError('');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }

  async function saveEdit(event) {
    event.preventDefault();
    if (!editing || !window.supabaseClient) return;
    const inEl = document.getElementById('timesheet-edit-in');
    const outEl = document.getElementById('timesheet-edit-out');
    const saveBtn = document.getElementById('timesheet-edit-save');
    const inValue = inEl ? inEl.value : '';
    const outValue = outEl ? outEl.value : '';
    const inPunch = editing.pair.in;
    const outPunch = editing.pair.out;
    if (inPunch && !inValue) {
      showEditError('Clock in is required.');
      return;
    }
    const inDate = inValue ? new Date(inValue) : null;
    const outDate = outValue ? new Date(outValue) : null;
    if ((inValue && Number.isNaN(inDate.getTime())) || (outValue && Number.isNaN(outDate.getTime()))) {
      showEditError('Enter a valid time.');
      return;
    }
    if (inDate && outDate && outDate.getTime() <= inDate.getTime()) {
      showEditError('Clock out has to be after clock in.');
      return;
    }
    if (saveBtn) saveBtn.disabled = true;
    showEditError('');
    try {
      const client = window.supabaseClient;
      if (inPunch && inDate) {
        const next = inDate.toISOString();
        if (toDatetimeLocal(inPunch.punched_at) !== inValue) {
          const { error } = await client.from('time_punches').update({ punched_at: next }).eq('id', inPunch.id);
          if (error) throw error;
        }
      }
      if (outPunch && outDate) {
        if (toDatetimeLocal(outPunch.punched_at) !== outValue) {
          const { error } = await client.from('time_punches').update({ punched_at: outDate.toISOString() }).eq('id', outPunch.id);
          if (error) throw error;
        }
      } else if (outPunch && !outDate) {
        const { error } = await client.from('time_punches').delete().eq('id', outPunch.id);
        if (error) throw error;
      } else if (!outPunch && outDate && inPunch) {
        const { error } = await client.from('time_punches').insert({
          org_id: inPunch.org_id || window.ORG_ID,
          user_id: inPunch.user_id || null,
          employee_id: inPunch.employee_id || null,
          employee_name: inPunch.employee_name || null,
          punch_type: 'out',
          punched_at: outDate.toISOString(),
          shift_id: inPunch.shift_id || null,
          scheduled_start: inPunch.scheduled_start || null,
          is_early: false,
        });
        if (error) throw error;
      }
      closeEdit();
      await loadManagerPunches();
    } catch (err) {
      const message = err?.message || 'Could not save the punch.';
      const needsPolicy = /row-level security|permission|policy/i.test(message);
      showEditError(needsPolicy
        ? `${message} Re-run supabase-clock-in-out.sql so managers can edit punches.`
        : message);
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function bindUi() {
    if (uiBound) return;
    uiBound = true;
    const prev = document.getElementById('timesheet-prev-week');
    const next = document.getElementById('timesheet-next-week');
    const csv = document.getElementById('timesheet-export-csv');
    const totals = document.getElementById('timesheet-export-totals');
    const body = document.getElementById('timesheet-body');
    const form = document.getElementById('timesheet-edit-form');
    const cancel = document.getElementById('timesheet-edit-cancel');
    const close = document.getElementById('timesheet-edit-close');
    if (prev) {
      prev.addEventListener('click', () => {
        visibleWeekStart.setDate(visibleWeekStart.getDate() - 7);
        loadManagerPunches();
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        visibleWeekStart.setDate(visibleWeekStart.getDate() + 7);
        loadManagerPunches();
      });
    }
    if (csv) csv.addEventListener('click', exportCsv);
    if (totals) totals.addEventListener('click', exportTotals);
    if (body) {
      body.addEventListener('click', (event) => {
        const btn = event.target.closest('.timesheet-edit-btn');
        if (!btn) return;
        openEdit(Number(btn.getAttribute('data-row')));
      });
    }
    if (form) form.addEventListener('submit', saveEdit);
    if (cancel) cancel.addEventListener('click', closeEdit);
    if (close) close.addEventListener('click', closeEdit);
  }

  async function loadManagerPunches() {
    const card = document.getElementById('clock-punches-card');
    const empty = document.getElementById('clock-punches-empty');
    const badge = document.getElementById('clock-punches-badge');
    const api = window.MissingClockOut;
    if (!card || !window.supabaseClient || !window.ORG_ID || !api) return;

    bindUi();
    const enabled = await fetchEnabled(window.ORG_ID);
    card.style.display = enabled ? '' : 'none';
    if (!enabled) return;

    const { weekStart, weekEnd } = weekBounds(visibleWeekStart);
    if (badge) badge.textContent = weekLabel(visibleWeekStart);

    const fetchFrom = new Date(weekStart.getTime() - LOOKBACK_MS);
    // Include clock-outs that land after this week so a closed punch is not shown as still open.
    const fetchTo = new Date(Math.max(weekEnd.getTime(), Date.now()) + 24 * 60 * 60 * 1000);
    const punchQuery = window.supabaseClient
      .from('time_punches')
      .select('id, org_id, user_id, employee_id, employee_name, punch_type, punched_at, shift_id, scheduled_start, is_early')
      .eq('org_id', window.ORG_ID)
      .gte('punched_at', fetchFrom.toISOString())
      .lt('punched_at', fetchTo.toISOString())
      .order('punched_at', { ascending: true })
      .limit(1000);
    let shiftRes = await window.supabaseClient
      .from('shifts')
      .select('id, employee_id, employee_name, shift_date, start_time, end_time')
      .eq('org_id', window.ORG_ID)
      .gte('shift_date', ymd(fetchFrom))
      .lt('shift_date', ymd(weekEnd));
    if (shiftRes.error && /employee_id/i.test(shiftRes.error.message || '')) {
      shiftRes = await window.supabaseClient
        .from('shifts')
        .select('id, employee_name, shift_date, start_time, end_time')
        .eq('org_id', window.ORG_ID)
        .gte('shift_date', ymd(fetchFrom))
        .lt('shift_date', ymd(weekEnd));
    }
    const punchRes = await punchQuery;

    if (punchRes.error) {
      console.warn('[Clock] punches:', punchRes.error.message);
      currentRows = [];
      renderRows([]);
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = punchRes.error.message.includes('time_punches')
          ? 'Run supabase-clock-in-out.sql in Supabase to create the punches table.'
          : 'Could not load punches.';
      }
      return;
    }
    if (shiftRes.error) {
      console.warn('[Clock] shifts:', shiftRes.error.message);
    }

    currentRows = api.buildTimesheetRows({
      punches: punchRes.data || [],
      shifts: shiftRes.error ? [] : (shiftRes.data || []),
      weekStart,
      weekEnd,
      now: new Date(),
    });
    if (empty) empty.textContent = 'No punches this week.';
    renderRows(currentRows);
  }

  window.kkLoadManagerPunches = loadManagerPunches;

  window.addEventListener('supabase-ready', () => {
    loadManagerPunches();
  });
})();
