import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// =============================================================
// SUPABASE CONFIG — Sheek Mobile
// No login required. RLS is disabled for local MVP development.
//
// FILL IN ORG_ID after you get it from the web console.
// =============================================================

// Must match web (supabase-config.js) — same project
const SUPABASE_URL      = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';

// ── Optional manual override (leave blank for multi-restaurant) ──────────────
// For strict multi-tenant behavior, keep this empty and resolve org from auth.
export const ORG_ID           = '';
export const EMPLOYEE_NAME    = '';            // Leave blank: resolve identity from authenticated profile
// ─────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

const SELECTED_ORG_STORAGE_KEY = 'kk_selected_org_id_v1';

let orgIdCache = null;

async function safeQuery(query) {
  try {
    const { data, error } = await query;
    if (error) return null;
    return data ?? null;
  } catch (_) {
    return null;
  }
}

async function safeQueryAll(query) {
  try {
    const { data, error } = await query;
    if (error) return [];
    return Array.isArray(data) ? data : [];
  } catch (_) {
    return [];
  }
}

/**
 * All org IDs the current auth user may access (org_members + profiles).
 */
export async function getAllowedOrgIdsForCurrentUser() {
  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user || null;
  const userId = user?.id || null;
  const userEmail = String(user?.email || '').trim().toLowerCase();

  const ids = new Set();

  if (userId) {
    const omRows = await safeQueryAll(
      supabase.from('org_members').select('org_id').eq('user_id', userId)
    );
    omRows.forEach((r) => {
      if (r?.org_id) ids.add(r.org_id);
    });

    const profRows = await safeQueryAll(
      supabase.from('profiles').select('org_id').eq('user_id', userId)
    );
    profRows.forEach((r) => {
      if (r?.org_id) ids.add(r.org_id);
    });
  }

  if (userEmail) {
    const byEmail = await safeQueryAll(
      supabase.from('profiles').select('org_id').ilike('email', userEmail)
    );
    byEmail.forEach((r) => {
      if (r?.org_id) ids.add(r.org_id);
    });
  }

  return [...ids].sort();
}

/** Clear resolved org cache (e.g. after switching restaurant). */
export function clearOrgIdCache() {
  orgIdCache = null;
}

/**
 * Orgs the user belongs to, with display names from public.orgs.
 */
export async function listOrgsForCurrentUser() {
  const ids = await getAllowedOrgIdsForCurrentUser();
  if (!ids.length) return [];

  const { data: orgRows, error } = await supabase.from('orgs').select('id, name').in('id', ids);
  if (error) {
    console.warn('[Supabase] listOrgsForCurrentUser:', error.message);
    return ids.map((id) => ({ id, name: 'Restaurant' }));
  }

  const nameById = new Map((orgRows || []).map((o) => [o.id, (o.name || '').trim()]));
  return ids.map((id) => ({
    id,
    name: nameById.get(id) || 'Restaurant',
  }));
}

/**
 * Persist chosen org and update cache. Throws if user is not a member.
 */
export async function switchToOrg(orgId) {
  const next = String(orgId || '').trim();
  if (!next) throw new Error('Invalid org');

  const allowed = await getAllowedOrgIdsForCurrentUser();
  if (!allowed.includes(next)) {
    throw new Error('You do not have access to that restaurant.');
  }

  try {
    await AsyncStorage.setItem(SELECTED_ORG_STORAGE_KEY, next);
  } catch (e) {
    console.warn('[Supabase] Could not save selected org:', e?.message);
  }
  orgIdCache = next;
  return next;
}

// Resolve org ID for the current authenticated user (multi-restaurant safe).
export async function getOrgId() {
  if (ORG_ID) return ORG_ID;
  if (orgIdCache) return orgIdCache;

  const { data: authData } = await supabase.auth.getUser();
  const user = authData?.user || null;
  const userId = user?.id || null;
  const userEmail = String(user?.email || '').trim().toLowerCase();

  const allowed = await getAllowedOrgIdsForCurrentUser();

  let resolved = null;

  if (allowed.length > 0) {
    let stored = null;
    try {
      stored = await AsyncStorage.getItem(SELECTED_ORG_STORAGE_KEY);
    } catch (_) {}
    const storedTrim = (stored || '').trim();
    if (storedTrim && allowed.includes(storedTrim)) {
      resolved = storedTrim;
    } else {
      resolved = allowed[0];
      try {
        await AsyncStorage.setItem(SELECTED_ORG_STORAGE_KEY, resolved);
      } catch (_) {}
    }
  }

  // Legacy fallbacks if org_members / profiles returned nothing (older data)
  if (!resolved && userId) {
    const om = await safeQuery(
      supabase
        .from('org_members')
        .select('org_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()
    );
    resolved = om?.org_id || null;
  }

  if (!resolved && userId) {
    const p = await safeQuery(
      supabase
        .from('profiles')
        .select('org_id')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle()
    );
    resolved = p?.org_id || null;
  }

  if (!resolved && userEmail) {
    const p = await safeQuery(
      supabase
        .from('profiles')
        .select('org_id')
        .ilike('email', userEmail)
        .limit(1)
        .maybeSingle()
    );
    resolved = p?.org_id || null;
  }

  if (!resolved) {
    console.warn('[Supabase] Could not resolve org for current user.');
    return null;
  }

  orgIdCache = resolved;
  return resolved;
}
