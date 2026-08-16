/**
 * Profil utilisateur : affichage et édition inline.
 */
import { api } from './api.js';
import { saveSession } from './session.js';
import { $, $$, EMPTY_VALUE, setAvatar, toast } from './ui.js';

export function createProfile(deps) {
  const { state, refreshIcons } = deps;

  /** Ancienne préférence « persist session » retirée — sessionStorage toujours actif. */
  function syncPersistSessionPrefUI() {}

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

  function updateExportCount() {
    const count = state.entries.filter((e) => !e.isShare).length;
    const label = $('#profile-export-count-label');
    const isZero = count === 0;
    label.textContent = isZero
      ? 'Aucune clé à exporter'
      : `${count} clé${count > 1 ? 's' : ''} prête${count > 1 ? 's' : ''} à exporter`;
    label.closest('.profile-export-count').classList.toggle('profile-export-count-empty', isZero);
    document.querySelectorAll('.profile-export-btn').forEach((btn) => {
      btn.disabled = isZero;
    });
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
    const userNameEl = $('#user-name');
    const userEmailEl = $('#user-email');
    if (userNameEl) userNameEl.textContent = normalized.display_name;
    if (userEmailEl) userEmailEl.textContent = normalized.email;
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
    updateExportCount();

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

  return {
    buildDisplayName, normalizeUser, userFromProfile, PROFILE_FIELD_CONFIG,
    formatProfileDate, formatMemberSince, shortenUserId,
    updateProfileChip, setProfileStatus, applyUserToUI, renderProfile,
    closeAllProfileFieldEdits, openProfileFieldEdit, saveProfileField,
    initProfileFieldEdits, syncPersistSessionPrefUI,
  };
}
