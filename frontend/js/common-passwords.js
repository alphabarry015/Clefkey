/**
 * Vérification contre les listes SecLists (sélection Passwords).
 * Chargement en 2 phases via manifeste :
 *  1. listes prioritaires (rapide) → validation possible
 *  2. reste en arrière-plan → enrichit le Set
 * Timeout pour ne pas bloquer l'inscription si /data/ est lent.
 */

const MANIFEST_URL = '/data/common-passwords-manifest.json';
const FETCH_TIMEOUT_MS = 12000;
const PRIORITY_BUDGET_MS = 15000;

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

function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: 'force-cache', signal: ctrl.signal })
    .finally(() => clearTimeout(timer));
}

async function fetchTexts(paths) {
  const responses = await Promise.all(
    paths.map((rel) => fetchWithTimeout(`/data/${rel}`)),
  );
  const ok = responses.filter((r) => r.ok);
  if (!ok.length) {
    throw new Error('Impossible de charger la liste des mots de passe courants');
  }
  return Promise.all(ok.map((r) => r.text()));
}

function startBackgroundLoad(restPaths, set) {
  if (backgroundStarted || !restPaths.length) return;
  backgroundStarted = true;
  // Par lots pour ne pas saturer le réseau / Vercel
  const chunkSize = 4;
  (async () => {
    for (let i = 0; i < restPaths.length; i += chunkSize) {
      const chunk = restPaths.slice(i, i + chunkSize);
      try {
        const texts = await fetchTexts(chunk);
        for (const text of texts) addLinesToSet(text, set);
      } catch {
        // ignore lot en échec
      }
    }
  })();
}

/**
 * Charge les listes prioritaires (lazy). Enrichit ensuite le reste en arrière-plan.
 * @returns {Promise<Set<string>>}
 */
export async function loadCommonPasswords() {
  if (commonSet) return commonSet;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const manifestResp = await fetchWithTimeout(MANIFEST_URL);
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
      : allPaths.slice(0, Math.min(5, allPaths.length));
    const rest = allPaths.filter((p) => !priority.includes(p));

    const budget = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Délai dépassé pour les listes de mots de passe')), PRIORITY_BUDGET_MS);
    });

    const texts = await Promise.race([fetchTexts(priority), budget]);
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
