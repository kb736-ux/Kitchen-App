(function () {
  var KEY = "sheek_onboard_v1";

  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || "{}") || {};
    } catch (_) {
      return {};
    }
  }

  function save(partial) {
    try {
      var next = Object.assign({}, load(), partial || {});
      sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch (_) {}
  }

  /**
   * @param {string[]} keys
   * @param {string} redirectHref
   * @returns {Record<string, string>|null}
   */
  function require(keys, redirectHref) {
    var o = load();
    for (var i = 0; i < keys.length; i++) {
      if (!String(o[keys[i]] || "").trim()) {
        window.location.href = redirectHref;
        return null;
      }
    }
    return o;
  }

  window.sheekOnboard = { load: load, save: save, require: require, KEY: KEY };
})();
