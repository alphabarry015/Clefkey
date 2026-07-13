/* Crypto côté client — compatible avec le backend Python */

import { argon2id } from 'https://esm.sh/hash-wasm@4.12.0';
import { x25519 } from 'https://esm.sh/@noble/curves@1.8.1/ed25519';

const SALT_SIZE = 16;
const NONCE_SIZE = 12;
const KEY_SIZE = 32;
const MEMORY_COST = 65536;
const TIME_COST = 3;
const PARALLELISM = 4;

// ── Utilitaires ──────────────────────────────────────────

export function toB64(bytes) {
  return btoa(String.fromCharCode(...bytes));
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
  return crypto.getRandomValues(new Uint8Array(SALT_SIZE));
}

export async function deriveKey(masterPassword, salt) {
  const hash = await argon2id({
    password: new TextEncoder().encode(masterPassword),
    salt,
    parallelism: PARALLELISM,
    iterations: TIME_COST,
    memorySize: MEMORY_COST,
    hashLength: KEY_SIZE,
    outputType: 'binary',
  });
  return new Uint8Array(hash);
}

export async function createAuthVerifier(derivedKey) {
  const data = concat(derivedKey, new TextEncoder().encode('auth_verifier'));
  const hash = await crypto.subtle.digest('SHA-256', toBuffer(data));
  return new Uint8Array(hash);
}

// ── AES-256-GCM ──────────────────────────────────────────

async function importAesKey(rawKey) {
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

// ── Générateur de mots de passe ──────────────────────────

export function generatePassword(length = 20) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, b => chars[b % chars.length]).join('');
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
  return { salt, authVerifier, vaultKey, privateKey, publicKey, encryptedVaultKey, encryptedPrivateKey };
}

export async function unlockSession(authResponse, masterPassword) {
  const salt = fromB64(authResponse.salt);
  const derived = await deriveKey(masterPassword, salt);
  const vaultKey = await decryptBytes(fromB64(authResponse.encrypted_vault_key), derived);
  const privateKey = await decryptPrivateKey(fromB64(authResponse.encrypted_private_key), vaultKey);
  const publicKey = fromB64(authResponse.public_key);
  return { vaultKey, privateKey, publicKey };
}

export async function prepareLogin(email, masterPassword, apiBase) {
  const resp = await fetch(`${apiBase}/auth/salt?email=${encodeURIComponent(email)}`);
  if (!resp.ok) throw new Error('Utilisateur introuvable');
  const { salt: saltB64 } = await resp.json();
  const salt = fromB64(saltB64);
  const derived = await deriveKey(masterPassword, salt);
  const authVerifier = await createAuthVerifier(derived);
  return toB64(authVerifier);
}
