/**
 * Manager dashboard: this week's Sheek punches (hidden until the org toggle is on).
 */
(function () {
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function weekRange(now) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  function formatTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const h = d.getHours();
    return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  function formatWhen(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `${days[d.getDay()]} ${formatTime(d)}`;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  async function loadManagerPunches() {
    const card = document.getElementById('clock-punches-card');
    const list = document.getElementById('clock-punches-list');
    const empty = document.getElementById('clock-punches-empty');
    const badge = document.getElementById('clock-punches-badge');
    if (!card || !window.supabaseClient || !window.ORG_ID) return;

    const enabled = await fetchEnabled(window.ORG_ID);
    card.style.display = enabled ? '' : 'none';
    if (!enabled) return;

    const { start, end } = weekRange(new Date());
    if (badge) badge.textContent = 'This week';

    const { data, error } = await window.supabaseClient
      .from('time_punches')
      .select('id, employee_name, punch_type, punched_at, scheduled_start, is_early')
      .eq('org_id', window.ORG_ID)
      .gte('punched_at', start.toISOString())
      .lt('punched_at', end.toISOString())
      .order('punched_at', { ascending: false })
      .limit(80);

    if (error) {
      console.warn('[Clock] punches:', error.message);
      if (empty) {
        empty.style.display = 'block';
        empty.textContent = error.message.includes('time_punches')
          ? 'Run supabase-clock-in-out.sql in Supabase to create the punches table.'
          : 'Could not load punches.';
      }
      if (list) list.innerHTML = '';
      return;
    }

    const rows = data || [];
    if (list) list.innerHTML = '';
    if (empty) empty.style.display = rows.length ? 'none' : 'block';
    if (!rows.length) return;

    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'clock-punch-row';
      const type = String(row.punch_type || '').toLowerCase() === 'out' ? 'Out' : 'In';
      const name = (row.employee_name || 'Staff').trim();
      const sched = row.scheduled_start
        ? ` · shift ${formatTime(row.scheduled_start)}`
        : '';
      const early = row.is_early ? '<span class="clock-punch-early">Early</span>' : '';
      item.innerHTML = `
        <div class="clock-punch-who">
          <div class="employee-avatar">${escapeHtml(name.charAt(0).toUpperCase())}</div>
          <div>
            <div class="clock-punch-name">${escapeHtml(name)}</div>
            <div class="clock-punch-meta">${formatWhen(row.punched_at)}${escapeHtml(sched)}</div>
          </div>
        </div>
        <div class="clock-punch-type clock-punch-${type.toLowerCase()}">${type}${early}</div>
      `;
      list.appendChild(item);
    });
  }

  window.kkLoadManagerPunches = loadManagerPunches;

  window.addEventListener('supabase-ready', () => {
    loadManagerPunches();
  });
})();
