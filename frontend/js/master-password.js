/**
 * Politique du mot de passe maître (longueur, complexité, listes SecLists).
 */

import { isCommonPassword } from './common-passwords.js';

export const MASTER_PASSWORD_MIN_LENGTH = 12;

export function checkStrength(password) {
  let score = 0;
  if (password.length >= MASTER_PASSWORD_MIN_LENGTH) score++;
  if (password.length >= 16) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return score;
}

/**
 * @param {string} password
 * @returns {Promise<string|null>} message d'erreur ou null si OK
 */
export async function validateMasterPassword(password) {
  if (!password || password.length < MASTER_PASSWORD_MIN_LENGTH) {
    return `Minimum ${MASTER_PASSWORD_MIN_LENGTH} caractères`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) {
    return 'Ajoutez des majuscules et des minuscules';
  }
  if (!/\d/.test(password)) {
    return 'Ajoutez au moins un chiffre';
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return 'Ajoutez au moins un caractère spécial';
  }
  if (checkStrength(password) < 4) {
    return 'Mot de passe maître trop faible';
  }
  try {
    if (await isCommonPassword(password)) {
      return 'Ce mot de passe est trop courant. Choisissez-en un autre.';
    }
  } catch {
    // Si la liste ne charge pas, on refuse plutôt que d'accepter un MDP faible connu
    return 'Vérification de sécurité indisponible. Réessayez dans un instant.';
  }
  return null;
}
