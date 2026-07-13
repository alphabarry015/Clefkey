/**
 * Vérification contre les listes SecLists (sélection Passwords).
 * Chargement en 2 phases via manifeste :
 *  1. listes prioritaires (rapide) → validation possible
 *  2. reste en arrière-plan → enrichit le Set
 * Le maître n'est jamais envoyé au serveur pour ce check.
 */

const MANIFEST_URL = '/data/common-passwords-manifest.json';

let commonSet = null;
let loadPromise = null;
let backgroundStarted = false;

function addLinesToSet(text, set) {
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith('#')) continue;
    set.add(raw.toLowerCase());
    const colon = raw.indexOf(':');
    if (colon > 0 && colon < raw.length - 1 && !raw.includes('://')) {
      const pwd = raw.slice(colon + 1).trim();
      if (pwd) set.add(pwd.toLowerCase());
    }
  }
}

async function fetchTexts(paths) {
  const responses = await Promise.all(
    paths.map((rel) => fetch(`/data/${rel}`, { cache: 'force-cache' })),
  );
  const failed = responses.find((r) => !r.ok);
  if (failed) {
    throw new Error('Impossible de charger la liste des mots de passe courants');
  }
  return Promise.all(responses.map((r) => r.text()));
}

function startBackgroundLoad(restPaths, set) {
  if (backgroundStarted || !restPaths.length) return;
  backgroundStarted = true;
  fetchTexts(restPaths)
    .then((texts) => {
      for (const text of texts) addLinesToSet(text, set);
    })
    .catch(() => {
      // Les listes prioritaires suffisent déjà pour bloquer l'essentiel.
    });
}

/**
 * Charge les listes prioritaires (lazy). Enrichit ensuite le reste en arrière-plan.
 * @returns {Promise<Set<string>>}
 */
export async function loadCommonPasswords() {
  if (commonSet) return commonSet;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const manifestResp = await fetch(MANIFEST_URL, { cache: 'force-cache' });
    if (!manifestResp.ok) {
      throw new Error('Impossible de charger le manifeste des mots de passe courants');
    }
    const manifest = await manifestResp.json();
    const allPaths = Array.isArray(manifest.files) ? manifest.files : [];
    if (!allPaths.length) {
      throw new Error('Manifeste des mots de passe courants vide');
    }

    const priority = Array.isArray(manifest.priority) && manifest.priority.length
      ? manifest.priority.filter((p) => allPaths.includes(p))
      : allPaths.slice(0, Math.min(8, allPaths.length));
    const rest = allPaths.filter((p) => !priority.includes(p));

    const texts = await fetchTexts(priority);
    const set = new Set();
    for (const text of texts) addLinesToSet(text, set);
    commonSet = set;
    startBackgroundLoad(rest, set);
    return commonSet;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

/**
 * @param {string} password
 * @returns {Promise<boolean>} true si le mot de passe est trop courant
 */
export async function isCommonPassword(password) {
  if (!password) return false;
  const set = await loadCommonPasswords();
  return set.has(password.toLowerCase());
}

/** Précharge en arrière-plan (ex. onglet Inscription ouvert). */
export function prefetchCommonPasswords() {
  loadCommonPasswords().catch(() => {});
}
