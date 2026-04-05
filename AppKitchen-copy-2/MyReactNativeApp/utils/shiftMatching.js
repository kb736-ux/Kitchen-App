/** Local calendar date as YYYY-MM-DD (avoid UTC drift from toISOString()). */
export function formatLocalDateYMD(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Match a Supabase shifts row to the logged-in employee.
 * Web scheduler often saves employee_name as a short roster name ("Kenny")
 * while the mobile profile shows full display ("Kenny Bae").
 *
 * Some DB rows store Supabase Auth `user.id` in shifts.employee_id instead of
 * profiles.id — pass authUserId from session when available.
 */
export function shiftRowMatchesEmployee(shiftRow, userEmployeeId, candidateNames, authUserId = null) {
  if (!shiftRow) return false;
  const sid = shiftRow.employee_id;
  if (userEmployeeId && sid != null && String(sid) === String(userEmployeeId)) {
    return true;
  }
  if (authUserId && sid != null && String(sid) === String(authUserId)) {
    return true;
  }
  const raw = (shiftRow.employee_name || '').trim().toLowerCase();
  if (!raw) return false;

  const uniq = [
    ...new Set(
      (candidateNames || [])
        .map((n) => (n || '').trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
  if (uniq.length === 0) return false;

  const rawTokens = raw.split(/\s+/).filter(Boolean);
  const rawFirst = rawTokens[0] || '';

  for (const me of uniq) {
    if (raw === me) return true;
    if (raw.startsWith(`${me} `) || raw.endsWith(` ${me}`) || raw.includes(` ${me} `)) return true;
    if (me.startsWith(`${raw} `) || me.endsWith(` ${raw}`) || me.includes(` ${raw} `)) return true;
    const meTokens = me.split(/\s+/).filter(Boolean);
    if (rawFirst && meTokens[0] && rawFirst === meTokens[0]) return true;
    if (rawTokens.length === 1 && meTokens[0] === raw) return true;
    if (meTokens.length === 1 && rawTokens[0] === me) return true;
  }
  return false;
}
