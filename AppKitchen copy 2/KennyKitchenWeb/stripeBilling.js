/**
 * Sheek — Stripe via Supabase Edge Functions (no secret keys in the browser).
 * Requires: supabaseClient + session; deploy stripe-checkout, stripe-portal, stripe-webhook.
 */
(function () {
  function pageBaseUrl() {
    const { origin, pathname } = window.location;
    if (!origin || origin === 'null') return '';
    return `${origin}${pathname}`;
  }

  window.kkStripeCheckout = async function (planId, orgId) {
    const supa = window.supabaseClient;
    if (!supa) throw new Error('Not connected to Supabase.');
    if (!orgId) throw new Error('No organization selected.');
    const base = pageBaseUrl();
    if (!base) throw new Error('Open the dashboard from http(s):// (not file://) so Stripe can return here.');

    const successUrl = `${base}${base.includes('?') ? '&' : '?'}billing=success`;
    const cancelUrl = `${base}${base.includes('?') ? '&' : '?'}billing=cancel`;

    const { data, error } = await supa.functions.invoke('stripe-checkout', {
      body: {
        plan: planId,
        org_id: orgId,
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
    });
    if (error) throw new Error(error.message || 'Checkout request failed');
    if (data?.error) throw new Error(data.error);
    if (!data?.url) throw new Error('No checkout URL returned');
    window.location.href = data.url;
  };

  window.kkStripePortal = async function (orgId) {
    const supa = window.supabaseClient;
    if (!supa) throw new Error('Not connected to Supabase.');
    if (!orgId) throw new Error('No organization selected.');
    const base = pageBaseUrl();
    if (!base) throw new Error('Open the dashboard from http(s):// (not file://).');
    const returnUrl = base.split('?')[0];

    const { data, error } = await supa.functions.invoke('stripe-portal', {
      body: { org_id: orgId, return_url: returnUrl },
    });
    if (error) throw new Error(error.message || 'Portal request failed');
    if (data?.error) throw new Error(data.error);
    if (!data?.url) throw new Error('No portal URL returned');
    window.location.href = data.url;
  };
})();
