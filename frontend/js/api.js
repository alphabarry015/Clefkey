/* Client API */

const API_BASE = window.location.origin;

async function request(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || 'Erreur serveur');
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
};
