/** Générateur de clés SSH (Ed25519, format OpenSSH). */

import { ed25519 } from '../vendor/noble-ed25519.bundle.js';
import { assertCryptoReady } from './compat.js';

const SSH_AUTH_MAGIC = new TextEncoder().encode('openssh-key-v1\0');
const SSH_ED25519 = 'ssh-ed25519';

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Chaîne SSH wire : uint32 BE longueur + octets. */
function sshString(value) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const out = new Uint8Array(4 + data.length);
  new DataView(out.buffer).setUint32(0, data.length, false);
  out.set(data, 4);
  return out;
}

function sshUint32(n) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, false);
  return out;
}

function encodeOpenSshPublicBlob(publicKey) {
  return concatBytes(sshString(SSH_ED25519), sshString(publicKey));
}

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function wrapPem(label, bodyB64) {
  const lines = bodyB64.match(/.{1,70}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function encodeOpenSshPrivateKey(seed, publicKey, comment) {
  const pubBlob = encodeOpenSshPublicBlob(publicKey);
  const check = crypto.getRandomValues(new Uint8Array(4));
  const checkInt = new DataView(check.buffer).getUint32(0, false);
  // OpenSSH Ed25519 : clé privée = seed (32) || public (32)
  const privMaterial = concatBytes(seed, publicKey);
  let privateSection = concatBytes(
    sshUint32(checkInt),
    sshUint32(checkInt),
    sshString(SSH_ED25519),
    sshString(publicKey),
    sshString(privMaterial),
    sshString(comment || ''),
  );
  // Padding (cipher none → bloc 8) : 1, 2, 3, …
  const padLen = (8 - (privateSection.length % 8)) % 8;
  if (padLen) {
    const pad = new Uint8Array(padLen);
    for (let i = 0; i < padLen; i++) pad[i] = i + 1;
    privateSection = concatBytes(privateSection, pad);
  }

  const body = concatBytes(
    SSH_AUTH_MAGIC,
    sshString('none'),
    sshString('none'),
    sshString(new Uint8Array(0)),
    sshUint32(1),
    sshString(pubBlob),
    sshString(privateSection),
  );
  return wrapPem('OPENSSH PRIVATE KEY', toBase64(body));
}

function encodeOpenSshPublicLine(publicKey, comment) {
  const blob = encodeOpenSshPublicBlob(publicKey);
  const line = `${SSH_ED25519} ${toBase64(blob)}`;
  return comment ? `${line} ${comment}` : line;
}

async function sshFingerprintSha256(publicKey) {
  const blob = encodeOpenSshPublicBlob(publicKey);
  const digest = await crypto.subtle.digest('SHA-256', blob);
  const b64 = toBase64(new Uint8Array(digest)).replace(/=+$/, '');
  return `SHA256:${b64}`;
}

/**
 * Génère une paire Ed25519 au format OpenSSH (privée + publique + fingerprint).
 * @param {string} [comment]
 * @returns {Promise<{ privateKey: string, publicKey: string, fingerprint: string }>}
 */
export async function generateSshEd25519KeyPair(comment = '') {
  assertCryptoReady();
  const seed = ed25519.utils.randomPrivateKey();
  try {
    const publicKey = ed25519.getPublicKey(seed);
    const privateKey = encodeOpenSshPrivateKey(seed, publicKey, comment);
    const publicLine = encodeOpenSshPublicLine(publicKey, comment);
    const fingerprint = await sshFingerprintSha256(publicKey);
    return { privateKey, publicKey: publicLine, fingerprint };
  } finally {
    seed.fill(0);
  }
}
