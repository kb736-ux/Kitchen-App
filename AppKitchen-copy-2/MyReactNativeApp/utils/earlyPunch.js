/**
 * Sheek clock in/out — early-punch rule (v1).
 *
 * Block clock-IN before the employee's scheduled shift start for that day.
 * No geofence, no payroll. Used by mobile ClockCard; keep this file side-effect free
 * so Node can unit-test it.
 */

export function parseShiftStart(shiftDate, startTime) {
  if (!shiftDate || !startTime) return null;
  const dateKey = String(shiftDate).trim().match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const timeKey = String(startTime).trim().match(/^(\d{1,2}:\d{2}(?::\d{2})?)/)?.[1];
  if (!dateKey || !timeKey) return null;
  const hhmmss = timeKey.length === 5 ? `${timeKey}:00` : timeKey;
  const d = new Date(`${dateKey}T${hhmmss}`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function formatClockTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function formatClockDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

/** Monday 00:00 local → next Monday 00:00 local (current week, matches Home week strip). */
export function currentWeekRange(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0m';
  const totalMin = Math.round(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours <= 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Pair consecutive in/out punches into timesheet rows.
 * An unmatched trailing IN is still open.
 */
export function pairPunches(punches = []) {
  const sorted = [...punches].sort((a, b) => {
    const ta = new Date(a.punched_at).getTime();
    const tb = new Date(b.punched_at).getTime();
    return ta - tb;
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

export function latestOpenPunch(punches = []) {
  const pairs = pairPunches(punches);
  const last = pairs[pairs.length - 1];
  if (last?.in && !last.out) return last.in;
  return null;
}

/**
 * Clock-IN decision.
 * @param {{ now?: Date, scheduledStart?: Date|null, graceMs?: number }} opts
 */
export function evaluateClockIn({ now = new Date(), scheduledStart = null, graceMs = 0 } = {}) {
  if (!scheduledStart) {
    return {
      allowed: true,
      isEarly: false,
      reason: 'no_schedule',
      message: '',
    };
  }
  const start = scheduledStart instanceof Date ? scheduledStart : new Date(scheduledStart);
  if (Number.isNaN(start.getTime())) {
    return {
      allowed: true,
      isEarly: false,
      reason: 'no_schedule',
      message: '',
    };
  }
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  if (nowMs + (Number(graceMs) || 0) < start.getTime()) {
    return {
      allowed: false,
      isEarly: true,
      reason: 'before_shift_start',
      scheduledStart: start,
      message: `Too early to clock in. Your shift starts at ${formatClockTime(start)}.`,
    };
  }
  return {
    allowed: true,
    isEarly: false,
    reason: 'on_time',
    scheduledStart: start,
    message: '',
  };
}

export function evaluateClockOut({ openPunch = null } = {}) {
  if (!openPunch) {
    return {
      allowed: false,
      reason: 'not_clocked_in',
      message: 'You are not clocked in.',
    };
  }
  return { allowed: true, reason: 'clocked_in', message: '' };
}
