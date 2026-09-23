/**
 * Query shapes for the Expo shell hot paths (tasks, next shift, chat dot).
 * Kept pure so the filters can be checked without starting Metro.
 */
import { ShiftMatching } from './shiftMatching.js';

/** Columns the Tasks list and Home progress card actually read. */
export const TASK_LIST_COLUMNS =
  'id, text, status, is_urgent, created_at, completed_at, shift_id, employee_id, employee_name';

/** Recent rows for this employee. The shift window trims them again in the UI. */
export const TASK_LIST_LIMIT = 200;

/** Home urgent card. Not derived from an org-wide tasks dump. */
export const URGENT_TASK_COLUMNS =
  'id, text, status, is_urgent, created_at, completed_at, employee_id, employee_name';

export const URGENT_TASK_LIMIT = 20;

/** Columns the Home shift card and clock-in window read. */
export const SHIFT_CARD_COLUMNS =
  'id, shift_date, start_time, end_time, position, employee_name, employee_id';

export const TODAY_SHIFT_LIMIT = 10;
export const UPCOMING_SHIFT_LIMIT = 20;

const MAX_OR_PARTS = 16;

/** Quote a PostgREST `or` value when it contains reserved characters. */
export function postgrestLiteral(value) {
  const s = String(value);
  if (/[,\s.()"\\:*]/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/**
 * Spellings that should hit the same roster row:
 * "Kenny Bae", "kenny bae", and the web hyphen slug "kenny-bae".
 */
export function nameMatchVariants(name) {
  const raw = String(name || '').trim();
  if (!raw) return [];
  const norm = ShiftMatching.normalizeEmployeeName(raw);
  const hyphen = norm.replace(/ /g, '-');
  const variants = [];
  const push = (v) => {
    const t = String(v || '').trim();
    if (!t) return;
    if (variants.some((x) => x.toLowerCase() === t.toLowerCase())) return;
    variants.push(t);
  };
  push(raw);
  push(norm);
  push(hyphen);
  return variants;
}

/**
 * PostgREST `or` filter for this signed-in employee.
 * Ids first, then exact (case-insensitive) name spellings. Empty string means
 * "do not run the query" — never fall back to an org-wide scan.
 */
export function employeeOrFilter(ids, names, extraIdColumns = []) {
  const parts = [];
  const seen = new Set();
  const push = (part, key) => {
    if (parts.length >= MAX_OR_PARTS) return;
    if (!part || seen.has(key)) return;
    seen.add(key);
    parts.push(part);
  };

  const idColumns = ['employee_id', ...(extraIdColumns || [])];
  for (const column of idColumns) {
    for (const id of ids || []) {
      const v = String(id || '').trim();
      if (!v) continue;
      push(`${column}.eq.${postgrestLiteral(v)}`, `${column}:${v}`);
    }
  }

  for (const name of names || []) {
    for (const variant of nameMatchVariants(name)) {
      push(
        `employee_name.ilike.${postgrestLiteral(variant)}`,
        `n:${variant.toLowerCase()}`
      );
    }
  }

  return parts.join(',');
}

export function taskIsCompleted(t) {
  const normalizedStatus = (t?.status || '').toString().trim().toLowerCase();
  if (
    normalizedStatus === 'completed' ||
    normalizedStatus === 'complete' ||
    normalizedStatus === 'done' ||
    normalizedStatus === 'archived' ||
    normalizedStatus === 'cancelled'
  ) {
    return true;
  }
  if (t?.completed === true) return true;
  if (t?.completed_at) return true;
  return false;
}
