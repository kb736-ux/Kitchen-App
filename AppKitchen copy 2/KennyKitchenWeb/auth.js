// Simple admin-only auth gate for Kenny Kitchen Web
// Requires: window.supabaseClient from supabase-config.js

(function () {
  function createOverlay() {
    let overlay = document.getElementById('auth-overlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'auth-overlay';
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(15, 23, 42, 0.92)';
    overlay.style.display = 'none';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '10000';

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '420px';
    card.style.background = '#ffffff';
    card.style.borderRadius = '16px';
    card.style.padding = '28px 24px 24px';
    card.style.boxShadow = '0 20px 45px rgba(0,0,0,0.35)';
    card.style.fontFamily = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px;">
        <div style="width:40px;height:40px;border-radius:999px;background:#e8f5e9;display:flex;align-items:center;justify-content:center;">
          <i class="fas fa-utensils" style="color:#16a34a;"></i>
        </div>
        <div>
          <div style="font-size:18px;font-weight:700;color:#111827;">Kenny Kitchen Admin</div>
          <div style="font-size:13px;color:#6b7280;">Sign in with your admin email</div>
        </div>
      </div>
      <div id="auth-error" style="display:none;margin-bottom:10px;padding:8px 10px;border-radius:8px;font-size:12px;background:#fef2f2;color:#b91c1c;"></div>
      <div style="display:flex;flex-direction:column;gap:10px;">
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-email" style="font-size:13px;font-weight:500;color:#374151;">Email</label>
          <input id="auth-email" type="email" autocomplete="email"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="auth-password" style="font-size:13px;font-weight:500;color:#374151;">Password</label>
          <input id="auth-password" type="password" autocomplete="current-password"
            style="border-radius:10px;border:1px solid #e5e7eb;padding:9px 11px;font-size:14px;outline:none;"
          />
        </div>
        <button id="auth-submit"
          style="margin-top:6px;border:none;border-radius:999px;background:#16a34a;color:#fff;font-weight:600;font-size:14px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
          <span>Sign in</span>
        </button>
        <div id="auth-unauthorized" style="display:none;margin-top:6px;font-size:12px;color:#374151;background:#fefce8;border-radius:10px;padding:8px 10px;">
          This account is not marked as an admin for this dashboard. Ask the owner to grant access.
        </div>
      </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    return overlay;
  }

  function showError(message) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = message || 'Something went wrong. Please try again.';
    el.style.display = 'block';
  }

  function showUnauthorized() {
    const el = document.getElementById('auth-unauthorized');
    if (el) el.style.display = 'block';
  }

  function hideOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function addLogoutButton(email) {
    try {
      const navUser = document.querySelector('.nav-user');
      if (!navUser) return;
      if (navUser.querySelector('#admin-logout-btn')) return;
      const btn = document.createElement('button');
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

      const label = navUser.querySelector('.user-profile span');
      if (label && email) {
        label.textContent = email;
      }
    } catch (e) {
      console.warn('[Auth] Could not attach logout button:', e.message);
    }
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
    const { data: adminRow, error: adminError } = await window.supabaseClient
      .from('admin_users')
      .select('is_admin')
      .eq('user_id', user.id)
      .maybeSingle();

    if (adminError) {
      overlay.style.display = 'flex';
      console.warn('[Auth] admin_users lookup failed:', adminError.message);
      const unauthEl = document.getElementById('auth-unauthorized');
      if (unauthEl) unauthEl.style.display = 'none';
      showError('Could not verify admin. Enable read access to admin_users (see instructions below).');
      return;
    }
    if (!adminRow?.is_admin) {
      overlay.style.display = 'flex';
      showUnauthorized();
      return;
    }

    window.currentAdminUser = user;
    try {
      const evt = new CustomEvent('kk-admin-authenticated', { detail: { user } });
      window.dispatchEvent(evt);
    } catch (e) {
      console.warn('[Auth] Could not dispatch admin event:', e.message);
    }

    hideOverlay();
    const displayLabel = await getAdminDisplayLabel(user.id, user.email);
    addLogoutButton(displayLabel);
  }

  async function getAdminDisplayLabel(userId, fallbackEmail) {
    if (!window.supabaseClient) return fallbackEmail || 'Admin';
    try {
      const { data } = await window.supabaseClient
        .from('admin_profiles')
        .select('first_name, last_name, display_name')
        .eq('user_id', userId)
        .maybeSingle();
      if (data) {
        const first = (data.first_name || '').trim();
        const last = (data.last_name || '').trim();
        const combined = [first, last].filter(Boolean).join(' ');
        if (combined) return combined;
        if ((data.display_name || '').trim()) return data.display_name.trim();
      }
    } catch (e) {
      console.warn('[Auth] Could not load admin profile:', e?.message);
    }
    return fallbackEmail || 'Admin';
  }

  function setupLoginHandlers() {
    const overlay = createOverlay();
    overlay.style.display = 'flex';

    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    const submitBtn = document.getElementById('auth-submit');
    if (!emailInput || !passwordInput || !submitBtn) return;

    // Prefill last-used admin email if available
    try {
      const last = window.localStorage?.getItem('kk_admin_email');
      if (last && !emailInput.value) {
        emailInput.value = last;
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
      try {
        const { data, error } = await window.supabaseClient.auth.signInWithPassword({ email, password });
        if (error || !data?.user) {
          const msg = error?.message || 'Invalid email or password.';
          showError(msg === 'Invalid login credentials' ? 'Invalid email or password.' : msg);
          submitBtn.disabled = false;
          submitBtn.style.opacity = '1';
          return;
        }
        // Remember this admin email for next time
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

    submitBtn.onclick = doLogin;
    passwordInput.onkeydown = (e) => {
      if (e.key === 'Enter') doLogin();
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.supabaseClient) {
      ensureAdmin();
    } else {
      window.addEventListener('supabase-ready', ensureAdmin, { once: true });
    }
  });
})();

