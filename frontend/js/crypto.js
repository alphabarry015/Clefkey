/* Crypto côté client — compatible avec le backend Python */

import { argon2id } from '../vendor/hash-wasm.esm.min.js';
import { ed25519, x25519 } from '../vendor/noble-ed25519.bundle.js';
import { assertCryptoReady } from './compat.js';

const SALT_SIZE = 16;
const NONCE_SIZE = 12;
const KEY_SIZE = 32;
/** Ne pas changer : les comptes existants dépendent de ces paramètres. */
const MEMORY_COST = 65536;
const TIME_COST = 3;
const PARALLELISM = 4;

let _argon2Worker = null;
let _argon2WorkerFailed = false;
let _argon2ReqId = 0;
/** Au-delà : abandonner le worker (404 / hang) et basculer sur le thread principal. */
const ARGON2_WORKER_TIMEOUT_MS = 25000;

function markArgon2WorkerFailed() {
  _argon2WorkerFailed = true;
  if (_argon2Worker) {
    try { _argon2Worker.terminate(); } catch (_) { /* ignore */ }
    _argon2Worker = null;
  }
}

function getArgon2Worker() {
  if (_argon2WorkerFailed || typeof Worker === 'undefined') return null;
  if (_argon2Worker) return _argon2Worker;
  try {
    _argon2Worker = new Worker(new URL('./argon2-worker.js', import.meta.url), { type: 'module' });
    _argon2Worker.onerror = () => {
      markArgon2WorkerFailed();
    };
    return _argon2Worker;
  } catch (_) {
    markArgon2WorkerFailed();
    return null;
  }
}

function deriveKeyOnMainThread(masterPassword, salt) {
  return argon2id({
    password: new TextEncoder().encode(masterPassword),
    salt,
    parallelism: PARALLELISM,
    iterations: TIME_COST,
    memorySize: MEMORY_COST,
    hashLength: KEY_SIZE,
    outputType: 'binary',
  }).then((hash) => new Uint8Array(hash));
}

function deriveKeyInWorker(masterPassword, salt) {
  const worker = getArgon2Worker();
  if (!worker) return null;
  const id = (_argon2ReqId += 1);
  const saltCopy = new Uint8Array(salt);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      fn(value);
    };
    const onMessage = (event) => {
      if (!event.data || event.data.id !== id) return;
      if (event.data.ok) {
        finish(resolve, new Uint8Array(event.data.hash));
      } else {
        finish(reject, new Error(event.data.error || 'Échec Argon2'));
      }
    };
    const onError = () => {
      markArgon2WorkerFailed();
      finish(reject, new Error('Worker Argon2 indisponible'));
    };
    const timer = setTimeout(() => {
      markArgon2WorkerFailed();
      finish(reject, new Error('Worker Argon2 timeout'));
    }, ARGON2_WORKER_TIMEOUT_MS);
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    try {
      worker.postMessage({
        id,
        password: masterPassword,
        salt: saltCopy.buffer,
        parallelism: PARALLELISM,
        iterations: TIME_COST,
        memorySize: MEMORY_COST,
        hashLength: KEY_SIZE,
      }, [saltCopy.buffer]);
    } catch (err) {
      markArgon2WorkerFailed();
      finish(reject, err instanceof Error ? err : new Error('Worker Argon2 indisponible'));
    }
  });
}

/** Nombre de clés de récupération générées à l'inscription. */
export const RECOVERY_KEY_COUNT = 7;
const RECOVERY_SECRET_SIZE = 32;
const RECOVERY_WRAP_DOMAIN = 'gardefort-recovery-wrap-v1';
const RECOVERY_VERIFY_DOMAIN = 'gardefort-recovery-verify-v1';
const RECOVERY_PROOF_DOMAIN = 'gardefort-recovery-proof-v1';

// ── Utilitaires ──────────────────────────────────────────

export function toB64(bytes) {
  // Évite le débordement de pile sur de gros tableaux (spread ...bytes).
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromB64(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

function toBuffer(u8) {
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

function concat(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

// ── Dérivation de clé (Argon2id) ───────────────────────

export function generateSalt() {
  assertCryptoReady();
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

export async function deriveKey(masterPassword, salt) {
  assertCryptoReady();
  try {
    const viaWorker = deriveKeyInWorker(masterPassword, salt);
    if (viaWorker) {
      try {
        return await viaWorker;
      } catch (_) {
        // Fallback thread principal si le worker échoue (CSP, navigateur).
        _argon2WorkerFailed = true;
        try { _argon2Worker?.terminate(); } catch (_) { /* ignore */ }
        _argon2Worker = null;
        return await deriveKeyOnMainThread(masterPassword, salt);
      }
    }
    return await deriveKeyOnMainThread(masterPassword, salt);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : '';
    if (/memory|out of memory|Array buffer|Wasm|WebAssembly/i.test(msg)) {
      throw new Error(
        'Dérivation de clé interrompue (mémoire insuffisante). Fermez des onglets, '
        + 'réessayez, ou utilisez Chrome / Firefox / Edge à jour.',
      );
    }
    throw new Error(
      msg || 'Échec de la dérivation Argon2. Navigateur trop ancien (Safari 16+ recommandé).',
    );
  }
}

export async function createAuthVerifier(derivedKey) {
  const data = concat(derivedKey, new TextEncoder().encode('auth_verifier'));
  const hash = await crypto.subtle.digest('SHA-256', toBuffer(data));
  return new Uint8Array(hash);
}

// ── AES-256-GCM ──────────────────────────────────────────

async function importAesKey(rawKey) {
  assertCryptoReady();
  return crypto.subtle.importKey('raw', toBuffer(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(plaintext, key) {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_SIZE));
  const aesKey = await importAesKey(key);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(nonce) }, aesKey, toBuffer(plaintext))
  );
  return concat(nonce, ciphertext);
}

export async function decryptBytes(encrypted, key) {
  const nonce = encrypted.slice(0, NONCE_SIZE);
  const ciphertext = encrypted.slice(NONCE_SIZE);
  const aesKey = await importAesKey(key);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toBuffer(nonce) }, aesKey, toBuffer(ciphertext)
  );
  return new Uint8Array(plaintext);
}

export async function encryptData(data, key) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  return encryptBytes(json, key);
}

export async function decryptData(encrypted, key) {
  const plaintext = await decryptBytes(encrypted, key);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

export function generateVaultKey() {
  return crypto.getRandomValues(new Uint8Array(32));
}

// ── X25519 ───────────────────────────────────────────────

export function generateKeypair() {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export async function encryptPrivateKey(privateKey, vaultKey) {
  return encryptBytes(privateKey, vaultKey);
}

export async function decryptPrivateKey(encrypted, vaultKey) {
  return decryptBytes(encrypted, vaultKey);
}

async function deriveSharedAesKey(privateKey, publicKey) {
  const shared = x25519.getSharedSecret(privateKey, publicKey);
  const digest = await crypto.subtle.digest('SHA-256', toBuffer(new Uint8Array(shared)));
  return new Uint8Array(digest);
}

/** Chiffre un objet JSON pour la clé publique X25519 du destinataire (ECDH éphémère). */
export async function encryptForRecipient(data, recipientPublicKey) {
  assertCryptoReady();
  const ephemeral = generateKeypair();
  const aesKey = await deriveSharedAesKey(ephemeral.privateKey, recipientPublicKey);
  const encrypted = await encryptBytes(new TextEncoder().encode(JSON.stringify(data)), aesKey);
  return concat(ephemeral.publicKey, encrypted);
}

/** Déchiffre un blob produit par encryptForRecipient. */
export async function decryptFromSender(blob, privateKey) {
  assertCryptoReady();
  if (!blob || blob.length < 32 + NONCE_SIZE + 16) {
    throw new Error('Partage invalide');
  }
  const ephemeralPublicKey = blob.slice(0, 32);
  const encrypted = blob.slice(32);
  const aesKey = await deriveSharedAesKey(privateKey, ephemeralPublicKey);
  const plaintext = await decryptBytes(encrypted, aesKey);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ── Générateur de mots de passe ──────────────────────────

export function generatePassword(length = 20) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const n = Math.max(12, Math.min(64, Number(length) || 20));
  const maxUnbiased = 256 - (256 % chars.length);
  let out = '';
  while (out.length < n) {
    const buf = new Uint8Array(n - out.length + 8);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b >= maxUnbiased) continue;
      out += chars[b % chars.length];
      if (out.length >= n) break;
    }
  }
  return out;
}

export { generateSshEd25519KeyPair } from './crypto-ssh.js';

// ── Récupération (7 clés haute entropie) ─────────────────

function generateRecoverySecret() {
  assertCryptoReady();
  return crypto.getRandomValues(new Uint8Array(RECOVERY_SECRET_SIZE));
}

/** Affichage humain : HEX groupé (256 bits d'entropie). */
export function formatRecoveryCode(secret) {
  const hex = Array.from(secret, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return hex.match(/.{1,4}/g).join('-');
}

export function parseRecoveryCode(code) {
  const hex = String(code || '').replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== RECOVERY_SECRET_SIZE * 2) {
    throw new Error('Clé de récupération invalide (format attendu : 64 hexadécimaux)');
  }
  const out = new Uint8Array(RECOVERY_SECRET_SIZE);
  for (let i = 0; i < RECOVERY_SECRET_SIZE; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hashDomain(domain, secret) {
  const data = concat(new TextEncoder().encode(domain), secret);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', toBuffer(data)));
}

async function recoveryWrappingKey(secret) {
  return hashDomain(RECOVERY_WRAP_DOMAIN, secret);
}

export async function recoveryVerifierFromSecret(secret) {
  return hashDomain(RECOVERY_VERIFY_DOMAIN, secret);
}

export async function recoveryVerifierFromCode(code) {
  return recoveryVerifierFromSecret(parseRecoveryCode(code));
}

export async function recoveryKeyProofFromVaultKey(vaultKey) {
  return hashDomain(RECOVERY_PROOF_DOMAIN, vaultKey);
}

export async function createRecoveryPackages(vaultKey) {
  const codes = [];
  const packages = [];
  const keyProof = await recoveryKeyProofFromVaultKey(vaultKey);
  const keyProofB64 = toB64(keyProof);
  for (let i = 0; i < RECOVERY_KEY_COUNT; i += 1) {
    const secret = generateRecoverySecret();
    const wrapKey = await recoveryWrappingKey(secret);
    const encrypted = await encryptBytes(vaultKey, wrapKey);
    const verifier = await recoveryVerifierFromSecret(secret);
    codes.push(formatRecoveryCode(secret));
    packages.push({
      verifier: toB64(verifier),
      encrypted_vault_key: toB64(encrypted),
      key_proof: keyProofB64,
    });
  }
  return { codes, packages };
}

export async function unwrapVaultKeyWithRecoveryCode(code, encryptedVaultKeyRecovery) {
  const secret = parseRecoveryCode(code);
  const wrapKey = await recoveryWrappingKey(secret);
  return decryptBytes(encryptedVaultKeyRecovery, wrapKey);
}

/** Nouveau MDP maître après récupération (sans régénérer les clés). */
export async function prepareMasterPasswordReset(vaultKey, newMasterPassword, salt) {
  const derived = await deriveKey(newMasterPassword, salt);
  const authVerifier = await createAuthVerifier(derived);
  const encryptedVaultKey = await encryptBytes(vaultKey, derived);
  return { authVerifier, encryptedVaultKey };
}

// ── Session crypto ───────────────────────────────────────

export async function prepareRegistration(masterPassword) {
  const salt = generateSalt();
  const derived = await deriveKey(masterPassword, salt);
  const authVerifier = await createAuthVerifier(derived);
  const vaultKey = generateVaultKey();
  const { privateKey, publicKey } = generateKeypair();
  const encryptedVaultKey = await encryptBytes(vaultKey, derived);
  const encryptedPrivateKey = await encryptPrivateKey(privateKey, vaultKey);
  const recovery = await createRecoveryPackages(vaultKey);
  return {
    salt,
    authVerifier,
    vaultKey,
    privateKey,
    publicKey,
    encryptedVaultKey,
    encryptedPrivateKey,
    recoveryCodes: recovery.codes,
    recoveryPackages: recovery.packages,
  };
}

export async function unlockSession(authResponse, masterPassword, options = {}) {
  const salt = fromB64(authResponse.salt);
  // Réutilise le dérivé de prepareLogin quand le sel n’a pas changé (évite un 2ᵉ Argon2).
  let derived = options.derivedKey || null;
  if (!derived || (options.saltB64 && options.saltB64 !== authResponse.salt)) {
    derived = await deriveKey(masterPassword, salt);
  }
  const vaultKey = await decryptBytes(fromB64(authResponse.encrypted_vault_key), derived);
  const privateKey = await decryptPrivateKey(fromB64(authResponse.encrypted_private_key), vaultKey);
  const publicKey = fromB64(authResponse.public_key);
  return { vaultKey, privateKey, publicKey };
}

export async function prepareLogin(email, masterPassword, apiBase) {
  let resp;
  try {
    resp = await fetch(`${apiBase}/auth/salt?email=${encodeURIComponent(email)}`);
  } catch {
    throw new Error('Impossible de joindre le serveur pour préparer la connexion.');
  }
  if (!resp.ok) {
    let detail = '';
    try {
      const body = await resp.json();
      if (body && typeof body.detail === 'string') detail = body.detail;
    } catch { /* ignore */ }
    if (resp.status === 429) {
      throw new Error(detail || 'Trop de tentatives. Réessayez plus tard.');
    }
    throw new Error(detail || 'Impossible de préparer la connexion');
  }
  const { salt: saltB64 } = await resp.json();
  const salt = fromB64(saltB64);
  const derived = await deriveKey(masterPassword, salt);
  const authVerifier = await createAuthVerifier(derived);
  return {
    authVerifier: toB64(authVerifier),
    derived,
    saltB64,
  };
}
