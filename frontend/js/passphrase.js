/**
 * Passphrase de déverrouillage — formatage auto + validation (min. 3 mots).
 */

/** Nombre minimum de mots (séparés par des espaces). */
export const PASSPHRASE_MIN_WORDS = 3;

/**
 * Force une majuscule en début de phrase et après chaque point.
 * Les autres caractères saisis par l'utilisateur sont conservés.
 * @param {string} raw
 * @returns {string}
 */
export function formatPassphraseInput(raw) {
  const text = String(raw ?? '');
  let out = '';
  let capitalizeNext = true;
  for (const ch of text) {
    if (capitalizeNext && /[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(ch)) {
      out += ch.toLocaleUpperCase('fr-FR');
      capitalizeNext = false;
      continue;
    }
    out += ch;
    if (ch === '.') capitalizeNext = true;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {number}
 */
export function countPassphraseWords(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Applique le formatage sur un input en préservant la position du curseur au mieux.
 * @param {HTMLInputElement|HTMLTextAreaElement} el
 */
export function applyPassphraseFormatting(el) {
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const before = el.value;
  const after = formatPassphraseInput(before);
  if (before === after) return;
  el.value = after;
  if (typeof start === 'number' && typeof end === 'number') {
    const delta = after.length - before.length;
    const nextStart = Math.max(0, start + delta);
    const nextEnd = Math.max(0, end + delta);
    try {
      el.setSelectionRange(nextStart, nextEnd);
    } catch {
      /* ignore */
    }
  }
}

/**
 * @param {string} passphrase
 * @returns {string|null} message d'erreur ou null si OK
 */
export function validatePassphrase(passphrase) {
  const formatted = formatPassphraseInput(passphrase || '');
  if (!formatted.trim()) {
    return 'La passphrase est requise';
  }
  if (countPassphraseWords(formatted) < PASSPHRASE_MIN_WORDS) {
    return `Minimum ${PASSPHRASE_MIN_WORDS} mots`;
  }
  if (!/^[A-ZÀÂÄÉÈÊËÏÎÔÙÛÜŸÇ]/.test(formatted.trim())) {
    return 'La passphrase doit commencer par une majuscule';
  }
  return null;
}
