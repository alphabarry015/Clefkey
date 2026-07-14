/**
 * Compatibilité navigateurs : détection + presse-papiers.
 * Cible : Chrome/Edge récents, Firefox ESR, Safari 16+ (HTTPS requis).
 */

export function getCryptoSupportIssues() {
  const issues = [];
  if (!window.isSecureContext) {
    issues.push(
      'Cette page doit être ouverte en HTTPS (ou sur localhost). Le chiffrement ne fonctionne pas en HTTP ni en fichier local.',
    );
  }
  if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
    issues.push('Votre navigateur ne fournit pas un générateur cryptographique sécurisé.');
  }
  if (!window.crypto || !window.crypto.subtle) {
    issues.push(
      'Web Crypto (crypto.subtle) est indisponible. Mettez à jour le navigateur ou utilisez HTTPS.',
    );
  }
  if (typeof WebAssembly === 'undefined') {
    issues.push('WebAssembly est requis pour dériver votre clé (Argon2).');
  }
  if (typeof TextEncoder === 'undefined' || typeof TextDecoder === 'undefined') {
    issues.push('TextEncoder/TextDecoder manquants — navigateur trop ancien.');
  }
  return issues;
}

export function assertCryptoReady() {
  const issues = getCryptoSupportIssues();
  if (issues.length) {
    throw new Error(issues[0]);
  }
}

export function showCompatBannerIfNeeded() {
  const el = document.getElementById('compat-banner');
  const text = document.getElementById('compat-banner-text');
  if (!el || !text) return false;
  const issues = getCryptoSupportIssues();
  if (!issues.length) {
    el.classList.add('hidden');
    return false;
  }
  text.textContent = issues[0];
  el.classList.remove('hidden');
  return true;
}

function legacyCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.padding = '0';
  ta.style.border = 'none';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/**
 * Copie fiable (Clipboard API + fallback Safari / Firefox / permissions).
 * @returns {Promise<boolean>}
 */
export async function copyToClipboard(text) {
  if (text == null) return false;
  const value = String(text);
  if (window.isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through */
    }
  }
  return legacyCopy(value);
}
