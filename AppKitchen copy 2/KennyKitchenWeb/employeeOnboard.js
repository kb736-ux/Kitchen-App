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

  function buildRedirectUrl(orgId, employeeName, isManager, emailQuery) {
    const p = new URLSearchParams();
    if (orgId) p.set('org', orgId);
    if (employeeName) p.set('name', employeeName);
    p.set('manager', isManager ? '1' : '0');
    const e = (emailQuery || '').trim();
    if (e) p.set('email', e);
    const path = window.location.pathname || '/employee-onboard.html';
    return `${window.location.origin}${path}?${p.toString()}`;
  }

  async function linkOrgAndFinish(supabase, orgId, employeeName, isManager, user) {
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

  function bindUnauthedForms(supabase, orgId, employeeName, isManager, prefillEmail) {
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
      const redirectTo = buildRedirectUrl(orgId, employeeName, isManager, email);
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
      bindPasswordForm(supabase, orgId, employeeName, isManager, data.session.user);
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

  function bindPasswordForm(supabase, orgId, employeeName, isManager, user) {
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
      await linkOrgAndFinish(supabase, orgId, employeeName, isManager, user);
    });
  }

  async function route(supabase, orgId, employeeName, isManager, prefillEmail) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      setSubtitle('Sign up or sign in');
      showStep('step-unauthed');
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
      }
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
      await linkOrgAndFinish(supabase, orgId, employeeName, isManager, session.user);
      document.getElementById('step-done-link')?.removeAttribute('hidden');
      return;
    }

    setSubtitle('Create your password');
    showStep('step-password');
    bindPasswordForm(supabase, orgId, employeeName, isManager, session.user);
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

    bindUnauthedForms(supabase, orgId, employeeName, isManager, prefillEmail);

    await route(supabase, orgId, employeeName, isManager, prefillEmail);

    supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        try {
          if (sessionStorage.getItem(PW_LOGIN_FLAG) === '1') return;
        } catch (_) {}
        const stillUnauthed = document.getElementById('step-unauthed');
        if (stillUnauthed && !stillUnauthed.hidden) {
          setSubtitle('Create your password');
          showStep('step-password');
          bindPasswordForm(supabase, orgId, employeeName, isManager, session.user);
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
