/**
 * Session navigateur : survit au rafraîchissement (sessionStorage),
 * expire après inactivité (pas au simple F5).
 * Le mot de passe maître n’est jamais stocké.
 */

import { toB64, fromB64 } from './crypto.js';

const STORAGE_KEY = 'gardefort_vault_session';
const LEGACY_STORAGE_KEYS = ['binalph93_vault_session'];

/** Durée sans action avant verrouillage (alignée sous le JWT ~60 min). */
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart'];

let idleTimer = null;
let activityThrottle = null;
let onIdleCallback = null;

function now() {
  return Date.now();
}

export function clearStoredSession() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    LEGACY_STORAGE_KEYS.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    /* private mode / quota */
  }
}

export function saveSession(state) {
  if (state.devMode || !state.token || !state.vaultKey) {
    clearStoredSession();
    return;
  }
  try {
    const payload = {
      token: state.token,
      user: state.user,
      vaultKey: toB64(state.vaultKey),
      privateKey: toB64(state.privateKey),
      publicKey: toB64(state.publicKey),
      authMaterial: state.authMaterial || null,
      lastActivity: now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    clearStoredSession();
  }
}

/**
 * @returns {null | { token, user, vaultKey, privateKey, publicKey, authMaterial }}
 */
export function loadSessionIfFresh() {
  try {
    let raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
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
    if (!data?.token || !data?.vaultKey || !data?.lastActivity) {
      clearStoredSession();
      return null;
    }
    if (now() - data.lastActivity > IDLE_TIMEOUT_MS) {
      clearStoredSession();
      return null;
    }
    return {
      token: data.token,
      user: data.user,
      vaultKey: fromB64(data.vaultKey),
      privateKey: fromB64(data.privateKey),
      publicKey: fromB64(data.publicKey),
      authMaterial: data.authMaterial || null,
    };
  } catch {
    clearStoredSession();
    return null;
  }
}

export function touchSessionActivity(state) {
  if (!state?.token || state.devMode) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      saveSession(state);
      return;
    }
    const data = JSON.parse(raw);
    data.lastActivity = now();
    data.token = state.token;
    data.user = state.user;
    if (state.authMaterial) data.authMaterial = state.authMaterial;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    saveSession(state);
  }
}

function remainingIdleMs() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw);
    return Math.max(0, IDLE_TIMEOUT_MS - (now() - Number(data.lastActivity || 0)));
  } catch {
    return 0;
  }
}

function scheduleIdleCheck() {
  if (idleTimer) clearTimeout(idleTimer);
  const delay = remainingIdleMs();
  idleTimer = setTimeout(() => {
    if (typeof onIdleCallback === 'function') onIdleCallback();
  }, delay);
}

function handleActivity(getState) {
  const state = getState();
  if (!state?.token || state.devMode) return;
  if (activityThrottle) return;
  activityThrottle = setTimeout(() => {
    activityThrottle = null;
  }, 1000);
  touchSessionActivity(state);
  scheduleIdleCheck();
}

function handleVisibility(getState) {
  if (document.visibilityState !== 'visible') return;
  const state = getState();
  if (!state?.token || state.devMode) return;
  if (!loadSessionIfFresh()) {
    if (typeof onIdleCallback === 'function') onIdleCallback();
    return;
  }
  scheduleIdleCheck();
}

export function startIdleWatch(getState, onIdle) {
  stopIdleWatch();
  onIdleCallback = onIdle;
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
}
