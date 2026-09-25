/**
 * Flag open punches that ran past the scheduled shift (or 12h with no shift).
 * Pure: no DOM, no network. Browser sets window.MissingClockOut; Node can require().
 *
 * Missing clock-out: still open more than 30 minutes after that day's shift end.
 * No shift that day: still open more than 12 hours.
 * A normal in-progress punch stays "Still clocked in".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) root.MissingClockOut = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const SHIFT_END_GRACE_MS = 30 * 60 * 1000;
  const NO_SHIFT_OPEN_MS = 12 * 60 * 60 * 1000;
  const NOTE_MISSING = 'Missing clock-out';
  const NOTE_OPEN = 'Still clocked in';

  function normName(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function parseLocalDateTime(dateValue, timeValue) {
    if (!dateValue || !timeValue) return null;
    const dateKey = String(dateValue).trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    const timeKey = String(timeValue).trim().match(/^(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
    if (!dateKey || !timeKey) return null;
    const hhmmss = timeKey.length === 5 ? `${timeKey}:00` : timeKey;
    const d = new Date(`${dateKey}T${hhmmss}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function formatClockTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const h = d.getHours();
    return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  function formatClockDate(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
  }

  function localDateKey(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** End instant for a shift row. Overnight (end <= start) lands on the next calendar day. */
  function shiftEndDate(shift) {
    if (!shift) return null;
    const dateKey = String(shift.shift_date || '').slice(0, 10);
    const end = parseLocalDateTime(dateKey, shift.end_time);
    if (!end) return null;
    const start = parseLocalDateTime(dateKey, shift.start_time);
    if (start && end.getTime() <= start.getTime()) {
      return new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    return end;
  }

  function sameEmployee(punch, shift) {
    const punchId = punch.employee_id || null;
    const shiftId = shift.employee_id || null;
    if (punchId && shiftId) return punchId === shiftId;
    const a = normName(punch.employee_name);
    const b = normName(shift.employee_name);
    return !!a && a === b;
  }

  function pickShift(punch, candidates) {
    const inMs = new Date(punch.punched_at).getTime();
    let best = null;
    let bestDist = Infinity;
    candidates.forEach((shift) => {
      const end = shiftEndDate(shift);
      if (!end) return;
      const dateKey = String(shift.shift_date || '').slice(0, 10);
      const start = parseLocalDateTime(dateKey, shift.start_time);
      const startMs = start ? start.getTime() : end.getTime();
      const endMs = end.getTime();
      let dist = 0;
      if (inMs < startMs) dist = startMs - inMs;
      else if (inMs > endMs) dist = inMs - endMs;
      if (dist < bestDist) {
        bestDist = dist;
        best = shift;
      }
    });
    return best;
  }

  /**
   * Scheduled shift end for this punch, or null when that employee has no shift that day.
   * Prefers punch.shift_id, then the same-day shift closest to the clock-in.
   */
  function scheduledShiftEnd(punch, shifts) {
    if (!punch) return null;
    const list = Array.isArray(shifts) ? shifts : [];
    if (punch.shift_id) {
      const linked = list.find((shift) => shift.id && shift.id === punch.shift_id);
      if (linked) return shiftEndDate(linked);
    }
    const day = localDateKey(punch.punched_at);
    if (!day) return null;
    const candidates = list.filter((shift) => {
      if (String(shift.shift_date || '').slice(0, 10) !== day) return false;
      return sameEmployee(punch, shift);
    });
    const chosen = pickShift(punch, candidates);
    return chosen ? shiftEndDate(chosen) : null;
  }

  function isMissingClockOut({ punchedAt, now = new Date(), shiftEnd = null } = {}) {
    const inAt = punchedAt instanceof Date ? punchedAt : new Date(punchedAt);
    const nowAt = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(inAt.getTime()) || Number.isNaN(nowAt.getTime())) return false;
    if (nowAt.getTime() < inAt.getTime()) return false;
    if (shiftEnd) {
      const endAt = shiftEnd instanceof Date ? shiftEnd : new Date(shiftEnd);
      if (!Number.isNaN(endAt.getTime())) {
        return nowAt.getTime() > endAt.getTime() + SHIFT_END_GRACE_MS;
      }
    }
    return nowAt.getTime() - inAt.getTime() > NO_SHIFT_OPEN_MS;
  }

  function employeeKey(row) {
    if (row.user_id) return `user:${row.user_id}`;
    if (row.employee_id) return `id:${row.employee_id}`;
    return `name:${normName(row.employee_name) || row.id || ''}`;
  }

  function pairOneEmployee(punches) {
    const sorted = [...punches].sort((a, b) => {
      return new Date(a.punched_at).getTime() - new Date(b.punched_at).getTime();
    });
    const pairs = [];
    let open = null;
    sorted.forEach((row) => {
      const type = String(row.punch_type || '').toLowerCase();
      if (type === 'in') {
        if (open) pairs.push(open);
        open = { in: row, out: null };
        return;
      }
      if (type === 'out') {
        if (open) {
          open.out = row;
          pairs.push(open);
          open = null;
        } else {
          pairs.push({ in: null, out: row });
        }
      }
    });
    if (open) pairs.push(open);
    return pairs;
  }

  function pairPunches(punches) {
    const groups = new Map();
    (punches || []).forEach((row) => {
      const key = employeeKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const pairs = [];
    groups.forEach((rows) => {
      pairOneEmployee(rows).forEach((pair) => pairs.push(pair));
    });
    return pairs;
  }

  function pairOverlapsWeek(pair, weekStart, weekEnd) {
    const startMs = weekStart.getTime();
    const endMs = weekEnd.getTime();
    const inAt = pair.in ? new Date(pair.in.punched_at) : null;
    const outAt = pair.out ? new Date(pair.out.punched_at) : null;
    if (inAt && !Number.isNaN(inAt.getTime())) {
      const closeMs = outAt && !Number.isNaN(outAt.getTime()) ? outAt.getTime() : Infinity;
      return inAt.getTime() < endMs && closeMs > startMs;
    }
    if (outAt && !Number.isNaN(outAt.getTime())) {
      const t = outAt.getTime();
      return t >= startMs && t < endMs;
    }
    return false;
  }

  function closedHours(inAt, outAt) {
    const ms = new Date(outAt).getTime() - new Date(inAt).getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.round((ms / 3600000) * 100) / 100;
  }

  function formatExportHours(hours) {
    if (hours == null || !Number.isFinite(Number(hours))) return '';
    return Number(hours).toFixed(2);
  }

  function csvEscape(value) {
    const s = String(value ?? '');
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function buildTimesheetRows({ punches, shifts, weekStart, weekEnd, now = new Date() } = {}) {
    const start = weekStart instanceof Date ? weekStart : new Date(weekStart);
    const end = weekEnd instanceof Date ? weekEnd : new Date(weekEnd);
    return pairPunches(punches)
      .filter((pair) => pairOverlapsWeek(pair, start, end))
      .map((pair) => {
        const open = !!(pair.in && !pair.out);
        const anchor = pair.in || pair.out;
        const shiftEnd = open ? scheduledShiftEnd(pair.in, shifts) : null;
        const missingClockOut = open && isMissingClockOut({
          punchedAt: pair.in.punched_at,
          now,
          shiftEnd,
        });
        let note = '';
        if (missingClockOut) note = NOTE_MISSING;
        else if (open) note = NOTE_OPEN;
        const hours = pair.in && pair.out
          ? closedHours(pair.in.punched_at, pair.out.punched_at)
          : null;
        return {
          pair,
          employee: (anchor.employee_name || 'Staff').trim() || 'Staff',
          dateLabel: formatClockDate(anchor.punched_at),
          clockInLabel: pair.in ? formatClockTime(pair.in.punched_at) : '',
          clockOutLabel: pair.out ? formatClockTime(pair.out.punched_at) : '',
          hours,
          note,
          open,
          missingClockOut,
          shiftEnd,
        };
      })
      .sort((a, b) => {
        const ta = new Date((a.pair.in || a.pair.out).punched_at).getTime();
        const tb = new Date((b.pair.in || b.pair.out).punched_at).getTime();
        return ta - tb;
      });
  }

  function missingClockOutWarning(rows) {
    const n = (rows || []).filter((row) => row.missingClockOut).length;
    if (!n) return '';
    const noun = n === 1 ? 'punch is' : 'punches are';
    return `Missing clock-out: ${n} ${noun} still open past when they should have ended. Hours for those rows are blank — fix them with the pencil before relying on this export.`;
  }

  function timesheetCsv(rows) {
    const header = ['Employee', 'Date', 'Clock in', 'Clock out', 'Hours', 'Notes', 'Flag'];
    const lines = [header.join(',')];
    (rows || []).forEach((row) => {
      lines.push([
        row.employee,
        row.dateLabel,
        row.clockInLabel,
        row.clockOutLabel,
        formatExportHours(row.hours),
        row.note,
        row.missingClockOut ? NOTE_MISSING : '',
      ].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  function totalsCsv(rows) {
    const byName = new Map();
    (rows || []).forEach((row) => {
      const key = row.employee || 'Staff';
      if (!byName.has(key)) byName.set(key, { hours: 0, hasHours: false, missing: 0 });
      const bucket = byName.get(key);
      if (row.hours != null && Number.isFinite(Number(row.hours))) {
        bucket.hours += Number(row.hours);
        bucket.hasHours = true;
      }
      if (row.missingClockOut) bucket.missing += 1;
    });
    const lines = [['Employee', 'Hours', 'Missing clock-outs'].join(',')];
    [...byName.keys()].sort().forEach((name) => {
      const bucket = byName.get(name);
      lines.push([
        name,
        bucket.hasHours ? formatExportHours(Math.round(bucket.hours * 100) / 100) : '',
        String(bucket.missing),
      ].map(csvEscape).join(','));
    });
    return lines.join('\n');
  }

  return {
    SHIFT_END_GRACE_MS,
    NO_SHIFT_OPEN_MS,
    NOTE_MISSING,
    NOTE_OPEN,
    parseLocalDateTime,
    shiftEndDate,
    scheduledShiftEnd,
    isMissingClockOut,
    pairPunches,
    buildTimesheetRows,
    formatExportHours,
    missingClockOutWarning,
    timesheetCsv,
    totalsCsv,
    formatClockTime,
    formatClockDate,
  };
});
