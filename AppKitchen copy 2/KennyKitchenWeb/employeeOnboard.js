(async function () {
  function setStatus(title, message, isError) {
    const subtitle = document.getElementById('onboard-subtitle');
    const body = document.getElementById('onboard-body');
    if (subtitle && title) subtitle.textContent = title;
    if (body && message) {
      body.innerHTML = `<p style="color:${isError ? '#b91c1c' : '#4b5563'};">${message}</p>`;
    }
  }

  async function run() {
    if (!window.supabaseClient) {
      setStatus('Something went wrong', 'Supabase is not ready. Please try opening the link again.', true);
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const orgId = params.get('org') || window.ORG_ID;
    const employeeName = params.get('name') || '';
    const isManager = params.get('manager') === '1';

    try {
      const { data, error } = await window.supabaseClient.auth.getUser();
      if (error || !data?.user) {
        setStatus('Sign‑in required', 'Please open this page using the magic link we emailed you.', true);
        return;
      }
      const user = data.user;

      if (!orgId) {
        setStatus('Missing restaurant', 'We could not determine which restaurant to link you to. Ask your manager to resend the invite.', true);
        return;
      }

      // Link user to org_members
      try {
        const { error: orgErr } = await window.supabaseClient
          .from('org_members')
          .upsert(
            {
              org_id: orgId,
              user_id: user.id,
              role: isManager ? 'manager' : 'employee',
              position: null,
            },
            { onConflict: 'org_id,user_id' }
          );
        if (orgErr) {
          console.warn('[Onboard] org_members upsert failed:', orgErr.message);
        }
      } catch (e) {
        console.warn('[Onboard] org_members error:', e.message);
      }

      // If manager, also grant admin access
      if (isManager) {
        try {
          const { error: adminErr } = await window.supabaseClient
            .from('admin_users')
            .upsert({ user_id: user.id, is_admin: true }, { onConflict: 'user_id' });
          if (adminErr) {
            console.warn('[Onboard] admin_users upsert failed:', adminErr.message);
          }
        } catch (e) {
          console.warn('[Onboard] admin_users error:', e.message);
        }
      }

      const niceName = employeeName || user.email || 'your account';
      setStatus(
        'You’re all set!',
        `We linked ${niceName} to the restaurant. You can now use this email to sign in on the Kenny Kitchen web app, and the mobile app will recognize you as part of this restaurant.`,
        false
      );
    } catch (e) {
      console.warn('[Onboard] Unexpected error:', e.message);
      setStatus('Something went wrong', 'We could not finish setting up your account. Please try again or ask your manager to resend the invite.', true);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();

