/**
 * Session auth : lock/logout/recovery helpers + confirmations maître.
 */
import {
  fromB64, deriveKey, decryptBytes,
} from './crypto.js';
import { clearAuthSecrets } from './auth-secrets.js';
import {
  saveSession, clearStoredSession, loadSessionIfFresh, stopIdleWatch, IDLE_TIMEOUT_MS,
  wipeUnlockedSecrets, wipeStateSecrets, wipeKeyBytes,
} from './session.js';
import { setRecoveryCodeValue } from './recovery-input.js';
import { setLucideIcon } from './icons.js';
import {
  $, $$, toast, openModal, closeModal, syncBodyModalLock,
} from './ui.js';

export function createAuthSession(deps) {
  const { state, refreshIcons } = deps;

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
    deps.collapseSidebar();
    deps.showScreen('landing');
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
    deps.collapseSidebar();
    saveSession(state);
    deps.openUnlockScreen();
    const minutes = Math.round(IDLE_TIMEOUT_MS / 60000);
    const messages = {
      idle: `Coffre verrouillé après ${minutes} min d'inactivité`,
      hidden: 'Coffre verrouillé (onglet en arrière-plan)',
      manual: 'Coffre verrouillé',
    };
    toast(messages[reason] || messages.manual, 'info');
  }

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
    const options = $('#confirm-options');
    if (options) {
      options.innerHTML = '';
      options.classList.add('hidden');
    }
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
    const optionsBox = $('#confirm-options');
    if (optionsBox) {
      optionsBox.innerHTML = options.optionsHtml || '';
      optionsBox.classList.toggle('hidden', !options.optionsHtml);
    }
    state.confirmDeleteName = entry.title;
    state.confirmCallback = onConfirm;
    $('#confirm-name-input').value = '';
    $('#btn-confirm-ok').disabled = true;
    openModal($('#modal-confirm'));
    refreshIcons($('#modal-confirm'));
    setTimeout(() => $('#confirm-name-input')?.focus(), 50);
  }

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

  function lockVault(reason = 'manual') {
    softLockVault(reason);
  }

  async function restoreSessionIfAny() {
    const saved = loadSessionIfFresh();
    if (!saved) return false;
    Object.assign(state, {
      token: saved.token,
      user: deps.normalizeUser(saved.user),
      authMaterial: saved.authMaterial,
      vaultKey: null,
      privateKey: null,
      publicKey: null,
      devMode: false,
      entries: [],
      sharesReceived: [],
      sharesSent: [],
    });
    deps.openUnlockScreen();
    return true;
  }

  return {
    authMaterialFromPayload, sameBytes, getAuthMaterialForVerification,
    verifyMasterPasswordForCurrentVault, clearEntrySecretsInMemory,
    hardLogout, softLockVault, isRecoveryKeysModalOpen, clearDetailSecrets,
    closeAllModals, resetDeleteConfirm, settleMasterConfirm,
    requestMasterPasswordConfirmation, showDeleteConfirm,
    clearLoginForm, validateLoginForm, lockVault, restoreSessionIfAny,
  };
}
