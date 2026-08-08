/**
 * Session navigateur — sécurité d’abord + confort F5.
 *
 * On persiste : JWT + profil + authMaterial (salt + blobs chiffrés).
 * On ne persiste JAMAIS : vaultKey / privateKey en clair, ni le mot de passe maître.
 *
 * Après F5 / verrouillage : écran « mot de passe maître » uniquement (pas de reconnect email).
 */

const STORAGE_KEY = 'clefkey_vault_session';
const LEGACY_STORAGE_KEYS = [
  'binalph93_vault_session',
  'gardefort_vault_session',
  'gardefort_persist_session',
  'clefkey_persist_session',
];

/** Durée sans action avant verrouillage soft (alignée sous le JWT ~60 min). */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
/** Onglet en arrière-plan trop longtemps → verrouillage soft au retour. */
export const HIDDEN_LOCK_MS = 5 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart'];

let idleTimer = null;
let activityThrottle = null;
let onIdleCallback = null;
let memoryLastActivity = 0;
let hiddenAt = 0;

function now() {
  return Date.now();
}

export function clearStoredSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => {
      try {
        sessionStorage.removeItem(key);
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* private mode / quota */
  }
}

/** Efface les octets des clés en mémoire (best-effort). */
export function wipeKeyBytes(key) {
  if (key instanceof Uint8Array) {
    key.fill(0);
  }
}

/** Efface les clés déchiffrées (garde token + authMaterial pour re-unlock). */
export function wipeUnlockedSecrets(state) {
  if (!state) return;
  wipeKeyBytes(state.vaultKey);
  wipeKeyBytes(state.privateKey);
  wipeKeyBytes(state.publicKey);
  state.vaultKey = null;
  state.privateKey = null;
  state.publicKey = null;
}

/** Déconnexion complète. */
export function wipeStateSecrets(state) {
  wipeUnlockedSecrets(state);
  if (!state) return;
  state.authMaterial = null;
  state.token = null;
}

function hasAuthMaterial(material) {
  return Boolean(material?.salt && material?.encrypted_vault_key);
}

/**
 * Persiste la session « verrouillable » (jamais de clés en clair).
 */
export function saveSession(state) {
  if (state.devMode || !state.token || !hasAuthMaterial(state.authMaterial)) {
    clearStoredSession();
    return;
  }
  memoryLastActivity = now();
  try {
    const payload = {
      version: 2,
      token: state.token,
      user: state.user,
      authMaterial: {
        salt: state.authMaterial.salt,
        encrypted_vault_key: state.authMaterial.encrypted_vault_key,
        encrypted_private_key: state.authMaterial.encrypted_private_key || null,
        public_key: state.authMaterial.public_key || null,
      },
      lastActivity: memoryLastActivity,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    clearStoredSession();
  }
}

/**
 * Charge une session fraîche (toujours « locked » : il faut le maître).
 * @returns {null | { token, user, authMaterial }}
 */
export function loadSessionIfFresh() {
  try {
    let raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        if (key === 'gardefort_persist_session' || key === 'clefkey_persist_session') continue;
        raw = sessionStorage.getItem(key);
        if (raw) {
          sessionStorage.setItem(STORAGE_KEY, raw);
          sessionStorage.removeItem(key);
          break;
        }
      }
    }
    if (!raw) return null;
    const data = JSON.parse(raw);
    // Purge d’anciennes sessions v1 qui stockaient vaultKey en clair.
    if (data?.vaultKey || data?.privateKey) {
      delete data.vaultKey;
      delete data.privateKey;
      delete data.publicKey;
    }
    if (!data?.token || !hasAuthMaterial(data.authMaterial) || !data?.lastActivity) {
      clearStoredSession();
      return null;
    }
    if (now() - data.lastActivity > IDLE_TIMEOUT_MS) {
      clearStoredSession();
      return null;
    }
    memoryLastActivity = Number(data.lastActivity) || now();
    // Réécrire sans clés claires (migration).
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        token: data.token,
        user: data.user,
        authMaterial: data.authMaterial,
        lastActivity: memoryLastActivity,
      }));
    } catch {
      /* ignore */
    }
    return {
      token: data.token,
      user: data.user,
      authMaterial: data.authMaterial,
    };
  } catch {
    clearStoredSession();
    return null;
  }
}

export function touchSessionActivity(state) {
  if (!state?.token || state.devMode) return;
  // Idle watch uniquement coffre déverrouillé.
  if (!state.vaultKey) return;
  memoryLastActivity = now();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveSession(state);
      return;
    }
    const data = JSON.parse(raw);
    data.lastActivity = memoryLastActivity;
    data.token = state.token;
    data.user = state.user;
    if (hasAuthMaterial(state.authMaterial)) data.authMaterial = state.authMaterial;
    delete data.vaultKey;
    delete data.privateKey;
    delete data.publicKey;
    data.version = 2;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    saveSession(state);
  }
}

function remainingIdleMs() {
  if (!memoryLastActivity) return 0;
  return Math.max(0, IDLE_TIMEOUT_MS - (now() - memoryLastActivity));
}

function scheduleIdleCheck() {
  if (idleTimer) clearTimeout(idleTimer);
  const delay = remainingIdleMs();
  idleTimer = setTimeout(() => {
    if (typeof onIdleCallback === 'function') onIdleCallback('idle');
  }, delay || 0);
}

function handleActivity(getState) {
  const state = getState();
  if (!state?.token || !state?.vaultKey || state.devMode) return;
  if (activityThrottle) return;
  activityThrottle = setTimeout(() => {
    activityThrottle = null;
  }, 1000);
  touchSessionActivity(state);
  scheduleIdleCheck();
}

function handleVisibility(getState) {
  if (document.visibilityState === 'hidden') {
    hiddenAt = now();
    return;
  }

  const state = getState();
  if (!state?.token || !state?.vaultKey || state.devMode) return;

  const awayMs = hiddenAt ? now() - hiddenAt : 0;
  hiddenAt = 0;

  if (awayMs >= HIDDEN_LOCK_MS || remainingIdleMs() <= 0) {
    if (typeof onIdleCallback === 'function') {
      onIdleCallback(awayMs >= HIDDEN_LOCK_MS ? 'hidden' : 'idle');
    }
    return;
  }

  scheduleIdleCheck();
}

export function startIdleWatch(getState, onIdle) {
  stopIdleWatch();
  onIdleCallback = onIdle;
  memoryLastActivity = now();
  hiddenAt = 0;
  const listener = () => handleActivity(getState);
  const visibilityListener = () => handleVisibility(getState);
  ACTIVITY_EVENTS.forEach((evt) => {
    window.addEventListener(evt, listener, { passive: true, capture: true });
  });
  document.addEventListener('visibilitychange', visibilityListener);
  startIdleWatch._listener = listener;
  startIdleWatch._visibilityListener = visibilityListener;
  touchSessionActivity(getState());
  scheduleIdleCheck();
}

export function stopIdleWatch() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (activityThrottle) {
    clearTimeout(activityThrottle);
    activityThrottle = null;
  }
  if (startIdleWatch._listener) {
    ACTIVITY_EVENTS.forEach((evt) => {
      window.removeEventListener(evt, startIdleWatch._listener, { capture: true });
    });
    startIdleWatch._listener = null;
  }
  if (startIdleWatch._visibilityListener) {
    document.removeEventListener('visibilitychange', startIdleWatch._visibilityListener);
    startIdleWatch._visibilityListener = null;
  }
  onIdleCallback = null;
  hiddenAt = 0;
}
