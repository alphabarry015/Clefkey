(function () {
  try {
    var pref = localStorage.getItem('clefkey_theme') || 'system';
    if (pref !== 'light' && pref !== 'dark' && pref !== 'system') pref = 'system';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
    document.documentElement.setAttribute('data-theme-pref', pref);
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {}
})();