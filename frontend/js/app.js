/**
 * Application principale — Gestion’air
 *
 * Écrans : auth → dashboard / liste / profil
 * Mode dev : localhost + champs vides → données mock en mémoire
 * Mode réel : JWT + chiffrement WebCrypto, sync via api.js
 */

import {
  toB64, fromB64, prepareRegistration, unlockSession, prepareLogin,
  encryptData, decryptData, generatePassword,
} from './crypto.js';
import { api } from './api.js';
import { initIcons, refreshIcons, setLucideIcon } from './icons.js';
import {
  enterDevMode, shouldUseDevBypass, createDevEntry, deleteDevEntry,
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

const state = {
  token: null,
  user: null,
  vaultKey: null,
  privateKey: null,
  publicKey: null,
  entries: [],
  devMode: false,
  page: 'dashboard',
  search: '',
  dashTab: 'popular',
  dashSearch: '',
  confirmCallback: null,
  confirmDeleteName: null,
  detailEntryId: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const EMPTY_VALUE = '…';

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

const screens = { landing: $('#screen-landing'), auth: $('#screen-auth'), vault: $('#screen-vault') };

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function openAuthTab(tab = 'login') {
  $('#tab-login').classList.toggle('active', tab === 'login');
  $('#tab-register').classList.toggle('active', tab === 'register');
  $('#form-login').classList.toggle('hidden', tab !== 'login');
  $('#form-register').classList.toggle('hidden', tab !== 'register');
  if (tab === 'register') prefetchCommonPasswords();
  showScreen('auth');
  refreshIcons($('#screen-auth'));
}

function bindLandingNavigation() {
  const goRegister = () => openAuthTab('register');
  const goLogin = () => openAuthTab('login');

  $('#btn-landing-start')?.addEventListener('click', goRegister);
  $('#btn-landing-login')?.addEventListener('click', goLogin);
  $('#btn-back-landing')?.addEventListener('click', () => {
    showScreen('landing');
    refreshIcons($('#screen-landing'));
  });
  $('#tab-login')?.addEventListener('click', () => openAuthTab('login'));
  $('#tab-register')?.addEventListener('click', () => openAuthTab('register'));
}

// Navigation landing tout de suite (avant les imports lourds / listeners coffre).
bindLandingNavigation();
showScreen('landing');


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

function filterEntriesByQuery(list, query) {
  if (!query) return list;
  const q = query.toLowerCase();
  return list.filter(e =>
    e.title.toLowerCase().includes(q) ||
    e.username.toLowerCase().includes(q) ||
    (e.url && e.url.toLowerCase().includes(q))
  );
}

function entryLetter(entry) {
  return esc((entry.title?.[0] || '?').toUpperCase());
}

function dashTileIconMarkup(entry) {
  const letter = entryLetter(entry);
  const siteUrl = normalizeEntryUrl(entry.url);
  const faviconUrl = getFaviconUrl(siteUrl);
  if (!faviconUrl) return `<span class="dash-tile-letter">${letter}</span>`;

  return `
    <span class="dash-tile-logo">
      <img
        class="dash-tile-favicon"
        src="${esc(faviconUrl)}"
        alt=""
        decoding="async"
        data-site-url="${esc(siteUrl)}"
        onerror="window.onFaviconError(this)"
      >
      <span class="dash-tile-letter dash-tile-letter-fallback">${letter}</span>
    </span>`;
}

function dashTileClassName(entry) {
  return getSiteDomain(entry.url) ? 'dash-tile dash-tile-branded' : 'dash-tile';
}

function dashTileStyle(entry, index) {
  const delay = `animation-delay:${index * 0.03}s`;
  if (getSiteDomain(entry.url)) return delay;
  const [c1, c2] = getAvatarColor(entry.title);
  return `background:linear-gradient(160deg,${c1},${c2});${delay}`;
}

function entryAvatarMarkup(entry) {
  const letter = entryLetter(entry);
  const [c1, c2] = getAvatarColor(entry.title);
  const siteUrl = normalizeEntryUrl(entry.url);
  const faviconUrl = getFaviconUrl(siteUrl);
  if (!faviconUrl) {
    return `<div class="entry-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${letter}</div>`;
  }
  return `
    <div class="entry-avatar entry-icon entry-icon-branded">
      <img class="entry-favicon" src="${esc(faviconUrl)}" alt="" width="24" height="24" decoding="async" data-site-url="${esc(siteUrl)}" onerror="window.onFaviconError(this)">
      <span class="entry-letter">${letter}</span>
    </div>`;
}

function setEntryAvatar(el, entry) {
  const letter = entryLetter(entry);
  const [c1, c2] = getAvatarColor(entry.title);
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

function closeAllModals() {
  $$('.modal.open').forEach(m => m.classList.remove('open'));
  syncBodyModalLock();
  resetDeleteConfirm();
  state.detailEntryId = null;
}

function resetDeleteConfirm() {
  $('#confirm-name-input').value = '';
  $('#btn-confirm-ok').disabled = true;
  state.confirmDeleteName = null;
  state.confirmCallback = null;
}

function showDeleteConfirm(entry, onConfirm) {
  $('#confirm-title').textContent = 'Supprimer l\'entrée';
  $('#confirm-message').textContent =
    'Cette action est irréversible. Toutes les informations de cette entrée seront définitivement supprimées.';
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

async function copyText(text, btn) {
  await navigator.clipboard.writeText(text);
  if (btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  }
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
  vault: { title: 'Tous les mots de passe', subtitle: 'Votre coffre complet' },
  profile: { title: 'Mon profil', subtitle: 'Informations de votre compte' },
};

function updatePageTitle() {
  const page = PAGE_TITLES[state.page] || PAGE_TITLES.dashboard;
  $('#page-title').textContent = page.title;
  $('#page-subtitle').textContent = page.subtitle;
  const onProfile = state.page === 'profile';
  $('#topbar-total').classList.toggle('hidden', onProfile);
  $('#fab-add').classList.toggle('hidden', onProfile);
}

function switchPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  if (page !== 'profile') closeAllProfileFieldEdits();
  state.page = page;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  $('#dashboard-view').classList.toggle('hidden', page !== 'dashboard');
  $('#vault-view').classList.toggle('hidden', page !== 'vault');
  $('#profile-view').classList.toggle('hidden', page !== 'profile');
  updatePageTitle();
  updateEntryCounts();
  $('.vault-main')?.scrollTo(0, 0);
  try {
    if (page === 'dashboard') renderDashboard();
    else if (page === 'vault') renderEntries();
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
    const authVerifier = await prepareLogin(creds.email, creds.master, window.location.origin);
    const data = await api.login(creds.email, authVerifier);
    const keys = await unlockSession(data, creds.master);
    clearAuthSecrets();
    state.devMode = false;
    state.token = data.access_token;
    state.user = userFromProfile(data);
    Object.assign(state, keys);
    try {
      await loadEntries();
    } catch (err) {
      console.warn('Chargement des entrées partiel:', err);
      toast('Connexion réussie, mais certaines entrées n\'ont pas pu être chargées', 'info');
    }
    showVault();
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
    showLoading('Création du coffre chiffré...');
    const prep = await prepareRegistration(master);
    const data = await api.register({
      email: $('#register-email').value.trim(),
      first_name: $('#register-first-name').value.trim(),
      middle_name: $('#register-middle-name').value.trim(),
      last_name: $('#register-last-name').value.trim(),
      salt: toB64(prep.salt),
      auth_verifier: toB64(prep.authVerifier),
      encrypted_vault_key: toB64(prep.encryptedVaultKey),
      public_key: toB64(prep.publicKey),
      encrypted_private_key: toB64(prep.encryptedPrivateKey),
    });
    state.token = data.access_token;
    state.user = userFromProfile(data);
    state.vaultKey = prep.vaultKey;
    state.privateKey = prep.privateKey;
    state.publicKey = prep.publicKey;
    state.entries = [];
    clearAuthSecrets();
    showVault();
    toast('Compte créé avec succès', 'success');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    hideLoading();
    btn.disabled = false;
  }
});

$('#btn-lock').addEventListener('click', lockVault);

function lockVault() {
  Object.assign(state, {
    token: null,
    user: null,
    vaultKey: null,
    privateKey: null,
    publicKey: null,
    entries: [],
    devMode: false,
    page: 'dashboard',
    search: '',
    dashTab: 'popular',
    dashSearch: '',
  });
  closeAllModals();
  clearAuthSecrets();
  clearLoginForm();
  $('#form-register')?.reset();
  collapseSidebar();
  showScreen('landing');
  refreshIcons($('#screen-landing'));
  toast('Coffre verrouillé', 'info');
}

// ── Entrées ──────────────────────────────────────────────

async function loadEntries() {
  if (state.devMode) return;
  const raw = await api.getEntries(state.token);
  state.entries = [];
  for (const e of raw) {
    try {
      const encrypted = fromB64(e.encrypted_data);
      const data = await decryptData(encrypted, state.vaultKey);
      state.entries.push(prepareEntry({ ...data, ...e }));
    } catch (err) {
      console.warn('Entrée ignorée (déchiffrement impossible):', e.id, err);
    }
  }
}

function getFilteredEntries() {
  return filterEntriesByQuery(state.entries, state.search);
}

function refreshCurrentView() {
  if (state.page === 'dashboard') renderDashboard();
  else if (state.page === 'vault') renderEntries();
  else if (state.page === 'profile') renderProfile();
}

function updateEntryCounts() {
  $('#entry-count').textContent = state.entries.length;
  $('#nav-count-all').textContent = state.entries.length;
}

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
        <span class="dash-tile-name">Nouvelle entrée</span>
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
    return;
  }

  empty.classList.add('hidden');
  empty.querySelector('p').textContent = 'Aucun mot de passe pour le moment';
  grid.innerHTML = entries.map((e, i) => `
      <button type="button" class="${dashTileClassName(e)}" style="${dashTileStyle(e, i)}" onclick="window.showEntry('${e.id}')">
        ${dashTileIconMarkup(e)}
        <span class="dash-tile-name">${esc(e.title)}</span>
      </button>`).join('') + `
    <button type="button" class="dash-tile dash-tile-add" onclick="document.getElementById('btn-dash-add').click()">
      <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
      <span class="dash-tile-name">Nouvelle entrée</span>
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
    <div class="entry-card" data-id="${e.id}" style="animation-delay:${i * 0.04}s" onclick="window.showEntry('${e.id}')">
      ${entryAvatarMarkup(e)}
      <div class="entry-info">
        <div class="entry-title">${esc(e.title)}</div>
        <div class="entry-username">${esc(e.username)}</div>
      </div>
      <div class="entry-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" title="Copier" onclick="window.copyPassword('${e.id}')">
          <i data-lucide="copy"></i>
        </button>
        <button class="btn-icon btn-danger" title="Supprimer" onclick="window.deleteEntry('${e.id}')">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>`).join('');
  refreshIcons(container);
  setupFaviconImages(container);
}

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

$('#btn-profile-lock').addEventListener('click', lockVault);

$('#btn-copy-profile-email').addEventListener('click', async () => {
  const email = $('#profile-detail-email').textContent;
  if (!email || email === EMPTY_VALUE) return;
  await copyText(email, $('#btn-copy-profile-email'));
  toast('Email copié', 'success');
});

$('#btn-copy-profile-id').addEventListener('click', async () => {
  const id = $('#profile-detail-id').dataset.full;
  if (!id) return;
  await copyText(id, $('#btn-copy-profile-id'));
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

// ── Détail entrée ────────────────────────────────────────

window.showEntry = function(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;

  state.detailEntryId = id;
  setEntryAvatar($('#detail-avatar'), e);
  $('#detail-title').textContent = e.title;
  $('#detail-username').textContent = e.username;
  $('#detail-password').textContent = '••••••••••••';
  $('#detail-password').dataset.real = e.password;
  $('#detail-password').dataset.visible = 'false';

  const urlField = $('#detail-url-field');
  if (e.url) {
    urlField.classList.remove('hidden');
    const link = $('#detail-url');
    link.href = e.url.startsWith('http') ? e.url : `https://${e.url}`;
    link.textContent = e.url;
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

  openModal($('#modal-detail'));
  refreshIcons($('#modal-detail'));
};

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
  await copyText($('#detail-password').dataset.real, $('#btn-copy-detail'));
  toast('Mot de passe copié', 'success');
});

$$('.btn-copy-field[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const text = document.getElementById(btn.dataset.copy).textContent;
    await copyText(text, btn);
    toast('Copié', 'success');
  });
});

$('#btn-close-detail').addEventListener('click', () => {
  closeModal($('#modal-detail'));
  state.detailEntryId = null;
});

window.copyPassword = function(id) {
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  navigator.clipboard.writeText(e.password);
  toast(`"${e.title}" copié`, 'success');
};

// ── Ajouter entrée ───────────────────────────────────────

function openAddModal() {
  $('#form-entry').reset();
  $('#entry-generated').classList.add('hidden');
  openModal($('#modal-add'));
  refreshIcons($('#modal-add'));
  setTimeout(() => $('#entry-title')?.focus(), 50);
}

function readEntryFormData() {
  const title = $('#entry-title').value.trim();
  const username = $('#entry-username').value.trim();
  const password = $('#entry-password').value;
  const url = normalizeEntryUrl($('#entry-url').value);
  const notes = $('#entry-notes').value.trim();

  if (!title) {
    toast('Le titre est requis', 'error');
    $('#entry-title').focus();
    return null;
  }
  if (!password) {
    toast('Le mot de passe est requis', 'error');
    $('#entry-password').focus();
    return null;
  }

  return { title, username, password, url, notes };
}

$('#btn-add-sidebar').addEventListener('click', () => {
  openAddModal();
  if (window.innerWidth <= 900) collapseSidebar();
});
$('#fab-add').addEventListener('click', openAddModal);
$('#btn-close-add').addEventListener('click', () => closeModal($('#modal-add')));

$('#btn-generate').addEventListener('click', () => {
  const pwd = generatePassword(20);
  $('#entry-password').value = pwd;
  $('#entry-generated').textContent = pwd;
  $('#entry-generated').classList.remove('hidden');
});

$('#form-entry').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = readEntryFormData();
  if (!data) return;

  const btn = $('#btn-save-entry');
  btn.disabled = true;
  try {
    if (state.devMode) {
      createDevEntry(state.entries, data);
      if (data.url) await preloadFavicon(data.url);
      refreshCurrentView();
      closeModal($('#modal-add'));
      toast(`"${data.title}" ajouté`, 'success');
      return;
    }

    const encrypted = await encryptData(data, state.vaultKey);
    await api.createEntry(state.token, toB64(encrypted));
    await loadEntries();
    if (data.url) await preloadFavicon(data.url);
    refreshCurrentView();
    closeModal($('#modal-add'));
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
  if (e.key === 'Escape') closeAllModals();
});

$$('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.closest('.modal'));
  });
});

showScreen('landing');
clearLoginForm();
initIcons();
initProfileFieldEdits();
refreshIcons($('#screen-landing'));
