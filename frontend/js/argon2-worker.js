/* Web Worker — dérivation Argon2id hors du thread UI. */
import { argon2id } from '../vendor/hash-wasm.esm.min.js';

self.onmessage = async (event) => {
  const { id, password, salt, parallelism, iterations, memorySize, hashLength } = event.data || {};
  try {
    const hash = await argon2id({
      password: new TextEncoder().encode(password),
      salt: new Uint8Array(salt),
      parallelism,
      iterations,
      memorySize,
      hashLength,
      outputType: 'binary',
    });
    const out = new Uint8Array(hash);
    self.postMessage({ id, ok: true, hash: out.buffer }, [out.buffer]);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err && err.message ? String(err.message) : 'Échec Argon2',
    });
  }
};
