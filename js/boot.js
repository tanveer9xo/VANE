// Runs before the first paint (a plain, blocking script in <head>, so the CSP needs no inline script).
// 1. Refuse to run inside a frame: a <meta> CSP can't send frame-ancestors, so this stops clickjacking.
// 2. Apply the saved appearance before the first paint, so there's no theme flash.
//    Keep in sync with applyAppearance() in js/theme.js.
// 3. Show the splash until the first screen renders (js/app.js removes the class).
(function () {
  var root = document.documentElement;
  if (window.top !== window.self) {
    root.setAttribute('data-framed', '');
    try { window.top.location.replace(window.self.location.href); } catch (e) { /* cross-origin frame: stay hidden */ }
    return;
  }
  var pref = 'system';
  try { pref = localStorage.getItem('appearance') || 'system'; } catch (e) { /* storage blocked */ }
  if (pref !== 'light' && pref !== 'dark') pref = 'system';
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.setAttribute('data-appearance', pref);
  root.style.colorScheme = dark ? 'dark' : 'light';
  // The timeout only matters if the app fails to start, so the splash can never get stuck.
  root.classList.add('booting');
  setTimeout(function () { root.classList.remove('booting'); }, 6000);
  if (pref === 'light' || pref === 'dark') {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) { metas[i].setAttribute('content', dark ? '#0F1226' : '#F4F5FA'); metas[i].removeAttribute('media'); }
  }
})();
