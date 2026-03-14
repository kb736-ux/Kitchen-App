(function () {
  let adminUser = null;
  let modalEl = null;
  let originalRestaurantName = null;

  function createSettingsModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'admin-settings-modal';
    modalEl.style.position = 'fixed';
    modalEl.style.inset = '0';
    modalEl.style.background = 'rgba(15,23,42,0.72)';
    modalEl.style.display = 'none';
    modalEl.style.alignItems = 'center';
    modalEl.style.justifyContent = 'center';
    modalEl.style.zIndex = '10001';

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '520px';
    card.style.background = '#ffffff';
    card.style.borderRadius = '18px';
    card.style.padding = '22px 24px 20px';
    card.style.boxShadow = '0 18px 40px rgba(0,0,0,0.35)';
    card.style.fontFamily = "'Inter', system-ui, -apple-system, BlinkMacSystemFont, sans-serif";

    card.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
        <div>
          <div style="font-size:18px;font-weight:700;color:#111827;">Admin Settings</div>
          <div style="font-size:12px;color:#6b7280;margin-top:2px;">Update your profile and restaurant details</div>
        </div>
        <button id="admin-settings-close" style="border:none;background:transparent;cursor:pointer;font-size:18px;color:#6b7280;">
          ×
        </button>
      </div>
      <div id="admin-settings-error" style="display:none;margin-bottom:8px;padding:6px 9px;border-radius:8px;font-size:12px;background:#fef2f2;color:#b91c1c;"></div>
      <div id="admin-settings-success" style="display:none;margin-bottom:8px;padding:6px 9px;border-radius:8px;font-size:12px;background:#ecfdf5;color:#166534;"></div>
      <div style="display:grid;grid-template-columns:1fr;gap:12px;margin-bottom:10px;">
        <div style="display:flex;gap:10px;">
          <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
            <label for="admin-first-name" style="font-size:12px;font-weight:500;color:#374151;">First name</label>
            <input id="admin-first-name" type="text" style="border-radius:10px;border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;" />
          </div>
          <div style="flex:1;display:flex;flex-direction:column;gap:4px;">
            <label for="admin-last-name" style="font-size:12px;font-weight:500;color:#374151;">Last name</label>
            <input id="admin-last-name" type="text" style="border-radius:10px;border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;" />
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="admin-email" style="font-size:12px;font-weight:500;color:#374151;">Email (login)</label>
          <input id="admin-email" type="email" autocomplete="email" style="border-radius:10px;border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;" />
          <div style="font-size:11px;color:#9ca3af;">Changing email may require re‑verification via Supabase.</div>
        </div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="font-size:11px;color:#6b7280;max-width:260px;">
            To change your password, we&apos;ll email you a secure reset link.
          </div>
          <button id="admin-send-reset" style="border-radius:999px;border:1px solid #e5e7eb;padding:6px 10px;font-size:12px;background:#ffffff;color:#16a34a;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;">
            <i class="fas fa-envelope"></i><span>Send reset email</span>
          </button>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="admin-restaurant-name" style="font-size:12px;font-weight:500;color:#374151;">Restaurant / Organization name</label>
          <input id="admin-restaurant-name" type="text" placeholder="e.g. My Restaurant" style="border-radius:10px;border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;" />
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <label for="admin-restaurant-logo" style="font-size:12px;font-weight:500;color:#374151;">Restaurant logo URL (optional)</label>
          <input id="admin-restaurant-logo" type="text" placeholder="https://..." style="border-radius:10px;border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;" />
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;">
        <button id="admin-settings-logout" style="border-radius:999px;border:1px solid #e5e7eb;padding:8px 12px;font-size:13px;background:#ffffff;color:#374151;cursor:pointer;display:flex;align-items:center;gap:6px;">
          <i class="fas fa-sign-out-alt"></i><span>Logout</span>
        </button>
        <div style="display:flex;gap:8px;">
          <button id="admin-settings-cancel" style="border-radius:999px;border:1px solid #e5e7eb;padding:8px 14px;font-size:13px;background:#ffffff;color:#374151;cursor:pointer;">
            Cancel
          </button>
          <button id="admin-settings-save" style="border-radius:999px;border:none;padding:8px 16px;font-size:13px;font-weight:600;background:#16a34a;color:#ffffff;cursor:pointer;">
            Save changes
          </button>
        </div>
      </div>
    `;

    modalEl.appendChild(card);
    document.body.appendChild(modalEl);

    modalEl.querySelector('#admin-settings-close').onclick = hideModal;
    modalEl.querySelector('#admin-settings-cancel').onclick = hideModal;
    modalEl.querySelector('#admin-settings-logout').onclick = async () => {
      if (window.supabaseClient) {
        await window.supabaseClient.auth.signOut();
      }
      window.location.reload();
    };
    modalEl.querySelector('#admin-send-reset').onclick = sendPasswordReset;
    modalEl.querySelector('#admin-settings-save').onclick = saveChanges;

    return modalEl;
  }

  function showError(message) {
    const el = document.getElementById('admin-settings-error');
    if (!el) return;
    if (!message) {
      el.style.display = 'none';
      return;
    }
    el.textContent = message;
    el.style.display = 'block';
  }

  function showSuccess(message) {
    const el = document.getElementById('admin-settings-success');
    if (!el) return;
    if (!message) {
      el.style.display = 'none';
      return;
    }
    el.textContent = message;
    el.style.display = 'block';
  }

  function hideModal() {
    if (modalEl) modalEl.style.display = 'none';
  }

  async function sendPasswordReset() {
    if (!window.supabaseClient) {
      showError('Supabase is not ready. Please reload.');
      return;
    }
    const emailEl = document.getElementById('admin-email');
    const email = (emailEl?.value || '').trim();
    showError('');
    showSuccess('');

    if (!email) {
      showError('Enter an email first.');
      return;
    }

    const btn = document.getElementById('admin-send-reset');
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.7';
    }

    try {
      const { error } = await window.supabaseClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      if (error) {
        showError(error.message || 'Could not send reset email.');
      } else {
        showSuccess('Password reset email sent.');
      }
    } catch (e) {
      console.warn('[AdminSettings] Reset email failed:', e.message);
      showError('Could not send reset email. Please try again.');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    }
  }

  async function openModal() {
    if (!adminUser || !window.supabaseClient) return;
    const modal = createSettingsModal();
    modal.style.display = 'flex';
    showError('');
    showSuccess('');

    const emailEl = document.getElementById('admin-email');
    const firstEl = document.getElementById('admin-first-name');
    const lastEl = document.getElementById('admin-last-name');
    const restNameEl = document.getElementById('admin-restaurant-name');
    const restLogoEl = document.getElementById('admin-restaurant-logo');

    if (emailEl) emailEl.value = adminUser.email || '';

    try {
      const supa = window.supabaseClient;

      const [{ data: profile }, { data: orgRow, error: orgError }] = await Promise.all([
        supa
          .from('admin_profiles')
          .select('*')
          .eq('user_id', adminUser.id)
          .maybeSingle()
          .catch(() => ({ data: null })),
        supa
          .from('orgs')
          .select('name')
          .eq('id', window.ORG_ID)
          .maybeSingle()
          .then((r) => ({ data: r.data, error: r.error })),
      ]);

      if (orgError) {
        console.warn('[AdminSettings] Could not load org name:', orgError.message);
      }

      if (profile) {
        if (firstEl) firstEl.value = profile.first_name || '';
        if (lastEl) lastEl.value = profile.last_name || '';
      } else {
        // Fallback: derive name from email or current nav label
        const navLabel = document.querySelector('.nav-user .user-profile span');
        const navName = navLabel?.textContent?.trim() || '';
        const base = navName || (adminUser.email || '').split('@')[0];
        if (base) {
          const parts = base.split(/[.\s]+/).filter(Boolean);
          if (firstEl && !firstEl.value && parts[0]) {
            firstEl.value = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
          }
          if (lastEl && !lastEl.value && parts[1]) {
            lastEl.value = parts[1].charAt(0).toUpperCase() + parts[1].slice(1);
          }
        }
      }

      // Restaurant name: prefer org row from DB, then localStorage, then nav brand or header
      const brandSpan = document.querySelector('.nav-brand span');
      const currentBrand = brandSpan?.textContent?.trim() || '';
      const headerH1 = document.querySelector('.dashboard-header h1');
      const headerName = (headerH1?.textContent || '').replace(/\s*Overview\s*$/, '').trim();

      const storedOrg = (() => {
        try {
          return localStorage.getItem('kk_org_name') || '';
        } catch (_) {
          return '';
        }
      })();

      const orgName = (orgRow && orgRow.name != null ? orgRow.name : '') || '';
      const currentRestaurantName = (orgName || '').trim() || storedOrg || currentBrand || headerName;

      if (restNameEl) {
        restNameEl.value = currentRestaurantName;
        restNameEl.placeholder = currentRestaurantName ? currentRestaurantName : 'e.g. My Restaurant';
      }
      if (restLogoEl) {
        restLogoEl.value = '';
      }

      if (restNameEl) {
        originalRestaurantName = (restNameEl.value || '').trim();
      }
    } catch (e) {
      console.warn('[AdminSettings] Failed to load settings:', e.message);
    }
  }

  async function saveChanges() {
    if (!adminUser || !window.supabaseClient) return;
    const supa = window.supabaseClient;

    const emailEl = document.getElementById('admin-email');
    const firstEl = document.getElementById('admin-first-name');
    const lastEl = document.getElementById('admin-last-name');
    const restNameEl = document.getElementById('admin-restaurant-name');
    const restLogoEl = document.getElementById('admin-restaurant-logo');

    const email = (emailEl?.value || '').trim();
    const firstName = (firstEl?.value || '').trim();
    const lastName = (lastEl?.value || '').trim();
    const restaurantName = (restNameEl?.value || '').trim();
    const restaurantLogo = (restLogoEl?.value || '').trim() || null;

    showError('');
    showSuccess('');

    if (!email) {
      showError('Email is required.');
      return;
    }

    if (originalRestaurantName != null && restaurantName !== originalRestaurantName) {
      const fromLabel = originalRestaurantName || 'current name';
      const toLabel = restaurantName || 'blank name';
      const ok = window.confirm(`Change restaurant name from "${fromLabel}" to "${toLabel}"?`);
      if (!ok) {
        return;
      }
    }

    const saveBtn = document.getElementById('admin-settings-save');
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.style.opacity = '0.7';
    }

    try {
      const updates = [];
      const userUpdate = {};
      if (email && email !== adminUser.email) userUpdate.email = email;
      if (Object.keys(userUpdate).length) {
        updates.push(supa.auth.updateUser(userUpdate));
      }

      // Admin profile: update if row exists, otherwise insert (avoids upsert constraint issues)
      if (firstName !== undefined || lastName !== undefined) {
        const displayName = [firstName, lastName].filter(Boolean).join(' ') || null;
        const { data: existing } = await supa.from('admin_profiles').select('user_id').eq('user_id', adminUser.id).maybeSingle();
        if (existing) {
          const { error: upErr } = await supa.from('admin_profiles').update({
            first_name: firstName || null,
            last_name: lastName || null,
            display_name: displayName,
            updated_at: new Date().toISOString(),
          }).eq('user_id', adminUser.id);
          if (upErr) throw new Error(upErr.message || 'Could not update admin name.');
        } else {
          const { error: inErr } = await supa.from('admin_profiles').insert({
            user_id: adminUser.id,
            first_name: firstName || null,
            last_name: lastName || null,
            display_name: displayName,
            updated_at: new Date().toISOString(),
          });
          if (inErr) throw new Error(inErr.message || 'Could not save admin name.');
        }
      }

      if (updates.length) {
        await Promise.all(updates);
      }

      // Org name only (avoids logo_url column missing error; add logo_url to orgs table later if needed)
      const { error: orgErr } = await supa.from('orgs').update({ name: restaurantName }).eq('id', window.ORG_ID).select();
      if (orgErr) {
        throw new Error(orgErr.message || 'Could not update restaurant name. Check RLS on orgs table.');
      }
      if (restaurantName) {
        try { localStorage.setItem('kk_org_name', restaurantName); } catch (_) {}
      }

      // Immediately reflect new restaurant name in the UI without waiting for reload
      if (restaurantName) {
        const brandEls = document.querySelectorAll('.nav-brand span');
        brandEls.forEach(el => { el.textContent = restaurantName; });
        const header = document.querySelector('.dashboard-header h1');
        if (header && /Overview$/.test(header.textContent || '')) {
          header.textContent = `${restaurantName} Overview`;
        }
        if (document.title.includes('Kenny Kitchen')) {
          document.title = document.title.replace('Kenny Kitchen', restaurantName);
        }
      }

      showSuccess('Settings saved.');
      const displayName = [firstName, lastName].filter(Boolean).join(' ');
      if (displayName) {
        const label = document.querySelector('.nav-user .user-profile span');
        if (label) label.textContent = displayName;
      }
      setTimeout(() => {
        hideModal();
        window.location.reload();
      }, 600);
    } catch (e) {
      console.warn('[AdminSettings] Save failed:', e.message);
      showError(e?.message || 'Could not save changes. Please try again.');
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
      }
    }
  }

  function attachProfileClick() {
    const profile = document.querySelector('.nav-user .user-profile');
    if (!profile) return;
    if (profile.dataset.settingsAttached === '1') return;
    profile.dataset.settingsAttached = '1';
    profile.style.cursor = 'pointer';
    profile.addEventListener('click', () => {
      openModal();
    });
  }

  window.addEventListener('kk-admin-authenticated', (e) => {
    adminUser = e.detail?.user || null;
    attachProfileClick();
  });

  document.addEventListener('DOMContentLoaded', () => {
    if (window.currentAdminUser) {
      adminUser = window.currentAdminUser;
      attachProfileClick();
    }
  });
})();

