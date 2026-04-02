/**
 * Production URLs for sheekapp.com
 * - Marketing site: https://sheekapp.com  (this folder)
 * - Manager dashboard: https://app.sheekapp.com  (deploy KennyKitchenWeb here)
 *
 * On localhost, dashboard links stay relative so you can develop without DNS.
 *
 * Until app.sheekapp.com DNS exists, set a global before this script:
 *   <script>window.SHEEK_DASHBOARD_ORIGIN = "https://your-dashboard-host.netlify.app";</script>
 * (no trailing slash required). Also add that origin to Edge Function secret
 * ONBOARD_ALLOWED_URL_PREFIXES for Stripe onboard success/cancel URLs.
 *
 * Data attributes (wired on DOMContentLoaded):
 *   data-sheek-dashboard     → dashboard home
 *   data-sheek-login         → dashboard with ?login=1 (sign-in tab)
 *   data-sheek-signup        → dashboard with ?signup=1 (new restaurant); optional data-plan="growth"
 *   window.sheekBuildSignupUrl({ email, first_name, last_name, plan }) → dashboard signup URL with prefill
 *   data-sheek-onboard       → marketing onboard wizard (onboard/index.html); optional data-plan="growth"
 *   data-sheek-app="x.html"  → other dashboard pages (employees.html, scheduling.html, …)
 */
(function () {
  var APP_HOST = 'app.sheekapp.com';
  var APP_PROTOCOL = 'https:';

  function productionDashboardBase() {
    try {
      var o = window.SHEEK_DASHBOARD_ORIGIN;
      if (o != null && String(o).trim()) {
        return String(o).trim().replace(/\/+$/, '') + '/';
      }
    } catch (_) {}
    return APP_PROTOCOL + '//' + APP_HOST + '/';
  }

  function dashboardUrl() {
    var h = window.location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') {
      return '../KennyKitchenWeb/index.html';
    }
    return productionDashboardBase();
  }

  function dashboardUrlWithQuery(queryString) {
    var base = dashboardUrl();
    var q = String(queryString || '').replace(/^\?/, '');
    if (!q) return base;
    var sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + q;
  }

  function appPage(filename) {
    var name = String(filename || '').replace(/^\//, '');
    if (!name) return dashboardUrl();
    var base = dashboardUrl();
    if (base.indexOf('index.html') !== -1) {
      return base.replace(/index\.html(\?.*)?$/i, name);
    }
    if (base.slice(-1) === '/') return base + name;
    return base + '/' + name;
  }

  /**
   * Build dashboard URL for new-restaurant signup with optional prefill from the marketing site.
   * @param {{ email?: string, first_name?: string, last_name?: string, plan?: string }} opts
   */
  function buildSignupUrl(opts) {
    opts = opts || {};
    var parts = ['signup=1'];
    var plan = String(opts.plan || '').toLowerCase().trim();
    if (plan === 'starter' || plan === 'growth' || plan === 'scale') {
      parts.push('plan=' + encodeURIComponent(plan));
    }
    var em = String(opts.email || '').trim();
    if (em) parts.push('email=' + encodeURIComponent(em));
    var fn = String(opts.first_name || '').trim();
    if (fn) parts.push('first_name=' + encodeURIComponent(fn));
    var ln = String(opts.last_name || '').trim();
    if (ln) parts.push('last_name=' + encodeURIComponent(ln));
    return dashboardUrlWithQuery(parts.join('&'));
  }

  try {
    window.sheekBuildSignupUrl = buildSignupUrl;
  } catch (_) {}

  document.addEventListener('DOMContentLoaded', function () {
    var u = dashboardUrl();
    var ctas = document.querySelectorAll('a[data-sheek-dashboard]');
    for (var i = 0; i < ctas.length; i++) {
      ctas[i].href = u;
    }

    document.querySelectorAll('a[data-sheek-login]').forEach(function (a) {
      a.href = dashboardUrlWithQuery('login=1');
    });

    document.querySelectorAll('a[data-sheek-signup]').forEach(function (a) {
      var plan = (a.getAttribute('data-plan') || '').toLowerCase().trim();
      a.href = buildSignupUrl(plan ? { plan: plan } : {});
    });

    document.querySelectorAll('a[data-sheek-app]').forEach(function (a) {
      var page = a.getAttribute('data-sheek-app');
      if (page) a.href = appPage(page);
    });

    document.querySelectorAll('a[data-sheek-onboard]').forEach(function (a) {
      var plan = (a.getAttribute('data-plan') || '').toLowerCase().trim();
      var q = plan === 'starter' || plan === 'growth' || plan === 'scale' ? '?plan=' + encodeURIComponent(plan) : '';
      a.href = 'onboard/index.html' + q;
    });
  });
})();
