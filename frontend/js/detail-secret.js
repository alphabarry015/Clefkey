/**
 * Secret affiché dans la fiche détail — hors DOM (pas de data-real).
 */

let detailPlainSecret = '';

export function setDetailPlainSecret(value) {
  detailPlainSecret = typeof value === 'string' ? value : '';
}

export function getDetailPlainSecret() {
  return detailPlainSecret;
}

export function clearDetailPlainSecret() {
  detailPlainSecret = '';
}
