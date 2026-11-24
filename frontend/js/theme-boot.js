(function () {
  try {
    var key = 'clefkey_theme';
    var pref = localStorage.getItem(key) || 'system';
    if (pref !== 'light' && pref !== 'dark' && pref !== 'system') pref = 'system';
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
    var bg = resolved === 'dark' ? '#0a0a0a' : '#f4f6fb';
    document.documentElement.setAttribute('data-theme-pref', pref);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.style.backgroundColor = bg;
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', bg);
  } catch (e) {}
})();
