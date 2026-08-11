/**
 * Vue Audit — vérification de fuite de mot de passe (k-anonymity Pwned Passwords).
 */

export function createAudit(deps) {
  const { $, refreshIcons } = deps;

  const eyeSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOffSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg>';

  function toHex(buffer) {
    const bytes = new Uint8Array(buffer);
    let hex = '';
    for (let i = 0; i < bytes.length; i += 1) {
      hex += bytes[i].toString(16).padStart(2, '0');
    }
    return hex.toUpperCase();
  }

  async function sha1(value) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('Web Crypto non disponible. Utilisez HTTPS ou un navigateur récent.');
    }
    const digest = await window.crypto.subtle.digest('SHA-1', new TextEncoder().encode(value));
    return toHex(digest);
  }

  async function checkPassword(password) {
    const hash = await sha1(password);
    const prefix = hash.substring(0, 5);
    const suffix = hash.substring(5);
    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
    if (!response.ok) throw new Error('Service indisponible.');
    const text = await response.text();
    for (const line of text.split(/\r?\n/)) {
      const [hashSuffix, count] = line.split(':');
      if (hashSuffix === suffix) return parseInt(count, 10) || 0;
    }
    return 0;
  }

  function showResult(safe, count) {
    const result = $('#audit-result');
    if (!result) return;
    result.classList.add('is-visible');
    result.classList.remove('is-safe', 'is-pwned');
    if (safe) {
      result.classList.add('is-safe');
      result.textContent = '✅ Mot de passe non compromis.';
    } else {
      result.classList.add('is-pwned');
      result.textContent = `⚠️ Compromis ${count.toLocaleString('fr-FR')} fois.`;
    }
  }

  function showError(message) {
    const result = $('#audit-result');
    if (!result) return;
    result.classList.add('is-visible', 'is-pwned');
    result.classList.remove('is-safe');
    result.textContent = `❌ ${message}`;
  }

  let bound = false;

  function bindAudit() {
    if (bound) return;
    bound = true;

    const form = $('#audit-form');
    const input = $('#audit-input');
    const toggle = $('#audit-toggle');

    if (form && input) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = input.value;
        if (!password) return;
        try {
          const count = await checkPassword(password);
          showResult(count === 0, count);
        } catch (err) {
          showError(err.message || 'Erreur.');
        }
      });
    }

    if (toggle && input) {
      toggle.addEventListener('click', () => {
        const showPassword = input.type === 'password';
        input.type = showPassword ? 'text' : 'password';
        toggle.setAttribute('aria-pressed', String(showPassword));
        toggle.innerHTML = showPassword ? eyeOffSvg : eyeSvg;
      });
    }

    const infoBtn = $('#audit-info-btn');
    const infoPopover = $('#audit-info-popover');
    if (infoBtn && infoPopover) {
      infoBtn.addEventListener('click', () => {
        const isOpen = !infoPopover.hidden;
        infoPopover.hidden = isOpen;
        infoBtn.setAttribute('aria-expanded', String(!isOpen));
      });
    }
  }

  function renderAudit() {
    bindAudit();
    const view = $('#audit-view');
    if (view) refreshIcons(view);
  }

  return { renderAudit };
}
