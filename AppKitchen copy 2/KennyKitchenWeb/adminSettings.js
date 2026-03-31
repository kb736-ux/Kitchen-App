(function () {
  let adminUser = null;
  let modalEl = null;
  let originalRestaurantName = null;
  let pendingAvatarFile = null;
  let currentAvatarUrl = '';

  function getInitials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return 'U';
    return parts.map(p => p[0]).join('').slice(0, 2).toUpperCase();
  }

  function buildInitialAvatarDataUrl(name) {
    const initials = getInitials(name);
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80'>` +
      `<rect width='100%' height='100%' rx='40' ry='40' fill='#e2e8f0'/>` +
      `<text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' fill='#4a5568' font-family='Inter,Arial,sans-serif' font-size='28' font-weight='700'>${initials}</text>` +
      `</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  function splitNameParts(value) {
    const raw = (value || '').trim();
    if (!raw) return { first: '', last: '' };
    const parts = raw.split(/\s+/).filter(Boolean);
    return {
      first: parts[0] || '',
      last: parts.slice(1).join(' '),
    };
  }

  function applyNavAvatar(url) {
    const src = (url || '').trim();
    if (!src) return;
    document.querySelectorAll('.nav-user .user-avatar').forEach((img) => {
      img.src = src;
    });
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
      if (en && en.toLowerCase() !== local) s += 10;
      if (dn && dn.toLowerCase() !== local) s += 10;
      if (dn && dn.toLowerCase() === local) s -= 25;
      if (en && en.toLowerCase() === local) s -= 10;
      return s;
    };
    return arr.sort((a, b) => score(b) - score(a))[0] || arr[0];
  }

  async function uploadAdminAvatar(file) {
    if (!window.supabaseClient || !window.ORG_ID || !file) return null;
    const emailKey = ((adminUser?.email || '').split('@')[0] || 'admin').replace(/[^a-z0-9_-]/gi, '_');
    const userKey = (adminUser?.id || emailKey || 'admin').replace(/[^a-z0-9_-]/gi, '_');
    const filePath = `${window.ORG_ID}/admins/${userKey}.jpg`;
    const { error: upErr } = await window.supabaseClient.storage
      .from('avatars')
      .upload(filePath, file, {
        contentType: file.type || 'image/jpeg',
        upsert: true,
      });
    if (upErr) throw upErr;
    const { data: pub } = window.supabaseClient.storage.from('avatars').getPublicUrl(filePath);
    if (!pub?.publicUrl) {
      throw new Error('Avatar uploaded but public URL was unavailable.');
    }
    return `${pub.publicUrl}?t=${Date.now()}`;
  }

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
      <div id="admin-subscription-block" style="border:1px solid #e5e7eb;border-radius:12px;padding:12px 14px;margin-bottom:14px;background:#fafafa;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:4px;">Subscription plan</div>
        <div id="admin-subscription-usage" style="font-size:12px;color:#6b7280;margin-bottom:10px;line-height:1.4;">—</div>
        <label for="admin-subscription-plan" style="font-size:12px;font-weight:500;color:#374151;">Plan</label>
        <select id="admin-subscription-plan" style="width:100%;margin-top:4px;border-radius:10px;border:1px solid #e5e7eb;padding:8px 10px;font-size:14px;box-sizing:border-box;">
          <option value="starter">Starter — up to 20 employees</option>
          <option value="growth">Growth — 21–40 employees</option>
          <option value="scale">Scale — 41+ employees</option>
        </select>
        <p style="font-size:11px;color:#9ca3af;margin:8px 0 0;line-height:1.35;">Limits are based on roster size (profiles in Supabase). Connect billing (e.g. Stripe) separately when you&apos;re ready.</p>
      </div>
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
        <div style="display:flex;align-items:center;gap:12px;padding:8px 0;">
          <img id="admin-avatar-preview" src="" alt="Profile photo"
            style="width:56px;height:56px;border-radius:999px;object-fit:cover;border:2px solid #e5e7eb;" />
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label style="font-size:12px;font-weight:500;color:#374151;">Profile photo</label>
            <div style="display:flex;gap:8px;align-items:center;">
              <input id="admin-avatar-file" type="file" accept="image/*" style="display:none;" />
              <button id="admin-avatar-pick" type="button" style="border-radius:999px;border:1px solid #e5e7eb;padding:6px 10px;font-size:12px;background:#fff;color:#16a34a;cursor:pointer;">Choose photo</button>
              <button id="admin-avatar-clear" type="button" style="border-radius:999px;border:1px solid #e5e7eb;padding:6px 10px;font-size:12px;background:#fff;color:#6b7280;cursor:pointer;">Clear</button>
            </div>
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
    modalEl.querySelector('#admin-avatar-pick').onclick = () => {
      modalEl.querySelector('#admin-avatar-file')?.click();
    };
    modalEl.querySelector('#admin-avatar-clear').onclick = () => {
      pendingAvatarFile = null;
      currentAvatarUrl = '';
      const preview = modalEl.querySelector('#admin-avatar-preview');
      const first = (document.getElementById('admin-first-name')?.value || '').trim();
      const last = (document.getElementById('admin-last-name')?.value || '').trim();
      if (preview) preview.src = buildInitialAvatarDataUrl([first, last].filter(Boolean).join(' '));
    };
    modalEl.querySelector('#admin-avatar-file').onchange = (e) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      pendingAvatarFile = file;
      const preview = modalEl.querySelector('#admin-avatar-preview');
      if (preview) {
        const local = URL.createObjectURL(file);
        preview.src = local;
      }
    };

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
    const avatarPreviewEl = document.getElementById('admin-avatar-preview');

    if (emailEl) emailEl.value = adminUser.email || '';
    pendingAvatarFile = null;

    // Seed fields immediately so they are never blank while async data loads.
    const resolvedIdentity = typeof window.kkGetAdminIdentity === 'function'
      ? await window.kkGetAdminIdentity(adminUser.id, adminUser.email)
      : null;
    const seededName = (resolvedIdentity?.displayName || '').trim()
      || (document.querySelector('.user-profile span')?.textContent || '').trim()
      || (adminUser?.user_metadata?.full_name || '').trim()
      || (adminUser?.user_metadata?.name || '').trim()
      || (adminUser.email || '').split('@')[0];
    const seededParts = splitNameParts(seededName);
    if (firstEl) firstEl.value = seededParts.first || firstEl.value || '';
    if (lastEl) lastEl.value = seededParts.last || lastEl.value || '';

    const seededRestaurantName = (() => {
      const fromBrand = (document.querySelector('.nav-brand span')?.textContent || '').trim();
      const fromHeader = ((document.querySelector('.dashboard-header h1')?.textContent || '')
        .replace(/\s*Overview\s*$/, '')
        .trim());
      const fromTitle = (document.title || '').replace(/\s*-\s*.*$/, '').trim();
      let fromStorage = '';
      try { fromStorage = (localStorage.getItem('kk_org_name') || '').trim(); } catch (_) {}
      return fromStorage || fromBrand || fromHeader || fromTitle || 'Sheek';
    })();
    if (restNameEl) {
      restNameEl.value = seededRestaurantName;
      restNameEl.placeholder = seededRestaurantName;
    }

    try {
      const supa = window.supabaseClient;

      const [
        { data: profile },
        { data: orgRow, error: orgError },
        { data: profileByEmail },
        { data: profileByUserIdAnyOrg },
        { count: profileCount, error: profileCountError },
      ] = await Promise.all([
        supa
          .from('admin_profiles')
          .select('*')
          .eq('user_id', adminUser.id)
          .maybeSingle()
          .catch(() => ({ data: null })),
        supa
          .from('orgs')
          .select('name, subscription_plan')
          .eq('id', window.ORG_ID)
          .maybeSingle()
          .then((r) => ({ data: r.data, error: r.error })),
        supa
          .from('profiles')
          .select('employee_name, display_name, email, avatar_url')
          .eq('org_id', window.ORG_ID)
          .eq('user_id', adminUser.id)
          .limit(5)
          .catch(() => ({ data: [] })),
        supa
          .from('profiles')
          .select('employee_name, display_name, email, avatar_url')
          .eq('user_id', adminUser.id)
          .limit(5)
          .catch(() => ({ data: [] })),
        supa
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', window.ORG_ID)
          .then((r) => ({ count: r.count, error: r.error }))
          .catch(() => ({ count: null, error: null })),
      ]);
      if (profileCountError) {
        console.warn('[AdminSettings] Profile count failed:', profileCountError.message);
      }

      const planSel = document.getElementById('admin-subscription-plan');
      const usageEl = document.getElementById('admin-subscription-usage');
      const rawPlan = String(orgRow?.subscription_plan || 'starter').toLowerCase();
      const resolvedPlan = ['starter', 'growth', 'scale'].includes(rawPlan) ? rawPlan : 'starter';
      if (planSel) planSel.value = resolvedPlan;
      if (usageEl && typeof window.kkGetEmployeeLimit === 'function' && typeof window.kkGetSubscriptionPlan === 'function') {
        const lim = window.kkGetEmployeeLimit(resolvedPlan);
        const p = window.kkGetSubscriptionPlan(resolvedPlan);
        const n = profileCount != null ? profileCount : '—';
        const capLabel = lim == null ? 'unlimited' : String(lim);
        usageEl.textContent = `${p.label}: ${n} employee${n === 1 ? '' : 's'} on file — plan allows up to ${capLabel}.`;
      } else if (usageEl) {
        usageEl.textContent = 'Load subscriptionPlans.js to see plan limits here.';
      }
      let profileByEmailRow = null;
      if (Array.isArray(profileByEmail) && profileByEmail.length > 0) {
        profileByEmailRow = pickBestProfileRow(profileByEmail, adminUser.email || '');
      } else if (adminUser.email) {
        const byEmailRes = await supa
          .from('profiles')
          .select('employee_name, display_name, email, avatar_url')
          .eq('org_id', window.ORG_ID)
          .ilike('email', adminUser.email || '')
          .limit(5)
          .catch(() => ({ data: [] }));
        const rows = byEmailRes?.data || [];
        profileByEmailRow = pickBestProfileRow(rows, adminUser.email || '');
      }

      if (orgError) {
        console.warn('[AdminSettings] Could not load org name:', orgError.message);
      }

      const profileByUserIdAnyOrgRow = pickBestProfileRow(profileByUserIdAnyOrg, adminUser.email || '');

      const preferredDisplayName = (profile?.display_name || '').trim()
        || (profileByEmailRow?.display_name || '').trim()
        || (profileByEmailRow?.employee_name || '').trim()
        || (profileByUserIdAnyOrgRow?.display_name || '').trim()
        || (profileByUserIdAnyOrgRow?.employee_name || '').trim()
        || (resolvedIdentity?.displayName || '').trim()
        || '';
      const preferredAvatarUrl = (profile?.avatar_url || profileByEmailRow?.avatar_url || profileByUserIdAnyOrgRow?.avatar_url || resolvedIdentity?.avatarUrl || '').trim();

      if (profile) {
        const savedFirst = (profile.first_name || '').trim();
        const savedLast = (profile.last_name || '').trim();
        const fallbackName = preferredDisplayName
          || (document.querySelector('.user-profile span')?.textContent || '').trim()
          || (adminUser?.user_metadata?.full_name || '').trim()
          || (adminUser?.user_metadata?.name || '').trim()
          || (adminUser.email || '').split('@')[0];
        const fallbackParts = splitNameParts(fallbackName);
        if (firstEl) firstEl.value = savedFirst || fallbackParts.first;
        if (lastEl) lastEl.value = savedLast || fallbackParts.last;
        currentAvatarUrl = preferredAvatarUrl;
      } else {
        // Fallback: prefer profiles row, then nav/email.
        const navLabel = document.querySelector('.user-profile span');
        const navName = navLabel?.textContent?.trim() || '';
        const base = preferredDisplayName
          || navName
          || (adminUser?.user_metadata?.full_name || '').trim()
          || (adminUser?.user_metadata?.name || '').trim()
          || (adminUser.email || '').split('@')[0];
        if (base && (firstEl || lastEl)) {
          const parts = splitNameParts(base);
          if (firstEl) firstEl.value = parts.first || '';
          if (lastEl) lastEl.value = parts.last || '';
        }
        currentAvatarUrl = preferredAvatarUrl;
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
        const resolvedRestaurantName = currentRestaurantName || seededRestaurantName;
        restNameEl.value = resolvedRestaurantName;
        restNameEl.placeholder = resolvedRestaurantName;
      }
      if (restLogoEl) {
        restLogoEl.value = '';
      }
      if (avatarPreviewEl) {
        const fullNameForInitials = [firstEl?.value, lastEl?.value].filter(Boolean).join(' ');
        avatarPreviewEl.src = currentAvatarUrl || buildInitialAvatarDataUrl(fullNameForInitials);
        avatarPreviewEl.onerror = () => {
          avatarPreviewEl.src = buildInitialAvatarDataUrl(fullNameForInitials || preferredDisplayName || 'User');
        };
      }

      // Keep nav label/avatar in sync with the resolved profile identity.
      if (preferredDisplayName) {
        const navLabel = document.querySelector('.nav-user .user-profile span');
        if (navLabel) navLabel.textContent = preferredDisplayName;
      }
      if (preferredAvatarUrl) {
        applyNavAvatar(preferredAvatarUrl);
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
      const displayName = [firstName, lastName].filter(Boolean).join(' ') || null;
      let avatarUrlToSave = currentAvatarUrl || null;
      if (firstName !== undefined || lastName !== undefined) {
        if (pendingAvatarFile) {
          avatarUrlToSave = await uploadAdminAvatar(pendingAvatarFile);
          if (!avatarUrlToSave) {
            throw new Error('Could not upload profile photo. Please try again.');
          }
          applyNavAvatar(avatarUrlToSave);
          currentAvatarUrl = avatarUrlToSave;
          pendingAvatarFile = null;
        }
        const { data: existing } = await supa.from('admin_profiles').select('user_id').eq('user_id', adminUser.id).maybeSingle();
        if (existing) {
          const { error: upErr } = await supa.from('admin_profiles').update({
            first_name: firstName || null,
            last_name: lastName || null,
            display_name: displayName,
            avatar_url: avatarUrlToSave,
            updated_at: new Date().toISOString(),
          }).eq('user_id', adminUser.id);
          if (upErr) {
            if ((upErr.message || '').toLowerCase().includes('avatar_url')) {
              const { error: retryErr } = await supa.from('admin_profiles').update({
                first_name: firstName || null,
                last_name: lastName || null,
                display_name: displayName,
                updated_at: new Date().toISOString(),
              }).eq('user_id', adminUser.id);
              if (retryErr) throw new Error(retryErr.message || 'Could not update admin profile.');
            } else {
              throw new Error(upErr.message || 'Could not update admin profile.');
            }
          }
        } else {
          const { error: inErr } = await supa.from('admin_profiles').insert({
            user_id: adminUser.id,
            first_name: firstName || null,
            last_name: lastName || null,
            display_name: displayName,
            avatar_url: avatarUrlToSave,
            updated_at: new Date().toISOString(),
          });
          if (inErr) {
            if ((inErr.message || '').toLowerCase().includes('avatar_url')) {
              const { error: retryErr } = await supa.from('admin_profiles').insert({
                user_id: adminUser.id,
                first_name: firstName || null,
                last_name: lastName || null,
                display_name: displayName,
                updated_at: new Date().toISOString(),
              });
              if (retryErr) throw new Error(retryErr.message || 'Could not save admin profile.');
            } else {
              throw new Error(inErr.message || 'Could not save admin profile.');
            }
          }
        }
      }

      // Keep profiles in sync with admin settings so mobile app sees the same name/avatar.
      if (window.ORG_ID) {
        const profilePayload = {
          display_name: displayName,
          full_name: displayName,
          avatar_url: avatarUrlToSave,
          email: email || adminUser.email || null,
          user_id: adminUser.id || null,
        };
        const { data: profileByUserId } = await supa
          .from('profiles')
          .select('id, employee_name')
          .eq('org_id', window.ORG_ID)
          .eq('user_id', adminUser.id)
          .maybeSingle();
        const { data: profileByEmail } = await supa
          .from('profiles')
          .select('id, employee_name')
          .eq('org_id', window.ORG_ID)
          .ilike('email', email || adminUser.email || '')
          .maybeSingle();

        const existingProfile = profileByUserId || profileByEmail || null;

        if (existingProfile?.id) {
          const { error: profileUpErr } = await supa
            .from('profiles')
            .update(profilePayload)
            .eq('id', existingProfile.id);
          if (profileUpErr) {
            console.warn('[AdminSettings] Could not sync profiles row:', profileUpErr.message);
          }
        } else {
          const employeeKey = (existingProfile?.employee_name || (email || adminUser.email || '').split('@')[0] || 'admin').trim().toLowerCase();
          const { error: profileInErr } = await supa
            .from('profiles')
            .insert({
              org_id: window.ORG_ID,
              employee_name: employeeKey,
              ...profilePayload,
            });
          if (profileInErr) {
            console.warn('[AdminSettings] Could not create profiles row:', profileInErr.message);
          }
        }
      }

      if (updates.length) {
        await Promise.all(updates);
      }

      const planEl = document.getElementById('admin-subscription-plan');
      let newPlan = String(planEl?.value || 'starter').toLowerCase();
      if (!['starter', 'growth', 'scale'].includes(newPlan)) newPlan = 'starter';

      if (typeof window.kkGetEmployeeLimit === 'function' && window.ORG_ID) {
        const { count: pc, error: pcErr } = await supa
          .from('profiles')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', window.ORG_ID);
        if (!pcErr) {
          const lim = window.kkGetEmployeeLimit(newPlan);
          if (lim != null && (pc ?? 0) > lim) {
            throw new Error(
              `Plan "${window.kkGetSubscriptionPlan(newPlan).label}" allows up to ${lim} employees. You have ${pc}. Remove roster entries or choose Scale.`
            );
          }
        }
      }

      const { error: orgErr } = await supa
        .from('orgs')
        .update({ name: restaurantName, subscription_plan: newPlan })
        .eq('id', window.ORG_ID)
        .select();
      if (orgErr) {
        const msg = orgErr.message || 'Could not update restaurant. Check RLS on orgs table.';
        if ((msg || '').toLowerCase().includes('subscription_plan')) {
          throw new Error(`${msg} Run orgs-subscription-plan.sql in Supabase to add the column.`);
        }
        throw new Error(msg);
      }
      // Nav/header always shows product name "Sheek" (orgs.name is still saved for records).
      if (typeof updateOrgBranding === 'function') {
        try { updateOrgBranding(); } catch (_) {}
      }

      showSuccess('Settings saved.');
      if (displayName) {
        const label = document.querySelector('.nav-user .user-profile span');
        if (label) label.textContent = displayName;
      }
      if (currentAvatarUrl) {
        applyNavAvatar(currentAvatarUrl);
      }
      if (typeof window.kkRefreshNavIdentity === 'function') {
        try { await window.kkRefreshNavIdentity(adminUser); } catch (_) {}
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

