/**
 * Manager app (KennyKitchenWeb) — public redirect target for “Log in” and post-onboarding.
 *
 * If you land on sheekapp.com (marketing) after login, app.sheekapp.com may not be deployed
 * or points at this same site. Set MANAGER_APP_ORIGIN to wherever KennyKitchenWeb is actually
 * hosted (e.g. https://your-manager.netlify.app).
 */
(function () {
  var MANAGER_APP_ORIGIN = "https://app.sheekapp.com";
  try {
    if (typeof window.SHEEK_DASHBOARD_ORIGIN === "string" && String(window.SHEEK_DASHBOARD_ORIGIN).trim()) {
      return;
    }
    window.SHEEK_DASHBOARD_ORIGIN = String(MANAGER_APP_ORIGIN).trim().replace(/\/+$/, "");
  } catch (_) {}
})();
