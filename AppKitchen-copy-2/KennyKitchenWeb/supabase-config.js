// =============================================================
// SUPABASE CONFIG — Sheek Web (Manager Dashboard)
// =============================================================
// No login required. RLS is disabled for local MVP development.
//
// FIRST RUN ONLY:
//   1. Open index.html in browser
//   2. Open DevTools console (Cmd+Option+I → Console tab)
//   3. Copy the ORG_ID that gets printed
//   4. Paste it into ORG_ID below
// =============================================================

const SUPABASE_URL      = 'https://xutxuhypqpxobujxdhfz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4';

// ── Optional manual override (leave blank for multi-restaurant) ──────────────
const ORG_ID = '';

// Employee display name → Supabase UUID map.
// Get UUIDs from: Supabase Dashboard → Authentication → Users
window.EMPLOYEE_IDS = {
  // 'Kenny': 'uuid-of-kenny-here',
  // 'Rohan': 'uuid-of-rohan-here',
};
// ─────────────────────────────────────────────────────────────

(function () {
  const { createClient } = window.supabase;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  window.supabaseClient = client;
  window.ORG_ID = ORG_ID || localStorage.getItem('kk_org_id') || null;

  async function safeAll(query) {
    try {
      const { data, error } = await query;
      if (error) return [];
      return Array.isArray(data) ? data : [];
    } catch (_) {
      return [];
    }
  }

  /** All org UUIDs the user can access (members + profiles). */
  async function fetchAllowedOrgIds(user) {
    const ids = new Set();
    if (user?.id) {
      const om = await safeAll(
        client.from('org_members').select('org_id').eq('user_id', user.id)
      );
      om.forEach((r) => {
        if (r?.org_id) ids.add(r.org_id);
      });
      const pr = await safeAll(
        client.from('profiles').select('org_id').eq('user_id', user.id)
      );
      pr.forEach((r) => {
        if (r?.org_id) ids.add(r.org_id);
      });
    }
    if (user?.email) {
      const pr2 = await safeAll(
        client.from('profiles').select('org_id').ilike('email', user.email)
      );
      pr2.forEach((r) => {
        if (r?.org_id) ids.add(r.org_id);
      });
    }
    return [...ids].sort();
  }

  async function resolveOrgFromAuth(userOverride = null) {
    const user = userOverride || (await client.auth.getUser()).data?.user || null;
    if (!user?.id && !user?.email) {
      window.ORG_ID = ORG_ID || localStorage.getItem('kk_org_id') || null;
      return window.ORG_ID;
    }

    const allowed = await fetchAllowedOrgIds(user);
    if (!allowed.length) {
      console.warn('[Supabase] No org memberships for current user.');
      return window.ORG_ID || null;
    }

    const stored = localStorage.getItem('kk_org_id');
    let chosen = stored && allowed.includes(stored) ? stored : allowed[0];
    if (!stored || !allowed.includes(stored)) {
      try {
        localStorage.setItem('kk_org_id', chosen);
      } catch (_) {}
    }
    window.ORG_ID = chosen;
    return chosen;
  }

  window.resolveOrgFromAuth = resolveOrgFromAuth;

  window.kkListUserOrgs = async function kkListUserOrgs() {
    const user = (await client.auth.getUser()).data?.user;
    if (!user) return [];
    const ids = await fetchAllowedOrgIds(user);
    if (!ids.length) return [];
    const { data: orgs, error } = await client.from('orgs').select('id, name').in('id', ids);
    if (error) {
      console.warn('[Supabase] kkListUserOrgs:', error.message);
      return ids.map((id) => ({ id, name: 'Restaurant' }));
    }
    const map = new Map((orgs || []).map((o) => [o.id, (o.name || '').trim()]));
    return ids.map((id) => ({
      id,
      name: map.get(id) || 'Restaurant',
    }));
  };

  window.kkSwitchOrg = async function kkSwitchOrg(orgId) {
    const next = String(orgId || '').trim();
    if (!next) return;
    const user = (await client.auth.getUser()).data?.user;
    if (!user) return;
    const allowed = await fetchAllowedOrgIds(user);
    if (!allowed.includes(next)) {
      console.warn('[Supabase] kkSwitchOrg: not a member of org', next);
      return;
    }
    try {
      localStorage.setItem('kk_org_id', next);
    } catch (_) {}
    window.ORG_ID = next;
    window.location.reload();
  };

  async function bootstrap() {
    // Resolve org from authenticated user when possible.
    await resolveOrgFromAuth();

    // Do not auto-seed demo/alias employees — add real staff via Employees UI or Supabase.

    window.dispatchEvent(new Event('supabase-ready'));
    console.log('[Supabase] ✅ Ready! org:', window.ORG_ID);
  }

  bootstrap();
})();
