import { formatLocalDateYMD } from './shiftMatching.js';

export const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const NBSP = '\u00A0';

export function addDaysToYmd(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return formatLocalDateYMD(d);
}

export function addMonthsToYmd(dateStr, months) {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setMonth(d.getMonth() + months);
  return formatLocalDateYMD(d);
}

export function getShiftSeriesInterval(prevDate, nextDate) {
  if (!prevDate || !nextDate) return null;
  if (addDaysToYmd(prevDate, 7) === nextDate) return 'weekly';
  if (addMonthsToYmd(prevDate, 1) === nextDate) return 'monthly';
  return null;
}

export function groupRepeatingShifts(rows) {
  const byPattern = new Map();
  (rows || []).forEach((row) => {
    const key = [
      row.employee_name || '',
      row.position || '',
      row.start_time || '',
      row.end_time || '',
    ].join('|');
    if (!byPattern.has(key)) byPattern.set(key, []);
    byPattern.get(key).push(row);
  });

  const groups = [];
  byPattern.forEach((list) => {
    const sorted = [...list].sort((a, b) => (a.shift_date || '').localeCompare(b.shift_date || ''));
    if (sorted.length === 0) return;

    let run = [sorted[0]];
    let runInterval = null;

    const flush = () => {
      if (run.length === 0) return;
      groups.push({
        shift: run[0],
        shifts: [...run],
        repeatInterval: run.length > 1 ? runInterval : null,
        repeatCount: run.length,
        repeatUntil: run[run.length - 1]?.shift_date || run[0]?.shift_date || '',
      });
    };

    for (let i = 1; i < sorted.length; i += 1) {
      const prev = run[run.length - 1];
      const curr = sorted[i];
      const step = getShiftSeriesInterval(prev.shift_date, curr.shift_date);

      if (run.length === 1) {
        if (step) {
          runInterval = step;
          run.push(curr);
        } else {
          flush();
          run = [curr];
          runInterval = null;
        }
        continue;
      }

      if (step && step === runInterval) {
        run.push(curr);
      } else {
        flush();
        run = [curr];
        runInterval = null;
      }
    }
    flush();
  });

  return groups.sort((a, b) => (a.shift.shift_date || '').localeCompare(b.shift.shift_date || ''));
}

export function isShiftSeries(group) {
  return !!(group?.repeatInterval && group?.repeatCount >= 2);
}

/** Keep "2:00 PM" as one token so Android/Yoga cannot split "2:00" / "PM". */
export function formatShiftTime(timeStr) {
  if (!timeStr) return '';
  const [h, m] = String(timeStr).split(':');
  const hour = parseInt(h, 10);
  if (Number.isNaN(hour)) return String(timeStr);
  const minute = (m || '00').slice(0, 2);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute}${NBSP}${ampm}`;
}

export function formatShiftTimeRange(start, end) {
  const left = formatShiftTime(start);
  const right = formatShiftTime(end);
  if (!left && !right) return '';
  if (!right) return left;
  if (!left) return right;
  return `${left}${NBSP}\u2013${NBSP}${right}`;
}

/** Full weekday + month + day as one non-wrapping line ("Thursday Nov 5"). */
export function formatShiftDate(dateStr, { nowrap = true } = {}) {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const parts = [DAYS_FULL[d.getDay()], SHORT_MONTHS[d.getMonth()], String(d.getDate())];
  return parts.join(nowrap ? NBSP : ' ');
}

export function getRepeatSummary(group) {
  if (!isShiftSeries(group)) return '';
  const unit = group.repeatInterval === 'monthly' ? 'month' : 'week';
  const everyLabel = group.repeatInterval === 'monthly' ? 'monthly' : 'weekly';
  const countLabel = `${group.repeatCount} ${unit}${group.repeatCount === 1 ? '' : 's'}`;
  const until = formatShiftDate(group.repeatUntil, { nowrap: true });
  return `Repeats ${everyLabel} for ${countLabel} until ${until}`;
}

export function shiftRowKey(s) {
  if (!s) return '';
  if (s.id != null) return `id:${s.id}`;
  return `${s.shift_date}|${s.employee_name}|${s.start_time}|${s.end_time}`;
}

export function seriesGroupKey(group) {
  const shift = group?.shift;
  return `${shiftRowKey(shift)}|${group?.repeatUntil || shift?.shift_date || ''}`;
}
