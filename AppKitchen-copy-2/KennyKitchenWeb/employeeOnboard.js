(function () {
  const PW_LOGIN_FLAG = 'kk_onboard_password_login';

  function normalizePhone(raw) {
    let s = String(raw || '')
      .trim()
      .replace(/[\s()-]/g, '');
    if (!s) return '';
    if (s.startsWith('+')) return s;
    if (/^\d{10}$/.test(s)) return '+1' + s;
    if (/^\d+$/.test(s)) return '+' + s;
    return s;
  }

  function setSubtitle(text) {
    const el = document.getElementById('onboard-subtitle');
    if (el) el.textContent = text;
  }

  function showIntro(show) {
    const intro = document.getElementById('onboard-body-intro');
    if (intro) intro.hidden = !show;
  }

  function showStep(step) {
    ['step-unauthed', 'step-password', 'step-done'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = id !== step;
    });
    showIntro(step === 'step-unauthed');
  }

  function setUnauthedDisabled(disabled) {
    const box = document.getElementById('unauthed-recovery-forms');
    if (!box) return;
    box.querySelectorAll('input, button, select, textarea').forEach((el) => {
      el.disabled = !!disabled;
    });
  }

  /** Remove PKCE ?code= (and auth hash) from the address bar without losing org/name params. */
  function scrubAuthFromUrl() {
    try {
      const u = new URL(window.location.href);
      let changed = false;
      ['code', 'error', 'error_description', 'error_code'].forEach((k) => {
        if (u.searchParams.has(k)) {
          u.searchParams.delete(k);
          changed = true;
        }
      });
      if (window.location.hash && /access_token|refresh_token|error/i.test(window.location.hash)) {
        u.hash = '';
        changed = true;
      }
      if (changed) window.history.replaceState({}, '', u.pathname + u.search + u.hash);
    } catch (_) {}
  }

  function decodeAuthErrorMessage(raw) {
    if (!raw || typeof raw !== 'string') return raw || '';
    try {
      return decodeURIComponent(raw.replace(/\+/g, ' ')).trim();
    } catch (_) {
      return String(raw).replace(/\+/g, ' ').trim();
    }
  }

  function showFormError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (msg) {
      el.textContent = msg;
      el.hidden = false;
    } else {
      el.textContent = '';
      el.hidden = true;
    }
  }

  function buildRedirectUrl(orgId, employeeName, isManager, emailQuery, positionLabels) {
    const p = new URLSearchParams();
    if (orgId) p.set('org', orgId);
    if (employeeName) p.set('name', employeeName);
    p.set('manager', isManager ? '1' : '0');
    const e = (emailQuery || '').trim();
    if (e) p.set('email', e);
    const labels = Array.isArray(positionLabels)
      ? positionLabels.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (labels.length) p.set('pos', labels.join('|'));
    const path = window.location.pathname || '/employee-onboard.html';
    return `${window.location.origin}${path}?${p.toString()}`;
  }

  function parsePositionsParam(raw) {
    if (!raw || typeof raw !== 'string') return [];
    return raw
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function splitDisplayName(fullName) {
    const dn = (fullName || '').trim();
    if (!dn) return { first: '', last: '' };
    const parts = dn.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  }

  async function linkOrgAndFinish(supabase, orgId, employeeName, isManager, user, positionLabels) {
    if (!orgId) {
      setSubtitle('Missing restaurant');
      showStep('step-done');
      const msg = document.getElementById('step-done-message');
      if (msg) {
        msg.innerHTML =
          'We could not determine which restaurant to link you to. Ask your manager to resend the invite.';
      }
      return;
    }

    try {
      const { error: orgErr } = await supabase.from('org_members').upsert(
        {
          org_id: orgId,
          user_id: user.id,
          role: isManager ? 'manager' : 'employee',
          position: null,
        },
        { onConflict: 'org_id,user_id' }
      );
      if (orgErr) console.warn('[Onboard] org_members upsert failed:', orgErr.message);
    } catch (e) {
      console.warn('[Onboard] org_members error:', e.message);
    }

    if (isManager) {
      try {
        const { error: adminErr } = await supabase
          .from('admin_users')
          .upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
        if (adminErr) console.warn('[Onboard] admin_users upsert failed:', adminErr.message);
      } catch (e) {
        console.warn('[Onboard] admin_users error:', e.message);
      }
    }

    const email = String(user.email || '').trim();
    const dn = (employeeName || '').trim() || email.split('@')[0] || 'Team member';
    const { first: firstName, last: lastName } = splitDisplayName(dn);
    try {
      const { data: existingProfiles } = await supabase
        .from('profiles')
        .select('id, user_id, onboarding_completed')
        .eq('org_id', orgId)
        .ilike('employee_name', dn);

      if (existingProfiles && existingProfiles.length > 0) {
        const { error: updErr } = await supabase
          .from('profiles')
          .update({
            user_id: user.id,
            email: email || null,
            display_name: dn,
            first_name: firstName || null,
            last_name: lastName || null,
            onboarding_completed: true,
          })
          .eq('id', existingProfiles[0].id);
        if (updErr) console.warn('[Onboard] profiles update failed:', updErr.message);
      } else {
        const { error: profErr } = await supabase.from('profiles').insert({
          org_id: orgId,
          user_id: user.id,
          email: email || null,
          display_name: dn,
          employee_name: dn,
          first_name: firstName || null,
          last_name: lastName || null,
          onboarding_completed: true,
        });
        if (profErr) {
          const msg = String(profErr.message || '').toLowerCase();
          const dup = profErr.code === '23505' || msg.includes('duplicate') || msg.includes('unique');
          if (dup) {
            const { error: updErr } = await supabase
              .from('profiles')
              .update({
                org_id: orgId,
                email: email || null,
                display_name: dn,
                employee_name: dn,
                first_name: firstName || null,
                last_name: lastName || null,
                onboarding_completed: true,
              })
              .eq('user_id', user.id)
              .eq('org_id', orgId);
            if (updErr) console.warn('[Onboard] profiles update failed:', updErr.message);
          } else {
            console.warn('[Onboard] profiles insert failed:', profErr.message);
          }
        }
      }
      
      // Async trigger to sync stripe quantity
      try {
        await supabase.functions.invoke('sync-stripe-quantity', { body: { org_id: orgId } });
      } catch (e) {
        console.warn('[Onboard] sync-stripe-quantity failed:', e.message);
      }
    } catch (e) {
      console.warn('[Onboard] profiles error:', e.message);
    }

    const positions = Array.isArray(positionLabels) ? positionLabels : [];
    if (positions.length) {
      try {
        const { error: epErr } = await supabase.from('employee_positions').upsert(
          {
            org_id: orgId,
            employee_name: dn,
            positions,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'org_id,employee_name' }
        );
        if (epErr) console.warn('[Onboard] employee_positions upsert failed:', epErr.message);
      } catch (e) {
        console.warn('[Onboard] employee_positions error:', e.message);
      }
    }

    const niceName = employeeName || user.email || user.phone || 'your account';
    setSubtitle('You’re all set!');
    showStep('step-done');
    const msg = document.getElementById('step-done-message');
    if (msg) {
      msg.innerHTML = `We linked <strong>${escapeHtml(niceName)}</strong> to the restaurant. Sign in anytime with the same email or phone number and your password on the Sheek web app; the mobile app will recognize you as part of this restaurant.`;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function bindUnauthedForms(supabase, orgId, employeeName, isManager, prefillEmail, positionLabels) {
    const emailInput = document.getElementById('ob-email');
    const signinEmail = document.getElementById('ob-signin-email');
    if (emailInput && prefillEmail) emailInput.value = prefillEmail;
    if (signinEmail && prefillEmail) signinEmail.value = prefillEmail;

    document.getElementById('form-send-link')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      showFormError('form-send-link-err', '');
      const email = (emailInput?.value || '').trim();
      if (!email) {
        showFormError('form-send-link-err', 'Enter your email.');
        return;
      }
      const btn = document.getElementById('btn-send-link');
      if (btn) btn.disabled = true;
      const redirectTo = buildRedirectUrl(orgId, employeeName, isManager, email, positionLabels);
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (btn) btn.disabled = false;
      if (error) {
        showFormError('form-send-link-err', error.message || 'Could not send email.');
        return;
      }
      setSubtitle('Check your email');
      showFormError(
        'form-send-link-err',
        ''
      );
      const intro = document.getElementById('onboard-body-intro');
      if (intro) {
        intro.hidden = false;
        intro.textContent =
          'We sent a link to ' + email + '. Open it on this device to confirm your email and continue to create your password.';
      }
    });

    let pendingPhone = '';

    document.getElementById('form-send-sms')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      showFormError('form-send-sms-err', '');
      const phone = normalizePhone(document.getElementById('ob-phone')?.value || '');
      if (!phone || phone.length < 8) {
        showFormError('form-send-sms-err', 'Enter a valid number with country code (e.g. +1…).');
        return;
      }
      const btn = document.getElementById('btn-send-sms');
      if (btn) btn.disabled = true;
      const { error } = await supabase.auth.signInWithOtp({
        phone,
        options: { shouldCreateUser: true },
      });
      if (btn) btn.disabled = false;
      if (error) {
        showFormError('form-send-sms-err', error.message || 'Could not send SMS.');
        return;
      }
      pendingPhone = phone;
      document.getElementById('sms-step-request')?.setAttribute('hidden', '');
      document.getElementById('sms-step-verify')?.removeAttribute('hidden');
      setSubtitle('Enter your code');
      const intro = document.getElementById('onboard-body-intro');
      if (intro) {
        intro.hidden = false;
        intro.textContent = 'We texted a code to your phone. Enter it below, then create your password.';
      }
    });

    document.getElementById('btn-verify-sms')?.addEventListener('click', async () => {
      showFormError('form-send-sms-err', '');
      const token = (document.getElementById('ob-sms-code')?.value || '').replace(/\s/g, '');
      if (!pendingPhone || !token) {
        showFormError('form-send-sms-err', 'Enter the code from your text message.');
        return;
      }
      const btn = document.getElementById('btn-verify-sms');
      if (btn) btn.disabled = true;
      const { data, error } = await supabase.auth.verifyOtp({
        phone: pendingPhone,
        token,
        type: 'sms',
      });
      if (btn) btn.disabled = false;
      if (error || !data?.session) {
        showFormError('form-send-sms-err', error?.message || 'Invalid code. Try again.');
        return;
      }
      setSubtitle('Create your password');
      showStep('step-password');
      bindPasswordForm(supabase, orgId, employeeName, isManager, data.session.user, positionLabels);
    });

    document.getElementById('form-signin')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      showFormError('form-signin-err', '');
      const email = (document.getElementById('ob-signin-email')?.value || '').trim();
      const password = document.getElementById('ob-signin-password')?.value || '';
      if (!email || !password) {
        showFormError('form-signin-err', 'Enter email and password.');
        return;
      }
      const btn = document.getElementById('btn-signin');
      if (btn) btn.disabled = true;
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (btn) btn.disabled = false;
      if (error) {
        showFormError('form-signin-err', error.message || 'Sign-in failed.');
        return;
      }
      try {
        sessionStorage.setItem(PW_LOGIN_FLAG, '1');
      } catch (_) {}
      window.location.reload();
    });
  }

  function bindPasswordForm(supabase, orgId, employeeName, isManager, user, positionLabels) {
    const form = document.getElementById('form-password');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';

    const hint = document.getElementById('pw-signed-in-as');
    if (hint) {
      const id = user.email || user.phone || 'your account';
      hint.textContent = 'Signed in as ' + id + '. Choose a password for next time.';
    }

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      showFormError('form-password-err', '');
      const p1 = document.getElementById('ob-password')?.value || '';
      const p2 = document.getElementById('ob-password2')?.value || '';
      if (p1.length < 8) {
        showFormError('form-password-err', 'Use at least 8 characters.');
        return;
      }
      if (p1 !== p2) {
        showFormError('form-password-err', 'Passwords do not match.');
        return;
      }
      const btn = document.getElementById('btn-password');
      if (btn) btn.disabled = true;
      const { error } = await supabase.auth.updateUser({ password: p1 });
      if (btn) btn.disabled = false;
      if (error) {
        showFormError('form-password-err', error.message || 'Could not save password.');
        return;
      }
      await linkOrgAndFinish(supabase, orgId, employeeName, isManager, user, positionLabels);
    });
  }

  async function route(supabase, orgId, employeeName, isManager, prefillEmail, positionLabels) {
    const hashParams = new URLSearchParams(window.location.hash.substring(1));
    const qParams = new URLSearchParams(window.location.search);
    const sbErrorRaw =
      hashParams.get('error_description') ||
      hashParams.get('error') ||
      qParams.get('error_description') ||
      qParams.get('error');
    const sbError = decodeAuthErrorMessage(sbErrorRaw);

    const dbg = document.getElementById('debug-hash-err');
    const errPanel = document.getElementById('unauthed-error-panel');
    if (dbg) {
      dbg.textContent = '';
      dbg.style.display = 'none';
    }
    if (errPanel) errPanel.hidden = true;

    // Let supabase-js finish detectSessionInUrl / PKCE (mobile Safari can be slower).
    await new Promise((res) => setTimeout(res, 450));
    let {
      data: { session },
    } = await supabase.auth.getSession();

    // Only exchange manually if still no session (avoids double-consuming ?code=).
    if (!session?.user && qParams.has('code')) {
      const { error: exErr } = await supabase.auth.exchangeCodeForSession(qParams.get('code'));
      if (exErr) {
        console.warn('[Onboard] Code exchange failed:', exErr.message);
        let detail = exErr.message || 'link may have expired or been opened twice. Try “Email me a new link” below.';
        if (/pkce|code verifier/i.test(detail)) {
          detail =
            'This link type doesn’t match your browser storage (common with email invites). Use “Email me a new sign-in link” below on this same phone, or ask your manager to resend after your app is updated.';
        }
        if (dbg) {
          dbg.textContent = 'Could not use the link: ' + detail;
          dbg.style.display = 'block';
        }
        if (errPanel) errPanel.hidden = false;
      } else {
        scrubAuthFromUrl();
      }
      ({
        data: { session },
      } = await supabase.auth.getSession());
    } else if (session?.user && qParams.has('code')) {
      scrubAuthFromUrl();
    } else if (hashParams.has('access_token')) {
      await supabase.auth.setSession({
        access_token: hashParams.get('access_token'),
        refresh_token: hashParams.get('refresh_token') || '',
      });
      ({
        data: { session },
      } = await supabase.auth.getSession());
      scrubAuthFromUrl();
    }

    if (!session?.user) {
      setSubtitle('Sign up or sign in');
      showStep('step-unauthed');
      const titleEl = document.getElementById('unauthed-title');
      if (titleEl) titleEl.textContent = orgId ? 'Finish signing in' : 'Invite link incomplete';
      if (sbError) {
        if (dbg) {
          dbg.textContent = sbError;
          dbg.style.display = 'block';
        }
        if (errPanel) errPanel.hidden = false;
      } else if (dbg && dbg.textContent) {
        if (errPanel) errPanel.hidden = false;
      }
      if (!orgId) {
        setSubtitle('Invite link incomplete');
        setUnauthedDisabled(true);
        const intro = document.getElementById('onboard-body-intro');
        if (intro) {
          intro.textContent =
            'Open the invite link from your manager’s email, or ask them to resend it. We need the restaurant ID from that link.';
        }
      } else {
        setUnauthedDisabled(false);
        const intro = document.getElementById('onboard-body-intro');
        if (intro) {
          if (sbError) {
            intro.innerHTML =
              '<strong>On a phone?</strong> The Gmail/Mail <em>in-app</em> browser often breaks magic links. Tap <strong>⋯</strong> or <strong>Open in Safari / Chrome</strong>, then use the button in the email again—or enter your email below for a <strong>new link</strong> to this same page.';
          } else {
            intro.innerHTML =
              'If the button in your email didn’t work, enter the <strong>same email your manager invited</strong> below and we’ll send a fresh link to this page.';
          }
        }
      }
      // Drop error/code fragments from the URL so refresh doesn’t keep showing a stale Supabase error.
      scrubAuthFromUrl();
      return;
    }

    let fromPw = false;
    try {
      fromPw = sessionStorage.getItem(PW_LOGIN_FLAG) === '1';
    } catch (_) {}
    if (fromPw) {
      try {
        sessionStorage.removeItem(PW_LOGIN_FLAG);
      } catch (_) {}
      setSubtitle('Linking your account…');
      showIntro(false);
      showStep('step-done');
      const msg = document.getElementById('step-done-message');
      if (msg) msg.textContent = 'Almost done…';
      document.getElementById('step-done-link')?.setAttribute('hidden', '');
      await linkOrgAndFinish(supabase, orgId, employeeName, isManager, session.user, positionLabels);
      document.getElementById('step-done-link')?.removeAttribute('hidden');
      return;
    }

    setSubtitle('Create your password');
    showStep('step-password');
    bindPasswordForm(supabase, orgId, employeeName, isManager, session.user, positionLabels);
  }

  async function run() {
    if (!window.supabaseClient) {
      setSubtitle('Something went wrong');
      const intro = document.getElementById('onboard-body-intro');
      if (intro) {
        intro.innerHTML =
          '<p style="color:#b91c1c;">Supabase is not ready. Please try opening the link again.</p>';
      }
      return;
    }

    const supabase = window.supabaseClient;
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get('org') || window.ORG_ID;
    const employeeName = params.get('name') || '';
    const isManager = params.get('manager') === '1';
    const prefillEmail = params.get('email') || '';
    const positionLabels = parsePositionsParam(params.get('pos') || '');

    bindUnauthedForms(supabase, orgId, employeeName, isManager, prefillEmail, positionLabels);

    await route(supabase, orgId, employeeName, isManager, prefillEmail, positionLabels);

    supabase.auth.onAuthStateChange(async (event, session) => {
      const validEvents = ['SIGNED_IN', 'PASSWORD_RECOVERY', 'INITIAL_SESSION'];
      if (validEvents.includes(event) && session?.user) {
        try {
          if (sessionStorage.getItem(PW_LOGIN_FLAG) === '1') return;
        } catch (_) {}
        const stillUnauthed = document.getElementById('step-unauthed');
        if (stillUnauthed && !stillUnauthed.hidden) {
          setSubtitle('Create your password');
          showStep('step-password');
          bindPasswordForm(supabase, orgId, employeeName, isManager, session.user, positionLabels);
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
