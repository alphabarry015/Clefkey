/* Application principale */

import {
  toB64, fromB64, prepareRegistration, unlockSession, prepareLogin,
  encryptData, decryptData, generatePassword,
} from './crypto.js';
import { api } from './api.js';
import { initIcons, refreshIcons, setLucideIcon } from './icons.js';
import {
  enterDevMode, shouldUseDevBypass, isDevAction,
} from './dev.js';

const state = {
  token: null,
  user: null,
  vaultKey: null,
  privateKey: null,
  publicKey: null,
  entries: [],
  page: 'dashboard',
  search: '',
  vaultFilter: null,
  confirmCallback: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

const screens = { auth: $('#screen-auth'), vault: $('#screen-vault') };

const AVATAR_COLORS = [
  ['#7c6aef', '#6355d8'], ['#34d399', '#10b981'], ['#60a5fa', '#3b82f6'],
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
}

function showConfirm(title, message, onConfirm) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  state.confirmCallback = onConfirm;
  openModal($('#modal-confirm'));
}

$('#btn-confirm-cancel').addEventListener('click', () => {
  closeModal($('#modal-confirm'));
  state.confirmCallback = null;
});

$('#btn-close-confirm').addEventListener('click', () => {
  closeModal($('#modal-confirm'));
  state.confirmCallback = null;
});

$('#btn-confirm-ok').addEventListener('click', () => {
  closeModal($('#modal-confirm'));
  if (state.confirmCallback) state.confirmCallback();
  state.confirmCallback = null;
});

async function copyText(text, btn) {
  await navigator.clipboard.writeText(text);
  if (btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  }
}

// ── Password strength ────────────────────────────────────

function checkStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  return score;
}

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

function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

const PAGE_TITLES = {
  dashboard: { title: 'Dashboard', subtitle: 'Vue d\'ensemble de votre coffre' },
  vault: { title: 'Tous les mots de passe', subtitle: 'Votre coffre complet' },
  profile: { title: 'Mon profil', subtitle: 'Informations de votre compte' },
};

function updatePageTitle() {
  const page = PAGE_TITLES[state.page] || PAGE_TITLES.dashboard;
  $('#page-title').textContent = page.title;
  $('#page-subtitle').textContent = page.subtitle;
  const onProfile = state.page === 'profile';
  $('#topbar-total').classList.toggle('hidden', onProfile);
  $('.topbar-actions').classList.toggle('hidden', onProfile);
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

function openSidebar() {
  setSidebarExpanded(true);
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

$('#tab-login').addEventListener('click', () => {
  $('#tab-login').classList.add('active');
  $('#tab-register').classList.remove('active');
  $('#form-login').classList.remove('hidden');
  $('#form-register').classList.add('hidden');
});

$('#tab-register').addEventListener('click', () => {
  $('#tab-register').classList.add('active');
  $('#tab-login').classList.remove('active');
  $('#form-register').classList.remove('hidden');
  $('#form-login').classList.add('hidden');
});

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
  if (!master || master.length < 8) {
    toast('Veuillez saisir votre mot de passe maître (min. 8 caractères)', 'error');
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
  if (master.length < 8) { toast('Minimum 8 caractères', 'error'); return; }
  if (!$('#register-first-name').value.trim()) { toast('Le prénom est requis', 'error'); return; }
  if (!$('#register-last-name').value.trim()) { toast('Le nom est requis', 'error'); return; }

  btn.disabled = true;
  showLoading('Création du coffre chiffré...');
  try {
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
    vaultFilter: null,
  });
  closeAllModals();
  clearLoginForm();
  collapseSidebar();
  showScreen('auth');
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
      state.entries.push({ ...data, ...e });
    } catch (err) {
      console.warn('Entrée ignorée (déchiffrement impossible):', e.id, err);
    }
  }
}

function applyVaultFilter(list) {
  switch (state.vaultFilter) {
    case 'url':
      return list.filter(e => e.url && e.url.trim());
    case 'notes':
      return list.filter(e => e.notes && e.notes.trim());
    case 'weak':
      return list.filter(e => checkStrength(e.password || '') < 3);
    default:
      return list;
  }
}

function openVaultFilter(filter) {
  state.vaultFilter = filter === 'all' ? null : filter;
  state.search = '';
  const searchInput = $('#search-input');
  if (searchInput) searchInput.value = '';
  $('#btn-clear-search')?.classList.add('hidden');
  switchPage('vault');
}

function getFilteredEntries() {
  let list = applyVaultFilter(state.entries);
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter(e =>
      e.title.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) ||
      (e.url && e.url.toLowerCase().includes(q))
    );
  }
  return list;
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

function getRecentEntries(limit = 5) {
  return [...state.entries]
    .sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0))
    .slice(0, limit);
}

function renderDashboard() {
  updateEntryCounts();
  const firstName = state.user?.first_name || (state.user?.display_name || '').split(' ')[0] || 'vous';
  $('#dash-greeting-name').textContent = firstName;

  const withUrl = state.entries.filter(e => e.url && e.url.trim()).length;
  const withNotes = state.entries.filter(e => e.notes && e.notes.trim()).length;
  const weak = state.entries.filter(e => checkStrength(e.password || '') < 3).length;

  $('#dash-stat-total').textContent = state.entries.length;
  $('#dash-stat-urls').textContent = withUrl;
  $('#dash-stat-notes').textContent = withNotes;
  $('#dash-stat-weak').textContent = weak;

  const recent = getRecentEntries();
  const list = $('#dash-recent-list');
  const empty = $('#dash-recent-empty');

  if (recent.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
    list.innerHTML = recent.map(e => {
      const [c1, c2] = getAvatarColor(e.title);
      return `
      <button type="button" class="dash-recent-item" onclick="window.showEntry('${e.id}')">
        <div class="entry-avatar sm" style="background:linear-gradient(135deg,${c1},${c2})">${esc(e.title[0] || '?')}</div>
        <div class="dash-recent-info">
          <span class="dash-recent-title">${esc(e.title)}</span>
          <span class="dash-recent-username">${esc(e.username)}</span>
        </div>
        <i data-lucide="chevron-right" class="dash-recent-chevron"></i>
      </button>`;
    }).join('');
    refreshIcons(list);
  }
  refreshIcons($('#dashboard-view'));
}

function formatProfileDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function formatMemberSince(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  return `Depuis ${date.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;
}

function shortenUserId(id) {
  if (!id || id.length < 12) return id || '—';
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
  $('#profile-display-name').textContent = normalized.display_name || '—';
  $('#profile-detail-first-name').textContent = normalized.first_name || '—';
  $('#profile-detail-middle-name').textContent = normalized.middle_name || 'Non renseigné';
  $('#profile-detail-last-name').textContent = normalized.last_name || '—';
  $('#profile-email').textContent = normalized.email;
  $('#profile-detail-email').textContent = normalized.email;
  $('#user-name').textContent = normalized.display_name;
  $('#user-email').textContent = normalized.email;
  $('#user-avatar').title = `${normalized.display_name} (${normalized.email})`;
  $('#dash-greeting-name').textContent = normalized.first_name || 'vous';
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
    $('#profile-detail-created').textContent = '—';
    $('#profile-member-since').textContent = '—';
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

  container.innerHTML = list.map((e, i) => {
    const [c1, c2] = getAvatarColor(e.title);
    return `
    <div class="entry-card" data-id="${e.id}" style="animation-delay:${i * 0.04}s" onclick="window.showEntry('${e.id}')">
      <div class="entry-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${esc(e.title[0] || '?')}</div>
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
    </div>`;
  }).join('');
  refreshIcons(container);
}

$$('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (!page) return;
    if (page === 'vault') state.vaultFilter = null;
    switchPage(page);
    if (isMobileLayout()) collapseSidebar();
  });
});

$$('[data-vault-filter]').forEach(btn => {
  btn.addEventListener('click', () => openVaultFilter(btn.dataset.vaultFilter));
});

$('#btn-dash-add').addEventListener('click', openAddModal);
$('#btn-dash-add-empty').addEventListener('click', openAddModal);
$('#btn-dash-view-all').addEventListener('click', () => openVaultFilter('all'));

$('#btn-profile-sidebar').addEventListener('click', () => {
  switchPage('profile');
  if (window.innerWidth <= 900) collapseSidebar();
});

$('#btn-profile-lock').addEventListener('click', lockVault);

$('#btn-copy-profile-email').addEventListener('click', async () => {
  const email = $('#profile-detail-email').textContent;
  if (!email || email === '—') return;
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
  renderEntries();
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

  setAvatar($('#detail-avatar'), e.title);
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

  const badge = $('#detail-badge');
  badge.textContent = 'Personnel';
  badge.className = 'badge badge-mine';
  openModal($('#modal-detail'));
  refreshIcons($('#modal-detail'));
};

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

$('#btn-close-detail').addEventListener('click', () => closeModal($('#modal-detail')));

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
}

$('#btn-add').addEventListener('click', openAddModal);
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
  if (state.devMode) { toast(isDevAction().message, 'info'); return; }
  const btn = $('#btn-save-entry');
  btn.disabled = true;
  try {
    const data = {
      title: $('#entry-title').value.trim(),
      username: $('#entry-username').value.trim(),
      password: $('#entry-password').value,
      url: $('#entry-url').value.trim(),
      notes: $('#entry-notes').value.trim(),
    };
    const encrypted = await encryptData(data, state.vaultKey);
    await api.createEntry(state.token, toB64(encrypted));
    await loadEntries();
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
  if (state.devMode) { toast(isDevAction().message, 'info'); return; }
  const e = state.entries.find(x => x.id === id);
  if (!e) return;
  showConfirm('Supprimer', `Voulez-vous vraiment supprimer "${e.title}" ? Cette action est irréversible.`, async () => {
    try {
      await api.deleteEntry(state.token, id);
      await loadEntries();
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

showScreen('auth');
clearLoginForm();
initIcons();
initProfileFieldEdits();
