/** Bounded Expo Home / Tasks list — columns the UI actually renders. */
export const TASK_LIST_COLUMNS =
  'id, text, status, is_urgent, created_at, completed_at, shift_id, employee_id, employee_name';

export const MY_TASKS_LIMIT = 200;
export const HOME_URGENT_LIMIT = 20;

export function taskNameQueryVariants(names) {
  const out = new Set();
  for (const raw of names || []) {
    const t = String(raw || '').trim();
    if (!t) continue;
    out.add(t);
    const spaced = t.replace(/[-_./]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (spaced) out.add(spaced);
    const hyphen = spaced.replace(/\s+/g, '-');
    if (hyphen) out.add(hyphen);
  }
  return Array.from(out);
}

export function escapeOrValue(value) {
  return String(value || '')
    .replace(/[,()]/g, ' ')
    .replace(/"/g, '')
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** PostgREST `or` clause: this employee’s ids + name spellings. Empty = do not query. */
export function mineTasksOrFilter(ids, names) {
  const parts = [];
  for (const id of ids || []) {
    const s = String(id || '').trim();
    if (s) parts.push(`employee_id.eq.${s}`);
  }
  for (const name of taskNameQueryVariants(names)) {
    const safe = escapeOrValue(name);
    if (safe) parts.push(`employee_name.ilike."${safe}"`);
  }
  return parts.join(',');
}
