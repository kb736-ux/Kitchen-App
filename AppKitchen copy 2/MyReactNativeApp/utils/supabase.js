import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// =============================================================
// SUPABASE CONFIG — Kenny Kitchen Mobile
// No login required. RLS is disabled for local MVP development.
//
// FILL IN ORG_ID after you get it from the web console.
// =============================================================

// Must match web (supabase-config.js) — same project
const SUPABASE_URL      = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';

// ── FILL THIS IN ─────────────────────────────────────────────
// Paste the ORG_ID printed in the web browser console here:
export const ORG_ID           = 'f4121c7b-53ed-45b3-9966-57af9b40cb5d';
export const EMPLOYEE_NAME    = 'Dudu';        // Default display name shown in the app
// Restaurant name is loaded from orgs.name in the database (what you set on the web app).
// ─────────────────────────────────────────────────────────────

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});


// Get org ID — uses the hardcoded value above, or falls back to fetching the first org
export async function getOrgId() {
  if (ORG_ID) return ORG_ID;

  const { data, error } = await supabase
    .from('orgs')
    .select('id')
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.warn('[Supabase] Could not load org:', error?.message);
    return null;
  }
  return data.id;
}

// Restaurant name from the web app — reads orgs.name (same as web dashboard).
export async function getRestaurantName(orgId) {
  if (!orgId) return null;
  const { data, error } = await supabase
    .from('orgs')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();
  if (error) {
    console.warn('[Supabase] getRestaurantName failed:', error?.message);
    return null;
  }
  const name = (data?.name || '').trim();
  return name || null;
}
