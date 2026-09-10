// Simple admin-only auth gate for Sheek (web manager dashboard)
// Requires: window.supabaseClient from supabase-config.js

(function () {
  function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function buildInitialAvatarDataUrl(name) {
    const initials = getInitials(name);
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>` +
      `<rect width='100%' height='100%' rx='40' ry='40' fill='${SheekColors.primarySoft}'/>` +
      `<text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='${SheekColors.primary}' font-family='Inter,Arial,sans-serif' font-size='30' font-weight='700'>${initials}</text>` +
      `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function displayFromEmail(email) {
    const local = String(email || '').split('@')[0] || '';
    if (!local) return '';
    return local
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function pickBestProfileRow(rows, fallbackEmail = '') {
    const arr = Array.isArray(rows) ? rows.filter(Boolean) : (rows ? [rows] : []);
    if (!arr.length) return null;
    const local = String(fallbackEmail || '').split('@')[0].trim().toLowerCase();
    const score = (r) => {
      const dn = String(r?.display_name || '').trim();
      const en = String(r?.employee_name || '').trim();
      const avatar = String(r?.avatar_url || '').trim();
      let s = 0;
      if (dn) s += 20;
      if (dn.includes(' ')) s += 35;
      if (avatar) s += 20;
      if (en && en !== local) s += 10;
      if (dn && dn.toLowerCase() !== local) s += 10;
      if (dn && dn.toLowerCase() === local) s -= 25;
      if (en && en.toLowerCase() === local) s -= 10;
      return s;
    };
    return arr.sort((a, b) => score(b) - score(a))[0] || arr[0];
  }

  function createOverlay() {
    let overlay = document.getElementById('auth-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = SheekColors.bg;
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10000';

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '420px';
    card.style.background = SheekColors.surface;
    card.style.borderRadius = '16px';
    card.style.padding = '28px 24px 24px';
    card.style.boxShadow = '0 20px 45px rgba(51, 42, 37, 0.12)';
    card.style.border = `1px solid ${SheekColors.border}`;
    card.style.fontFamily = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
        <img src="assets/logo.png" alt="" width="40" height="40" style="border-radius:10px;background:${SheekColors.bg};">
        <div>
          <div style="font-size:18px;font-weight:700;color:${SheekColors.text};">Sheek</div>
          <div id="auth-subtitle" style="font-size:13px;color:#6b7280;">Manager dashboard</div>
        </div>
      </div>
      <div id="auth-error" style="display:none;margin-bottom:10px;padding:8px 10px;border-radius:8px;font-size:12px;background:#fef2f2;color:#b91c1c;"></div>
      <div id="auth-info" style="display:none;margin-bottom:10px;padding:8px 10px;border-radius:8px;font-size:12px;background:#ecfdf5;color:#047857;"></div>
      <div id="auth-main-flow">
      <div style="display:flex;gap:8px;margin-bottom:16px;background:#f3f4f6;border-radius:12px;padding:4px;">
        <button type="button" id="auth-tab-signin" style="flex:1;border:0;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:600;cursor:pointer;background:#fff;color:#111827;box-shadow:0 1px 2px rgba(0,0,0,0.06);">
          Existing restaurant
        </button>
        <button type="button" id="auth-tab-signup" style="flex:1;border:0;border-radius:10px;padding:8px 10px;font-size:13px;font-weight:600;cursor:pointer;background:transparent;color:#6b7280;">
          New restaurant
        </button>
      </div>
      <div id="auth-panel-signin" style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-email" style="font-size:13px;font-weight:500;color:#374151;">Email</label>
          <input id="auth-email" type="email" autocomplete="email" placeholder="you@restaurant.com"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-password" style="font-size:13px;font-weight:500;color:#374151;">Password</label>
          <input id="auth-password" type="password" autocomplete="current-password" placeholder="••••••••"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <button type="button" id="auth-submit"
          style="margin-top:6px;border:none;border-radius:999px;background:${SheekColors.primary};color:#fff;font-weight:600;font-size:14px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span>Sign in</span>
        </button>
      </div>
      <div id="auth-panel-signup" style="display:none;flex-direction:column;gap:10px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-restaurant-name" style="font-size:13px;font-weight:500;color:#374151;">Restaurant name</label>
          <input id="auth-restaurant-name" type="text" autocomplete="organization" placeholder="e.g. Northside Diner"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;">
          <span style="font-size:13px;font-weight:500;color:#374151;">Pricing</span>
          <div style="padding:10px 12px;border:2px solid #dcfce7;border-radius:10px;background:#f0fdf4;">
            <div style="font-size:13px;font-weight:600;color:#166534;">$3.00/user/mo</div>
            <div style="font-size:11px;color:#6b7280;line-height:1.35;">$2.50/user/mo for 30+ employees. No limits—add as many staff as you need.</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <span style="font-size:13px;font-weight:500;color:#374151;">Your name</span>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;">
              <label for="auth-owner-first" style="font-size:12px;font-weight:500;color:#6b7280;">First name</label>
              <input id="auth-owner-first" type="text" autocomplete="given-name" placeholder="John"
                style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
              />
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:120px;">
              <label for="auth-owner-last" style="font-size:12px;font-weight:500;color:#6b7280;">Last name</label>
              <input id="auth-owner-last" type="text" autocomplete="family-name" placeholder="Doe"
                style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
              />
            </div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-signup-email" style="font-size:13px;font-weight:500;color:#374151;">Email</label>
          <input id="auth-signup-email" type="email" autocomplete="email" placeholder="you@restaurant.com"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-signup-password" style="font-size:13px;font-weight:500;color:#374151;">Password</label>
          <input id="auth-signup-password" type="password" autocomplete="new-password" placeholder="At least 6 characters"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <button type="button" id="auth-signup-submit"
          style="margin-top:6px;border:none;border-radius:999px;background:${SheekColors.primary};color:#fff;font-weight:600;font-size:14px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span>Create restaurant &amp; account</span>
        </button>
        <p style="font-size:11px;color:#9ca3af;margin:0;line-height:1.4;">By continuing you agree to use this account as the manager for this restaurant. Staff use the same restaurant in the mobile app.</p>
      </div>
      </div>
      <div id="auth-unauthorized" style="display:none;margin-top:6px;font-size:12px;color:#374151;background:#fefce8;border-radius:10px;padding:8px 10px;">
        This account can’t open the manager dashboard. Use a manager account, or create a new restaurant.
        <div style="margin-top:10px;">
          <button type="button" id="auth-unauthorized-signout" style="border:1px solid #e5e7eb;border-radius:999px;padding:8px 14px;background:#fff;cursor:pointer;font-size:13px;font-weight:600;color:#374151;">Sign out</button>
        </div>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showError(message) {
    const el = document.getElementById('auth-error');
    const info = document.getElementById('auth-info');
    if (info) {
      info.style.display = 'none';
      info.textContent = '';
    }
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.style.display = 'none';
      return;
    }
    el.textContent = message;
    el.style.display = 'block';
  }

  function showInfo(message) {
    const el = document.getElementById('auth-info');
    const err = document.getElementById('auth-error');
    if (err) {
      err.style.display = 'none';
      err.textContent = '';
    }
    if (!el) return;
    if (!message) {
      el.textContent = '';
      el.style.display = 'none';
      return;
    }
    el.textContent = message;
    el.style.display = 'block';
  }

  function showUnauthorized() {
    const el = document.getElementById('auth-unauthorized');
    const main = document.getElementById('auth-main-flow');
    if (main) main.style.display = 'none';
    if (el) el.style.display = 'block';
  }

  function hideUnauthorizedPanel() {
    const el = document.getElementById('auth-unauthorized');
    const main = document.getElementById('auth-main-flow');
    if (el) el.style.display = 'none';
    if (main) main.style.display = 'block';
  }

  function wireUnauthorizedSignOut() {
    const signOutBtn = document.getElementById('auth-unauthorized-signout');
    if (signOutBtn && !signOutBtn.dataset.kkWired) {
      signOutBtn.dataset.kkWired = '1';
      signOutBtn.onclick = async () => {
        if (window.supabaseClient) await window.supabaseClient.auth.signOut();
        window.location.reload();
      };
    }
  }

  function hideOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function addLogoutButton(profile) {
    try {
      const navUser = document.querySelector('.nav-user');
      if (!navUser) return;
      let btn = navUser.querySelector('#admin-logout-btn');
      if (!btn) {
        btn = document.createElement('button');
        btn.id = 'admin-logout-btn';
        btn.textContent = 'Logout';
        btn.style.marginLeft = '10px';
        btn.style.border = '1px solid #e5e7eb';
        btn.style.borderRadius = '999px';
        btn.style.padding = '6px 10px';
        btn.style.fontSize = '12px';
        btn.style.cursor = 'pointer';
        btn.style.background = '#ffffff';
        btn.onclick = async () => {
          if (!window.supabaseClient) return;
          await window.supabaseClient.auth.signOut();
          window.location.reload();
        };
        navUser.appendChild(btn);
      }

      const label = navUser.querySelector('.user-profile span');
      const resolvedLabel = (profile?.displayName || '').trim() || 'Admin';
      if (label) label.textContent = resolvedLabel;
      const avatar = navUser.querySelector('.user-profile .user-avatar');
      if (avatar) {
        avatar.src = (profile?.avatarUrl || '').trim() || buildInitialAvatarDataUrl(resolvedLabel);
        avatar.onerror = () => {
          avatar.src = buildInitialAvatarDataUrl(resolvedLabel);
        };
      }
    } catch (e) {
      console.warn('[Auth] Could not attach logout button:', e.message);
    }
  }

  async function refreshNavIdentity(user = null) {
    const u = user || window.currentAdminUser;
    if (!u) return;
    await relinkProfileToAuth(u);
    const identity = await getAdminIdentity(u.id, u.email);
    addLogoutButton(identity);
    try { window.kkCurrentAdminIdentity = identity; } catch (_) {}
  }

  async function relinkProfileToAuth(user) {
    if (!window.supabaseClient || !user?.id || !user?.email) return;
    try {
      const { data: rows } = await window.supabaseClient
        .from('profiles')
        .select('id, user_id, email')
        .eq('org_id', window.ORG_ID)
        .ilike('email', user.email)
        .limit(5);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (row?.id && row.user_id !== user.id) {
        await window.supabaseClient
          .from('profiles')
          .update({ user_id: user.id, email: user.email })
          .eq('id', row.id);
      }
    } catch (_) {}
  }

  async function ensureAdmin() {
    if (!window.supabaseClient) {
      console.warn('[Auth] Supabase client not ready');
      return;
    }

    const overlay = createOverlay();

    const { data, error } = await window.supabaseClient.auth.getUser();
    if (error || !data?.user) {
      setupLoginHandlers();
      return;
    }

    const user = data.user;
    await maybeCompletePendingRestaurantSignup(user);

    try {
      const paramsOnboard = new URLSearchParams(window.location.search || '');
      if (paramsOnboard.get('onboard_paid') === '1') {
        await waitForPostCheckoutOrg(user, 32, 1500);
        const u = new URL(window.location.href);
        u.searchParams.delete('onboard_paid');
        u.searchParams.delete('session_id');
        window.history.replaceState({}, '', u.pathname + (u.search ? u.search : '') + u.hash);
      }
    } catch (e) {
      console.warn('[Auth] onboard_paid cleanup:', e?.message);
    }

    const [{ data: adminRow, error: adminError }, { data: mgrRows }] = await Promise.all([
      window.supabaseClient
        .from('admin_users')
        .select('is_admin')
        .eq('user_id', user.id)
        .maybeSingle(),
      window.supabaseClient
        .from('org_members')
        .select('org_id, role')
        .eq('user_id', user.id)
        .in('role', ['manager', 'owner'])
        .limit(5),
    ]);

    const isAdminUser = !!(adminRow && adminRow.is_admin);
    const isOrgManager = Array.isArray(mgrRows) && mgrRows.length > 0;
    window.kkCanManageOrg = false;

    if (adminError) {
      console.warn('[Auth] admin_users lookup failed:', adminError.message);
    }

    if (!isAdminUser && !isOrgManager) {
      overlay.style.display = 'flex';
      wireUnauthorizedSignOut();
      if (adminError && !isOrgManager) {
        showError('Could not verify access. If this keeps happening, check RLS on admin_users and org_members.');
        showUnauthorized();
      } else {
        showUnauthorized();
      }
      return;
    }

    window.currentAdminUser = user;
    window.kkCanManageOrg = true;
    try {
      if (typeof window.resolveOrgFromAuth === 'function') {
        const prevOrg = window.ORG_ID || null;
        const nextOrg = await window.resolveOrgFromAuth(user);
        if (nextOrg && nextOrg !== prevOrg) {
          window.dispatchEvent(new Event('supabase-ready'));
        }
      }
    } catch (e) {
      console.warn('[Auth] Could not resolve org from auth:', e.message);
    }
    try {
      const evt = new CustomEvent('kk-admin-authenticated', { detail: { user } });
      window.dispatchEvent(evt);
    } catch (e) {
      console.warn('[Auth] Could not dispatch admin event:', e.message);
    }

    hideOverlay();
    await refreshNavIdentity(user);
  }

  async function getAdminIdentity(userId, fallbackEmail) {
    const navLabel = (document.querySelector('.nav-user .user-profile span')?.textContent || '').trim();
    const userMetaName = (window.currentAdminUser?.user_metadata?.full_name || window.currentAdminUser?.user_metadata?.name || '').trim();
    const fallbackDisplay = userMetaName || navLabel || 'Admin';
    if (!window.supabaseClient) return { displayName: fallbackDisplay, avatarUrl: null };
    try {
      const safe = async (query, single = false) => {
        try {
          const { data, error } = await query;
          if (error) return null;
          return data || null;
        } catch (_) {
          return null;
        }
      };

      const [adminData, profileByUserIdRows, profileByEmailRows, profileNoOrgRows, profileByUserIdAnyOrgRows, profileByIdRows] = await Promise.all([
        safe(
          window.supabaseClient
            .from('admin_profiles')
            .select('first_name, last_name, display_name, avatar_url')
            .eq('user_id', userId)
            .maybeSingle(),
          true
        ),
        window.ORG_ID
          ? safe(
              window.supabaseClient
                .from('profiles')
                .select('display_name, employee_name, avatar_url')
                .eq('org_id', window.ORG_ID)
                .eq('user_id', userId)
                .limit(5)
            )
          : Promise.resolve(null),
        window.ORG_ID && fallbackEmail
          ? safe(
              window.supabaseClient
                .from('profiles')
                .select('display_name, employee_name, avatar_url')
                .eq('org_id', window.ORG_ID)
                .ilike('email', fallbackEmail)
                .limit(5)
            )
          : Promise.resolve(null),
        fallbackEmail
          ? safe(
              window.supabaseClient
                .from('profiles')
                .select('display_name, employee_name, avatar_url')
                .ilike('email', fallbackEmail)
                .limit(5)
            )
          : Promise.resolve(null),
        userId
          ? safe(
              window.supabaseClient
                .from('profiles')
                .select('display_name, employee_name, avatar_url')
                .eq('user_id', userId)
                .limit(5)
            )
          : Promise.resolve(null),
        userId
          ? safe(
              window.supabaseClient
                .from('profiles')
                .select('display_name, employee_name, avatar_url')
                .eq('id', userId)
                .limit(5)
            )
          : Promise.resolve(null),
      ]);

      const profileByUserId = pickBestProfileRow(profileByUserIdRows, fallbackEmail);
      const profileByEmail = pickBestProfileRow(profileByEmailRows, fallbackEmail);
      const profileNoOrg = pickBestProfileRow(profileNoOrgRows, fallbackEmail);
      const profileByUserIdAnyOrg = pickBestProfileRow(profileByUserIdAnyOrgRows, fallbackEmail);
      const profileById = pickBestProfileRow(profileByIdRows, fallbackEmail);

      const first = (adminData?.first_name || '').trim();
      const last = (adminData?.last_name || '').trim();
      const combined = [first, last].filter(Boolean).join(' ').trim();
      const displayName =
        combined ||
        (adminData?.display_name || '').trim() ||
        (profileByUserId?.display_name || '').trim() ||
        (profileByUserId?.employee_name || '').trim() ||
        (profileById?.display_name || '').trim() ||
        (profileById?.employee_name || '').trim() ||
        (profileByEmail?.display_name || '').trim() ||
        (profileByEmail?.employee_name || '').trim() ||
        (profileByUserIdAnyOrg?.display_name || '').trim() ||
        (profileByUserIdAnyOrg?.employee_name || '').trim() ||
        (profileNoOrg?.display_name || '').trim() ||
        (profileNoOrg?.employee_name || '').trim() ||
        fallbackDisplay;
      const avatarUrl =
        (adminData?.avatar_url || '').trim() ||
        (profileByUserId?.avatar_url || '').trim() ||
        (profileById?.avatar_url || '').trim() ||
        (profileByEmail?.avatar_url || '').trim() ||
        (profileByUserIdAnyOrg?.avatar_url || '').trim() ||
        (profileNoOrg?.avatar_url || '').trim() ||
        null;

      return { displayName, avatarUrl };
    } catch (e) {
      console.warn('[Auth] Could not load admin profile:', e?.message);
    }
    return { displayName: fallbackDisplay, avatarUrl: null };
  }

  // Expose canonical profile resolver for other modules (admin settings/chat/etc).
  try {
    window.kkGetAdminIdentity = getAdminIdentity;
    window.kkRefreshNavIdentity = refreshNavIdentity;
    if (typeof window.kkCanManageOrg !== 'boolean') window.kkCanManageOrg = false;
  } catch (_) {}

  function readSelectedSignupPlan() {
    return 'per_user';
  }

  async function bootstrapNewRestaurant(user, restaurantName, displayName, subscriptionPlan, explicitFirst, explicitLast) {
    const supa = window.supabaseClient;
    const name = (restaurantName || '').trim();
    if (!name) throw new Error('Please enter your restaurant name.');
    if (!user?.id) throw new Error('Not signed in.');
    const plan = 'per_user';

    const { data: orgRow, error: orgErr } = await supa
      .from('orgs')
      .insert({ name, subscription_plan: plan })
      .select('id')
      .single();
    if (orgErr) {
      const hint =
        String(orgErr.message || '').toLowerCase().includes('permission') ||
        String(orgErr.message || '').toLowerCase().includes('policy')
          ? ' Run fix-signup-new-restaurant-rls.sql in the Supabase SQL editor (bootstrap policies).'
          : '';
      throw new Error((orgErr.message || 'Could not create restaurant.') + hint);
    }

    const orgId = orgRow.id;

    const { error: omErr } = await supa.from('org_members').insert({
      org_id: orgId,
      user_id: user.id,
      role: 'manager',
      position: null,
    });
    if (omErr) {
      throw new Error(
        (omErr.message || 'Could not link you to the restaurant.') +
          ' If this is a new project, run fix-signup-new-restaurant-rls.sql in Supabase.'
      );
    }

    const email = String(user.email || '').trim();
    const fnEx = String(explicitFirst || '').trim();
    const lnEx = String(explicitLast || '').trim();
    let dn = (displayName || '').trim();
    if (fnEx || lnEx) {
      dn = [fnEx, lnEx].filter(Boolean).join(' ').trim();
    }
    if (!dn) dn = email.split('@')[0] || 'Manager';
    let firstName = fnEx;
    let lastName = lnEx;
    if (!fnEx && !lnEx) {
      const parts = dn.split(/\s+/).filter(Boolean);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ') || '';
    }

    const { error: profErr } = await supa.from('profiles').insert({
      org_id: orgId,
      user_id: user.id,
      email: email || null,
      display_name: dn,
      employee_name: dn,
      first_name: firstName || null,
      last_name: lastName || null,
    });
    if (profErr) {
      console.warn('[Auth] bootstrap profile insert:', profErr.message);
    }

    try {
      await supa.from('admin_users').upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
    } catch (e) {
      console.warn('[Auth] admin_users upsert:', e?.message);
    }

    try {
      window.localStorage.setItem('kk_org_id', orgId);
    } catch (_) {}
    window.ORG_ID = orgId;
  }

  async function clearPendingRestaurantMeta() {
    try {
      await window.supabaseClient.auth.updateUser({
        data: {
          kk_pending_restaurant: '',
          kk_subscription_plan: '',
          kk_manager_first: '',
          kk_manager_last: '',
        },
      });
    } catch (e) {
      console.warn('[Auth] Could not clear signup metadata:', e?.message);
    }
  }

  async function waitForPostCheckoutOrg(user, maxAttempts, delayMs) {
    if (!window.supabaseClient || !user?.id) return;
    for (let i = 0; i < maxAttempts; i++) {
      const { data: mgrRows } = await window.supabaseClient
        .from('org_members')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('role', 'manager')
        .limit(1);
      if (Array.isArray(mgrRows) && mgrRows.length > 0) return;
      await new Promise((r) => setTimeout(r, delayMs));
      try {
        await window.supabaseClient.auth.refreshSession();
      } catch (_) {}
    }
  }

  async function maybeCompletePendingRestaurantSignup(user) {
    if (!window.supabaseClient || !user?.id) return;
    const pending = String(user.user_metadata?.kk_pending_restaurant || '').trim();
    if (!pending) return;

    const { data: existingOm, error: omReadErr } = await window.supabaseClient
      .from('org_members')
      .select('org_id')
      .eq('user_id', user.id)
      .limit(1);
    if (omReadErr) {
      console.warn('[Auth] org_members check:', omReadErr.message);
      return;
    }
    if (Array.isArray(existingOm) && existingOm.length > 0) {
      await clearPendingRestaurantMeta();
      return;
    }

    const fnMeta = String(user.user_metadata?.kk_manager_first || '').trim();
    const lnMeta = String(user.user_metadata?.kk_manager_last || '').trim();
    const displayName = String(user.user_metadata?.full_name || user.user_metadata?.name || '').trim();
    const metaPlan = String(user.user_metadata?.kk_subscription_plan || '').toLowerCase().trim();
    const plan = 'per_user';
    try {
      await bootstrapNewRestaurant(user, pending, displayName, plan, fnMeta, lnMeta);
      await clearPendingRestaurantMeta();
    } catch (e) {
      console.warn('[Auth] Pending restaurant bootstrap failed:', e?.message || e);
    }
  }

  function setAuthMode(mode) {
    const tabIn = document.getElementById('auth-tab-signin');
    const tabUp = document.getElementById('auth-tab-signup');
    const panIn = document.getElementById('auth-panel-signin');
    const panUp = document.getElementById('auth-panel-signup');
    const sub = document.getElementById('auth-subtitle');
    if (!tabIn || !tabUp || !panIn || !panUp) return;
    const active = {
      background: '#fff',
      color: '#111827',
      boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
    };
    const inactive = { background: 'transparent', color: '#6b7280', boxShadow: 'none' };
    if (mode === 'signup') {
      Object.assign(tabUp.style, active);
      Object.assign(tabIn.style, inactive);
      panUp.style.display = 'flex';
      panIn.style.display = 'none';
      if (sub) sub.textContent = 'Create your restaurant';
    } else {
      Object.assign(tabIn.style, active);
      Object.assign(tabUp.style, inactive);
      panIn.style.display = 'flex';
      panUp.style.display = 'none';
      if (sub) sub.textContent = 'Sign in to your restaurant';
    }
  }

  function setupLoginHandlers() {
    const overlay = createOverlay();
    overlay.style.display = 'flex';
    hideUnauthorizedPanel();
    wireUnauthorizedSignOut();

    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit');
    const tabIn = document.getElementById('auth-tab-signin');
    const tabUp = document.getElementById('auth-tab-signup');
    const restName = document.getElementById('auth-restaurant-name');
    const ownerFirst = document.getElementById('auth-owner-first');
    const ownerLast = document.getElementById('auth-owner-last');
    const upEmail = document.getElementById('auth-signup-email');
    const upPass = document.getElementById('auth-signup-password');
    const upSubmit = document.getElementById('auth-signup-submit');

    if (!emailInput || !passwordInput || !submitBtn) return;

    showError('');
    showInfo('');

    let startMode = 'signin';
    try {
      const params = new URLSearchParams(window.location.search || '');
      if (params.get('login') === '1') {
        startMode = 'signin';
      } else if (params.get('signup') === '1' || params.get('onboard') === '1') {
        startMode = 'signup';
      }
      if (params.get('onboard_paid') === '1') {
        startMode = 'signin';
      }
      setAuthMode(startMode);
      if (startMode === 'signup') {
        const planParam = String(params.get('plan') || '').toLowerCase().trim();
        if (planParam) {
          const radio = document.querySelector(
            `#auth-overlay input[name="kk-signup-plan"][value="${planParam}"]`
          );
          if (radio) radio.checked = true;
        }
        const preEmail = String(params.get('email') || '').trim();
        if (preEmail && upEmail) upEmail.value = preEmail;
        const preFirst = String(params.get('first_name') || '').trim();
        const preLast = String(params.get('last_name') || '').trim();
        if (preFirst && ownerFirst) ownerFirst.value = preFirst;
        if (preLast && ownerLast) ownerLast.value = preLast;
      }
    } catch (_) {
      setAuthMode('signin');
    }

    try {
      const p2 = new URLSearchParams(window.location.search || '');
      if (p2.get('onboard_paid') === '1') {
        showInfo(
          'Sign in with your manager email and the password you created on the “Finish signup” page after Stripe. If you just finished, your restaurant may take a few seconds to activate.'
        );
      }
    } catch (_) {}

    if (tabIn) {
      tabIn.onclick = () => {
        showError('');
        showInfo('');
        setAuthMode('signin');
      };
    }
    if (tabUp) {
      tabUp.onclick = () => {
        showError('');
        showInfo('');
        setAuthMode('signup');
        try {
          const last = window.localStorage?.getItem('kk_admin_email');
          if (last && upEmail && !upEmail.value) upEmail.value = last;
        } catch (_) {}
        try {
          const params = new URLSearchParams(window.location.search || '');
          if (params.get('signup') === '1' || params.get('onboard') === '1') {
            const preEmail = String(params.get('email') || '').trim();
            if (preEmail && upEmail) upEmail.value = preEmail;
            const preFirst = String(params.get('first_name') || '').trim();
            const preLast = String(params.get('last_name') || '').trim();
            if (preFirst && ownerFirst) ownerFirst.value = preFirst;
            if (preLast && ownerLast) ownerLast.value = preLast;
          }
        } catch (_) {}
      };
    }

    try {
      const ob = window.localStorage?.getItem('kk_onboard_email');
      if (ob) emailInput.value = ob;
      else {
        const last = window.localStorage?.getItem('kk_admin_email');
        if (last && !emailInput.value) emailInput.value = last;
      }
    } catch (e) {
      console.warn('[Auth] Could not load saved admin email:', e?.message);
    }

    const doLogin = async () => {
      if (!window.supabaseClient) {
        showError('Supabase is not ready. Please reload.');
        return;
      }
      const email = (emailInput.value || '').trim();
      const password = passwordInput.value || '';
      if (!email || !password) {
        showError('Enter both email and password.');
        return;
      }
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.7';
      showError('');
      showInfo('');
      try {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        if (error || !data?.user) {
          const msg = error?.message || 'Invalid email or password.';
          showError(msg === 'Invalid login credentials' ? 'Invalid email or password.' : msg);
          return;
        }
        try {
          window.localStorage?.setItem('kk_admin_email', email);
        } catch (e) {
          console.warn('[Auth] Could not save admin email:', e?.message);
        }
        await ensureAdmin();
      } catch (e) {
        showError('Could not sign in. Please try again.');
      } finally {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
      }
    };

    const doSignup = async () => {
      if (!window.supabaseClient) {
        showError('Supabase is not ready. Please reload.');
        return;
      }
      const restaurantName = (restName?.value || '').trim();
      const fn = (ownerFirst?.value || '').trim();
      const ln = (ownerLast?.value || '').trim();
      const email = (upEmail?.value || '').trim().toLowerCase();
      const password = upPass?.value || '';
      if (!restaurantName) {
        showError('Enter your restaurant name.');
        return;
      }
      if (!fn || !ln) {
        showError('Enter your first and last name.');
        return;
      }
      if (!email) {
        showError('Enter your email.');
        return;
      }
      if (!password || password.length < 6) {
        showError('Use a password with at least 6 characters.');
        return;
      }
      if (!upSubmit) return;
      upSubmit.disabled = true;
      upSubmit.style.opacity = '0.7';
      showError('');
      showInfo('');
      try {
        const selectedPlan = readSelectedSignupPlan();
        const ownerDisp = `${fn} ${ln}`.trim();
        const { data, error } = await window.supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: ownerDisp,
              kk_manager_first: fn,
              kk_manager_last: ln,
              kk_pending_restaurant: restaurantName,
              kk_subscription_plan: selectedPlan,
            },
          },
        });
        if (error) {
          const msg = error.message || 'Could not create account.';
          showError(
            /already registered|already been registered/i.test(msg)
              ? 'That email is already registered. Use “Existing restaurant” and sign in.'
              : msg
          );
          return;
        }
        if (!data?.user) {
          showError('Sign up failed. Please try again.');
          return;
        }

        if (!data.session) {
          showInfo(
            'Check your email to confirm your account. After you confirm, return here, choose “Existing restaurant”, and sign in — your restaurant will be created automatically on first login.'
          );
          return;
        }

        await bootstrapNewRestaurant(data.user, restaurantName, ownerDisp, selectedPlan, fn, ln);
        await clearPendingRestaurantMeta();
        try {
          window.localStorage?.setItem('kk_admin_email', email);
        } catch (_) {}

        showInfo('Restaurant created. Loading dashboard…');
        await ensureAdmin();
      } catch (e) {
        showError(e?.message || 'Could not finish sign up.');
      } finally {
        upSubmit.disabled = false;
        upSubmit.style.opacity = '1';
      }
    };

    submitBtn.onclick = doLogin;
    passwordInput.onkeydown = (e) => {
      if (e.key === 'Enter') doLogin();
    };
    if (upSubmit) upSubmit.onclick = doSignup;
    if (upPass) {
      upPass.onkeydown = (e) => {
        if (e.key === 'Enter') doSignup();
      };
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.supabaseClient) {
      ensureAdmin();
    } else {
      window.addEventListener('supabase-ready', ensureAdmin, { once: true });
    }
    // Re-hydrate top-right identity after org bootstrap resolves.
    window.addEventListener('supabase-ready', () => {
      if (window.currentAdminUser) {
        refreshNavIdentity(window.currentAdminUser);
      }
    });
  });
})();

