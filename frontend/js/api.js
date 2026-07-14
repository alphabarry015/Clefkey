/**
 * Client HTTP vers l'API Django (/auth, /vault).
 * Toutes les méthodes lèvent Error avec le message serveur en cas d'échec.
 */

const API_BASE = window.location.origin;

function formatApiError(payload, fallback) {
  if (!payload || typeof payload !== 'object') return fallback;
  const detail = payload.detail ?? payload.error ?? payload.message;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item.msg === 'string') return item.msg;
        return JSON.stringify(item);
      })
      .filter(Boolean)
      .join(' ') || fallback;
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail);
  return fallback;
}

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  let resp;
  try {
    resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error(
      'Impossible de joindre le serveur. Vérifiez votre connexion et que le site est en HTTPS.',
    );
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(formatApiError(err, `Erreur serveur (${resp.status})`));
  }
  if (resp.status === 204) return null;
  return resp.json();
}

export const api = {
  register(payload) {
    return request('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
  },

  async login(email, authVerifierB64) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, auth_verifier: authVerifierB64 }),
    });
  },

  recoveryBegin(email, verifierB64) {
    return request('/auth/recovery/begin', {
      method: 'POST',
      body: JSON.stringify({ email, verifier: verifierB64 }),
    });
  },

  recoveryComplete(payload) {
    return request('/auth/recovery/complete', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getProfile(token) {
    return request('/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  },

  updateProfile(token, payload) {
    return request('/auth/me', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  getEntries(token) {
    return request('/vault/entries', { headers: { Authorization: `Bearer ${token}` } });
  },

  createEntry(token, encryptedDataB64) {
    return request('/vault/entries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ encrypted_data: encryptedDataB64 }),
    });
  },

  deleteEntry(token, id) {
    return request(`/vault/entries/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  lookupUser(token, email) {
    return request(`/auth/lookup?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  createShare(token, payload) {
    return request('/vault/shares', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  },

  getSharesReceived(token) {
    return request('/vault/shares/received', {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  getSharesSent(token) {
    return request('/vault/shares/sent', {
      headers: { Authorization: `Bearer ${token}` },
    });
  },

  deleteShare(token, shareId) {
    return request(`/vault/shares/${shareId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  },
};
