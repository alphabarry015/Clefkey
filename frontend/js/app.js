/**
 * Application principale — Clefkey.
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
  wipeKeyBytes,
} from './session.js';
import { showCompatBannerIfNeeded, copyToClipboard } from './compat.js';
import {
  recoveryCodesAsText,
  downloadRecoveryKeysPng,
  downloadRecoveryKeysPdf,
  downloadRecoveryKeysTxt,
} from './recovery-export.js';
import {
  isFoldersMetaEntry,
  isVaultMetaEntry,
  newFolderId,
  normalizeFolderName,
  normalizeFoldersList,
  foldersFromMetaEntry,
  createFoldersMetaPayload,
  entryFolderId,
  entryInKnownFolder,
  folderNameById,
} from './folders.js';
import { createAuthScreens } from './auth-screens.js';
import { initTheme } from './theme.js';
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
  /** @type {string | null} email du contact affiché */
  contactsSelectedEmail: null,
  /** @type {string | null} email prérempli pour le modal partage */
  sharePrefillEmail: null,
  sharePickSearch: '',
  devMode: false,
  page: 'dashboard',
  search: '',
  dashTab: 'recent',
  dashSearch: '',
  typeFilter: 'all',
  /** @type {'all' | 'none' | string} */
  folderFilter: 'all',
  /** @type {string | null} */
  activeProjectId: null,
  projectDetailSearch: '',
  /** @type {string[]} */
  projectDetailSelectedIds: [],
  transferAllowUnassign: false,
  transferExcludeFolderId: '',
  /** @type {{ id: string, name: string }[]} */
  folders: [],
  foldersMetaEntryId: null,
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
const $$ = (sel) => [...document.querySelectorAll(sel)];
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
  const folderLabel = folderNameById(state.folders, entryFolderId(e));
  const badge = $('#detail-type-badge');
  // applyDetailTypeLabels already set type badge; append project hint on title area via notes of badge sibling
  let folderBadge = $('#detail-folder-badge');
  if (!folderBadge && badge?.parentElement) {
    folderBadge = document.createElement('span');
    folderBadge.id = 'detail-folder-badge';
    folderBadge.className = 'entry-folder-badge';
    badge.parentElement.appendChild(folderBadge);
  }
  if (folderBadge) {
    if (folderLabel && !e.isShare) {
      folderBadge.textContent = folderLabel;
      folderBadge.classList.remove('hidden');
    } else {
      folderBadge.classList.add('hidden');
    }
  }
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
  if (btn) setHtml(btn, '<i data-lucide="check-circle"></i> Enregistrer');
  hideEntryFolderCreate();
}

function hideEntryFolderCreate() {
  const panel = $('#entry-folder-create');
  const toggle = $('#btn-entry-folder-toggle');
  const input = $('#entry-folder-new-name');
  panel?.classList.add('hidden');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (input) input.value = '';
}

function showEntryFolderCreate() {
  const panel = $('#entry-folder-create');
  const toggle = $('#btn-entry-folder-toggle');
  panel?.classList.remove('hidden');
  if (toggle) toggle.setAttribute('aria-expanded', 'true');
  setTimeout(() => $('#entry-folder-new-name')?.focus(), 40);
}

async function createFolderByName(rawName, { selectInEntryForm = false } = {}) {
  const name = normalizeFolderName(rawName);
  if (!name) {
    toast('Nom du projet requis', 'error');
    return null;
  }
  if (state.folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    toast('Ce projet existe déjà', 'error');
    return null;
  }
  const folder = { id: newFolderId(), name };
  state.folders = normalizeFoldersList([...state.folders, folder]);
  await persistFoldersMeta();
  syncFolderFilterButtons();
  populateFolderSelect(selectInEntryForm ? folder.id : undefined);
  populateTransferFolderSelect(folder.id);
  syncTransferEntryButtons();
  renderFoldersManageList();
  refreshCurrentView();
  toast('Projet créé', 'success');
  return folder;
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
  let derived = null;
  let vaultKey = null;
  try {
    const material = await getAuthMaterialForVerification();
    derived = await deriveKey(masterPassword, fromB64(material.salt));
    vaultKey = await decryptBytes(fromB64(material.encrypted_vault_key), derived);
    return sameBytes(vaultKey, state.vaultKey);
  } catch {
    return false;
  } finally {
    wipeKeyBytes(derived);
    wipeKeyBytes(vaultKey);
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
  if (!el) return;
  const [c1, c2] = getAvatarColor(name);
  el.textContent = getInitials(name);
  el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remplace le contenu HTML sans assigner `.innerHTML` (réduit le risque XSS / alertes scanners). */
function setHtml(el, html) {
  el.replaceChildren();
  const source = String(html ?? '');
  if (!source) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  el.appendChild(range.createContextualFragment(source));
}

/** Remplit un <select> via le DOM (pas d'innerHTML). */
function fillSelect(sel, options, selectedValue = '') {
  sel.replaceChildren();
  for (const { value, label } of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (selectedValue !== '' && [...sel.options].some((o) => o.value === selectedValue)) {
    sel.value = selectedValue;
  } else if (selectedValue === '' && [...sel.options].some((o) => o.value === '')) {
    sel.value = '';
  } else if (sel.options.length) {
    sel.selectedIndex = 0;
  }
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

function syncEntryTypePills(type = 'login') {
  const t = normalizeEntryType(type);
  const input = $('#entry-type');
  if (input) input.value = t;
  $$('.entry-type-pill').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.entryType === t);
  });
}

function setEntryFormType(type) {
  const t = normalizeEntryType(type);
  syncEntryTypePills(t);
  applyEntryFormLabels(t);
  $('#entry-generated')?.classList.add('hidden');
  if (!state.editingEntryId) {
    $('#modal-entry-title').textContent = addEntryModalTitle(t);
  }
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
      setHtml(userLabel, 'Commentaire / utilisateur <span class="optional">(optionnel)</span>');
    } else if (isApi) {
      setHtml(userLabel, 'Client ID / Identifiant <span class="optional">(optionnel)</span>');
    } else {
      setHtml(userLabel, 'Identifiant <span class="optional">(optionnel)</span>');
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
      setHtml(urlLabel, 'Hôte / alias <span class="optional">(optionnel)</span>');
    } else if (isApi) {
      setHtml(urlLabel, 'Console / endpoint <span class="optional">(optionnel)</span>');
    } else {
      setHtml(urlLabel, 'URL <span class="optional">(optionnel)</span>');
    }
  }
  if (notesLabel) {
    if (isSsh) {
      notesLabel.textContent = 'Clé publique / fingerprint (optionnel)';
    } else if (isApi) {
      notesLabel.textContent = 'Scopes / notes (optionnel)';
    } else {
      notesLabel.textContent = 'Notes (optionnel)';
    }
  }
  const notesHeading = $('#entry-notes-heading');
  if (notesHeading) {
    if (isSsh) {
      setHtml(notesHeading, 'Clé publique / fingerprint <span class="optional">optionnel</span>');
    } else if (isApi) {
      setHtml(notesHeading, 'Scopes / notes <span class="optional">optionnel</span>');
    } else {
      setHtml(notesHeading, 'Notes <span class="optional">optionnel</span>');
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
      ? 'Collez la clé SSH privée'
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

function syncFolderFilterButtons() {
  const renderList = (containerId) => {
    const el = $(containerId);
    if (!el) return;
    setHtml(el, state.folders.map((f) => `
      <button type="button" class="folder-filter${state.folderFilter === f.id ? ' active' : ''}" data-folder-filter="${esc(f.id)}">${esc(f.name)}</button>
    `).join(''));
  };
  renderList('#dash-folder-filter-list');
  renderList('#vault-folder-filter-list');
  $$('.folder-filters > .folder-filter[data-folder-filter="all"]').forEach((btn) => {
    btn.classList.toggle('active', state.folderFilter === 'all');
  });
  $$('.folder-filters > .folder-filter[data-folder-filter="none"]').forEach((btn) => {
    btn.classList.toggle('active', state.folderFilter === 'none');
  });
}

function populateFolderSelect(selectedId = '') {
  const sel = $('#entry-folder');
  if (!sel) return;
  const current = selectedId || sel.value || '';
  const pick = current && state.folders.some((f) => f.id === current) ? current : '';
  fillSelect(sel, [
    { value: '', label: 'Sans projet' },
    ...state.folders.map((f) => ({ value: f.id, label: f.name })),
  ], pick);
}

function defaultFolderIdFromFilter() {
  if (state.page === 'project-detail' && state.activeProjectId
      && state.folders.some((f) => f.id === state.activeProjectId)) {
    return state.activeProjectId;
  }
  if (state.folderFilter && state.folderFilter !== 'all' && state.folderFilter !== 'none'
      && state.folders.some((f) => f.id === state.folderFilter)) {
    return state.folderFilter;
  }
  return '';
}

function entryEncryptedPayload(data) {
  const payload = {
    type: normalizeEntryType(data.type),
    title: data.title,
    username: data.username || '',
    password: data.password || '',
    url: data.url || '',
    notes: data.notes || '',
  };
  const folderId = typeof data.folderId === 'string' ? data.folderId.trim() : '';
  if (folderId && state.folders.some((f) => f.id === folderId)) {
    payload.folderId = folderId;
  }
  return payload;
}

async function persistFoldersMeta() {
  const payload = createFoldersMetaPayload(state.folders);
  if (state.devMode) {
    // Meta hors liste visible : stockée à part en mémoire via foldersMetaEntryId factice
    state.foldersMetaEntryId = state.foldersMetaEntryId || 'dev-folders-meta';
    return;
  }
  const encrypted = await encryptData(payload, state.vaultKey);
  const b64 = toB64(encrypted);
  if (state.foldersMetaEntryId) {
    await api.updateEntry(state.token, state.foldersMetaEntryId, b64);
  } else {
    const created = await api.createEntry(state.token, b64);
    state.foldersMetaEntryId = created?.id || state.foldersMetaEntryId;
    // Recharger pour récupérer l’id si la réponse ne le donne pas
    if (!state.foldersMetaEntryId) await loadEntries();
  }
}

async function clearFolderIdOnEntries(folderId) {
  const affected = state.entries.filter((e) => entryFolderId(e) === folderId);
  for (const e of affected) {
    const payload = { ...entryEncryptedPayload({ ...e, folderId: '' }), folderId: '' };
    if (state.devMode) {
      updateDevEntry(state.entries, e.id, payload);
    } else {
      const encrypted = await encryptData(payload, state.vaultKey);
      await api.updateEntry(state.token, e.id, toB64(encrypted));
    }
  }
  if (!state.devMode && affected.length) await loadEntries();
}

function getUnassignedEntries() {
  return state.entries
    .filter((e) => !e.isShare && !isVaultMetaEntry(e) && !entryInKnownFolder(e, state.folders))
    .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
}

async function setEntryFolder(entryId, folderId, { reload = true } = {}) {
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry || entry.isShare) throw new Error('Clé introuvable');
  const nextId = typeof folderId === 'string' ? folderId.trim() : '';
  if (nextId && !state.folders.some((f) => f.id === nextId)) {
    throw new Error('Projet invalide');
  }
  const payload = nextId
    ? entryEncryptedPayload({ ...entry, folderId: nextId })
    : { ...entryEncryptedPayload({ ...entry, folderId: '' }), folderId: '' };
  if (state.devMode) {
    updateDevEntry(state.entries, entryId, payload);
  } else {
    const encrypted = await encryptData(payload, state.vaultKey);
    await api.updateEntry(state.token, entryId, toB64(encrypted));
    if (reload) await loadEntries();
  }
}

async function assignEntriesToFolder(entryIds, folderId) {
  const targetFolderId = typeof folderId === 'string' ? folderId.trim() : '';
  if (targetFolderId && !state.folders.some((f) => f.id === targetFolderId)) {
    throw new Error('Choisissez un projet valide');
  }
  const idSet = new Set(entryIds.map(String));
  const targets = state.entries.filter(
    (e) => idSet.has(String(e.id)) && !e.isShare && !isVaultMetaEntry(e),
  );
  if (!targets.length) return 0;

  for (const e of targets) {
    await setEntryFolder(e.id, targetFolderId, { reload: false });
  }
  if (!state.devMode) await loadEntries();
  return targets.length;
}

function syncTransferEntryButtons() {
  const unassignedCount = getUnassignedEntries().length;
  const foldersBtn = $('#btn-folders-transfer');
  if (foldersBtn) {
    foldersBtn.disabled = unassignedCount === 0;
    foldersBtn.classList.toggle('is-disabled', unassignedCount === 0);
    foldersBtn.title = unassignedCount === 0
      ? 'Aucune clé sans projet'
      : `${unassignedCount} clé${unassignedCount > 1 ? 's' : ''} sans projet`;
  }
}

function populateTransferFolderSelect(selectedId = '', {
  excludeFolderId = '',
  allowUnassign = false,
} = {}) {
  const sel = $('#transfer-folder');
  if (!sel) return;
  const folders = state.folders.filter((f) => f.id !== excludeFolderId);
  const options = [{ value: '', label: 'Choisir une destination…' }];
  if (allowUnassign) {
    options.push({ value: '__unassign__', label: 'Sans projet' });
  }
  options.push(...folders.map((f) => ({ value: f.id, label: f.name })));
  let pick = selectedId || '';
  if (!pick) {
    if (folders.length === 1) pick = folders[0].id;
    else if (folders.length === 0 && allowUnassign) pick = '__unassign__';
  }
  if (pick === '__unassign__' && allowUnassign) {
    fillSelect(sel, options, '__unassign__');
  } else if (pick && folders.some((f) => f.id === pick)) {
    fillSelect(sel, options, pick);
  } else {
    fillSelect(sel, options, '');
  }
}

function populateDetailFolderSelect(selectedId = '') {
  const sel = $('#detail-move-folder');
  if (!sel) return;
  const current = selectedId || '';
  const pick = current && state.folders.some((f) => f.id === current) ? current : '';
  fillSelect(sel, [
    { value: '', label: 'Sans projet' },
    ...state.folders.map((f) => ({ value: f.id, label: f.name })),
  ], pick);
  syncDetailMoveButton();
}

function syncDetailMoveButton() {
  const sel = $('#detail-move-folder');
  const btn = $('#btn-detail-move-folder');
  const entry = state.entries.find((e) => e.id === state.detailEntryId);
  if (!sel || !btn || !entry) {
    if (btn) btn.disabled = true;
    return;
  }
  const current = entryFolderId(entry) || '';
  const next = (sel.value || '').trim();
  btn.disabled = next === current || (next !== '' && !state.folders.some((f) => f.id === next));
}

function syncDetailProjectField(entry, { editable = false } = {}) {
  const field = $('#detail-project-field');
  const hint = $('#detail-project-hint');
  if (!field) return;
  if (!editable || entry?.isShare) {
    field.classList.add('hidden');
    return;
  }
  field.classList.remove('hidden');
  populateDetailFolderSelect(entryFolderId(entry) || '');
  const hasFolder = !!folderNameById(state.folders, entryFolderId(entry));
  hint?.classList.toggle('hidden', hasFolder || state.folders.length === 0);
  if (hint && !hasFolder && state.folders.length === 0) {
    hint.textContent = 'Créez d’abord un projet pour y ranger cette clé.';
  } else if (hint && !hasFolder) {
    hint.textContent = 'Assignez cette clé à un projet pour l’organiser.';
  }
}

function updateTransferSelectionUi() {
  const boxes = Array.from(document.querySelectorAll('#transfer-entry-list input[type="checkbox"]'));
  const checked = boxes.filter((b) => b.checked);
  const countEl = $('#transfer-selection-count');
  const n = checked.length;
  if (countEl) {
    countEl.textContent = n <= 1 ? `${n} sélectionnée` : `${n} sélectionnées`;
  }
  const all = $('#transfer-select-all');
  if (all) {
    all.checked = boxes.length > 0 && checked.length === boxes.length;
    all.indeterminate = checked.length > 0 && checked.length < boxes.length;
  }
  const folderVal = ($('#transfer-folder')?.value || '').trim();
  const submit = $('#btn-transfer-submit');
  // Destination valide : projet choisi OU « Sans projet »
  const destOk = folderVal === '__unassign__' || (folderVal !== '' && folderVal !== '__unassign__');
  if (submit) submit.disabled = n === 0 || !destOk;
}

function renderTransferEntryList(entries) {
  const list = $('#transfer-entry-list');
  const empty = $('#transfer-empty');
  if (!list) return;
  const items = Array.isArray(entries) ? entries : getUnassignedEntries();
  if (items.length === 0) {
    list.replaceChildren();
    empty?.classList.remove('hidden');
    if (empty) {
      empty.textContent = state.transferAllowUnassign
        ? 'Aucune clé à transférer.'
        : 'Aucune clé sans projet.';
    }
    updateTransferSelectionUi();
    return;
  }
  empty?.classList.add('hidden');
  setHtml(list, items.map((e) => `
    <li class="transfer-entry-item">
      <label class="transfer-entry-item-label">
        <input type="checkbox" value="${esc(e.id)}" checked>
        <span class="transfer-entry-info">
          <span class="transfer-entry-title">${esc(e.title)}</span>
          <span class="transfer-entry-meta">${esc(entryTypeLabel(entryType(e)))}</span>
        </span>
      </label>
    </li>
  `).join(''));
  updateTransferSelectionUi();
}

function openTransferModal({
  preselectIds = null,
  preferredFolderId = '',
  entries = null,
  allowUnassign = false,
  excludeFolderId = '',
  hint = '',
  emptyMessage = '',
} = {}) {
  try {
    const listEntries = Array.isArray(entries) ? entries : getUnassignedEntries();
    state.transferAllowUnassign = !!allowUnassign;
    state.transferExcludeFolderId = excludeFolderId || '';

    if (!allowUnassign && state.folders.length === 0) {
      toast('Créez d’abord un projet', 'info');
      openProjectsPage();
      return;
    }

    if (listEntries.length === 0) {
      toast(
        allowUnassign
          ? 'Aucune clé à transférer'
          : 'Toutes vos clés sont déjà dans un projet',
        'info',
      );
      return;
    }

    const destFolders = state.folders.filter((f) => f.id !== excludeFolderId);
    if (!allowUnassign && destFolders.length === 0) {
      toast('Aucun projet de destination disponible', 'info');
      return;
    }

    const hintEl = $('#transfer-hint');
    if (hintEl) {
      hintEl.textContent = hint
        || (allowUnassign
          ? 'Sélectionnez les clés, puis choisissez le projet de destination (ou Sans projet).'
          : 'Sélectionnez les clés sans projet, puis choisissez le projet de destination.');
    }
    const empty = $('#transfer-empty');
    if (empty && emptyMessage) empty.textContent = emptyMessage;

    const modal = $('#modal-transfer');
    if (!modal) {
      toast('Modale de transfert introuvable — rechargez la page (Ctrl+Shift+R)', 'error');
      return;
    }

    populateTransferFolderSelect(preferredFolderId, { excludeFolderId, allowUnassign });
    renderTransferEntryList(listEntries);
    if (Array.isArray(preselectIds) && preselectIds.length) {
      const set = new Set(preselectIds.map(String));
      Array.from(document.querySelectorAll('#transfer-entry-list input[type="checkbox"]')).forEach((box) => {
        box.checked = set.has(String(box.value));
      });
    }
    updateTransferSelectionUi();
    closeModal($('#modal-folders'));
    openModal(modal);
    refreshIcons(modal);
  } catch (err) {
    console.error('openTransferModal', err);
    toast(err?.message || 'Impossible d’ouvrir le transfert', 'error');
  }
}

function openProjectDetailTransfer() {
  try {
    const folderId = state.activeProjectId;
    if (!folderId) {
      toast('Ouvrez d’abord un projet', 'error');
      return;
    }
    const selected = (state.projectDetailSelectedIds || []).map(String);
    const inProject = getProjectDetailEntries();
    const sourceEntries = selected.length
      ? inProject.filter((e) => selected.includes(String(e.id)))
      : inProject;
    if (!sourceEntries.length) {
      toast('Aucune clé à transférer dans ce projet', 'info');
      return;
    }
    openTransferModal({
      entries: sourceEntries,
      preselectIds: sourceEntries.map((e) => String(e.id)),
      allowUnassign: true,
      excludeFolderId: folderId,
      hint: 'Choisissez le projet de destination (ou Sans projet), puis validez.',
      emptyMessage: 'Aucune clé dans ce projet.',
    });
  } catch (err) {
    console.error('openProjectDetailTransfer', err);
    toast(err?.message || 'Transfert impossible', 'error');
  }
}


function renderFoldersManageList() {
  const list = $('#folders-manage-list');
  const empty = $('#folders-manage-empty');
  if (!list) return;
  if (state.folders.length === 0) {
    list.replaceChildren();
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  setHtml(list, state.folders.map((f) => `
    <li class="folders-manage-item" data-folder-id="${esc(f.id)}">
      <input type="text" class="folder-rename-input" value="${esc(f.name)}" maxlength="80" aria-label="Nom du projet">
      <button type="button" class="btn btn-ghost btn-sm folder-rename-save" title="Enregistrer">OK</button>
      <button type="button" class="btn btn-ghost btn-sm btn-danger folder-delete-btn" title="Supprimer">
        <i data-lucide="trash-2"></i>
      </button>
    </li>
  `).join(''));
  refreshIcons(list);
}

function openFoldersModal() {
  renderFoldersManageList();
  syncTransferEntryButtons();
  const input = $('#folder-new-name');
  if (input) input.value = '';
  openModal($('#modal-folders'));
  refreshIcons($('#modal-folders'));
  setTimeout(() => input?.focus(), 50);
}

function openProjectsPage() {
  closeModal($('#modal-folders'));
  switchPage('projects');
  if (isMobileLayout()) collapseSidebar();
}

function countEntriesInFolder(folderId) {
  return state.entries.filter(
    (e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folderId,
  ).length;
}

function openProjectPage(folderId) {
  if (!folderId || !state.folders.some((f) => f.id === folderId)) {
    toast('Projet introuvable', 'error');
    switchPage('projects');
    return;
  }
  state.activeProjectId = folderId;
  state.projectDetailSearch = '';
  state.projectDetailSelectedIds = [];
  const input = $('#project-detail-search-input');
  if (input) input.value = '';
  $('#btn-clear-project-detail-search')?.classList.add('hidden');
  switchPage('project-detail');
  if (isMobileLayout()) collapseSidebar();
}

function getProjectDetailEntries() {
  const folderId = state.activeProjectId;
  let list = state.entries.filter(
    (e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folderId,
  );
  const q = state.projectDetailSearch.trim().toLowerCase();
  if (q) {
    list = list.filter((e) =>
      e.title.toLowerCase().includes(q)
      || (e.username || '').toLowerCase().includes(q)
      || (e.url && e.url.toLowerCase().includes(q))
      || (e.notes && e.notes.toLowerCase().includes(q)),
    );
  }
  return list.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
}

function entryListCardMarkup(e, i, { selectable = false, selected = false } = {}) {
  const selectMarkup = selectable ? `
      <label class="entry-card-select" data-action="toggle-select" data-id="${esc(e.id)}" title="Sélectionner">
        <input type="checkbox" data-action="toggle-select" data-id="${esc(e.id)}" ${selected ? 'checked' : ''} aria-label="Sélectionner ${esc(e.title)}">
      </label>` : '';
  return `
    <div class="entry-card${selectable ? ' entry-card-selectable' : ''}${selected ? ' is-selected' : ''}" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-entry">
      ${selectMarkup}
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
    </div>`;
}

function clearProjectDetailSelection() {
  state.projectDetailSelectedIds = [];
  syncProjectDetailSelectionUi();
}

function syncProjectDetailSelectionUi() {
  const visibleIds = new Set(getProjectDetailEntries().map((e) => e.id));
  state.projectDetailSelectedIds = state.projectDetailSelectedIds.filter((id) => visibleIds.has(id));
  const n = state.projectDetailSelectedIds.length;
  const bar = $('#project-detail-select-bar');
  const countEl = $('#project-detail-selection-count');
  const moveBtn = $('#btn-project-detail-move');
  const all = $('#project-detail-select-all');
  const transferBtn = $('#btn-project-detail-transfer');

  bar?.classList.toggle('hidden', n === 0);
  if (countEl) {
    countEl.textContent = n <= 1 ? `${n} sélectionnée` : `${n} sélectionnées`;
  }
  if (moveBtn) moveBtn.disabled = n === 0;
  if (all) {
    const total = visibleIds.size;
    all.checked = total > 0 && n === total;
    all.indeterminate = n > 0 && n < total;
  }
  if (transferBtn) {
    transferBtn.disabled = visibleIds.size === 0;
    transferBtn.classList.toggle('is-disabled', visibleIds.size === 0);
  }

  $$('#project-detail-list .entry-card[data-id]').forEach((card) => {
    const id = card.dataset.id;
    const on = state.projectDetailSelectedIds.includes(id);
    card.classList.toggle('is-selected', on);
    const box = card.querySelector('input[data-action="toggle-select"]');
    if (box) box.checked = on;
  });
}

function toggleProjectDetailSelection(id, force) {
  if (!id) return;
  const set = new Set(state.projectDetailSelectedIds);
  const next = typeof force === 'boolean' ? force : !set.has(id);
  if (next) set.add(id);
  else set.delete(id);
  state.projectDetailSelectedIds = [...set];
  syncProjectDetailSelectionUi();
}

function renderProjectDetailPage() {
  const folder = state.folders.find((f) => f.id === state.activeProjectId);
  if (!folder) {
    state.activeProjectId = null;
    switchPage('projects');
    return;
  }

  updateEntryCounts();
  const allInProject = state.entries.filter(
    (e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folder.id,
  );
  const entries = getProjectDetailEntries();
  const list = $('#project-detail-list');
  const empty = $('#project-detail-empty');
  const avatar = $('#project-detail-avatar');
  const nameEl = $('#project-detail-name');
  const metaEl = $('#project-detail-meta');
  const emptyTitle = $('#project-detail-empty-title');
  const emptyText = $('#project-detail-empty-text');

  if (avatar) avatar.textContent = (folder.name?.[0] || '?').toUpperCase();
  if (nameEl) nameEl.textContent = folder.name;
  if (metaEl) {
    const n = allInProject.length;
    metaEl.textContent = n <= 1 ? `${n} clé` : `${n} clés`;
  }

  updatePageTitle();

  if (!list) return;
  if (entries.length === 0) {
    list.replaceChildren();
    clearProjectDetailSelection();
    empty?.classList.remove('hidden');
    if (state.projectDetailSearch.trim()) {
      if (emptyTitle) emptyTitle.textContent = 'Aucun résultat';
      if (emptyText) emptyText.textContent = 'Essayez un autre terme de recherche.';
      $('#btn-project-detail-add-empty')?.classList.add('hidden');
    } else {
      if (emptyTitle) emptyTitle.textContent = 'Aucune clé dans ce projet';
      if (emptyText) emptyText.textContent = 'Ajoutez une clé pour l’organiser ici.';
      $('#btn-project-detail-add-empty')?.classList.remove('hidden');
    }
    refreshIcons($('#project-detail-view'));
    return;
  }

  empty?.classList.add('hidden');
  const selected = new Set(state.projectDetailSelectedIds);
  setHtml(list, entries.map((e, i) => entryListCardMarkup(e, i, {
    selectable: true,
    selected: selected.has(e.id),
  })).join(''));
  refreshIcons(list);
  setupFaviconImages(list);
  syncProjectDetailSelectionUi();
}

function openProjectFilter(folderId) {
  openProjectPage(folderId);
}

function renderProjectsPage() {
  updateEntryCounts();
  syncTransferEntryButtons();
  const grid = $('#projects-grid');
  const empty = $('#projects-empty');
  const countLabel = $('#projects-count-label');

  if (countLabel) {
    const n = state.folders.length;
    countLabel.textContent = n === 0 ? '0' : String(n);
  }

  if (!grid) return;
  if (state.folders.length === 0) {
    grid.replaceChildren();
    empty?.classList.remove('hidden');
    refreshIcons($('#projects-view'));
    return;
  }
  empty?.classList.add('hidden');
  setHtml(grid, state.folders.map((f) => {
    const count = countEntriesInFolder(f.id);
    const countLabelText = count <= 1 ? `${count} clé` : `${count} clés`;
    const initial = esc((f.name?.[0] || '?').toUpperCase());
    return `
      <article class="project-row" data-folder-id="${esc(f.id)}" role="listitem">
        <button type="button" class="project-row-main" data-action="open-project" title="Ouvrir ${esc(f.name)}">
          <span class="project-row-avatar" aria-hidden="true">${initial}</span>
          <span class="project-row-body">
            <span class="project-row-name">${esc(f.name)}</span>
            <span class="project-row-meta">${esc(countLabelText)}</span>
          </span>
          <span class="project-row-open">Ouvrir</span>
        </button>
        <div class="project-row-actions">
          <button type="button" class="project-row-btn" data-action="rename-project" title="Renommer" aria-label="Renommer">
            <i data-lucide="pencil"></i>
          </button>
          <button type="button" class="project-row-btn project-row-btn-danger" data-action="delete-project" title="Supprimer" aria-label="Supprimer">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </article>`;
  }).join(''));
  refreshIcons($('#projects-view'));
}

function filterEntriesByQuery(list, query) {
  let filtered = list.filter((e) => !isVaultMetaEntry(e));
  if (ENTRY_TYPES.includes(state.typeFilter)) {
    filtered = filtered.filter((e) => entryType(e) === state.typeFilter);
  }
  if (state.folderFilter === 'none') {
    filtered = filtered.filter((e) => !entryInKnownFolder(e, state.folders));
  } else if (state.folderFilter && state.folderFilter !== 'all') {
    filtered = filtered.filter((e) => entryFolderId(e) === state.folderFilter);
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
  const img = document.createElement('img');
  img.className = 'entry-favicon';
  img.src = faviconUrl;
  img.alt = '';
  img.width = 28;
  img.height = 28;
  img.decoding = 'async';
  img.dataset.siteUrl = normalizeEntryUrl(entry.url) || '';
  img.onerror = function onFaviconImgError() { window.onFaviconError(this); };
  const letterEl = document.createElement('span');
  letterEl.className = 'entry-letter';
  letterEl.textContent = letter;
  el.replaceChildren(img, letterEl);
  setupFaviconImages(el);
}

function toast(msg, type = 'info') {
  const icons = { success: 'check-circle', error: 'x-circle', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', icons[type] || 'info');
  const span = document.createElement('span');
  span.textContent = msg || '';
  el.append(icon, span);
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
  if (!modal) return;
  modal.classList.add('open');
  const body = modal.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
  syncBodyModalLock();
}

function closeModal(modal) {
  if (!modal) return;
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
  const wipeEntry = (e) => {
    if (!e || typeof e !== 'object') return;
    if (typeof e.password === 'string') e.password = '';
    if (typeof e.notes === 'string') e.notes = '';
    if (typeof e.username === 'string') e.username = '';
    if (typeof e.encrypted_data === 'string') e.encrypted_data = '';
  };
  if (Array.isArray(state.entries)) state.entries.forEach(wipeEntry);
  if (Array.isArray(state.sharesReceived)) state.sharesReceived.forEach(wipeEntry);
  if (Array.isArray(state.sharesSent)) state.sharesSent.forEach(wipeEntry);
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
    contactsSelectedEmail: null,
    sharePrefillEmail: null,
    sharePickSearch: '',
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
    dashTab: 'recent',
    dashSearch: '',
    typeFilter: 'all',
    folderFilter: 'all',
    activeProjectId: null,
    projectDetailSearch: '',
    projectDetailSelectedIds: [],
    transferAllowUnassign: false,
    transferExcludeFolderId: '',
    folders: [],
    foldersMetaEntryId: null,
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
  state.folders = [];
  state.foldersMetaEntryId = null;
  state.sharesReceived = [];
  state.sharesSent = [];
  state.contactsSelectedEmail = null;
  state.sharePrefillEmail = null;
  state.sharePickSearch = '';
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
  const input = $('#confirm-name-input');
  if (input) input.placeholder = options.placeholder || 'Nom de la clé';
  state.confirmDeleteName = entry.title;
  state.confirmCallback = onConfirm;
  $('#confirm-name-input').value = '';
  $('#btn-confirm-ok').disabled = true;
  openModal($('#modal-confirm'));
  refreshIcons($('#modal-confirm'));
  setTimeout(() => $('#confirm-name-input')?.focus(), 50);
}

async function performDeleteFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  showLoading('Mise à jour des projets...');
  try {
    await clearFolderIdOnEntries(folderId);
    state.folders = state.folders.filter((f) => f.id !== folderId);
    await persistFoldersMeta();
    if (state.folderFilter === folderId) state.folderFilter = 'all';
    if (state.activeProjectId === folderId) state.activeProjectId = null;
    syncFolderFilterButtons();
    populateFolderSelect();
    renderFoldersManageList();
    refreshCurrentView();
    toast('Projet supprimé — les clés sont passées en « Sans projet »', 'info');
  } finally {
    hideLoading();
  }
}

function deleteFolder(folderId) {
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;
  showDeleteConfirm(
    { title: folder.name },
    async () => {
      try {
        await performDeleteFolder(folderId);
      } catch (err) {
        toast(err.message || 'Suppression impossible', 'error');
      }
    },
    {
      title: 'Supprimer le projet',
      message: 'Cette action est irréversible. Les clés de ce projet passeront en « Sans projet ».',
      placeholder: 'Nom du projet',
    },
  );
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
  projects: { title: 'Projets', subtitle: 'Organisez vos clés par dossier' },
  'project-detail': { title: 'Projet', subtitle: 'Clés de ce projet' },
  'shares-received': { title: 'Partage · Reçu', subtitle: 'Clés partagées avec vous' },
  'shares-sent': { title: 'Partage · Envoyé', subtitle: 'Clés que vous avez partagées' },
  contacts: { title: 'Contacts', subtitle: 'Destinataires de vos partages' },
  profile: { title: 'Mon profil', subtitle: 'Informations de votre compte' },
};

function updatePageTitle() {
  if (state.page === 'project-detail') {
    const folder = state.folders.find((f) => f.id === state.activeProjectId);
    $('#page-title').textContent = folder?.name || 'Projet';
    const n = folder
      ? state.entries.filter((e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folder.id).length
      : 0;
    $('#page-subtitle').textContent = n <= 1 ? `${n} clé dans ce projet` : `${n} clés dans ce projet`;
    $('#topbar-total').classList.add('hidden');
    $('#fab-add').classList.remove('hidden');
    return;
  }
  const page = PAGE_TITLES[state.page] || PAGE_TITLES.dashboard;
  $('#page-title').textContent = page.title;
  $('#page-subtitle').textContent = page.subtitle;
  const onProfile = state.page === 'profile';
  const onShares = state.page === 'shares-received' || state.page === 'shares-sent' || state.page === 'contacts';
  const onProjects = state.page === 'projects';
  $('#topbar-total').classList.toggle('hidden', onProfile || onShares);
  $('#fab-add').classList.toggle('hidden', onProfile || onShares || onProjects);
}

function switchPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  if (page !== 'profile') closeAllProfileFieldEdits();
  if (page !== 'project-detail') {
    state.activeProjectId = null;
    state.projectDetailSelectedIds = [];
  }
  if (page !== 'contacts') state.contactsSelectedEmail = null;
  state.page = page;
  $$('.nav-item').forEach((b) => {
    const active = b.dataset.page === page
      || (page === 'project-detail' && b.dataset.page === 'projects');
    b.classList.toggle('active', active);
  });
  $('#dashboard-view').classList.toggle('hidden', page !== 'dashboard');
  $('#vault-view').classList.toggle('hidden', page !== 'vault');
  $('#projects-view')?.classList.toggle('hidden', page !== 'projects');
  $('#project-detail-view')?.classList.toggle('hidden', page !== 'project-detail');
  $('#shares-received-view')?.classList.toggle('hidden', page !== 'shares-received');
  $('#shares-sent-view')?.classList.toggle('hidden', page !== 'shares-sent');
  $('#contacts-view')?.classList.toggle('hidden', page !== 'contacts');
  $('#profile-view').classList.toggle('hidden', page !== 'profile');
  updatePageTitle();
  updateEntryCounts();
  $('.vault-main')?.scrollTo(0, 0);
  try {
    if (page === 'dashboard') renderDashboard();
    else if (page === 'vault') renderEntries();
    else if (page === 'projects') renderProjectsPage();
    else if (page === 'project-detail') renderProjectDetailPage();
    else if (page === 'shares-received') renderSharesReceived();
    else if (page === 'shares-sent') renderSharesSent();
    else if (page === 'contacts') renderContactsPage();
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
    syncFolderFilterButtons();
    populateFolderSelect();
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
    state.folders = [];
    state.foldersMetaEntryId = null;
    syncFolderFilterButtons();
    populateFolderSelect();
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
  const all = decrypted.filter(Boolean);
  const meta = all.find((e) => isFoldersMetaEntry(e));
  state.foldersMetaEntryId = meta?.id || null;
  state.folders = meta ? foldersFromMetaEntry(meta) : [];
  state.entries = all.filter((e) => !isVaultMetaEntry(e));
  if (state.folderFilter !== 'all' && state.folderFilter !== 'none'
      && !state.folders.some((f) => f.id === state.folderFilter)) {
    state.folderFilter = 'all';
  }
  syncFolderFilterButtons();
  populateFolderSelect();
}

function getFilteredEntries() {
  return filterEntriesByQuery(state.entries, state.search);
}

function refreshCurrentView() {
  if (state.page === 'dashboard') renderDashboard();
  else if (state.page === 'vault') renderEntries();
  else if (state.page === 'projects') renderProjectsPage();
  else if (state.page === 'project-detail') renderProjectDetailPage();
  else if (state.page === 'shares-received') renderSharesReceived();
  else if (state.page === 'shares-sent') renderSharesSent();
  else if (state.page === 'contacts') renderContactsPage();
  else if (state.page === 'profile') renderProfile();
}

function updateEntryCounts() {
  $('#entry-count').textContent = state.entries.length;
  $('#nav-count-all').textContent = state.entries.length;
  const projectsCount = $('#nav-count-projects');
  if (projectsCount) projectsCount.textContent = state.folders.length;
  const recv = $('#nav-count-received');
  const sent = $('#nav-count-sent');
  const contacts = $('#nav-count-contacts');
  if (recv) recv.textContent = state.sharesReceived.length;
  if (sent) sent.textContent = state.sharesSent.length;
  if (contacts) contacts.textContent = getShareContacts().length;
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

  syncContactsFromShares();

  updateEntryCounts();
  if (state.page === 'shares-received' || state.page === 'shares-sent' || state.page === 'contacts') {
    refreshCurrentView();
  }
}

function renderSharesReceived() {
  const list = $('#shares-received-list');
  const empty = $('#shares-received-empty');
  if (!list || !empty) return;
  updateEntryCounts();
  if (state.sharesReceived.length === 0) {
    list.replaceChildren();
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  setHtml(list, state.sharesReceived.map((e, i) => `
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
    </div>`).join(''));
  refreshIcons(list);
  setupFaviconImages(list);
}

function renderSharesSent() {
  const list = $('#shares-sent-list');
  const empty = $('#shares-sent-empty');
  if (!list || !empty) return;
  updateEntryCounts();
  if (state.sharesSent.length === 0) {
    list.replaceChildren();
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  setHtml(list, state.sharesSent.map((e, i) => `
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
    </div>`).join(''));
  refreshIcons(list);
  setupFaviconImages(list);
}

function contactsStorageKey() {
  const uid = state.user?.id || state.user?.email || 'anon';
  return `clefkey_share_contacts_${uid}`;
}

function loadStoredContacts() {
  try {
    const raw = localStorage.getItem(contactsStorageKey());
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((c) => c && typeof c.email === 'string' && c.email.includes('@'))
      .map((c) => ({
        email: String(c.email).trim().toLowerCase(),
        display_name: String(c.display_name || '').trim(),
        last_shared_at: c.last_shared_at || null,
      }));
  } catch {
    return [];
  }
}

function saveStoredContacts(list) {
  try {
    localStorage.setItem(contactsStorageKey(), JSON.stringify(list.slice(0, 100)));
  } catch {
    /* ignore */
  }
}

function rememberShareContact({ email, display_name } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized.includes('@')) return;
  const stored = loadStoredContacts().filter((c) => c.email !== normalized);
  stored.unshift({
    email: normalized,
    display_name: String(display_name || '').trim(),
    last_shared_at: new Date().toISOString(),
  });
  saveStoredContacts(stored);
}

function syncContactsFromShares() {
  const map = new Map(loadStoredContacts().map((c) => [c.email, { ...c }]));
  for (const s of state.sharesSent) {
    const email = String(s.recipient_email || '').trim().toLowerCase();
    if (!email.includes('@')) continue;
    const prev = map.get(email) || { email, display_name: '', last_shared_at: null };
    const dates = [prev.last_shared_at, s.created_at].filter(Boolean).sort();
    map.set(email, {
      email,
      display_name: String(s.recipient_display_name || prev.display_name || '').trim(),
      last_shared_at: dates.length ? dates[dates.length - 1] : null,
    });
  }
  saveStoredContacts(Array.from(map.values()));
}

function removeShareContact(email) {
  const normalized = String(email || '').trim().toLowerCase();
  saveStoredContacts(loadStoredContacts().filter((c) => c.email !== normalized));
  if (state.contactsSelectedEmail === normalized) state.contactsSelectedEmail = null;
  updateEntryCounts();
  if (state.page === 'contacts') renderContactsPage();
}

/** Agrège contacts stockés + destinataires des partages envoyés. */
function getShareContacts() {
  const byEmail = new Map();

  for (const c of loadStoredContacts()) {
    byEmail.set(c.email, {
      email: c.email,
      display_name: c.display_name || '',
      last_shared_at: c.last_shared_at || null,
      share_count: 0,
      shares: [],
    });
  }

  for (const s of state.sharesSent) {
    const email = String(s.recipient_email || '').trim().toLowerCase();
    if (!email) continue;
    const existing = byEmail.get(email) || {
      email,
      display_name: '',
      last_shared_at: null,
      share_count: 0,
      shares: [],
    };
    existing.display_name = s.recipient_display_name || existing.display_name || '';
    existing.shares.push(s);
    existing.share_count = existing.shares.length;
    const created = s.created_at || null;
    if (created && (!existing.last_shared_at || created > existing.last_shared_at)) {
      existing.last_shared_at = created;
    }
    byEmail.set(email, existing);
  }

  return Array.from(byEmail.values()).sort((a, b) => {
    const da = a.last_shared_at || '';
    const db = b.last_shared_at || '';
    return db.localeCompare(da);
  });
}

function formatContactDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

function contactInitials(contact) {
  const name = (contact.display_name || contact.email || '?').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function renderContactsPage() {
  const listPanel = $('#contacts-list-panel');
  const detailPanel = $('#contacts-detail-panel');
  if (!listPanel || !detailPanel) return;
  updateEntryCounts();

  if (state.contactsSelectedEmail) {
    listPanel.classList.add('hidden');
    detailPanel.classList.remove('hidden');
    renderContactDetail(state.contactsSelectedEmail);
    return;
  }

  detailPanel.classList.add('hidden');
  listPanel.classList.remove('hidden');

  const list = $('#contacts-list');
  const empty = $('#contacts-empty');
  if (!list || !empty) return;
  const contacts = getShareContacts();
  if (contacts.length === 0) {
    list.replaceChildren();
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  setHtml(list, contacts.map((c, i) => {
    const label = c.display_name || c.email;
    const meta = c.share_count > 0
      ? `${c.share_count} clé${c.share_count > 1 ? 's' : ''} partagée${c.share_count > 1 ? 's' : ''}`
      : 'Aucun partage actif';
    const when = formatContactDate(c.last_shared_at);
    const [c1, c2] = getAvatarColor(label);
    return `
      <button type="button" class="contact-card" data-action="show-contact" data-email="${esc(c.email)}" style="animation-delay:${i * 0.04}s">
        <div class="contact-avatar" aria-hidden="true" style="background:linear-gradient(135deg,${c1},${c2})">${esc(contactInitials(c))}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(label)}</div>
          <div class="contact-email">${esc(c.email)}</div>
          <div class="contact-meta">${esc(meta)}</div>
          ${when ? `<div class="contact-date">${esc(when)}</div>` : ''}
        </div>
        <span class="contact-open">Voir</span>
      </button>`;
  }).join(''));
  refreshIcons(list);
}

function renderContactDetail(email) {
  const contact = getShareContacts().find((c) => c.email === email);
  if (!contact) {
    state.contactsSelectedEmail = null;
    renderContactsPage();
    return;
  }

  const name = contact.display_name || contact.email;
  const when = formatContactDate(contact.last_shared_at);
  const count = contact.share_count || 0;

  $('#contacts-detail-name').textContent = name;
  $('#contacts-detail-email').textContent = contact.email;
  if ($('#contacts-detail-share-count')) {
    $('#contacts-detail-share-count').textContent = String(count);
  }
  if ($('#contacts-detail-share-label')) {
    $('#contacts-detail-share-label').textContent = count <= 1 ? 'active' : 'actives';
  }
  if ($('#contacts-detail-last-share')) {
    $('#contacts-detail-last-share').textContent = when || '—';
  }
  if ($('#contacts-detail-meta')) {
    $('#contacts-detail-meta').textContent = when
      ? `Dernier envoi le ${when}`
      : 'Aucun historique récent';
  }
  setAvatar($('#contacts-detail-avatar'), name);

  const sharesList = $('#contacts-detail-shares');
  const sharesEmpty = $('#contacts-detail-shares-empty');
  if (sharesList && sharesEmpty) {
    if (!contact.shares.length) {
      sharesList.replaceChildren();
      sharesEmpty.classList.remove('hidden');
    } else {
      sharesEmpty.classList.add('hidden');
      setHtml(sharesList, contact.shares.map((e, i) => `
        <div class="entry-card" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-share-sent">
          ${entryAvatarMarkup(e)}
          <div class="entry-info">
            <div class="entry-title">${esc(e.title)}</div>
            <div class="entry-username">${esc(e.username || e.recipient_email || '')}</div>
          </div>
          <div class="entry-actions">
            <button type="button" class="btn-icon btn-danger" title="Révoquer" data-action="delete-share" data-id="${esc(e.id)}">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>`).join(''));
      refreshIcons(sharesList);
      setupFaviconImages(sharesList);
    }
  }
  refreshIcons($('#contacts-detail-panel'));
}

function renderShareContactChips() {
  const wrap = $('#share-contacts');
  const chips = $('#share-contacts-chips');
  if (!wrap || !chips) return;
  const contacts = getShareContacts().slice(0, 8);
  if (!contacts.length) {
    wrap.classList.add('hidden');
    chips.replaceChildren();
    return;
  }
  wrap.classList.remove('hidden');
  setHtml(chips, contacts.map((c) => {
    const label = c.display_name || c.email;
    return `<button type="button" class="share-contact-chip" data-action="pick-share-contact" data-email="${esc(c.email)}" title="${esc(c.email)}">${esc(label)}</button>`;
  }).join(''));
}

function openShareModal(entryId, { email = '' } = {}) {
  const entry = state.entries.find((x) => x.id === entryId);
  if (!entry) return;
  if (state.devMode) {
    toast('Le partage n’est pas disponible en mode développement', 'info');
    return;
  }
  state.shareEntryId = entryId;
  const prefill = String(email || state.sharePrefillEmail || '').trim().toLowerCase();
  state.sharePrefillEmail = null;
  $('#share-entry-title').textContent = `Partager « ${entry.title} »`;
  $('#share-email').value = prefill;
  if ($('#share-note')) $('#share-note').value = '';
  renderShareContactChips();
  openModal($('#modal-share'));
  refreshIcons($('#modal-share'));
  setTimeout(() => {
    if (prefill) $('#share-note')?.focus();
    else $('#share-email')?.focus();
  }, 50);
}

function openSharePickEntryModal(email) {
  if (state.devMode) {
    toast('Le partage n’est pas disponible en mode développement', 'info');
    return;
  }
  state.sharePrefillEmail = String(email || '').trim().toLowerCase();
  state.sharePickSearch = '';
  if ($('#share-pick-search')) $('#share-pick-search').value = '';
  const contact = getShareContacts().find((c) => c.email === state.sharePrefillEmail);
  const label = contact?.display_name || state.sharePrefillEmail;
  if ($('#share-pick-hint')) {
    $('#share-pick-hint').textContent = `Choisissez la clé à partager avec ${label}.`;
  }
  renderSharePickEntryList();
  openModal($('#modal-share-pick-entry'));
  refreshIcons($('#modal-share-pick-entry'));
  setTimeout(() => $('#share-pick-search')?.focus(), 50);
}

function renderSharePickEntryList() {
  const list = $('#share-pick-entry-list');
  const empty = $('#share-pick-empty');
  if (!list || !empty) return;
  const entries = filterEntriesByQuery(state.entries, state.sharePickSearch)
    .filter((e) => !e.isShare && !isVaultMetaEntry(e));
  if (!entries.length) {
    list.replaceChildren();
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  setHtml(list, entries.slice(0, 40).map((e) => `
    <button type="button" class="share-pick-item" data-action="pick-share-entry" data-id="${esc(e.id)}">
      ${entryAvatarMarkup(e)}
      <div class="entry-info">
        <div class="entry-title">${esc(e.title)}</div>
        <div class="entry-username">${esc(e.username || e.url || '')}</div>
      </div>
    </button>`).join(''));
  refreshIcons(list);
  setupFaviconImages(list);
}

window.showShareReceived = function(id) {
  const e = state.sharesReceived.find((x) => x.id === id);
  if (!e) return;
  state.detailEntryId = null;
  fillEntryDetailCommon(e);
  syncDetailProjectField(e, { editable: false });
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
  if (state.dashTab === 'popular') {
    // Sites avec URL / favicon d’abord, puis récents
    return [...list].sort((a, b) => {
      const score = (e) => (getSiteDomain(e.url) ? 2 : 0) + (entryType(e) === 'login' ? 1 : 0);
      const diff = score(b) - score(a);
      if (diff) return diff;
      return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
    });
  }
  return [...list].sort(
    (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
  );
}

function dashTileMetaMarkup(entry) {
  const badges = [];
  if (entryType(entry) === 'api_key') badges.push('<span class="dash-tile-badge">API</span>');
  if (entryType(entry) === 'ssh_key') badges.push('<span class="dash-tile-badge dash-tile-badge-ssh">SSH</span>');
  const folder = folderNameById(state.folders, entryFolderId(entry));
  const project = folder
    ? `<span class="dash-tile-meta"><span class="dash-tile-project">${esc(folder)}</span></span>`
    : '';
  // Badges en absolute (coin) — le bandeau meta ne porte que le projet
  return `${badges.join('')}${project}`;
}

function renderDashboard() {
  updateEntryCounts();
  syncTypeFilterButtons();
  syncFolderFilterButtons();
  syncAddEntryButtonLabels();
  syncTransferEntryButtons();
  const entries = getDashboardEntries();
  const grid = $('#dash-tiles-grid');
  const empty = $('#dash-tiles-empty');

  $$('.dash-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.dashTab === state.dashTab);
  });

  if (entries.length === 0 && state.entries.length === 0) {
    setHtml(grid, `
      <button type="button" class="dash-tile dash-tile-add dash-tile-add-hero" id="dash-tile-add-only">
        <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
        <span class="dash-tile-name">${esc(addEntryTileLabel())}</span>
        <span class="dash-tile-add-hint">Connexion, API ou SSH</span>
      </button>`);
    empty.classList.add('hidden');
    $('#dash-tile-add-only')?.addEventListener('click', openAddModal);
    refreshIcons(grid);
    return;
  }

  if (entries.length === 0) {
    grid.replaceChildren();
    empty.classList.remove('hidden');
    const title = $('#dash-empty-title');
    const text = $('#dash-empty-text');
    if (state.dashSearch.trim()) {
      if (title) title.textContent = 'Aucun résultat';
      if (text) text.textContent = 'Essayez un autre terme, ou élargissez type / projet.';
    } else if (state.typeFilter !== 'all' || state.folderFilter !== 'all') {
      if (title) title.textContent = 'Aucune clé ici';
      if (text) text.textContent = 'Rien ne correspond à ces filtres. Changez de type ou de projet.';
    } else {
      if (title) title.textContent = 'Aucune clé';
      if (text) text.textContent = 'Ajoutez votre première clé pour commencer.';
    }
    syncAddEntryButtonLabels();
    refreshIcons(empty);
    return;
  }

  empty.classList.add('hidden');
  syncAddEntryButtonLabels();
  setHtml(grid, entries.map((e, i) => `
      <button type="button" class="${dashTileClassName(e)}" style="${dashTileStyle(e, i)}" data-action="show-entry" data-id="${esc(e.id)}" title="${esc(e.title)}">
        ${dashTileIconMarkup(e)}
        <span class="dash-tile-name">${esc(e.title)}</span>
        ${dashTileMetaMarkup(e)}
      </button>`).join('') + `
    <button type="button" class="dash-tile dash-tile-add" data-action="add-entry">
      <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
      <span class="dash-tile-name">${esc(addEntryTileLabel())}</span>
    </button>`);

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
  syncFolderFilterButtons();
  syncAddEntryButtonLabels();
  syncTransferEntryButtons();

  empty.classList.add('hidden');
  noResults.classList.add('hidden');

  if (state.entries.length === 0) {
    container.replaceChildren();
    empty.classList.remove('hidden');
    return;
  }

  if (list.length === 0) {
    container.replaceChildren();
    noResults.classList.remove('hidden');
    return;
  }

  setHtml(container, list.map((e, i) => `
    <div class="entry-card" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-entry">
      ${entryAvatarMarkup(e)}
      <div class="entry-info">
        <div class="entry-title-row">
          <div class="entry-title">${esc(e.title)}</div>
          ${entryTypeBadgeMarkup(e)}
          ${folderNameById(state.folders, entryFolderId(e))
            ? `<span class="entry-folder-badge">${esc(folderNameById(state.folders, entryFolderId(e)))}</span>`
            : ''}
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
    </div>`).join(''));
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

  const root = target.closest('#dash-tiles-grid, #entries-list, #project-detail-list, #shares-received-list, #shares-sent-list, #contacts-list, #contacts-detail-shares, #share-pick-entry-list, #share-contacts-chips');
  if (!root) return;

  if (target.closest('.entry-card-select')) return;

  const actionEl = target.closest('[data-action]');
  if (!actionEl || !root.contains(actionEl)) return;

  const action = actionEl.dataset.action;
  const id = actionEl.dataset.id
    || actionEl.closest('[data-id]')?.dataset.id;
  const email = actionEl.dataset.email;

  if (action === 'show-entry' && id) {
    window.showEntry(id);
    return;
  }
  if (action === 'show-contact' && email) {
    state.contactsSelectedEmail = email;
    renderContactsPage();
    return;
  }
  if (action === 'pick-share-contact' && email) {
    event.preventDefault();
    if ($('#share-email')) $('#share-email').value = email;
    $('#share-note')?.focus();
    return;
  }
  if (action === 'pick-share-entry' && id) {
    event.preventDefault();
    closeModal($('#modal-share-pick-entry'));
    openShareModal(id, { email: state.sharePrefillEmail || '' });
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
  syncDetailProjectField(e, { editable: true });
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

$('#btn-contacts-back')?.addEventListener('click', () => {
  state.contactsSelectedEmail = null;
  renderContactsPage();
});

$('#btn-contact-share')?.addEventListener('click', () => {
  if (!state.contactsSelectedEmail) return;
  openSharePickEntryModal(state.contactsSelectedEmail);
});

$('#btn-contact-remove')?.addEventListener('click', () => {
  if (!state.contactsSelectedEmail) return;
  const email = state.contactsSelectedEmail;
  const contact = getShareContacts().find((c) => c.email === email);
  const label = contact?.display_name || email;
  if (contact?.share_count > 0) {
    toast('Révoquez d’abord les partages actifs avec ce contact', 'error');
    return;
  }
  showDeleteConfirm(
    { title: label },
    () => {
      removeShareContact(email);
      toast('Contact retiré de la liste', 'info');
    },
    {
      title: 'Retirer le contact',
      message: 'Ce contact sera retiré de votre liste. Vous pourrez le retrouver en partageant à nouveau.',
    },
  );
});

$('#btn-close-share-pick')?.addEventListener('click', () => {
  closeModal($('#modal-share-pick-entry'));
  state.sharePrefillEmail = null;
});

$('#share-pick-search')?.addEventListener('input', (e) => {
  state.sharePickSearch = e.target.value || '';
  renderSharePickEntryList();
});

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
      type: entryType(entry),
      // Pas de folderId : les partages restent hors projets
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
    rememberShareContact({
      email: recipient.email,
      display_name: recipient.display_name,
    });
    await loadShares();
    closeModal($('#modal-share'));
    toast(`Partagé avec ${recipient.display_name || recipient.email}`, 'success');
    if (state.page === 'contacts') renderContactsPage();
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

function openAddModal(options = {}) {
  resetEntryFormModal();
  $('#form-entry').reset();
  if ($('#entry-secret-block')) $('#entry-secret-block').value = '';
  const type = defaultEntryTypeFromFilter();
  setEntryFormType(type);
  const folderId = options.folderId !== undefined
    ? options.folderId
    : defaultFolderIdFromFilter();
  populateFolderSelect(folderId || '');
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
  hideEntryFolderCreate();
  $('#form-entry').reset();
  const type = entryType(e);
  setEntryFormType(type);
  populateFolderSelect(entryFolderId(e) || '');
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
  setHtml($('#btn-save-entry'), '<i data-lucide="check-circle"></i> Mettre à jour');
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
  const folderId = ($('#entry-folder')?.value || '').trim();

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

  return entryEncryptedPayload({ type, title, username, password, url, notes, folderId });
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
      || 'clefkey';
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

document.querySelector('.entry-type-pills')?.addEventListener('click', (e) => {
  const pill = e.target.closest('.entry-type-pill[data-entry-type]');
  if (!pill) return;
  setEntryFormType(pill.dataset.entryType);
});

$$('.type-filter').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.typeFilter = btn.dataset.typeFilter || 'all';
    syncTypeFilterButtons();
    syncAddEntryButtonLabels();
    refreshCurrentView();
  });
});

document.addEventListener('click', (e) => {
  const folderBtn = e.target.closest('.folder-filter[data-folder-filter]');
  if (!folderBtn || folderBtn.classList.contains('folder-filter-manage')) return;
  if (!folderBtn.closest('.folder-filters')) return;
  state.folderFilter = folderBtn.dataset.folderFilter || 'all';
  syncFolderFilterButtons();
  refreshCurrentView();
});

$('#btn-dash-create-project')?.addEventListener('click', openProjectsPage);
$('#btn-close-folders')?.addEventListener('click', () => closeModal($('#modal-folders')));

$('#form-project-page-create')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-project-page-create');
  if (btn) btn.disabled = true;
  try {
    const folder = await createFolderByName($('#project-page-new-name')?.value);
    if (folder && $('#project-page-new-name')) $('#project-page-new-name').value = '';
  } catch (err) {
    toast(err.message || 'Impossible de créer le projet', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#btn-project-detail-back')?.addEventListener('click', () => switchPage('projects'));
$('#btn-project-detail-add')?.addEventListener('click', () => {
  openAddModal({ folderId: state.activeProjectId || '' });
});
$('#btn-project-detail-add-empty')?.addEventListener('click', () => {
  openAddModal({ folderId: state.activeProjectId || '' });
});

// Délégation : résiste au re-render / cache SW partiel
document.addEventListener('click', (e) => {
  const btn = e.target.closest('#btn-project-detail-transfer, #btn-project-detail-move');
  if (!btn || btn.disabled) return;
  e.preventDefault();
  openProjectDetailTransfer();
});

$('#btn-project-detail-select-clear')?.addEventListener('click', clearProjectDetailSelection);
$('#project-detail-select-all')?.addEventListener('change', (e) => {
  const checked = !!e.target.checked;
  const ids = getProjectDetailEntries().map((entry) => entry.id);
  state.projectDetailSelectedIds = checked ? ids : [];
  syncProjectDetailSelectionUi();
});

$('#project-detail-list')?.addEventListener('change', (e) => {
  const box = e.target.closest('input[data-action="toggle-select"]');
  if (!box) return;
  toggleProjectDetailSelection(box.dataset.id, box.checked);
});

$('#project-detail-search-input')?.addEventListener('input', (e) => {
  state.projectDetailSearch = e.target.value;
  $('#btn-clear-project-detail-search')?.classList.toggle('hidden', !e.target.value);
  if (state.page === 'project-detail') renderProjectDetailPage();
});

$('#btn-clear-project-detail-search')?.addEventListener('click', () => {
  state.projectDetailSearch = '';
  const input = $('#project-detail-search-input');
  if (input) input.value = '';
  $('#btn-clear-project-detail-search')?.classList.add('hidden');
  if (state.page === 'project-detail') renderProjectDetailPage();
});

$('#projects-grid')?.addEventListener('click', async (e) => {
  const card = e.target.closest('.project-row[data-folder-id], .project-card[data-folder-id]');
  if (!card) return;
  const folderId = card.dataset.folderId;
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  const action = e.target.closest('[data-action]')?.dataset.action;
  if (!action || action === 'open-project') {
    openProjectPage(folderId);
    return;
  }

  if (action === 'delete-project') {
    deleteFolder(folderId);
    return;
  }

  if (action === 'rename-project') {
    const name = normalizeFolderName(
      window.prompt('Nouveau nom du projet', folder.name) || '',
    );
    if (!name) return;
    if (state.folders.some((f) => f.id !== folderId && f.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce projet existe déjà', 'error');
      return;
    }
    try {
      state.folders = normalizeFoldersList(
        state.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
      );
      await persistFoldersMeta();
      syncFolderFilterButtons();
      populateFolderSelect();
      renderFoldersManageList();
      refreshCurrentView();
      toast('Projet renommé', 'success');
    } catch (err) {
      toast(err.message || 'Renommage impossible', 'error');
    }
  }
});

$('#btn-folders-transfer')?.addEventListener('click', () => openTransferModal());
$('#btn-close-transfer')?.addEventListener('click', () => closeModal($('#modal-transfer')));

$('#transfer-select-all')?.addEventListener('change', (e) => {
  const checked = !!e.target.checked;
  $$('#transfer-entry-list input[type="checkbox"]').forEach((box) => {
    box.checked = checked;
  });
  updateTransferSelectionUi();
});

$('#transfer-entry-list')?.addEventListener('change', (e) => {
  if (e.target.matches('input[type="checkbox"]')) updateTransferSelectionUi();
});

$('#transfer-folder')?.addEventListener('change', updateTransferSelectionUi);

$('#btn-transfer-submit')?.addEventListener('click', async () => {
  const ids = $$('#transfer-entry-list input[type="checkbox"]:checked').map((b) => b.value);
  const rawDest = ($('#transfer-folder')?.value || '').trim();
  const folderId = rawDest === '__unassign__' ? '' : rawDest;
  const btn = $('#btn-transfer-submit');
  if (!ids.length) {
    toast('Sélectionnez au moins une clé', 'error');
    return;
  }
  if (!rawDest) {
    toast('Choisissez une destination', 'error');
    return;
  }
  if (btn) btn.disabled = true;
  try {
    showLoading(folderId ? 'Transfert vers le projet...' : 'Retrait du projet...');
    const count = await assignEntriesToFolder(ids, folderId);
    const name = folderId ? (folderNameById(state.folders, folderId) || 'projet') : null;
    closeModal($('#modal-transfer'));
    state.projectDetailSelectedIds = state.projectDetailSelectedIds.filter((id) => !ids.includes(id));
    syncTransferEntryButtons();
    refreshCurrentView();
    toast(
      name
        ? (count <= 1
          ? `1 clé déplacée vers « ${name} »`
          : `${count} clés déplacées vers « ${name} »`)
        : (count <= 1
          ? '1 clé retirée du projet'
          : `${count} clés retirées du projet`),
      'success',
    );
  } catch (err) {
    toast(err.message || 'Transfert impossible', 'error');
  } finally {
    hideLoading();
    if (btn) btn.disabled = false;
    updateTransferSelectionUi();
  }
});

$('#detail-move-folder')?.addEventListener('change', syncDetailMoveButton);

$('#btn-detail-move-folder')?.addEventListener('click', async () => {
  const entryId = state.detailEntryId;
  if (!entryId) return;
  const folderId = ($('#detail-move-folder')?.value || '').trim();
  const btn = $('#btn-detail-move-folder');
  if (btn) btn.disabled = true;
  try {
    showLoading('Mise à jour du projet...');
    await setEntryFolder(entryId, folderId);
    refreshCurrentView();
    const entry = state.entries.find((e) => e.id === entryId);
    if (entry) {
      fillEntryDetailCommon(entry);
      syncDetailProjectField(entry, { editable: true });
    }
    const name = folderNameById(state.folders, folderId);
    toast(name ? `Clé déplacée vers « ${name} »` : 'Clé retirée du projet', 'success');
    syncTransferEntryButtons();
  } catch (err) {
    toast(err.message || 'Déplacement impossible', 'error');
  } finally {
    hideLoading();
    syncDetailMoveButton();
  }
});

$('#btn-entry-folder-toggle')?.addEventListener('click', () => {
  const panel = $('#entry-folder-create');
  if (panel?.classList.contains('hidden')) showEntryFolderCreate();
  else hideEntryFolderCreate();
});

$('#btn-entry-folder-cancel')?.addEventListener('click', hideEntryFolderCreate);

$('#btn-entry-folder-create')?.addEventListener('click', async () => {
  const btn = $('#btn-entry-folder-create');
  if (btn) btn.disabled = true;
  try {
    const folder = await createFolderByName($('#entry-folder-new-name')?.value, {
      selectInEntryForm: true,
    });
    if (folder) hideEntryFolderCreate();
  } catch (err) {
    toast(err.message || 'Impossible de créer le projet', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#entry-folder-new-name')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#btn-entry-folder-create')?.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    hideEntryFolderCreate();
  }
});

$('#form-folder-create')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#btn-folder-create');
  if (btn) btn.disabled = true;
  try {
    const folder = await createFolderByName($('#folder-new-name')?.value);
    if (folder && $('#folder-new-name')) $('#folder-new-name').value = '';
  } catch (err) {
    toast(err.message || 'Impossible de créer le projet', 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
});

$('#folders-manage-list')?.addEventListener('click', async (e) => {
  const row = e.target.closest('.folders-manage-item');
  if (!row) return;
  const folderId = row.dataset.folderId;
  const folder = state.folders.find((f) => f.id === folderId);
  if (!folder) return;

  if (e.target.closest('.folder-delete-btn')) {
    deleteFolder(folderId);
    return;
  }

  if (e.target.closest('.folder-rename-save')) {
    const input = row.querySelector('.folder-rename-input');
    const name = normalizeFolderName(input?.value);
    if (!name) {
      toast('Nom du projet requis', 'error');
      return;
    }
    if (state.folders.some((f) => f.id !== folderId && f.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce projet existe déjà', 'error');
      return;
    }
    try {
      state.folders = normalizeFoldersList(
        state.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
      );
      await persistFoldersMeta();
      syncFolderFilterButtons();
      populateFolderSelect();
      renderFoldersManageList();
      refreshCurrentView();
      toast('Projet renommé', 'success');
    } catch (err) {
      toast(err.message || 'Renommage impossible', 'error');
    }
  }
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
initTheme();
initIcons();
initProfileFieldEdits();
refreshIcons($('#screen-landing'));
showCompatBannerIfNeeded();
restoreSessionIfAny();
