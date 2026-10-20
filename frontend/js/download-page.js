/**
 * Met en avant la plateforme détectée (Windows / macOS).
 */
(function () {
  const ua = navigator.userAgent || '';
  const platform = (navigator.platform || '').toLowerCase();
  let os = 'other';
  if (/windows|win32|win64/i.test(ua) || platform.includes('win')) os = 'windows';
  else if (/mac os x|macintosh|macintel/i.test(ua) || platform.includes('mac')) os = 'macos';

  const card = document.querySelector(`.dl-card[data-platform="${os}"]`);
  if (card) {
    card.classList.add('is-suggested');
    const hint = document.createElement('p');
    hint.className = 'dl-suggested-hint';
    hint.textContent = 'Recommandé pour cet appareil';
    hint.style.cssText = 'margin:0;font-size:0.78rem;font-weight:600;color:var(--accent,#2F5FF0)';
    card.querySelector('.dl-card-top')?.after(hint);
  }
})();
