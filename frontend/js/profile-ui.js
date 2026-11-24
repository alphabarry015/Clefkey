/**
 * Profil utilisateur : affichage et édition inline.
 */
import { api } from './api.js';
import { saveSession, wipeKeyBytes } from './session.js';
import {
  fromB64, toB64, deriveKey, createAuthVerifier, createPassphraseVerifier,
  decryptBytes, prepareLogin, prepareMasterPasswordReset, preparePassphraseReset,
} from './crypto.js';
import { checkStrength, validateMasterPassword } from './master-password.js';
import {
  applyPassphraseFormatting,
  formatPassphraseInput,
  validatePassphrase,
} from './passphrase.js';
import { $, $$, EMPTY_VALUE, setAvatar, toast } from './ui.js';
import {
  DeviceUnlockCancelled,
  clearDeviceUnlock,
  deviceUnlockBlockReason,
  deviceUnlockLabel,
  deviceUnlockSupported,
  enrollDeviceUnlock,
  hasDeviceUnlock,
} from './device-unlock.js';
import { qrcode } from '../vendor/qrcode-generator.js';

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
    if (!id) return EMPTY_VALUE;
    if (id.length <= 8) return id;
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
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
      void syncDeviceUnlockControl();
      $('#btn-open-totp')?.classList.add('hidden');
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
      state.totpEnabled = Boolean(profile.totp_enabled);
      refreshTotpPage();
    } catch {
      $('#profile-detail-created').textContent = EMPTY_VALUE;
      $('#profile-member-since').textContent = EMPTY_VALUE;
    }

    refreshIcons($('#profile-view'));
    void syncDeviceUnlockControl();
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

  function showProfileTab(name) {
    $$('#profile-view [data-profile-tab]').forEach((button) => {
      const on = button.dataset.profileTab === name;
      button.classList.toggle('tab-active', on);
      button.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('#profile-view [data-profile-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.profilePanel !== name);
    });
  }

  function initProfileFieldEdits() {
    $$('#profile-view [data-profile-tab]').forEach((button) => {
      button.addEventListener('click', () => showProfileTab(button.dataset.profileTab));
    });
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

  function updatePasswordStrengthMeter(password) {
    const fill = $('#profile-strength-fill');
    const label = $('#profile-strength-label');
    if (!fill || !label) return;
    const levels = [
      { w: '0%', c: 'transparent', t: '' },
      { w: '20%', c: 'var(--error)', t: 'Très faible' },
      { w: '40%', c: 'var(--warning)', t: 'Faible' },
      { w: '60%', c: 'var(--info)', t: 'Moyen' },
      { w: '80%', c: 'var(--success)', t: 'Fort' },
      { w: '100%', c: 'var(--success)', t: 'Très fort' },
    ];
    const lvl = levels[checkStrength(password)];
    fill.style.width = lvl.w;
    fill.style.background = lvl.c;
    label.textContent = lvl.t;
    label.style.color = lvl.c || 'var(--text-muted)';
  }

  async function submitPasswordChange(event) {
    event.preventDefault();
    const current = $('#profile-current-password')?.value || '';
    const next = $('#profile-new-password')?.value || '';
    const confirm = $('#profile-new-password-confirm')?.value || '';
    const btn = $('#btn-change-password');

    if (!current || !next || !confirm) {
      toast('Tous les champs sont requis', 'error');
      return;
    }
    if (next !== confirm) {
      toast('Les mots de passe ne correspondent pas', 'error');
      return;
    }
    if (next === current) {
      toast('Le nouveau mot de passe doit être différent', 'error');
      return;
    }
    if (state.devMode) {
      toast('Changement de mot de passe indisponible en mode développement', 'info');
      return;
    }
    if (!state.vaultKey || !state.authMaterial?.salt) {
      toast('Coffre verrouillé — reconnectez-vous', 'error');
      return;
    }

    const verify = deps.verifyMasterPasswordForCurrentVault;
    const showLoading = deps.showLoading;
    const hideLoading = deps.hideLoading;
    const authMaterialFromPayload = deps.authMaterialFromPayload;

    btn.disabled = true;
    showLoading?.('Vérification du mot de passe actuel...');
    let currentDerived = null;
    try {
      const currentOk = await verify?.(current);
      if (!currentOk) {
        toast('Mot de passe actuel incorrect', 'error');
        return;
      }
      const masterError = await validateMasterPassword(next);
      if (masterError) {
        toast(masterError, 'error');
        return;
      }
      showLoading?.('Réchiffrement du coffre...');
      const salt = fromB64(state.authMaterial.salt);
      currentDerived = await deriveKey(current, salt);
      const currentVerifier = await createAuthVerifier(currentDerived);
      const prep = await prepareMasterPasswordReset(state.vaultKey, next, salt);
      const data = await api.changePassword(state.token, {
        current_auth_verifier: toB64(currentVerifier),
        auth_verifier: toB64(prep.authVerifier),
        encrypted_vault_key: toB64(prep.encryptedVaultKey),
      });
      if (data.access_token) state.token = data.access_token;
      if (authMaterialFromPayload) {
        state.authMaterial = authMaterialFromPayload(data) || {
          ...state.authMaterial,
          encrypted_vault_key: data.encrypted_vault_key,
        };
      } else {
        state.authMaterial = {
          ...state.authMaterial,
          encrypted_vault_key: data.encrypted_vault_key,
        };
      }
      saveSession(state);
      await clearDeviceUnlock(state.user);
      resetPasswordChangeForm();
      deps.switchPage?.('profile');
      toast('Mot de passe maître mis à jour', 'success');
    } catch (err) {
      toast(err.message || 'Impossible de changer le mot de passe', 'error');
    } finally {
      wipeKeyBytes(currentDerived);
      hideLoading?.();
      btn.disabled = false;
    }
  }

  function resetPasswordChangeForm() {
    $('#form-change-password')?.reset();
    updatePasswordStrengthMeter('');
  }

  function hasPassphraseConfigured() {
    return Boolean(
      state.authMaterial?.passphrase_salt && state.authMaterial?.encrypted_vault_key_passphrase,
    );
  }

  function resetPassphraseChangeForm() {
    $('#form-change-passphrase')?.reset();
    const group = $('#profile-current-passphrase-group');
    const current = $('#profile-current-passphrase');
    if (group) group.classList.toggle('hidden', !hasPassphraseConfigured());
    if (current) current.required = hasPassphraseConfigured();
  }

  async function submitPassphraseChange(event) {
    event.preventDefault();
    const current = formatPassphraseInput($('#profile-current-passphrase')?.value || '');
    const next = formatPassphraseInput($('#profile-new-passphrase')?.value || '');
    const confirm = formatPassphraseInput($('#profile-new-passphrase-confirm')?.value || '');
    const btn = $('#btn-change-passphrase');
    const hadPassphrase = hasPassphraseConfigured();

    if (!next || !confirm) {
      toast('Tous les champs sont requis', 'error');
      return;
    }
    if (hadPassphrase && !current) {
      toast('Passphrase actuelle requise', 'error');
      return;
    }
    if (next !== confirm) {
      toast('Les passphrases ne correspondent pas', 'error');
      return;
    }
    if (hadPassphrase && next === current) {
      toast('La nouvelle passphrase doit être différente', 'error');
      return;
    }
    if (state.devMode) {
      toast('Changement de passphrase indisponible en mode développement', 'info');
      return;
    }
    if (!state.vaultKey) {
      toast('Coffre verrouillé — reconnectez-vous', 'error');
      return;
    }

    const phraseError = validatePassphrase(next);
    if (phraseError) {
      toast(phraseError, 'error');
      return;
    }

    const showLoading = deps.showLoading;
    const hideLoading = deps.hideLoading;
    const authMaterialFromPayload = deps.authMaterialFromPayload;

    btn.disabled = true;
    showLoading?.('Mise à jour de la passphrase...');
    let currentDerived = null;
    try {
      const payload = {};
      if (hadPassphrase) {
        const salt = fromB64(state.authMaterial.passphrase_salt);
        currentDerived = await deriveKey(current, salt);
        const currentVerifier = await createPassphraseVerifier(currentDerived);
        try {
          await decryptBytes(fromB64(state.authMaterial.encrypted_vault_key_passphrase), currentDerived);
        } catch {
          toast('Passphrase actuelle incorrecte', 'error');
          return;
        }
        payload.current_passphrase_verifier = toB64(currentVerifier);
      }
      const prep = await preparePassphraseReset(state.vaultKey, next);
      payload.passphrase_salt = toB64(prep.salt);
      payload.passphrase_verifier = toB64(prep.verifier);
      payload.encrypted_vault_key_passphrase = toB64(prep.encryptedVaultKey);
      const data = await api.changePassphrase(state.token, payload);
      if (data.access_token) state.token = data.access_token;
      if (authMaterialFromPayload) {
        state.authMaterial = authMaterialFromPayload(data) || {
          ...state.authMaterial,
          passphrase_salt: data.passphrase_salt,
          encrypted_vault_key_passphrase: data.encrypted_vault_key_passphrase,
        };
      } else {
        state.authMaterial = {
          ...state.authMaterial,
          passphrase_salt: data.passphrase_salt,
          encrypted_vault_key_passphrase: data.encrypted_vault_key_passphrase,
        };
      }
      saveSession(state);
      await clearDeviceUnlock(state.user);
      resetPassphraseChangeForm();
      deps.switchPage?.('profile');
      toast(hadPassphrase ? 'Passphrase mise à jour' : 'Passphrase créée', 'success');
    } catch (err) {
      toast(err.message || 'Impossible de changer la passphrase', 'error');
    } finally {
      wipeKeyBytes(currentDerived);
      hideLoading?.();
      btn.disabled = false;
    }
  }

  function initPasswordChangeForm() {
    $('#profile-new-password')?.addEventListener('input', (e) => {
      updatePasswordStrengthMeter(e.target.value);
    });
    $('#form-change-password')?.addEventListener('submit', (event) => {
      submitPasswordChange(event).catch(() => {});
    });
    $('#btn-open-change-password')?.addEventListener('click', () => {
      deps.switchPage?.('password');
    });
    $('#btn-password-back')?.addEventListener('click', () => {
      deps.switchPage?.('profile');
    });
  }

  function initPassphraseChangeForm() {
    ['#profile-current-passphrase', '#profile-new-passphrase', '#profile-new-passphrase-confirm']
      .forEach((sel) => {
        $(sel)?.addEventListener('input', (e) => applyPassphraseFormatting(e.target));
      });
    $('#form-change-passphrase')?.addEventListener('submit', (event) => {
      submitPassphraseChange(event).catch(() => {});
    });
    $('#btn-open-change-passphrase')?.addEventListener('click', () => {
      resetPassphraseChangeForm();
      deps.switchPage?.('passphrase');
    });
    $('#btn-passphrase-back')?.addEventListener('click', () => {
      deps.switchPage?.('profile');
    });
    $('#device-unlock-switch')?.addEventListener('change', () => {
      toggleDeviceUnlock().catch(() => {});
    });
  }

  async function syncDeviceUnlockControl() {
    const button = $('#btn-device-unlock');
    if (!button) return;
    const label = await deviceUnlockLabel();
    const show = !state.devMode && Boolean(label);
    button.classList.toggle('hidden', !show);
    if (!show) return;
    const ready = await deviceUnlockSupported();
    const enrolled = ready && await hasDeviceUnlock(state.user);
    const title = $('#device-unlock-title');
    const hint = $('#device-unlock-hint');
    const input = $('#device-unlock-switch');
    const reason = ready ? '' : await deviceUnlockBlockReason();
    if (title) title.textContent = label;
    if (hint) {
      hint.textContent = enrolled
        ? 'Activé sur cet appareil.'
        : (reason || 'Déverrouille ce coffre sur cet appareil après un soft-lock.');
    }
    if (input) input.checked = enrolled;
    refreshIcons(button);
  }

  async function toggleDeviceUnlock() {
    const reason = await deviceUnlockBlockReason();
    if (reason && !(await hasDeviceUnlock(state.user))) {
      toast(reason, 'info');
      await syncDeviceUnlockControl();
      return;
    }
    if (await hasDeviceUnlock(state.user)) {
      await clearDeviceUnlock(state.user);
      toast('Capteur retiré de cet appareil', 'info');
      await syncDeviceUnlockControl();
      return;
    }
    if (!state.vaultKey || !state.privateKey) {
      toast('Ouvrez d’abord le coffre avec le mot de passe maître', 'info');
      await syncDeviceUnlockControl();
      return;
    }
    try {
      const label = await enrollDeviceUnlock(state);
      toast(`${label} activé sur cet appareil`, 'success');
    } catch (err) {
      if (err instanceof DeviceUnlockCancelled || err?.name === 'DeviceUnlockCancelled') {
        toast('Activation annulée', 'info');
        await syncDeviceUnlockControl();
        return;
      }
      toast(err.message || 'Impossible d’activer le capteur', 'info');
    }
    await syncDeviceUnlockControl();
  }

  function showTotpPanels(mode) {
    $('#totp-setup')?.classList.toggle('hidden', mode !== 'setup');
    $('#totp-codes-card')?.classList.toggle('hidden', mode !== 'codes');
    $('#totp-manage')?.classList.toggle('hidden', mode !== 'manage');
  }

  function refreshTotpPage() {
    const hint = $('#totp-row-hint');
    if (hint) {
      hint.textContent = state.totpEnabled
        ? 'Activé. Un code est demandé à chaque connexion.'
        : 'Code à 6 chiffres à chaque connexion.';
    }
    showTotpPanels(state.totpEnabled ? 'manage' : 'setup');
  }

  function renderTotpQr(uri) {
    const box = $('#totp-qr');
    if (!box) return;
    box.replaceChildren();
    const qr = qrcode(0, 'M');
    qr.addData(uri);
    qr.make();
    const markup = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('svg');
    if (svg) box.appendChild(document.importNode(svg, true));
  }

  function resetTotpForm() {
    const secret = $('#totp-secret');
    if (secret) {
      secret.textContent = '';
      secret.classList.add('hidden');
    }
    $('#totp-qr')?.replaceChildren();
    $('#totp-enroll')?.classList.add('hidden');
    const manual = $('#btn-totp-manual');
    if (manual) manual.textContent = 'Saisir la clé';
    $('#form-totp-confirm')?.classList.add('hidden');
    $('#form-totp-confirm')?.reset();
    $('#form-totp-manage')?.reset();
    $('#totp-backup-list')?.replaceChildren();
    showTotpPanels(state.totpEnabled ? 'manage' : 'setup');
  }

  function showBackupCodes(codes) {
    const list = $('#totp-backup-list');
    if (!list) return;
    list.replaceChildren();
    for (const code of codes) {
      const item = document.createElement('li');
      item.textContent = code;
      list.appendChild(item);
    }
    showTotpPanels('codes');
  }

  async function currentMasterVerifier() {
    const master = $('#totp-master')?.value || '';
    const prepared = await prepareLogin(state.user.email, master, window.location.origin);
    if (prepared.derived) prepared.derived.fill(0);
    return prepared.authVerifier;
  }

  function initTotpForm() {
    $('#btn-open-totp')?.addEventListener('click', () => {
      if (state.devMode) return;
      deps.switchPage?.('totp');
    });
    $('#btn-totp-page-back')?.addEventListener('click', () => {
      deps.switchPage?.('profile');
    });
    $('#btn-totp-manual')?.addEventListener('click', () => {
      const secret = $('#totp-secret');
      if (!secret) return;
      const show = secret.classList.contains('hidden');
      secret.classList.toggle('hidden', !show);
      const manual = $('#btn-totp-manual');
      if (manual) manual.textContent = show ? 'Masquer la clé' : 'Saisir la clé';
    });
    $('#btn-totp-begin')?.addEventListener('click', async () => {
      try {
        const data = await api.totpBegin(state.token);
        const secret = $('#totp-secret');
        if (secret) {
          secret.textContent = data.secret;
          secret.classList.add('hidden');
        }
        renderTotpQr(data.otpauth_uri);
        $('#totp-enroll')?.classList.remove('hidden');
        const manual = $('#btn-totp-manual');
        if (manual) manual.textContent = 'Saisir la clé';
        $('#form-totp-confirm')?.classList.remove('hidden');
        toast('Scannez le QR code, puis saisissez le code à 6 chiffres.', 'info');
      } catch (err) {
        toast(err.message, 'info');
      }
    });
    $('#form-totp-confirm')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const data = await api.totpConfirm(state.token, $('#totp-confirm-code')?.value.trim() || '');
        state.totpEnabled = true;
        showBackupCodes(data.backup_codes || []);
        toast('Authentificateur activé', 'success');
      } catch (err) {
        toast(err.message, 'info');
      }
    });
    $('#btn-totp-codes-done')?.addEventListener('click', () => {
      $('#totp-backup-list')?.replaceChildren();
      refreshTotpPage();
      deps.switchPage?.('profile');
    });
    $('#form-totp-manage')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await api.totpDisable(state.token, {
          current_auth_verifier: await currentMasterVerifier(),
          code: $('#totp-manage-code')?.value.trim() || '',
        });
        state.totpEnabled = false;
        resetTotpForm();
        toast('Authentificateur retiré', 'info');
        deps.switchPage?.('profile');
      } catch (err) {
        toast(err.message, 'info');
      }
    });
    $('#btn-totp-regenerate')?.addEventListener('click', async () => {
      try {
        const data = await api.totpRegenerate(state.token, {
          current_auth_verifier: await currentMasterVerifier(),
          code: $('#totp-manage-code')?.value.trim() || '',
        });
        showBackupCodes(data.backup_codes || []);
      } catch (err) {
        toast(err.message, 'info');
      }
    });
  }

  return {
    buildDisplayName, normalizeUser, userFromProfile, PROFILE_FIELD_CONFIG,
    formatProfileDate, formatMemberSince, shortenUserId,
    updateProfileChip, setProfileStatus, applyUserToUI, renderProfile,
    closeAllProfileFieldEdits, openProfileFieldEdit, saveProfileField,
    initProfileFieldEdits, initPasswordChangeForm, resetPasswordChangeForm,
    initPassphraseChangeForm, resetPassphraseChangeForm, syncPersistSessionPrefUI,
    initTotpForm, resetTotpForm, refreshTotpPage,
  };
}
