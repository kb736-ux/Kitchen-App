(function () {
  var y = document.getElementById('y');
  if (y) y.textContent = String(new Date().getFullYear());

  var toggle = document.querySelector('.menu-toggle');
  var mobile = document.querySelector('.nav-mobile');
  if (!toggle || !mobile) return;

  toggle.addEventListener('click', function () {
    var open = mobile.hasAttribute('hidden');
    if (open) {
      mobile.removeAttribute('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    } else {
      mobile.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  var links = mobile.querySelectorAll('a');
  for (var i = 0; i < links.length; i++) {
    links[i].addEventListener('click', function () {
      mobile.setAttribute('hidden', '');
      toggle.setAttribute('aria-expanded', 'false');
    });
  }
})();
