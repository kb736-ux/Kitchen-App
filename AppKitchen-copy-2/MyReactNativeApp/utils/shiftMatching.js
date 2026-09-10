/**
 * Match roster / shift rows to the logged-in org member.
 *
 * Web Assign Shift historically stored a display label or hyphen-slug
 * (`Kenny Bae`, `Kenny-bae`) while mobile identity uses profile.employee_name
 * (often a username). Compact + alias matching bridges those keys.
 */
export class ShiftMatching {
  /** Local calendar date as YYYY-MM-DD (avoid UTC drift from toISOString()). */
  static formatLocalDateYMD(d) {
    const x = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(x.getTime())) return '';
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * Canonical YYYY-MM-DD for a shifts.shift_date value.
   * DATE columns come back as `YYYY-MM-DD`; timestamptz / ISO strings must not
   * be compared raw against local YMD (calendar cells would never light up).
   */
  static dateKey(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) return ShiftMatching.formatLocalDateYMD(value);
    const s = String(value).trim();
    const isoDate = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoDate) return isoDate[1];
    return ShiftMatching.formatLocalDateYMD(s);
  }

  /**
   * Normalize roster / shift employee_name for comparison.
   * Web may store "Kenny-crocodile" while the profile shows "Kenny Crocodile".
   */
  static normalizeEmployeeName(s) {
    return (s || '')
      .trim()
      .toLowerCase()
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[-_./]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Collapse punctuation so "Kenny-bae", "Kenny Bae", "kenny.bae" compare equal. */
  static compactEmployeeKey(s) {
    return ShiftMatching.normalizeEmployeeName(s).replace(/[^a-z0-9]/g, '');
  }

  static nameTokens(s) {
    return ShiftMatching.normalizeEmployeeName(s).split(/\s+/).filter(Boolean);
  }

  static aliasesFromProfile(profile) {
    if (!profile) return [];
    const first = (profile.first_name || '').trim();
    const last = (profile.last_name || '').trim();
    const combined = [first, last].filter(Boolean).join(' ').trim();
    const emailLocal = String(profile.email || '')
      .split('@')[0]
      .trim();
    return [
      profile.employee_name,
      profile.display_name,
      profile.full_name,
      first,
      last,
      combined,
      emailLocal,
    ]
      .map((n) => (n || '').trim())
      .filter(Boolean);
  }

  /**
   * Name spellings for the logged-in member, using org profiles when present.
   * `identity` is EmployeeContext + optional profileData fields.
   */
  static collectNameCandidates(identity = {}, orgProfiles = []) {
    const employeeId = identity.employeeId || null;
    const authUserId = identity.authUserId || null;
    const authEmail = String(identity.email || '').trim().toLowerCase();

    const fromIdentity = [
      identity.employeeName,
      identity.displayName,
      identity.defaultEmployeeName,
      [identity.firstName, identity.lastName].filter(Boolean).join(' ').trim(),
      identity.firstName,
      identity.lastName,
      authEmail.split('@')[0],
      identity.profileData?.displayName,
      identity.profileData?.employeeNameFromProfile,
      identity.profileData?.firstName,
      identity.profileData?.lastName,
      [identity.profileData?.firstName, identity.profileData?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim(),
    ];

    const mine = (orgProfiles || []).filter((p) => {
      if (!p) return false;
      if (employeeId && p.id && String(p.id) === String(employeeId)) return true;
      if (authUserId && p.user_id && String(p.user_id) === String(authUserId)) return true;
      if (employeeId && p.user_id && String(p.user_id) === String(employeeId)) return true;
      const pEmail = String(p.email || '').trim().toLowerCase();
      if (authEmail && pEmail && pEmail === authEmail) return true;
      return false;
    });

    const fromProfiles = mine.flatMap((p) => ShiftMatching.aliasesFromProfile(p));

    return Array.from(
      new Set([...fromIdentity, ...fromProfiles].map((n) => (n || '').trim()).filter(Boolean))
    );
  }

  static profileIdsForMember(orgProfiles = [], identity = {}) {
    const employeeId = identity.employeeId || null;
    const authUserId = identity.authUserId || null;
    const ids = new Set();
    if (employeeId) ids.add(String(employeeId));
    if (authUserId) ids.add(String(authUserId));
    (orgProfiles || []).forEach((p) => {
      if (!p) return;
      const isMine =
        (employeeId && p.id && String(p.id) === String(employeeId)) ||
        (authUserId && p.user_id && String(p.user_id) === String(authUserId)) ||
        (employeeId && p.user_id && String(p.user_id) === String(employeeId));
      if (isMine && p.id) ids.add(String(p.id));
    });
    return ids;
  }

  static namesLooselyEqual(a, b) {
    const na = ShiftMatching.normalizeEmployeeName(a);
    const nb = ShiftMatching.normalizeEmployeeName(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    if (na.startsWith(`${nb} `) || na.endsWith(` ${nb}`) || na.includes(` ${nb} `)) return true;
    if (nb.startsWith(`${na} `) || nb.endsWith(` ${na}`) || nb.includes(` ${na} `)) return true;

    const aTokens = ShiftMatching.nameTokens(a);
    const bTokens = ShiftMatching.nameTokens(b);
    if (aTokens[0] && bTokens[0] && aTokens[0] === bTokens[0]) return true;
    if (aTokens.length === 1 && bTokens[0] === aTokens[0]) return true;
    if (bTokens.length === 1 && aTokens[0] === bTokens[0]) return true;

    const ca = ShiftMatching.compactEmployeeKey(a);
    const cb = ShiftMatching.compactEmployeeKey(b);
    if (ca && cb && ca.length >= 3 && ca === cb) return true;
    return false;
  }

  /**
   * Match a Supabase shifts row to the logged-in employee.
   * Web scheduler often saves employee_name as a short roster name ("Kenny")
   * while the mobile profile shows full display ("Kenny Bae").
   *
   * Some DB rows store Supabase Auth `user.id` in shifts.employee_id instead of
   * profiles.id — pass authUserId from session when available.
   * `knownProfileIds` covers the org profile UUID when it differs from context.
   */
  static rowMatchesEmployee(
    shiftRow,
    userEmployeeId,
    candidateNames,
    authUserId = null,
    knownProfileIds = null
  ) {
    if (!shiftRow) return false;
    const sid = shiftRow.employee_id;
    if (sid != null) {
      const sidStr = String(sid);
      if (userEmployeeId && sidStr === String(userEmployeeId)) return true;
      if (authUserId && sidStr === String(authUserId)) return true;
      if (knownProfileIds && knownProfileIds.has(sidStr)) return true;
    }

    const raw = shiftRow.employee_name;
    if (!raw) return false;

    const uniq = [
      ...new Set(
        (candidateNames || [])
          .map((n) => (n || '').trim())
          .filter(Boolean)
      ),
    ];
    if (uniq.length === 0) return false;

    for (const me of uniq) {
      if (ShiftMatching.namesLooselyEqual(raw, me)) return true;
    }
    return false;
  }
}

export function formatLocalDateYMD(d) {
  return ShiftMatching.formatLocalDateYMD(d);
}

export function normalizeShiftEmployeeName(s) {
  return ShiftMatching.normalizeEmployeeName(s);
}

export function shiftRowMatchesEmployee(shiftRow, userEmployeeId, candidateNames, authUserId = null) {
  return ShiftMatching.rowMatchesEmployee(shiftRow, userEmployeeId, candidateNames, authUserId);
}
