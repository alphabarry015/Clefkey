/**
 * Déverrouillage local par capteur (WebAuthn + PRF).
 * Le secret ne quitte pas l’appareil et n’est pas envoyé au serveur.
 */
import { encryptBytes, decryptBytes, toB64, fromB64 } from './crypto.js';

const DB_NAME = 'clefkey-device-unlock';
const STORE = 'wraps';

export class DeviceUnlockCancelled extends Error {
  constructor() {
    super('Déverrouillage annulé');
    this.name = 'DeviceUnlockCancelled';
  }
}

export function deviceUserId(user) {
  const id = user?.id || user?.user_id || user?.email || '';
  return String(id || '').trim();
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

function randomBytes(size) {
  return crypto.getRandomValues(new Uint8Array(size));
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'userId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Stockage local indisponible'));
  });
}

async function idbGet(userId) {
  if (!userId) return null;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(userId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbPut(record) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function idbDelete(userId) {
  if (!userId || !window.indexedDB) return;
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function platformName() {
  let platform = '';
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      const data = await navigator.userAgentData.getHighEntropyValues(['platform']);
      platform = data?.platform || '';
    }
  } catch { /* ignore */ }
  if (!platform) platform = navigator.userAgentData?.platform || navigator.platform || '';
  return `${platform} ${navigator.userAgent || ''}`.toLowerCase();
}

/** Libellé du capteur, ou null si ce système n’est pas pris en charge. */
export async function deviceUnlockLabel() {
  const blob = await platformName();
  if (/android/.test(blob)) return 'Empreinte';
  if (/iphone|ipad|ipod/.test(blob)) {
    const longest = Math.max(window.screen?.width || 0, window.screen?.height || 0);
    return longest >= 800 ? 'Face ID' : 'Touch ID';
  }
  if (/mac/.test(blob)) return 'Touch ID';
  if (/win/.test(blob)) return 'Windows Hello';
  return null;
}

/** Raison pour laquelle le capteur ne peut pas encore protéger la clé, ou chaîne vide. */
export async function deviceUnlockBlockReason() {
  const label = await deviceUnlockLabel();
  if (!label) return 'Ce système ne propose pas ce déverrouillage.';
  if (!window.isSecureContext) return 'Ouvrez le site en HTTPS ou sur localhost.';
  if (!window.PublicKeyCredential) {
    return 'Ce navigateur ne gère pas le capteur. Utilisez Chrome ou Edge.';
  }
  if (typeof PublicKeyCredential.getClientCapabilities !== 'function'
    || typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function') {
    return 'Mettez Chrome ou Edge à jour pour protéger la clé avec le capteur.';
  }
  try {
    const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    if (!available) {
      return `Activez ${label} dans les paramètres du système (code PIN, visage ou empreinte).`;
    }
    const caps = await PublicKeyCredential.getClientCapabilities();
    if (!caps?.prf) {
      return 'Ce navigateur ne peut pas encore protéger la clé du coffre. Mettez Chrome ou Edge à jour.';
    }
  } catch {
    return 'Impossible de vérifier le capteur de cet appareil.';
  }
  return '';
}

/** Vrai seulement si un capteur plateforme et l’extension PRF sont disponibles. */
export async function deviceUnlockSupported() {
  return (await deviceUnlockBlockReason()) === '';
}

export async function hasDeviceUnlock(user) {
  const userId = deviceUserId(user);
  if (!userId) return false;
  try {
    const row = await idbGet(userId);
    return Boolean(row?.credentialId && row?.prfSalt && row?.wrapped);
  } catch {
    return false;
  }
}

export async function clearDeviceUnlock(user) {
  try {
    await idbDelete(deviceUserId(user));
  } catch { /* ignore */ }
}

function prfBytes(credential) {
  const first = credential?.getClientExtensionResults?.()?.prf?.results?.first;
  const bytes = asBytes(first);
  if (!bytes || bytes.length < 32) {
    throw new Error('Cet appareil ne fournit pas de secret de capteur.');
  }
  return bytes.slice(0, 32);
}

function isCancel(err) {
  const name = err?.name || '';
  return name === 'NotAllowedError' || name === 'AbortError';
}

function userHandle(userId) {
  const bytes = new TextEncoder().encode(userId);
  return bytes.length <= 64 ? bytes : bytes.slice(0, 64);
}

async function wrapKeys(prfKey, state) {
  const vaultKey = asBytes(state.vaultKey);
  const privateKey = asBytes(state.privateKey);
  const publicKey = asBytes(state.publicKey);
  if (!vaultKey || !privateKey || !publicKey) {
    throw new Error('Ouvrez d’abord le coffre avec le mot de passe maître.');
  }
  const payload = new TextEncoder().encode(JSON.stringify({
    vaultKey: toB64(vaultKey),
    privateKey: toB64(privateKey),
    publicKey: toB64(publicKey),
  }));
  return encryptBytes(payload, prfKey);
}

/** Enrôle le capteur de cet appareil et enveloppe les clés déjà en mémoire. */
export async function enrollDeviceUnlock(state) {
  if (!(await deviceUnlockSupported())) {
    throw new Error('Ce système ne propose pas de capteur compatible.');
  }
  const userId = deviceUserId(state.user);
  if (!userId) throw new Error('Compte introuvable.');
  const email = state.user?.email || userId;
  const prfSalt = randomBytes(32);
  let credential;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'Clefkey', id: location.hostname },
        user: {
          id: userHandle(userId),
          name: email,
          displayName: email,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'required',
          userVerification: 'required',
        },
        timeout: 60000,
        attestation: 'none',
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    });
  } catch (err) {
    if (isCancel(err)) throw new DeviceUnlockCancelled();
    throw err;
  }
  if (!credential) throw new DeviceUnlockCancelled();
  const prfKey = prfBytes(credential);
  const wrapped = await wrapKeys(prfKey, state);
  await idbPut({
    userId,
    credentialId: toB64(new Uint8Array(credential.rawId)),
    prfSalt: toB64(prfSalt),
    wrapped: toB64(wrapped),
  });
  return deviceUnlockLabel();
}

/** Déballe les clés du coffre après vérification du capteur. */
export async function unlockWithDevice(user) {
  const userId = deviceUserId(user);
  const row = await idbGet(userId);
  if (!row) throw new Error('Aucun capteur activé sur cet appareil.');
  let assertion;
  try {
    assertion = await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        allowCredentials: [{
          type: 'public-key',
          id: fromB64(row.credentialId),
        }],
        userVerification: 'required',
        timeout: 60000,
        extensions: { prf: { eval: { first: fromB64(row.prfSalt) } } },
      },
    });
  } catch (err) {
    if (isCancel(err)) throw new DeviceUnlockCancelled();
    throw err;
  }
  if (!assertion) throw new DeviceUnlockCancelled();
  const prfKey = prfBytes(assertion);
  let packed;
  try {
    packed = await decryptBytes(fromB64(row.wrapped), prfKey);
  } catch {
    throw new Error('Impossible de lire la clé protégée par le capteur.');
  }
  const data = JSON.parse(new TextDecoder().decode(packed));
  return {
    vaultKey: fromB64(data.vaultKey),
    privateKey: fromB64(data.privateKey),
    publicKey: fromB64(data.publicKey),
  };
}
