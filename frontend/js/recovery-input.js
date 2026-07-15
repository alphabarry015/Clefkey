/**
 * Masque de saisie pour les clés de récupération (hex 64 → groupes de 4).
 */

export const RECOVERY_HEX_LENGTH = 64;

export function normalizeRecoveryInput(raw) {
  return String(raw || '')
    .replace(/[^0-9a-fA-F]/g, '')
    .toUpperCase()
    .slice(0, RECOVERY_HEX_LENGTH);
}

export function formatRecoveryInput(hex) {
  const clean = normalizeRecoveryInput(hex);
  if (!clean) return '';
  return clean.match(/.{1,4}/g).join('-');
}

function countHexBeforeCaret(value, caret) {
  const before = String(value || '').slice(0, Math.max(0, caret ?? 0));
  return before.replace(/[^0-9a-fA-F]/g, '').length;
}

function caretFromHexCount(formatted, hexCount) {
  if (hexCount <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/[0-9a-fA-F]/i.test(formatted[i])) {
      seen += 1;
      if (seen >= hexCount) return i + 1;
    }
  }
  return formatted.length;
}

function updateCounter(input, counter) {
  if (!counter) return;
  const n = normalizeRecoveryInput(input.value).length;
  counter.textContent = `${n} / ${RECOVERY_HEX_LENGTH}`;
  counter.classList.toggle('is-complete', n === RECOVERY_HEX_LENGTH);
}

export function setRecoveryCodeValue(input, raw, counter) {
  if (!input) return;
  const formatted = formatRecoveryInput(raw);
  input.value = formatted;
  updateCounter(input, counter);
}

export function bindRecoveryCodeInput(input, { counter } = {}) {
  if (!input) return () => {};

  const apply = (raw, preferredHexCaret = null) => {
    const formatted = formatRecoveryInput(raw);
    const hexCaret = preferredHexCaret == null
      ? normalizeRecoveryInput(raw).length
      : preferredHexCaret;
    input.value = formatted;
    const nextCaret = caretFromHexCount(formatted, hexCaret);
    try {
      input.setSelectionRange(nextCaret, nextCaret);
    } catch {
      /* ignore unsupported selection */
    }
    updateCounter(input, counter);
  };

  const onInput = () => {
    const hexBefore = countHexBeforeCaret(input.value, input.selectionStart);
    apply(input.value, hexBefore);
  };

  const onPaste = (event) => {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') || '';
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    const merged = `${before}${pasted}${after}`;
    const hexBefore = normalizeRecoveryInput(before).length;
    const pastedHex = normalizeRecoveryInput(pasted).length;
    apply(merged, hexBefore + pastedHex);
  };

  input.addEventListener('input', onInput);
  input.addEventListener('paste', onPaste);
  updateCounter(input, counter);

  return () => {
    input.removeEventListener('input', onInput);
    input.removeEventListener('paste', onPaste);
  };
}
