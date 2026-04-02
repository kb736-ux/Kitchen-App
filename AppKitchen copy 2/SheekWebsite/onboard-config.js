/**
 * Marketing-site onboarding — same Supabase project as KennyKitchenWeb/supabase-config.js
 * Used only to call Edge Functions (stripe-onboard-checkout). Keep URL/key in sync when rotating keys.
 *
 * If app.sheekapp.com is not in DNS yet, set before this script (see site-config.js comment):
 *   window.SHEEK_DASHBOARD_ORIGIN = "https://your-real-dashboard-host.example.com";
 */
(function () {
  window.SHEEK_SUPABASE_URL = "https://xutxuhypqpxobujxdhfz.supabase.co";
  window.SHEEK_SUPABASE_ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh1dHh1aHlwcXB4b2J1anhkaGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMjYzNTIsImV4cCI6MjA4NzgwMjM1Mn0.ojXb8Y1l1o-MFRMFzPk8zUewDehp5UzMw_EJzz3rTI4";

  window.sheekOnboardFunctionUrl = function (fnName) {
    var base = String(window.SHEEK_SUPABASE_URL || "").replace(/\/$/, "");
    return base + "/functions/v1/" + String(fnName || "").replace(/^\//, "");
  };

  /** Absolute URL to manager dashboard entry (matches site-config dashboard home). */
  window.sheekDashboardIndexUrl = function () {
    var h = window.location.hostname;
    if (!h || h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0") {
      return new URL("../../KennyKitchenWeb/index.html", window.location.href).href.split("#")[0];
    }
    try {
      var o = window.SHEEK_DASHBOARD_ORIGIN;
      if (o != null && String(o).trim()) {
        return String(o).trim().replace(/\/+$/, "") + "/";
      }
    } catch (_) {}
    return "https://app.sheekapp.com/";
  };
})();
