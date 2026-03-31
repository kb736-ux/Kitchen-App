/**
 * Production URLs for sheekapp.com
 * - Marketing site: https://sheekapp.com  (this folder)
 * - Manager dashboard: https://app.sheekapp.com  (deploy KennyKitchenWeb here)
 *
 * On localhost, dashboard links stay relative so you can develop without DNS.
 */
(function () {
  var APP_HOST = 'app.sheekapp.com';
  var APP_PROTOCOL = 'https:';

  function dashboardUrl() {
    var h = window.location.hostname;
    if (!h || h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0') {
      return '../KennyKitchenWeb/index.html';
    }
    return APP_PROTOCOL + '//' + APP_HOST + '/';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var u = dashboardUrl();
    var ctas = document.querySelectorAll('a[data-sheek-dashboard]');
    for (var i = 0; i < ctas.length; i++) {
      ctas[i].href = u;
    }
  });
})();
