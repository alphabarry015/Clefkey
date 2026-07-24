/**
 * Application principale — Gardefort
 *
 * Écrans : auth → dashboard / liste / profil
 * Mode dev : localhost + champs vides → données mock en mémoire
 * Mode réel : JWT + chiffrement WebCrypto, sync via api.js
 */

import {
  toB64, fromB64, prepareRegistration, unlockSession, prepareLogin,
  encryptData, decryptData, generatePassword, generateSshEd25519KeyPair,
  encryptForRecipient, decryptFromSender,
  RECOVERY_KEY_COUNT,
  recoveryVerifierFromCode,
  recoveryKeyProofFromVaultKey,
  unwrapVaultKeyWithRecoveryCode,
  prepareMasterPasswordReset,
  decryptPrivateKey,
  deriveKey, decryptBytes,
} from './crypto.js';
import { api } from './api.js';
import { initIcons, refreshIcons, setLucideIcon } from './icons.js';
import {
  enterDevMode, shouldUseDevBypass, createDevEntry, updateDevEntry, deleteDevEntry,
} from './dev.js';
import {
  getFaviconUrl, getSiteDomain, normalizeEntryUrl, prepareEntry,
  preloadFavicon, setupFaviconImages,
} from './favicon.js';
import { clearAuthSecrets } from './auth-secrets.js';
import { prefetchCommonPasswords } from './common-passwords.js';
import {
  checkStrength,
  validateMasterPassword,
} from './master-password.js';
import {
  saveSession,
  loadSessionIfFresh,
  clearStoredSession,
  startIdleWatch,
  stopIdleWatch,
  IDLE_TIMEOUT_MS,
  wipeUnlockedSecrets,
  wipeStateSecrets,
} from './session.js';
import { showCompatBannerIfNeeded, copyToClipboard } from './compat.js';
import {
  recoveryCodesAsText,
  downloadRecoveryKeysPng,
  downloadRecoveryKeysPdf,
  downloadRecoveryKeysTxt,
} from './recovery-export.js';
import { createAuthScreens } from './auth-screens.js';
import {
  bindRecoveryCodeInput,
  setRecoveryCodeValue,
} from './recovery-input.js';

const state = {
  token: null,
  user: null,
  vaultKey: null,
  privateKey: null,
  publicKey: null,
  entries: [],
  sharesReceived: [],
  sharesSent: [],
  devMode: false,
  page: 'dashboard',
  search: '',
  dashTab: 'popular',
  dashSearch: '',
  typeFilter: 'all',
  confirmCallback: null,
  confirmDeleteName: null,
  detailEntryId: null,
  editingEntryId: null,
  authMaterial: null,
  masterConfirmResolve: null,
  shareEntryId: null,
  /** @type {null | { email: string, verifierB64: string, vaultKey: Uint8Array, privateKey: Uint8Array, publicKey: Uint8Array, salt: Uint8Array }} */
  recoverySession: null,
  pendingRecoveryCodes: null,
  afterRecoveryKeys: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const EMPTY_VALUE = '…';

function formatEntryDateTime(iso) {
  if (!iso) return EMPTY_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_VALUE;
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatEntryDateCompact(iso) {
  if (!iso) return EMPTY_VALUE;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EMPTY_VALUE;
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

function entryWasUpdated(entry) {
  const created = Date.parse(entry?.created_at);
  const updated = Date.parse(entry?.updated_at);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
  // Tolérance : à la création Django fixe created_at et updated_at quasi simultanément.
  return updated - created > 2000;
}

function setDetailDateMeta(entry, { visible = true } = {}) {
  const meta = $('#detail-date-meta');
  if (!meta) return;
  if (!visible || !entry?.created_at) {
    meta.classList.add('hidden');
    meta.removeAttribute('title');
    return;
  }
  const wasUpdated = entryWasUpdated(entry);
  const iso = wasUpdated ? entry.updated_at : entry.created_at;
  $('#detail-date-label').textContent = wasUpdated ? 'Modifiée' : 'Créée';
  $('#detail-date-value').textContent = formatEntryDateCompact(iso);
  meta.title = `${wasUpdated ? 'Modifiée' : 'Créée'} le ${formatEntryDateTime(iso)}`;
  meta.classList.toggle('is-updated', wasUpdated);
  meta.classList.remove('hidden');
}

function setDetailActionButtonsVisible({ edit = false, share = false, delete: del = false } = {}) {
  $('#btn-edit-detail')?.classList.toggle('hidden', !edit);
  $('#btn-share-detail')?.classList.toggle('hidden', !share);
  $('#btn-delete-detail')?.classList.toggle('hidden', !del);
}

function fillEntryDetailCommon(e) {
  setEntryAvatar($('#detail-avatar'), e);
  applyDetailTypeLabels(e);
  $('#detail-title').textContent = e.title;
  $('#detail-username').textContent = displayUsername(e.username);
  $('#detail-password').textContent = '••••••••••••';
  $('#detail-password').dataset.real = e.password || '';
  $('#detail-password').dataset.visible = 'false';
  const icon = $('#btn-toggle-pwd')?.querySelector('[data-lucide], .lucide');
  if (icon) setLucideIcon(icon, 'eye');

  const urlField = $('#detail-url-field');
  const link = $('#detail-url');
  const linkIcon = urlField?.querySelector('.field-link-icon');
  if (e.url) {
    urlField.classList.remove('hidden');
    link.textContent = e.url;
    if (entryType(e) === 'ssh_key' && !/^https?:\/\//i.test(e.url)) {
      link.removeAttribute('href');
      link.removeAttribute('target');
      link.classList.add('detail-url-plain');
      linkIcon?.classList.add('hidden');
    } else {
      link.href = e.url.startsWith('http') ? e.url : `https://${e.url}`;
      link.target = '_blank';
      link.rel = 'noopener';
      link.classList.remove('detail-url-plain');
      linkIcon?.classList.remove('hidden');
    }
  } else {
    urlField.classList.add('hidden');
  }

  const notesField = $('#detail-notes-field');
  if (e.notes) {
    notesField.classList.remove('hidden');
    $('#detail-notes').textContent = e.notes;
  } else {
    notesField.classList.add('hidden');
  }
}

function resetEntryFormModal() {
  state.editingEntryId = null;
  $('#modal-entry-title').textContent = ENTRY_TYPES.includes(state.typeFilter)
    ? addEntryModalTitle(defaultEntryTypeFromFilter())
    : 'Ajouter une clé';
  const btn = $('#btn-save-entry');
  if (btn) btn.innerHTML = '<i data-lucide="check-circle"></i> Enregistrer';
}

function authMaterialFromPayload(payload) {
  if (!payload?.salt || !payload?.encrypted_vault_key) {
    return null;
  }
  return {
    salt: payload.salt,
    encrypted_vault_key: payload.encrypted_vault_key,
    encrypted_private_key: payload.encrypted_private_key || null,
    public_key: payload.public_key || null,
  };
}

function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function getAuthMaterialForVerification() {
  if (state.authMaterial?.salt && state.authMaterial?.encrypted_vault_key) {
    return state.authMaterial;
  }
  // Plus de fallback /auth/me : le profil ne renvoie plus le matériel crypto.
  throw new Error('Impossible de vérifier le mot de passe maître pour cette session. Reconnectez-vous.');
}

async function verifyMasterPasswordForCurrentVault(masterPassword) {
  if (!masterPassword || !state.vaultKey) return false;
  try {
    const material = await getAuthMaterialForVerification();
    const derived = await deriveKey(masterPassword, fromB64(material.salt));
    const vaultKey = await decryptBytes(fromB64(material.encrypted_vault_key), derived);
    return sameBytes(vaultKey, state.vaultKey);
  } catch {
    return false;
  }
}

function displayUsername(username) {
  const value = (username || '').trim();
  if (!value || value === EMPTY_VALUE || value === '...' || value === '…') return 'none';
  return value;
}

function buildDisplayName(user) {
  return [user.first_name, user.middle_name, user.last_name].filter(Boolean).join(' ');
}

function normalizeUser(user) {
  if (!user) return null;
  const first_name = user.first_name ?? '';
  const middle_name = user.middle_name ?? '';
  const last_name = user.last_name ?? '';
  const hasNameParts = first_name || middle_name || last_name;
  if (hasNameParts) {
    return {
      ...user,
      first_name,
      middle_name,
      last_name,
      display_name: user.display_name || buildDisplayName({ first_name, middle_name, last_name }),
    };
  }
  const parts = (user.display_name || '').split(' ').filter(Boolean);
  return {
    ...user,
    first_name: parts[0] || '',
    middle_name: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    last_name: parts.length > 1 ? parts[parts.length - 1] : '',
    display_name: user.display_name || '',
  };
}

function userFromProfile(profile) {
  return normalizeUser({
    id: profile.user_id,
    email: profile.email,
    first_name: profile.first_name,
    middle_name: profile.middle_name,
    last_name: profile.last_name,
    display_name: profile.display_name,
  });
}

const PROFILE_FIELD_CONFIG = {
  first_name: {
    input: '#inline-edit-first-name',
    required: true,
    requiredMessage: 'Le prénom est requis',
    getValue: (user) => user.first_name,
  },
  middle_name: {
    input: '#inline-edit-middle-name',
    required: false,
    requiredMessage: null,
    getValue: (user) => user.middle_name || '',
  },
  last_name: {
    input: '#inline-edit-last-name',
    required: true,
    requiredMessage: 'Le nom est requis',
    getValue: (user) => user.last_name,
  },
  email: {
    input: '#inline-edit-email',
    required: true,
    requiredMessage: "L'email est requis",
    getValue: (user) => user.email,
    normalize: (value) => value.trim().toLowerCase(),
  },
};

const AVATAR_COLORS = [
  ['#3b82f6', '#2563eb'], ['#34d399', '#10b981'], ['#60a5fa', '#3b82f6'],
  ['#f472b6', '#ec4899'], ['#fbbf24', '#f59e0b'], ['#a78bfa', '#8b5cf6'],
  ['#2dd4bf', '#14b8a6'], ['#fb923c', '#f97316'],
];

// ── Utilitaires UI ───────────────────────────────────────

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

function getAvatarColor(str) {
  const value = str || '';
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = value.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function setAvatar(el, name) {
  const [c1, c2] = getAvatarColor(name);
  el.textContent = getInitials(name);
  el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const ENTRY_TYPES = ['login', 'api_key', 'ssh_key'];

function normalizeEntryType(value) {
  return ENTRY_TYPES.includes(value) ? value : 'login';
}

function entryType(entry) {
  return normalizeEntryType(entry?.type);
}

function entryTypeLabel(type) {
  const t = normalizeEntryType(type);
  if (t === 'api_key') return 'Clé API';
  if (t === 'ssh_key') return 'SSH / stockage';
  return 'Connexion';
}

/** Type prérempli selon le filtre actif (Tous → connexion). */
function defaultEntryTypeFromFilter() {
  return ENTRY_TYPES.includes(state.typeFilter) ? state.typeFilter : 'login';
}

function addEntryModalTitle(type) {
  const t = normalizeEntryType(type);
  if (t === 'api_key') return 'Ajouter une clé API';
  if (t === 'ssh_key') return 'Ajouter une clé SSH';
  return 'Ajouter une clé de connexion';
}

function addEntryActionLabel(type = null) {
  const filter = type ?? state.typeFilter;
  if (filter === 'api_key') return 'Ajouter une clé API';
  if (filter === 'ssh_key') return 'Ajouter une clé SSH';
  if (filter === 'login') return 'Ajouter une clé de connexion';
  return 'Ajouter une clé';
}

function addEntryTileLabel(type = null) {
  const filter = type ?? state.typeFilter;
  if (filter === 'api_key') return 'Nouvelle clé API';
  if (filter === 'ssh_key') return 'Nouvelle clé SSH';
  if (filter === 'login') return 'Nouvelle connexion';
  return 'Nouvelle clé';
}

function syncAddEntryButtonLabels() {
  const label = addEntryActionLabel();
  const short = state.typeFilter === 'api_key'
    ? 'Clé API'
    : state.typeFilter === 'ssh_key'
      ? 'Clé SSH'
      : state.typeFilter === 'login'
        ? 'Connexion'
        : 'Nouveau';
  $$('.add-entry-label').forEach((el) => {
    if (el.closest('#btn-dash-add')) el.textContent = short;
    else el.textContent = label;
  });
}

function entryTypeBadgeMarkup(entry) {
  const type = entryType(entry);
  return `<span class="entry-type-badge entry-type-badge-${type}">${esc(entryTypeLabel(type))}</span>`;
}

function entrySecretRequiredLabel(type) {
  const t = normalizeEntryType(type);
  if (t === 'api_key') return 'Le secret / API key est requis';
  if (t === 'ssh_key') return 'La clé privée / secret de stockage est requis';
  return 'Le mot de passe est requis';
}

function entryTitleRequiredLabel(type) {
  return normalizeEntryType(type) === 'login' ? 'Le titre est requis' : 'Le nom est requis';
}

function applyEntryFormLabels(type = 'login') {
  const t = normalizeEntryType(type);
  const isApi = t === 'api_key';
  const isSsh = t === 'ssh_key';
  const titleLabel = $('#label-entry-title');
  const userLabel = $('#label-entry-username');
  const passLabel = $('#label-entry-password');
  const urlLabel = $('#label-entry-url');
  const notesLabel = $('#label-entry-notes');
  if (titleLabel) titleLabel.textContent = isApi || isSsh ? 'Nom' : 'Titre';
  if (userLabel) {
    if (isSsh) {
      userLabel.innerHTML = 'Commentaire / utilisateur <span class="optional">(optionnel)</span>';
    } else if (isApi) {
      userLabel.innerHTML = 'Client ID / Identifiant <span class="optional">(optionnel)</span>';
    } else {
      userLabel.innerHTML = 'Identifiant <span class="optional">(optionnel)</span>';
    }
  }
  if (passLabel) {
    if (isSsh) passLabel.textContent = 'Clé privée / secret';
    else if (isApi) passLabel.textContent = 'Secret / API key';
    else passLabel.textContent = 'Mot de passe';
    passLabel.setAttribute('for', isSsh ? 'entry-secret-block' : 'entry-password');
  }
  if (urlLabel) {
    if (isSsh) {
      urlLabel.innerHTML = 'Hôte / alias <span class="optional">(optionnel)</span>';
    } else if (isApi) {
      urlLabel.innerHTML = 'Console / endpoint <span class="optional">(optionnel)</span>';
    } else {
      urlLabel.innerHTML = 'URL <span class="optional">(optionnel)</span>';
    }
  }
  if (notesLabel) {
    if (isSsh) {
      notesLabel.innerHTML = 'Clé publique / fingerprint <span class="optional">(optionnel)</span>';
    } else if (isApi) {
      notesLabel.innerHTML = 'Scopes / notes <span class="optional">(optionnel)</span>';
    } else {
      notesLabel.innerHTML = 'Notes <span class="optional">(optionnel)</span>';
    }
  }
  const titleInput = $('#entry-title');
  const userInput = $('#entry-username');
  const passInput = $('#entry-password');
  const secretBlock = $('#entry-secret-block');
  const passRow = $('#entry-password-row');
  const urlInput = $('#entry-url');
  const notesInput = $('#entry-notes');
  if (titleInput) {
    titleInput.placeholder = isSsh
      ? 'GitHub, VPS, NAS, disque…'
      : isApi
        ? 'OpenAI, Stripe, AWS…'
        : 'Netflix, Gmail, Banque...';
  }
  if (userInput) {
    userInput.placeholder = isSsh
      ? 'user@host ou commentaire de clé'
      : isApi
        ? 'client_id ou account id'
        : 'email ou nom d\'utilisateur';
  }
  if (passInput) passInput.placeholder = isApi ? 'sk-… / secret' : 'Mot de passe';
  if (secretBlock) {
    secretBlock.placeholder = isSsh
      ? '-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'
      : '';
  }
  if (urlInput) {
    urlInput.placeholder = isSsh
      ? 'git@github.com ou serveur.exemple.com'
      : isApi
        ? 'https://console.exemple.com'
        : 'exemple.com ou https://...';
  }
  if (notesInput) {
    notesInput.placeholder = isSsh
      ? 'ssh-ed25519 AAAA… fingerprint…'
      : isApi
        ? 'Scopes, environnement, JSON…'
        : 'Informations supplémentaires';
  }

  if (passRow && secretBlock && passInput) {
    if (isSsh) {
      passRow.classList.add('hidden');
      secretBlock.classList.remove('hidden');
      passInput.required = false;
      passInput.value = '';
      secretBlock.required = true;
    } else {
      passRow.classList.remove('hidden');
      secretBlock.classList.add('hidden');
      secretBlock.required = false;
      secretBlock.value = '';
      passInput.required = true;
    }
  }
  $('#btn-generate')?.classList.toggle('hidden', isApi || isSsh);
  $('#btn-generate-ssh')?.classList.toggle('hidden', !isSsh);
  $('#entry-ssh-hint')?.classList.toggle('hidden', !isSsh);
}

function applyDetailTypeLabels(entry) {
  const type = entryType(entry);
  const isApi = type === 'api_key';
  const isSsh = type === 'ssh_key';
  const badge = $('#detail-type-badge');
  if (badge) {
    badge.textContent = entryTypeLabel(type);
    badge.className = `entry-type-badge entry-type-badge-${type}`;
    badge.classList.remove('hidden');
  }
  const userLabel = $('#detail-username-label');
  const passLabel = $('#detail-password-label');
  const urlLabel = $('#detail-url-label');
  const passEl = $('#detail-password');
  if (userLabel) {
    userLabel.textContent = isSsh
      ? 'Commentaire / utilisateur'
      : isApi
        ? 'Client ID / Identifiant'
        : 'Identifiant';
  }
  if (passLabel) {
    passLabel.textContent = isSsh
      ? 'Clé privée / secret'
      : isApi
        ? 'Secret / API key'
        : 'Mot de passe';
  }
  if (urlLabel) {
    urlLabel.textContent = isSsh ? 'Hôte / alias' : isApi ? 'Console / endpoint' : 'URL';
  }
  passEl?.classList.toggle('detail-secret-block', isSsh);
}

function syncTypeFilterButtons() {
  $$('.type-filter').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.typeFilter === state.typeFilter);
  });
}

function filterEntriesByQuery(list, query) {
  let filtered = list;
  if (ENTRY_TYPES.includes(state.typeFilter)) {
    filtered = filtered.filter((e) => entryType(e) === state.typeFilter);
  }
  if (!query) return filtered;
  const q = query.toLowerCase();
  return filtered.filter(e =>
    e.title.toLowerCase().includes(q) ||
    (e.username || '').toLowerCase().includes(q) ||
    (e.url && e.url.toLowerCase().includes(q)) ||
    (e.notes && e.notes.toLowerCase().includes(q))
  );
}

function entryLetter(entry) {
  return esc((entry.title?.[0] || '?').toUpperCase());
}

function dashTileIconMarkup(entry) {
  const letter = entryLetter(entry);
  if (entryType(entry) === 'ssh_key') {
    return `<span class="dash-tile-letter">${letter}</span>`;
  }
  const siteUrl = normalizeEntryUrl(entry.url);
  const faviconUrl = getFaviconUrl(siteUrl);
  if (!faviconUrl) return `<span class="dash-tile-letter">${letter}</span>`;

  return `
    <span class="dash-tile-logo">
      <img
        class="dash-tile-favicon"
        src="${esc(faviconUrl)}"
        alt=""
        loading="lazy"
        decoding="async"
        data-site-url="${esc(siteUrl)}"
        onerror="window.onFaviconError(this)"
      >
      <span class="dash-tile-letter dash-tile-letter-fallback">${letter}</span>
    </span>`;
}

function dashTileClassName(entry) {
  if (entryType(entry) === 'ssh_key') return 'dash-tile';
  return getSiteDomain(entry.url) ? 'dash-tile dash-tile-branded' : 'dash-tile';
}

function dashTileStyle(entry, index) {
  const delay = `animation-delay:${index * 0.03}s`;
  if (entryType(entry) !== 'ssh_key' && getSiteDomain(entry.url)) return delay;
  const [c1, c2] = getAvatarColor(entry.title);
  return `background:linear-gradient(160deg,${c1},${c2});${delay}`;
}

function entryAvatarMarkup(entry) {
  const letter = entryLetter(entry);
  const [c1, c2] = getAvatarColor(entry.title);
  if (entryType(entry) === 'ssh_key') {
    return `<div class="entry-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${letter}</div>`;
  }
  const siteUrl = normalizeEntryUrl(entry.url);
  const faviconUrl = getFaviconUrl(siteUrl);
  if (!faviconUrl) {
    return `<div class="entry-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${letter}</div>`;
  }
  return `
    <div class="entry-avatar entry-icon entry-icon-branded">
      <img class="entry-favicon" src="${esc(faviconUrl)}" alt="" width="24" height="24" loading="lazy" decoding="async" data-site-url="${esc(siteUrl)}" onerror="window.onFaviconError(this)">
      <span class="entry-letter">${letter}</span>
    </div>`;
}

function setEntryAvatar(el, entry) {
  const letter = entryLetter(entry);
  const [c1, c2] = getAvatarColor(entry.title);
  if (entryType(entry) === 'ssh_key') {
    el.className = 'entry-avatar lg';
    el.style.background = `linear-gradient(135deg,${c1},${c2})`;
    el.textContent = (entry.title?.[0] || '?').toUpperCase();
    return;
  }
  const faviconUrl = getFaviconUrl(normalizeEntryUrl(entry.url));
  el.className = 'entry-avatar lg entry-icon entry-icon-branded';
  el.style.background = '';
  if (!faviconUrl) {
    el.style.background = `linear-gradient(135deg,${c1},${c2})`;
    el.textContent = (entry.title?.[0] || '?').toUpperCase();
    return;
  }
  el.classList.add('entry-icon');
  el.innerHTML = `
    <img class="entry-favicon" src="${esc(faviconUrl)}" alt="" width="28" height="28" decoding="async" data-site-url="${esc(normalizeEntryUrl(entry.url))}" onerror="window.onFaviconError(this)">
    <span class="entry-letter">${letter}</span>`;
  setupFaviconImages(el);
}

function toast(msg, type = 'info') {
  const icons = { success: 'check-circle', error: 'x-circle', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i><span>${esc(msg)}</span>`;
  $('#toasts').appendChild(el);
  refreshIcons(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3200);
}

function showLoading(msg = 'Dérivation de clé en cours...') {
  $('#loading-text').textContent = msg;
  $('#loading').classList.remove('hidden');
}

function hideLoading() { $('#loading').classList.add('hidden'); }

function syncBodyModalLock() {
  document.body.classList.toggle('modal-open', !!document.querySelector('.modal.open'));
}

function openModal(modal) {
  modal.classList.add('open');
  const body = modal.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
  syncBodyModalLock();
}

function closeModal(modal) {
  modal.classList.remove('open');
  syncBodyModalLock();
}

const {
  showScreen,
  openAuthTab,
  openUnlockScreen,
  showRecoveryKeysModal,
  bindLandingNavigation,
  bindRecoveryExportButtons,
} = createAuthScreens({
  $,
  state,
  refreshIcons,
  prefetchCommonPasswords,
  openModal,
  closeModal,
  esc,
});

function clearEntrySecretsInMemory() {
  if (!Array.isArray(state.entries)) return;
  state.entries.forEach((e) => {
    if (e && typeof e.password === 'string') e.password = '';
  });
}

/** Déconnexion complète : efface JWT + authMaterial + stockage. */
function hardLogout(reason = 'manual') {
  stopIdleWatch();
  if (state.masterConfirmResolve) settleMasterConfirm(false);
  clearStoredSession();
  wipeStateSecrets(state);
  clearEntrySecretsInMemory();
  Object.assign(state, {
    token: null,
    user: null,
    vaultKey: null,
    privateKey: null,
    publicKey: null,
    entries: [],
    sharesReceived: [],
    sharesSent: [],
    shareEntryId: null,
    detailEntryId: null,
    editingEntryId: null,
    authMaterial: null,
    masterConfirmResolve: null,
    recoverySession: null,
    pendingRecoveryCodes: null,
    afterRecoveryKeys: null,
    devMode: false,
    page: 'dashboard',
    search: '',
    dashTab: 'popular',
    dashSearch: '',
    typeFilter: 'all',
  });
  $('#modal-recovery-keys')?.classList.remove('open');
  closeAllModals();
  clearAuthSecrets();
  clearLoginForm();
  $('#form-register')?.reset();
  $('#form-recovery')?.reset();
  setRecoveryCodeValue($('#recovery-code'), '', $('#recovery-code-count'));
  $('#form-recovery-reset')?.reset();
  $('#form-unlock')?.reset();
  collapseSidebar();
  showScreen('landing');
  refreshIcons($('#screen-landing'));
  if (reason !== 'silent') {
    const minutes = Math.round(IDLE_TIMEOUT_MS / 60000);
    const messages = {
      idle: `Session expirée après ${minutes} min d'inactivité`,
      hidden: 'Session fermée (onglet en arrière-plan trop longtemps)',
      manual: 'Déconnecté',
      unlock_back: 'Déconnecté',
    };
    toast(messages[reason] || messages.manual, 'info');
  }
}

/** Soft lock : garde JWT + authMaterial, efface les clés déchiffrées. */
function softLockVault(reason = 'manual') {
  stopIdleWatch();
  if (state.masterConfirmResolve) settleMasterConfirm(false);
  if (!state.token || !state.authMaterial?.salt || !state.authMaterial?.encrypted_vault_key || state.devMode) {
    hardLogout(reason);
    return;
  }
  wipeUnlockedSecrets(state);
  clearEntrySecretsInMemory();
  state.entries = [];
  state.sharesReceived = [];
  state.sharesSent = [];
  state.shareEntryId = null;
  state.detailEntryId = null;
  state.editingEntryId = null;
  $('#modal-recovery-keys')?.classList.remove('open');
  closeAllModals();
  clearAuthSecrets();
  collapseSidebar();
  saveSession(state);
  openUnlockScreen();
  const minutes = Math.round(IDLE_TIMEOUT_MS / 60000);
  const messages = {
    idle: `Coffre verrouillé après ${minutes} min d'inactivité`,
    hidden: 'Coffre verrouillé (onglet en arrière-plan)',
    manual: 'Coffre verrouillé',
  };
  toast(messages[reason] || messages.manual, 'info');
}

// Navigation landing tôt (avant les listeners coffre).
bindLandingNavigation({ onUnlockBack: () => hardLogout('unlock_back') });
showScreen('landing');
bindRecoveryCodeInput($('#recovery-code'), { counter: $('#recovery-code-count') });
bindRecoveryExportButtons({
  toast,
  copyToClipboard,
  recoveryCodesAsText,
  downloadRecoveryKeysPng,
  downloadRecoveryKeysPdf,
  downloadRecoveryKeysTxt,
});

function isRecoveryKeysModalOpen() {
  return Boolean($('#modal-recovery-keys')?.classList.contains('open'));
}

function clearDetailSecrets() {
  const el = $('#detail-password');
  if (!el) return;
  el.textContent = '';
  delete el.dataset.real;
  el.dataset.visible = 'false';
  const icon = $('#btn-toggle-pwd')?.querySelector('[data-lucide], .lucide');
  if (icon) setLucideIcon(icon, 'eye');
}

function closeAllModals() {
  if (state.masterConfirmResolve) settleMasterConfirm(false);
  // Ne jamais fermer le modal des 7 clés sans confirmation explicite.
  $$('.modal.open').forEach(m => {
    if (m.id === 'modal-recovery-keys') return;
    m.classList.remove('open');
  });
  syncBodyModalLock();
  resetDeleteConfirm();
  clearDetailSecrets();
  state.detailEntryId = null;
}

function resetDeleteConfirm() {
  $('#confirm-name-input').value = '';
  $('#btn-confirm-ok').disabled = true;
  state.confirmDeleteName = null;
  state.confirmCallback = null;
}

function settleMasterConfirm(ok) {
  const resolve = state.masterConfirmResolve;
  state.masterConfirmResolve = null;
  $('#master-confirm-password').value = '';
  $('#btn-master-confirm-ok').disabled = false;
  closeModal($('#modal-master-confirm'));
  if (resolve) resolve(ok);
}

function requestMasterPasswordConfirmation() {
  if (state.devMode) return Promise.resolve(true);
  if (state.masterConfirmResolve) state.masterConfirmResolve(false);
  $('#master-confirm-password').value = '';
  $('#btn-master-confirm-ok').disabled = false;
  openModal($('#modal-master-confirm'));
  refreshIcons($('#modal-master-confirm'));
  setTimeout(() => $('#master-confirm-password')?.focus(), 50);
  return new Promise((resolve) => {
    state.masterConfirmResolve = resolve;
  });
}

function showDeleteConfirm(entry, onConfirm, options = {}) {
  $('#confirm-title').textContent = options.title || 'Supprimer la clé';
  $('#confirm-message').textContent = options.message
    || 'Cette action est irréversible. Toutes les informations de cette clé seront définitivement supprimées.';
  $('#confirm-name-expected').textContent = entry.title;
  state.confirmDeleteName = entry.title;
  state.confirmCallback = onConfirm;
  $('#confirm-name-input').value = '';
  $('#btn-confirm-ok').disabled = true;
  openModal($('#modal-confirm'));
  refreshIcons($('#modal-confirm'));
  setTimeout(() => $('#confirm-name-input')?.focus(), 50);
}

$('#confirm-name-input').addEventListener('input', (e) => {
  $('#btn-confirm-ok').disabled = e.target.value !== state.confirmDeleteName;
});

$('#confirm-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !$('#btn-confirm-ok').disabled) {
    e.preventDefault();
    $('#btn-confirm-ok').click();
  }
});

$('#btn-confirm-cancel').addEventListener('click', () => {
  closeModal($('#modal-confirm'));
  resetDeleteConfirm();
});

$('#btn-close-confirm').addEventListener('click', () => {
  closeModal($('#modal-confirm'));
  resetDeleteConfirm();
});

$('#btn-confirm-ok').addEventListener('click', () => {
  if ($('#btn-confirm-ok').disabled) return;
  const callback = state.confirmCallback;
  closeModal($('#modal-confirm'));
  resetDeleteConfirm();
  if (callback) callback();
});

$('#btn-master-confirm-cancel')?.addEventListener('click', () => settleMasterConfirm(false));
$('#btn-close-master-confirm')?.addEventListener('click', () => settleMasterConfirm(false));

$('#form-master-confirm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('#master-confirm-password');
  const btn = $('#btn-master-confirm-ok');
  const master = input.value;
  if (!master) {
    toast('Mot de passe maître requis', 'error');
    input.focus();
    return;
  }

  btn.disabled = true;
  showLoading('Vérification du mot de passe maître...');
  try {
    const ok = await verifyMasterPasswordForCurrentVault(master);
    if (!ok) {
      toast('Mot de passe maître incorrect', 'error');
      input.value = '';
      input.focus();
      return;
    }
    settleMasterConfirm(true);
  } catch (err) {
    toast(err.message || 'Vérification impossible', 'error');
    input.value = '';
    input.focus();
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

async function copyText(text, btn) {
  const ok = await copyToClipboard(text);
  if (!ok) {
    toast('Impossible de copier — autorisez le presse-papiers ou copiez manuellement', 'error');
    return false;
  }
  if (btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  }
  return true;
}

// ── Password strength (UI) ───────────────────────────────

$('#register-password').addEventListener('input', (e) => {
  const pwd = e.target.value;
  const score = checkStrength(pwd);
  const fill = $('#strength-fill');
  const label = $('#strength-label');
  const levels = [
    { w: '0%', c: 'transparent', t: '' },
    { w: '20%', c: 'var(--error)', t: 'Très faible' },
    { w: '40%', c: 'var(--warning)', t: 'Faible' },
    { w: '60%', c: 'var(--info)', t: 'Moyen' },
    { w: '80%', c: 'var(--success)', t: 'Fort' },
    { w: '100%', c: 'var(--success)', t: 'Très fort' },
  ];
  const lvl = levels[score];
  fill.style.width = lvl.w;
  fill.style.background = lvl.c;
  label.textContent = lvl.t;
  label.style.color = lvl.c || 'var(--text-muted)';
});

// ── Toggle password visibility (auth handled in icons.js) ──

// ── Navigation ─────────────────────────────────────────

const PAGE_TITLES = {
  dashboard: { title: 'Accueil', subtitle: 'Vos connexions en un coup d\'œil' },
  vault: { title: 'Toutes les clés', subtitle: 'Votre coffre complet' },
  'shares-received': { title: 'Partage · Reçu', subtitle: 'Clés partagées avec vous' },
  'shares-sent': { title: 'Partage · Envoyé', subtitle: 'Clés que vous avez partagées' },
  profile: { title: 'Mon profil', subtitle: 'Informations de votre compte' },
};

function updatePageTitle() {
  const page = PAGE_TITLES[state.page] || PAGE_TITLES.dashboard;
  $('#page-title').textContent = page.title;
  $('#page-subtitle').textContent = page.subtitle;
  const onProfile = state.page === 'profile';
  const onShares = state.page === 'shares-received' || state.page === 'shares-sent';
  $('#topbar-total').classList.toggle('hidden', onProfile || onShares);
  $('#fab-add').classList.toggle('hidden', onProfile || onShares);
}

function switchPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  if (page !== 'profile') closeAllProfileFieldEdits();
  state.page = page;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#dashboard-view').classList.toggle('hidden', page !== 'dashboard');
  $('#vault-view').classList.toggle('hidden', page !== 'vault');
  $('#shares-received-view')?.classList.toggle('hidden', page !== 'shares-received');
  $('#shares-sent-view')?.classList.toggle('hidden', page !== 'shares-sent');
  $('#profile-view').classList.toggle('hidden', page !== 'profile');
  updatePageTitle();
  updateEntryCounts();
  $('.vault-main')?.scrollTo(0, 0);
  try {
    if (page === 'dashboard') renderDashboard();
    else if (page === 'vault') renderEntries();
    else if (page === 'shares-received') renderSharesReceived();
    else if (page === 'shares-sent') renderSharesSent();
    else if (page === 'profile') renderProfile();
  } catch (err) {
    console.error('Erreur affichage page:', err);
    toast('Impossible d\'afficher cette page', 'error');
  }
}

const MOBILE_BREAKPOINT = 900;

function isMobileLayout() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function setSidebarExpanded(expanded) {
  $('#screen-vault').classList.toggle('sidebar-expanded', expanded);
}

function collapseSidebar() {
  setSidebarExpanded(false);
}

function toggleSidebar() {
  setSidebarExpanded(!$('#screen-vault').classList.contains('sidebar-expanded'));
}

$('#btn-menu').addEventListener('click', toggleSidebar);
$('#sidebar-overlay').addEventListener('click', collapseSidebar);

window.addEventListener('resize', () => {
  if (!$('#screen-vault').classList.contains('active')) return;
  if (isMobileLayout()) collapseSidebar();
  else setSidebarExpanded(true);
});

function showVault() {
  showScreen('vault');
  if (!state.user) return;
  const user = normalizeUser(state.user);
  state.user = user;
  applyUserToUI(user);
  setSidebarExpanded(!isMobileLayout());
  state.page = 'dashboard';
  switchPage('dashboard');
  if (!state.devMode) {
    saveSession(state);
    startIdleWatch(() => state, (reason) => lockVault(reason || 'idle'));
    loadShares().catch((err) => console.warn('Partages:', err));
  }
}

// ── Auth ─────────────────────────────────────────────────

function clearLoginForm() {
  $('#form-login').reset();
  $('#login-email').value = '';
  $('#login-password').value = '';
}

function validateLoginForm() {
  const email = $('#login-email').value.trim();
  const master = $('#login-password').value;
  if (!email) {
    toast('Veuillez saisir votre email', 'error');
    $('#login-email').focus();
    return null;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Email invalide', 'error');
    $('#login-email').focus();
    return null;
  }
  if (!master) {
    toast('Veuillez saisir votre mot de passe maître', 'error');
    $('#login-password').focus();
    return null;
  }
  return { email, master };
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const master = $('#login-password').value;

  if (shouldUseDevBypass(email, master)) {
    clearAuthSecrets();
    enterDevMode(state);
    showVault();
    return;
  }

  const creds = validateLoginForm();
  if (!creds) return;

  const btn = $('#btn-login');
  btn.disabled = true;
  showLoading('Déverrouillage du coffre...');
  try {
    const prepared = await prepareLogin(creds.email, creds.master, window.location.origin);
    const data = await api.login(creds.email, prepared.authVerifier);
    const keys = await unlockSession(data, creds.master, {
      derivedKey: prepared.derived,
      saltB64: prepared.saltB64,
    });
    // Efface le matériel KDF de la closure dès que possible.
    if (prepared.derived) prepared.derived.fill(0);
    prepared.derived = null;
    clearAuthSecrets();
    state.devMode = false;
    state.token = data.access_token;
    state.user = userFromProfile(data);
    state.authMaterial = authMaterialFromPayload(data);
    Object.assign(state, keys);
    state.entries = [];
    // Afficher l’UI tout de suite (lettres) ; les clés se chargent ensuite.
    showVault();
    try {
      await loadEntries();
      refreshCurrentView();
    } catch (err) {
      console.warn('Chargement des clés partiel:', err);
      toast('Connexion réussie, mais certaines clés n\'ont pas pu être chargées', 'info');
    }
    toast('Coffre déverrouillé', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

$('#form-register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-register');
  const master = $('#register-password').value;
  const confirm = $('#register-password-confirm').value;
  if (master !== confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return; }
  if (!$('#register-first-name').value.trim()) { toast('Le prénom est requis', 'error'); return; }
  if (!$('#register-last-name').value.trim()) { toast('Le nom est requis', 'error'); return; }

  btn.disabled = true;
  showLoading('Vérification du mot de passe...');
  try {
    const masterError = await validateMasterPassword(master);
    if (masterError) {
      toast(masterError, 'error');
      return;
    }
    showLoading('Création du coffre et des clés de récupération...');
    const prep = await prepareRegistration(master);
    const email = $('#register-email').value.trim();
    const data = await api.register({
      email,
      first_name: $('#register-first-name').value.trim(),
      middle_name: $('#register-middle-name').value.trim(),
      last_name: $('#register-last-name').value.trim(),
      salt: toB64(prep.salt),
      auth_verifier: toB64(prep.authVerifier),
      encrypted_vault_key: toB64(prep.encryptedVaultKey),
      public_key: toB64(prep.publicKey),
      encrypted_private_key: toB64(prep.encryptedPrivateKey),
      recovery_keys: prep.recoveryPackages,
    });
    state.token = data.access_token;
    state.user = userFromProfile(data);
    state.authMaterial = authMaterialFromPayload(data) || {
      salt: toB64(prep.salt),
      encrypted_vault_key: toB64(prep.encryptedVaultKey),
      encrypted_private_key: toB64(prep.encryptedPrivateKey),
      public_key: toB64(prep.publicKey),
    };
    state.vaultKey = prep.vaultKey;
    state.privateKey = prep.privateKey;
    state.publicKey = prep.publicKey;
    state.entries = [];
    clearAuthSecrets();
    hideLoading();
    showRecoveryKeysModal(prep.recoveryCodes, {
      email,
      title: `${RECOVERY_KEY_COUNT} clés de récupération`,
      onContinue: () => {
        showVault();
        toast('Compte créé avec succès', 'success');
      },
    });
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

$('#btn-lock').addEventListener('click', () => lockVault('manual'));

$('#btn-forgot-master')?.addEventListener('click', () => {
  const email = ($('#login-email')?.value || '').trim();
  openAuthTab('recovery');
  if ($('#recovery-email')) $('#recovery-email').value = email;
  setRecoveryCodeValue($('#recovery-code'), '', $('#recovery-code-count'));
  setTimeout(() => $('#recovery-code')?.focus(), 50);
});

$('#btn-recovery-back')?.addEventListener('click', () => openAuthTab('login'));

$('#form-recovery')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = ($('#recovery-email')?.value || '').trim().toLowerCase();
  const code = ($('#recovery-code')?.value || '').trim();
  if (!email || !code) {
    toast('Email et clé de récupération requis', 'error');
    return;
  }
  const btn = $('#btn-recovery-begin');
  btn.disabled = true;
  showLoading('Vérification de la clé de récupération...');
  try {
    const verifier = await recoveryVerifierFromCode(code);
    const verifierB64 = toB64(verifier);
    const data = await api.recoveryBegin(email, verifierB64);
    const vaultKey = await unwrapVaultKeyWithRecoveryCode(
      code,
      fromB64(data.encrypted_vault_key_recovery),
    );
    const privateKey = await decryptPrivateKey(fromB64(data.encrypted_private_key), vaultKey);
    state.recoverySession = {
      email: data.email,
      verifierB64,
      vaultKey,
      privateKey,
      publicKey: fromB64(data.public_key),
      salt: fromB64(data.salt),
    };
    openAuthTab('recovery-reset');
    toast('Clé acceptée. Elle sera invalidée après la réinitialisation.', 'info');
  } catch (err) {
    toast(err.message || 'Récupération impossible', 'error');
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

$('#recovery-new-password')?.addEventListener('input', (e) => {
  const score = checkStrength(e.target.value);
  const fill = $('#recovery-strength-fill');
  const label = $('#recovery-strength-label');
  if (!fill || !label) return;
  const levels = [
    { w: '0%', c: 'transparent', t: '' },
    { w: '20%', c: 'var(--error)', t: 'Très faible' },
    { w: '40%', c: 'var(--warning)', t: 'Faible' },
    { w: '60%', c: 'var(--info)', t: 'Moyen' },
    { w: '80%', c: 'var(--success)', t: 'Fort' },
    { w: '100%', c: 'var(--success)', t: 'Très fort' },
  ];
  const lvl = levels[score];
  fill.style.width = lvl.w;
  fill.style.background = lvl.c;
  label.textContent = lvl.t;
  label.style.color = lvl.c || 'var(--text-muted)';
});

$('#form-recovery-reset')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const session = state.recoverySession;
  if (!session) {
    openAuthTab('recovery');
    return;
  }
  const master = $('#recovery-new-password')?.value || '';
  const confirm = $('#recovery-new-password-confirm')?.value || '';
  if (master !== confirm) {
    toast('Les mots de passe ne correspondent pas', 'error');
    return;
  }
  const btn = $('#btn-recovery-complete');
  btn.disabled = true;
  showLoading('Vérification du nouveau mot de passe...');
  try {
    const masterError = await validateMasterPassword(master);
    if (masterError) {
      toast(masterError, 'error');
      return;
    }
    showLoading('Réchiffrement du coffre...');
    const prep = await prepareMasterPasswordReset(session.vaultKey, master, session.salt);
    const keyProof = await recoveryKeyProofFromVaultKey(session.vaultKey);
    const data = await api.recoveryComplete({
      email: session.email,
      verifier: session.verifierB64,
      key_proof: toB64(keyProof),
      auth_verifier: toB64(prep.authVerifier),
      encrypted_vault_key: toB64(prep.encryptedVaultKey),
    });
    state.token = data.access_token;
    state.user = userFromProfile(data);
    state.authMaterial = authMaterialFromPayload(data);
    state.vaultKey = session.vaultKey;
    state.privateKey = session.privateKey;
    state.publicKey = session.publicKey;
    state.entries = [];
    state.recoverySession = null;
    clearAuthSecrets();
    $('#form-recovery-reset')?.reset();
    try {
      await loadEntries();
    } catch (err) {
      console.warn(err);
    }
    showVault();
    toast('Mot de passe réinitialisé. La clé utilisée est maintenant invalide.', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

function lockVault(reason = 'manual') {
  softLockVault(reason);
}

// ── Clés ─────────────────────────────────────────────────

async function loadEntries() {
  if (state.devMode) return;
  const raw = await api.getEntries(state.token);
  if (!raw.length) {
    state.entries = [];
    return;
  }
  const concurrency = 6;
  const decrypted = new Array(raw.length);
  let next = 0;

  async function worker() {
    while (next < raw.length) {
      const index = next++;
      const e = raw[index];
      try {
        const encrypted = fromB64(e.encrypted_data);
        const data = await decryptData(encrypted, state.vaultKey);
        decrypted[index] = prepareEntry({ ...data, ...e });
      } catch (err) {
        console.warn('Clé ignorée (déchiffrement impossible):', e.id, err);
        decrypted[index] = null;
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, raw.length) }, () => worker()),
  );
  state.entries = decrypted.filter(Boolean);
}

function getFilteredEntries() {
  return filterEntriesByQuery(state.entries, state.search);
}

function refreshCurrentView() {
  if (state.page === 'dashboard') renderDashboard();
  else if (state.page === 'vault') renderEntries();
  else if (state.page === 'shares-received') renderSharesReceived();
  else if (state.page === 'shares-sent') renderSharesSent();
  else if (state.page === 'profile') renderProfile();
}

function updateEntryCounts() {
  $('#entry-count').textContent = state.entries.length;
  $('#nav-count-all').textContent = state.entries.length;
  const recv = $('#nav-count-received');
  const sent = $('#nav-count-sent');
  if (recv) recv.textContent = state.sharesReceived.length;
  if (sent) sent.textContent = state.sharesSent.length;
}

async function loadShares() {
  if (state.devMode || !state.token || !state.privateKey) {
    state.sharesReceived = [];
    state.sharesSent = [];
    updateEntryCounts();
    return;
  }
  const [rawReceived, rawSent] = await Promise.all([
    api.getSharesReceived(state.token),
    api.getSharesSent(state.token),
  ]);

  state.sharesReceived = [];
  for (const s of rawReceived) {
    try {
      const data = await decryptFromSender(fromB64(s.encrypted_data), state.privateKey);
      state.sharesReceived.push({
        ...prepareEntry(data),
        id: s.id,
        shareId: s.id,
        isShare: true,
        share_note: (data.share_note || '').trim(),
        sender_email: s.sender_email,
        sender_display_name: s.sender_display_name,
        created_at: s.created_at,
      });
    } catch (err) {
      console.warn('Partage reçu ignoré:', s.id, err);
    }
  }

  state.sharesSent = rawSent.map((s) => {
    const entry = state.entries.find((e) => e.id === s.entry_id);
    return {
      id: s.id,
      shareId: s.id,
      entry_id: s.entry_id,
      title: entry?.title || 'Clé partagée',
      username: entry?.username || s.recipient_email,
      url: entry?.url || '',
      password: entry?.password || '',
      recipient_email: s.recipient_email,
      recipient_display_name: s.recipient_display_name,
      created_at: s.created_at,
      isShare: true,
      isSent: true,
    };
  });

  updateEntryCounts();
  if (state.page === 'shares-received' || state.page === 'shares-sent') {
    refreshCurrentView();
  }
}

function renderSharesReceived() {
  const list = $('#shares-received-list');
  const empty = $('#shares-received-empty');
  if (!list || !empty) return;
  updateEntryCounts();
  if (state.sharesReceived.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.sharesReceived.map((e, i) => `
    <div class="entry-card" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-share-received">
      ${entryAvatarMarkup(e)}
      <div class="entry-info">
        <div class="entry-title">${esc(e.title)}</div>
        <div class="entry-username">De ${esc(e.sender_display_name || e.sender_email)}${e.share_note ? ` · ${esc(e.share_note.length > 60 ? `${e.share_note.slice(0, 60)}…` : e.share_note)}` : ''}</div>
      </div>
      <div class="entry-actions">
        <button type="button" class="btn-icon" title="Copier" data-action="copy-share-received" data-id="${esc(e.id)}">
          <i data-lucide="copy"></i>
        </button>
        <button type="button" class="btn-icon btn-danger" title="Retirer" data-action="delete-share" data-id="${esc(e.id)}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`).join('');
  refreshIcons(list);
  setupFaviconImages(list);
}

function renderSharesSent() {
  const list = $('#shares-sent-list');
  const empty = $('#shares-sent-empty');
  if (!list || !empty) return;
  updateEntryCounts();
  if (state.sharesSent.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.sharesSent.map((e, i) => `
    <div class="entry-card" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-share-sent">
      ${entryAvatarMarkup(e)}
      <div class="entry-info">
        <div class="entry-title">${esc(e.title)}</div>
        <div class="entry-username">À ${esc(e.recipient_display_name || e.recipient_email)}</div>
      </div>
      <div class="entry-actions">
        <button type="button" class="btn-icon btn-danger" title="Révoquer" data-action="delete-share" data-id="${esc(e.id)}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`).join('');
  refreshIcons(list);
  setupFaviconImages(list);
}

function openShareModal(entryId) {
  const entry = state.entries.find((x) => x.id === entryId);
  if (!entry) return;
  if (state.devMode) {
    toast('Le partage n’est pas disponible en mode développement', 'info');
    return;
  }
  state.shareEntryId = entryId;
  $('#share-entry-title').textContent = `Partager « ${entry.title} »`;
  $('#share-email').value = '';
  if ($('#share-note')) $('#share-note').value = '';
  openModal($('#modal-share'));
  refreshIcons($('#modal-share'));
  setTimeout(() => $('#share-email')?.focus(), 50);
}

window.showShareReceived = function(id) {
  const e = state.sharesReceived.find((x) => x.id === id);
  if (!e) return;
  state.detailEntryId = null;
  fillEntryDetailCommon(e);
  const shareNoteField = $('#detail-share-note-field');
  if (e.share_note) {
    shareNoteField?.classList.remove('hidden');
    $('#detail-share-note').textContent = e.share_note;
  } else {
    shareNoteField?.classList.add('hidden');
  }
  $('#detail-share-note-field')?.classList.add('hidden');
  setDetailDateMeta(null, { visible: false });
  setDetailActionButtonsVisible({});
  openModal($('#modal-detail'));
  refreshIcons($('#modal-detail'));
};

window.showShareSent = function(id) {
  const s = state.sharesSent.find((x) => x.id === id);
  if (!s) return;
  if (s.entry_id && state.entries.some((e) => e.id === s.entry_id)) {
    window.showEntry(s.entry_id);
    return;
  }
  toast(`Partagé avec ${s.recipient_display_name || s.recipient_email}`, 'info');
};

window.deleteShare = function(id) {
  const received = state.sharesReceived.find((x) => x.id === id);
  const sent = state.sharesSent.find((x) => x.id === id);
  const label = received?.title || sent?.title || 'ce partage';
  showDeleteConfirm(
    { title: label },
    async () => {
      try {
        await api.deleteShare(state.token, id);
        await loadShares();
        toast('Partage retiré', 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    {
      title: 'Retirer le partage',
      message: 'Le destinataire n’aura plus accès à cette copie. Votre clé d’origine reste intacte.',
    },
  );
};

function getDashboardEntries() {
  const list = filterEntriesByQuery(state.entries, state.dashSearch);
  if (state.dashTab === 'az') {
    return [...list].sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  }
  return [...list].sort(
    (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
  );
}

function renderDashboard() {
  updateEntryCounts();
  syncTypeFilterButtons();
  const entries = getDashboardEntries();
  const grid = $('#dash-tiles-grid');
  const empty = $('#dash-tiles-empty');

  $$('.dash-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.dashTab === state.dashTab);
  });

  if (entries.length === 0 && state.entries.length === 0) {
    grid.innerHTML = `
      <button type="button" class="dash-tile dash-tile-add" id="dash-tile-add-only">
        <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
        <span class="dash-tile-name">${esc(addEntryTileLabel())}</span>
      </button>`;
    empty.classList.add('hidden');
    $('#dash-tile-add-only')?.addEventListener('click', openAddModal);
    refreshIcons(grid);
    return;
  }

  if (entries.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    empty.querySelector('p').textContent = 'Aucun résultat pour cette recherche';
    syncAddEntryButtonLabels();
    refreshIcons(empty);
    return;
  }

  empty.classList.add('hidden');
  empty.querySelector('p').textContent = 'Aucune clé pour le moment';
  syncAddEntryButtonLabels();
  grid.innerHTML = entries.map((e, i) => `
      <button type="button" class="${dashTileClassName(e)}" style="${dashTileStyle(e, i)}" data-action="show-entry" data-id="${esc(e.id)}">
        ${dashTileIconMarkup(e)}
        <span class="dash-tile-name">${esc(e.title)}</span>
        ${entryType(e) === 'api_key' ? '<span class="dash-tile-badge">API</span>' : ''}
        ${entryType(e) === 'ssh_key' ? '<span class="dash-tile-badge dash-tile-badge-ssh">SSH</span>' : ''}
      </button>`).join('') + `
    <button type="button" class="dash-tile dash-tile-add" data-action="add-entry">
      <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
      <span class="dash-tile-name">${esc(addEntryTileLabel())}</span>
    </button>`;

  refreshIcons(grid);
  setupFaviconImages(grid);
}

function formatProfileDate(iso) {
  if (!iso) return EMPTY_VALUE;
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatMemberSince(iso) {
  if (!iso) return EMPTY_VALUE;
  const date = new Date(iso);
  return `Depuis ${date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
}

function shortenUserId(id) {
  if (!id || id.length < 12) return id || EMPTY_VALUE;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function updateProfileChip() {
  $('#profile-chip-entries').textContent = state.entries.length;
}

function setProfileStatus(devMode) {
  $('#profile-status-label').textContent = devMode ? 'Mode développement' : 'Coffre actif';
  $('#profile-status').classList.toggle('profile-status-dev', devMode);
}

function applyUserToUI(user) {
  if (!user) return;
  const normalized = normalizeUser(user);
  setAvatar($('#profile-avatar'), normalized.display_name);
  setAvatar($('#user-avatar'), normalized.display_name);
  $('#profile-display-name').textContent = normalized.display_name || EMPTY_VALUE;
  $('#profile-detail-first-name').textContent = normalized.first_name || EMPTY_VALUE;
  $('#profile-detail-middle-name').textContent = normalized.middle_name || 'Non renseigné';
  $('#profile-detail-last-name').textContent = normalized.last_name || EMPTY_VALUE;
  $('#profile-email').textContent = normalized.email;
  $('#profile-detail-email').textContent = normalized.email;
  $('#user-name').textContent = normalized.display_name;
  $('#user-email').textContent = normalized.email;
  $('#user-avatar').title = `${normalized.display_name} (${normalized.email})`;
}

async function renderProfile() {
  const user = state.user;
  if (!user) return;

  setProfileStatus(state.devMode);
  applyUserToUI(user);
  syncPersistSessionPrefUI();
  $('#profile-detail-id').textContent = shortenUserId(user.id);
  $('#profile-detail-id').dataset.full = user.id;
  updateProfileChip();

  if (state.devMode) {
    $('#profile-detail-created').textContent = 'Environnement local';
    $('#profile-member-since').textContent = 'Environnement local';
    refreshIcons($('#profile-view'));
    return;
  }

  try {
    const profile = await api.getProfile(state.token);
    state.user = userFromProfile(profile);
    applyUserToUI(state.user);
    $('#profile-detail-id').textContent = shortenUserId(profile.user_id);
    $('#profile-detail-id').dataset.full = profile.user_id;
    $('#profile-detail-created').textContent = formatProfileDate(profile.created_at);
    $('#profile-member-since').textContent = formatMemberSince(profile.created_at);
    $('#profile-chip-entries').textContent = profile.entries_count;
  } catch {
    $('#profile-detail-created').textContent = EMPTY_VALUE;
    $('#profile-member-since').textContent = EMPTY_VALUE;
  }

  refreshIcons($('#profile-view'));
}

function closeAllProfileFieldEdits() {
  $$('.profile-field-editable').forEach(row => {
    row.classList.remove('is-editing');
    row.querySelector('.profile-field-view')?.classList.remove('hidden');
    row.querySelector('.profile-field-form')?.classList.add('hidden');
  });
}

function openProfileFieldEdit(field) {
  if (!state.user) return;
  closeAllProfileFieldEdits();

  const config = PROFILE_FIELD_CONFIG[field];
  const row = $(`.profile-field-editable[data-field="${field}"]`);
  if (!config || !row) return;

  const input = $(config.input);
  input.value = config.getValue(normalizeUser(state.user));

  row.classList.add('is-editing');
  row.querySelector('.profile-field-view').classList.add('hidden');
  row.querySelector('.profile-field-form').classList.remove('hidden');
  input.focus();
  input.select();
}

async function saveProfileField(field) {
  if (!state.user) return;

  const config = PROFILE_FIELD_CONFIG[field];
  if (!config) return;

  const input = $(config.input);
  const rawValue = input.value;
  const value = config.normalize ? config.normalize(rawValue) : rawValue.trim();

  if (config.required && !value) {
    toast(config.requiredMessage, 'error');
    return;
  }
  if (field === 'email' && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    toast('Email invalide', 'error');
    return;
  }

  const current = config.getValue(normalizeUser(state.user));
  if (value === current) {
    closeAllProfileFieldEdits();
    return;
  }

  if (state.devMode) {
    const updated = { ...normalizeUser(state.user), [field]: value };
    updated.display_name = buildDisplayName(updated);
    state.user = updated;
    applyUserToUI(state.user);
    closeAllProfileFieldEdits();
    toast('Profil mis à jour (mode développement)', 'success');
    return;
  }

  const row = $(`.profile-field-editable[data-field="${field}"]`);
  const btn = row.querySelector('.profile-field-save');
  btn.disabled = true;
  try {
    const profile = await api.updateProfile(state.token, { [field]: value });
    if (profile.access_token) state.token = profile.access_token;
    state.user = userFromProfile(profile);
    applyUserToUI(state.user);
    saveSession(state);
    $('#profile-detail-created').textContent = formatProfileDate(profile.created_at);
    $('#profile-member-since').textContent = formatMemberSince(profile.created_at);
    $('#profile-chip-entries').textContent = profile.entries_count;
    closeAllProfileFieldEdits();
    toast('Profil mis à jour', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

function initProfileFieldEdits() {
  $$('.profile-field-editable').forEach(row => {
    const field = row.dataset.field;

    row.querySelector('.profile-field-edit')?.addEventListener('click', () => openProfileFieldEdit(field));
    row.querySelector('.profile-field-cancel')?.addEventListener('click', closeAllProfileFieldEdits);
    row.querySelector('.profile-field-save')?.addEventListener('click', () => saveProfileField(field));

    const input = row.querySelector('.profile-field-input');
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); saveProfileField(field); }
      if (e.key === 'Escape') closeAllProfileFieldEdits();
    });
  });
}

function renderEntries() {
  const list = getFilteredEntries();
  const container = $('#entries-list');
  const empty = $('#entries-empty');
  const noResults = $('#entries-no-results');

  updateEntryCounts();
  syncTypeFilterButtons();
  syncAddEntryButtonLabels();

  empty.classList.add('hidden');
  noResults.classList.add('hidden');

  if (state.entries.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  if (list.length === 0) {
    container.innerHTML = '';
    noResults.classList.remove('hidden');
    return;
  }

  container.innerHTML = list.map((e, i) => `
    <div class="entry-card" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-entry">
      ${entryAvatarMarkup(e)}
      <div class="entry-info">
        <div class="entry-title-row">
          <div class="entry-title">${esc(e.title)}</div>
          ${entryTypeBadgeMarkup(e)}
        </div>
        <div class="entry-username">${esc(
          entryType(e) === 'api_key' && displayUsername(e.username) === 'none'
            ? 'Secret API'
            : entryType(e) === 'ssh_key' && displayUsername(e.username) === 'none'
              ? 'Clé SSH / stockage'
              : displayUsername(e.username)
        )}</div>
      </div>
      <div class="entry-actions">
        <button type="button" class="btn-icon" title="Copier" data-action="copy-password" data-id="${esc(e.id)}">
          <i data-lucide="copy"></i>
        </button>
        <button type="button" class="btn-icon btn-danger" title="Supprimer" data-action="delete-entry" data-id="${esc(e.id)}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`).join('');
  refreshIcons(container);
  setupFaviconImages(container);
}

function resolveEventElement(event) {
  const t = event.target;
  if (t instanceof Element) return t;
  if (t && t.parentElement) return t.parentElement;
  if (typeof event.composedPath === 'function') {
    for (const node of event.composedPath()) {
      if (node instanceof Element) return node;
    }
  }
  return null;
}

function handleEntryClick(event) {
  const target = resolveEventElement(event);
  if (!target) return;

  const root = target.closest('#dash-tiles-grid, #entries-list, #shares-received-list, #shares-sent-list');
  if (!root) return;

  const actionEl = target.closest('[data-action]');
  if (!actionEl || !root.contains(actionEl)) return;

  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id
    || actionEl.closest('[data-id]')?.dataset.id;

  if (action === 'show-entry' && id) {
    window.showEntry(id);
    return;
  }
  if (action === 'show-share-received' && id) {
    window.showShareReceived(id);
    return;
  }
  if (action === 'show-share-sent' && id) {
    window.showShareSent(id);
    return;
  }
  if (action === 'copy-password' && id) {
    event.stopPropagation();
    window.copyPassword(id);
    return;
  }
  if (action === 'copy-share-received' && id) {
    event.stopPropagation();
    const e = state.sharesReceived.find((x) => x.id === id);
    if (e?.password) copyToClipboard(e.password).then((ok) => {
      toast(ok ? `"${e.title}" copié` : 'Impossible de copier', ok ? 'success' : 'error');
    });
    return;
  }
  if (action === 'delete-entry' && id) {
    event.stopPropagation();
    window.deleteEntry(id);
    return;
  }
  if (action === 'delete-share' && id) {
    event.stopPropagation();
    window.deleteShare(id);
    return;
  }
  if (action === 'add-entry') {
    openAddModal();
  }
}

document.addEventListener('click', handleEntryClick);

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (!page) return;
    switchPage(page);
    if (isMobileLayout()) collapseSidebar();
  });
});

$('#btn-dash-add').addEventListener('click', openAddModal);
$('#btn-dash-add-empty').addEventListener('click', openAddModal);
$('#btn-entries-empty-add')?.addEventListener('click', openAddModal);

$$('.dash-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    state.dashTab = tab.dataset.dashTab;
    renderDashboard();
  });
});

const debouncedRenderDashboard = debounce(() => renderDashboard());
const debouncedRenderEntries = debounce(() => renderEntries());

$('#dash-search-input').addEventListener('input', (e) => {
  state.dashSearch = e.target.value;
  $('#btn-clear-dash-search').classList.toggle('hidden', !state.dashSearch);
  debouncedRenderDashboard();
});

$('#btn-clear-dash-search').addEventListener('click', () => {
  $('#dash-search-input').value = '';
  state.dashSearch = '';
  $('#btn-clear-dash-search').classList.add('hidden');
  renderDashboard();
});

$('#btn-profile-sidebar').addEventListener('click', () => {
  switchPage('profile');
  if (window.innerWidth <= 900) collapseSidebar();
});

$('#btn-profile-lock').addEventListener('click', () => lockVault('manual'));

$('#btn-copy-profile-email').addEventListener('click', async () => {
  const email = $('#profile-detail-email').textContent;
  if (!email || email === EMPTY_VALUE) return;
  if (!(await copyText(email, $('#btn-copy-profile-email')))) return;
  toast('Email copié', 'success');
});

$('#btn-copy-profile-id').addEventListener('click', async () => {
  const id = $('#profile-detail-id').dataset.full;
  if (!id) return;
  if (!(await copyText(id, $('#btn-copy-profile-id')))) return;
  toast('Identifiant copié', 'success');
});

$('#search-input').addEventListener('input', (e) => {
  state.search = e.target.value;
  $('#btn-clear-search').classList.toggle('hidden', !state.search);
  debouncedRenderEntries();
});

$('#btn-clear-search').addEventListener('click', () => {
  $('#search-input').value = '';
  state.search = '';
  $('#btn-clear-search').classList.add('hidden');
  renderEntries();
});

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    if (state.token && state.page === 'vault') { $('#search-input').focus(); }
  }
});

// ── Détail clé ───────────────────────────────────────────

window.showEntry = function(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;

  state.detailEntryId = id;
  fillEntryDetailCommon(e);
  $('#detail-share-note-field')?.classList.add('hidden');
  setDetailDateMeta(e, { visible: true });
  setDetailActionButtonsVisible({ edit: true, share: true, delete: true });
  openModal($('#modal-detail'));
  refreshIcons($('#modal-detail'));
};

$('#btn-edit-detail')?.addEventListener('click', () => {
  if (!state.detailEntryId) return;
  openEditModal(state.detailEntryId);
});

$('#btn-share-detail')?.addEventListener('click', () => {
  if (!state.detailEntryId) return;
  openShareModal(state.detailEntryId);
});

$('#btn-close-share')?.addEventListener('click', () => closeModal($('#modal-share')));

$('#form-share')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const entryId = state.shareEntryId;
  const entry = state.entries.find((x) => x.id === entryId);
  const email = $('#share-email')?.value.trim().toLowerCase();
  if (!entry || !email) {
    toast('Email du destinataire requis', 'error');
    return;
  }
  if (state.user?.email && email === String(state.user.email).toLowerCase()) {
    toast('Vous ne pouvez pas partager avec vous-même', 'error');
    return;
  }

  const btn = $('#btn-share-submit');
  btn.disabled = true;
  showLoading('Chiffrement du partage...');
  try {
    const recipient = await api.lookupUser(state.token, email);
    const shareNote = ($('#share-note')?.value || '').trim().slice(0, 500);
    const payload = {
      title: entry.title,
      username: entry.username || '',
      password: entry.password || '',
      url: entry.url || '',
      notes: entry.notes || '',
      share_note: shareNote,
      shared_by: state.user.display_name,
      shared_by_email: state.user.email,
    };
    const encrypted = await encryptForRecipient(payload, fromB64(recipient.public_key));
    await api.createShare(state.token, {
      entry_id: entry.id,
      recipient_email: recipient.email,
      encrypted_data: toB64(encrypted),
    });
    await loadShares();
    closeModal($('#modal-share'));
    toast(`Partagé avec ${recipient.display_name || recipient.email}`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

$('#btn-delete-detail').addEventListener('click', () => {
  if (!state.detailEntryId) return;
  window.deleteEntry(state.detailEntryId);
});

$('#btn-toggle-pwd').addEventListener('click', () => {
  const el = $('#detail-password');
  const icon = $('#btn-toggle-pwd').querySelector('[data-lucide], .lucide');
  const visible = el.dataset.visible === 'true';
  el.textContent = visible ? '••••••••••••' : el.dataset.real;
  el.dataset.visible = visible ? 'false' : 'true';
  if (icon) setLucideIcon(icon, visible ? 'eye' : 'eye-off');
});

$('#btn-copy-detail').addEventListener('click', async () => {
  if (!(await copyText($('#detail-password').dataset.real, $('#btn-copy-detail')))) return;
  const entry = state.entries.find((x) => x.id === state.detailEntryId)
    || state.sharesReceived.find((x) => x.id === state.detailEntryId);
  const type = entry ? entryType(entry) : 'login';
  const msg = type === 'ssh_key'
    ? 'Clé copiée'
    : type === 'api_key'
      ? 'Secret copié'
      : 'Mot de passe copié';
  toast(msg, 'success');
});

$$('.btn-copy-field[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy).textContent;
    if (!(await copyText(text, btn))) return;
    toast('Copié', 'success');
  });
});

$('#btn-close-detail').addEventListener('click', () => {
  closeModal($('#modal-detail'));
  clearDetailSecrets();
  state.detailEntryId = null;
});

window.copyPassword = async function(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  if (!(await copyToClipboard(e.password))) {
    toast('Impossible de copier — autorisez le presse-papiers ou copiez manuellement', 'error');
    return;
  }
  toast(`"${e.title}" copié`, 'success');
};

// ── Ajouter clé ──────────────────────────────────────────

function openAddModal() {
  resetEntryFormModal();
  $('#form-entry').reset();
  if ($('#entry-secret-block')) $('#entry-secret-block').value = '';
  const type = defaultEntryTypeFromFilter();
  if ($('#entry-type')) $('#entry-type').value = type;
  applyEntryFormLabels(type);
  $('#modal-entry-title').textContent = ENTRY_TYPES.includes(state.typeFilter)
    ? addEntryModalTitle(type)
    : 'Ajouter une clé';
  $('#entry-generated').classList.add('hidden');
  openModal($('#modal-add'));
  refreshIcons($('#modal-add'));
  setTimeout(() => $('#entry-title')?.focus(), 50);
}

function openEditModal(entryId) {
  const e = state.entries.find((x) => x.id === entryId);
  if (!e) return;

  state.editingEntryId = entryId;
  $('#form-entry').reset();
  const type = entryType(e);
  if ($('#entry-type')) $('#entry-type').value = type;
  applyEntryFormLabels(type);
  $('#entry-title').value = e.title;
  $('#entry-username').value = e.username || '';
  if (type === 'ssh_key') {
    if ($('#entry-secret-block')) $('#entry-secret-block').value = e.password || '';
  } else {
    $('#entry-password').value = e.password || '';
  }
  $('#entry-url').value = e.url || '';
  $('#entry-notes').value = e.notes || '';
  $('#entry-generated').classList.add('hidden');
  $('#modal-entry-title').textContent = 'Modifier la clé';
  $('#btn-save-entry').innerHTML = '<i data-lucide="check-circle"></i> Mettre à jour';
  closeModal($('#modal-detail'));
  openModal($('#modal-add'));
  refreshIcons($('#modal-add'));
  setTimeout(() => $('#entry-title')?.focus(), 50);
}

function readEntryFormData() {
  const type = normalizeEntryType($('#entry-type')?.value);
  const title = $('#entry-title').value.trim();
  const username = $('#entry-username').value.trim();
  const password = type === 'ssh_key'
    ? ($('#entry-secret-block')?.value || '').trim()
    : $('#entry-password').value;
  const urlRaw = $('#entry-url').value.trim();
  const url = type === 'ssh_key' ? urlRaw : normalizeEntryUrl(urlRaw);
  const notes = $('#entry-notes').value.trim();

  if (!title) {
    toast(entryTitleRequiredLabel(type), 'error');
    $('#entry-title').focus();
    return null;
  }
  if (!password) {
    toast(entrySecretRequiredLabel(type), 'error');
    if (type === 'ssh_key') $('#entry-secret-block')?.focus();
    else $('#entry-password').focus();
    return null;
  }

  return { type, title, username, password, url, notes };
}

$('#btn-add-sidebar').addEventListener('click', () => {
  openAddModal();
  if (window.innerWidth <= 900) collapseSidebar();
});
$('#fab-add').addEventListener('click', openAddModal);
$('#btn-close-add').addEventListener('click', () => {
  resetEntryFormModal();
  closeModal($('#modal-add'));
});

$('#btn-generate').addEventListener('click', () => {
  const pwd = generatePassword(20);
  $('#entry-password').value = pwd;
  $('#entry-generated').textContent = pwd;
  $('#entry-generated').classList.remove('hidden');
});

$('#btn-generate-ssh')?.addEventListener('click', async () => {
  const btn = $('#btn-generate-ssh');
  if (btn) btn.disabled = true;
  try {
    const comment = ($('#entry-username')?.value || '').trim()
      || ($('#entry-title')?.value || '').trim()
      || 'gardefort';
    const pair = await generateSshEd25519KeyPair(comment);
    if ($('#entry-secret-block')) $('#entry-secret-block').value = pair.privateKey;
    $('#entry-generated')?.classList.add('hidden');
    toast('Clé Ed25519 générée', 'success');
  } catch (err) {
    toast(err.message || 'Génération SSH impossible', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#entry-type')?.addEventListener('change', (e) => {
  const type = normalizeEntryType(e.target.value);
  applyEntryFormLabels(type);
  $('#entry-generated').classList.add('hidden');
  if (!state.editingEntryId) {
    $('#modal-entry-title').textContent = addEntryModalTitle(type);
  }
});

$$('.type-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.typeFilter = btn.dataset.typeFilter || 'all';
    syncTypeFilterButtons();
    syncAddEntryButtonLabels();
    refreshCurrentView();
  });
});

$('#form-entry').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readEntryFormData();
  if (!data) return;

  const btn = $('#btn-save-entry');
  const editingId = state.editingEntryId;
  btn.disabled = true;
  try {
    if (state.devMode) {
      if (editingId) {
        updateDevEntry(state.entries, editingId, data);
      } else {
        createDevEntry(state.entries, data);
      }
      if (data.url) void preloadFavicon(data.url);
      refreshCurrentView();
      closeModal($('#modal-add'));
      resetEntryFormModal();
      toast(editingId ? `"${data.title}" mis à jour` : `"${data.title}" ajouté`, 'success');
      if (editingId && state.detailEntryId === editingId) {
        showEntry(editingId);
      }
      return;
    }

    if (editingId) {
      const confirmed = await requestMasterPasswordConfirmation();
      if (!confirmed) {
        toast('Mise à jour annulée', 'info');
        return;
      }
      const encrypted = await encryptData(data, state.vaultKey);
      await api.updateEntry(state.token, editingId, toB64(encrypted));
      await loadEntries();
      if (data.url) void preloadFavicon(data.url);
      refreshCurrentView();
      closeModal($('#modal-add'));
      resetEntryFormModal();
      toast(`"${data.title}" mis à jour`, 'success');
      if (state.detailEntryId === editingId) {
        showEntry(editingId);
      }
      return;
    }

    const encrypted = await encryptData(data, state.vaultKey);
    await api.createEntry(state.token, toB64(encrypted));
    await loadEntries();
    if (data.url) void preloadFavicon(data.url);
    refreshCurrentView();
    closeModal($('#modal-add'));
    resetEntryFormModal();
    toast(`"${data.title}" ajouté`, 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

// ── Supprimer ────────────────────────────────────────────

window.deleteEntry = function(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  showDeleteConfirm(e, async () => {
    try {
        if (state.devMode) {
          deleteDevEntry(state.entries, id);
          if ($('#modal-detail').classList.contains('open')) {
            closeModal($('#modal-detail'));
            clearDetailSecrets();
            state.detailEntryId = null;
          }
          refreshCurrentView();
          toast(`"${e.title}" supprimé`, 'info');
          return;
        }
        await api.deleteEntry(state.token, id);
        await loadEntries();
        if ($('#modal-detail').classList.contains('open')) {
          closeModal($('#modal-detail'));
          clearDetailSecrets();
          state.detailEntryId = null;
        }
      refreshCurrentView();
      toast(`"${e.title}" supprimé`, 'info');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
};

// ── Modales ──────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isRecoveryKeysModalOpen()) {
      toast('Confirmez d’abord avoir sauvegardé vos 7 clés', 'error');
      return;
    }
    closeAllModals();
  }
});

$$('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    const modal = overlay.closest('.modal');
    if (modal?.id === 'modal-recovery-keys') {
      toast('Confirmez d’abord avoir sauvegardé vos 7 clés', 'error');
      return;
    }
    if (modal?.id === 'modal-master-confirm') {
      settleMasterConfirm(false);
      return;
    }
    if (modal?.id === 'modal-detail') {
      clearDetailSecrets();
      state.detailEntryId = null;
    }
    closeModal(modal);
  });
});

async function restoreSessionIfAny() {
  const saved = loadSessionIfFresh();
  if (!saved) return false;
  Object.assign(state, {
    token: saved.token,
    user: normalizeUser(saved.user),
    authMaterial: saved.authMaterial,
    vaultKey: null,
    privateKey: null,
    publicKey: null,
    devMode: false,
    entries: [],
    sharesReceived: [],
    sharesSent: [],
  });
  openUnlockScreen();
  return true;
}

$('#form-unlock')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const master = $('#unlock-password')?.value || '';
  if (!master) {
    toast('Veuillez saisir votre mot de passe maître', 'error');
    $('#unlock-password')?.focus();
    return;
  }
  if (!state.authMaterial?.salt || !state.authMaterial?.encrypted_vault_key) {
    hardLogout('silent');
    toast('Session invalide — reconnectez-vous', 'error');
    openAuthTab('login');
    return;
  }
  const btn = $('#btn-unlock');
  if (btn) btn.disabled = true;
  showLoading('Déverrouillage du coffre...');
  try {
    const keys = await unlockSession(state.authMaterial, master);
    clearAuthSecrets();
    Object.assign(state, keys);
    state.entries = [];
    showVault();
    try {
      await loadEntries();
      refreshCurrentView();
    } catch (err) {
      console.warn('Chargement des clés partiel:', err);
      const msg = String(err.message || err);
      if (/401|403|expir|unauthor|token/i.test(msg)) {
        hardLogout('silent');
        toast('Session expirée — reconnectez-vous', 'error');
        openAuthTab('login');
        return;
      }
      toast('Coffre ouvert, mais certaines clés n\'ont pas pu être chargées', 'info');
    }
    toast('Coffre déverrouillé', 'success');
  } catch {
    toast('Mot de passe maître incorrect', 'error');
    $('#unlock-password').value = '';
    $('#unlock-password')?.focus();
  } finally {
    hideLoading();
    if (btn) btn.disabled = false;
  }
});

$('#btn-unlock-logout')?.addEventListener('click', () => hardLogout('manual'));

showScreen('landing');
clearLoginForm();
initIcons();
initProfileFieldEdits();
refreshIcons($('#screen-landing'));
showCompatBannerIfNeeded();
restoreSessionIfAny();
