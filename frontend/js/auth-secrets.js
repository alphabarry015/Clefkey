/**
 * Empêche l'enregistrement / l'autofill du mot de passe maître par le navigateur.
 */

const SECRET_FIELDS = [
  '#login-password',
  '#register-password',
  '#register-password-confirm',
  '#unlock-password',
  '#master-confirm-password',
  '#recovery-new-password',
  '#recovery-new-password-confirm',
];

export function clearAuthSecrets() {
  for (const sel of SECRET_FIELDS) {
    const el = document.querySelector(sel);
    if (el) el.value = '';
  }
  if (navigator.credentials?.preventSilentAccess) {
    navigator.credentials.preventSilentAccess().catch(() => {});
  }
}
