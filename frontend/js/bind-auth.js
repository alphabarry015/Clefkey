/**
 * Listeners auth / recovery / confirmations maître.
 */
import {
  toB64, fromB64, prepareRegistration, unlockSession, unlockSessionWithPassphrase,
  prepareLogin,
  RECOVERY_KEY_COUNT,
  recoveryVerifierFromCode,
  recoveryKeyProofFromVaultKey,
  unwrapVaultKeyWithRecoveryCode,
  prepareMasterPasswordReset,
  preparePassphraseReset,
  decryptPrivateKey,
} from './crypto.js';
import { api } from './api.js';
import { enterDevMode, shouldUseDevBypass } from './dev.js';
import { clearAuthSecrets } from './auth-secrets.js';
import { checkStrength, validateMasterPassword } from './master-password.js';
import {
  applyPassphraseFormatting,
  formatPassphraseInput,
  validatePassphrase,
} from './passphrase.js';
import { setRecoveryCodeValue } from './recovery-input.js';
import { $, toast, showLoading, hideLoading } from './ui.js';

export function bindAuth(deps) {
  const {
    state,
    hardLogout, lockVault, settleMasterConfirm, resetDeleteConfirm,
    clearLoginForm, validateLoginForm, verifyMasterPasswordForCurrentVault,
    authMaterialFromPayload, userFromProfile, showVault,
    syncFolderFilterButtons, populateFolderSelect,
    loadEntries, refreshCurrentView, showRecoveryKeysModal,
    openAuthTab, openUnlockScreen, setUnlockMode, showScreen,
    closeModal, openModal, showLoading: _sl, hideLoading: _hl,
  } = deps;
  void _sl; void _hl; void showScreen; void openUnlockScreen; void openModal;

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

  // ── Password strength (UI) ───────────────────────────────

  ['#register-passphrase', '#register-passphrase-confirm', '#unlock-passphrase',
    '#recovery-new-passphrase', '#recovery-new-passphrase-confirm'].forEach((sel) => {
    $(sel)?.addEventListener('input', (e) => applyPassphraseFormatting(e.target));
  });

  $('#unlock-mode-passphrase')?.addEventListener('click', () => setUnlockMode?.('passphrase'));
  $('#unlock-mode-master')?.addEventListener('click', () => setUnlockMode?.('master'));

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
    const passphrase = formatPassphraseInput($('#register-passphrase')?.value || '');
    const passphraseConfirm = formatPassphraseInput($('#register-passphrase-confirm')?.value || '');
    if (master !== confirm) { toast('Les mots de passe ne correspondent pas', 'error'); return; }
    if (passphrase !== passphraseConfirm) {
      toast('Les passphrases ne correspondent pas', 'error');
      return;
    }
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
      const phraseError = validatePassphrase(passphrase);
      if (phraseError) {
        toast(phraseError, 'error');
        return;
      }
      showLoading('Création du coffre et des clés de récupération...');
      const prep = await prepareRegistration(master, passphrase);
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
        passphrase_salt: toB64(prep.passphraseSalt),
        passphrase_verifier: toB64(prep.passphraseVerifier),
        encrypted_vault_key_passphrase: toB64(prep.encryptedVaultKeyPassphrase),
      });
      state.token = data.access_token;
      state.user = userFromProfile(data);
      state.authMaterial = authMaterialFromPayload(data) || {
        salt: toB64(prep.salt),
        encrypted_vault_key: toB64(prep.encryptedVaultKey),
        encrypted_private_key: toB64(prep.encryptedPrivateKey),
        public_key: toB64(prep.publicKey),
        passphrase_salt: toB64(prep.passphraseSalt),
        encrypted_vault_key_passphrase: toB64(prep.encryptedVaultKeyPassphrase),
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
    state.recoveryTarget = 'master';
    openAuthTab('recovery');
    if ($('#recovery-email')) $('#recovery-email').value = email;
    setRecoveryCodeValue($('#recovery-code'), '', $('#recovery-code-count'));
    setTimeout(() => $('#recovery-code')?.focus(), 50);
  });

  $('#btn-forgot-passphrase')?.addEventListener('click', () => {
    state.recoveryTarget = 'passphrase';
    openAuthTab('recovery');
    if ($('#recovery-email') && state.user?.email) {
      $('#recovery-email').value = state.user.email;
    }
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
      const target = state.recoveryTarget === 'passphrase' ? 'passphrase' : 'master';
      openAuthTab(target === 'passphrase' ? 'recovery-passphrase' : 'recovery-reset');
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

  $('#form-recovery-passphrase')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const session = state.recoverySession;
    if (!session) {
      openAuthTab('recovery');
      return;
    }
    const passphrase = formatPassphraseInput($('#recovery-new-passphrase')?.value || '');
    const confirm = formatPassphraseInput($('#recovery-new-passphrase-confirm')?.value || '');
    if (passphrase !== confirm) {
      toast('Les passphrases ne correspondent pas', 'error');
      return;
    }
    const phraseError = validatePassphrase(passphrase);
    if (phraseError) {
      toast(phraseError, 'error');
      return;
    }
    const btn = $('#btn-recovery-passphrase-complete');
    btn.disabled = true;
    showLoading('Réchiffrement de la passphrase...');
    try {
      const prep = await preparePassphraseReset(session.vaultKey, passphrase);
      const keyProof = await recoveryKeyProofFromVaultKey(session.vaultKey);
      const data = await api.recoveryPassphraseComplete({
        email: session.email,
        verifier: session.verifierB64,
        key_proof: toB64(keyProof),
        passphrase_salt: toB64(prep.salt),
        passphrase_verifier: toB64(prep.verifier),
        encrypted_vault_key_passphrase: toB64(prep.encryptedVaultKey),
      });
      state.token = data.access_token;
      state.user = userFromProfile(data);
      state.authMaterial = authMaterialFromPayload(data);
      state.vaultKey = session.vaultKey;
      state.privateKey = session.privateKey;
      state.publicKey = session.publicKey;
      state.entries = [];
      state.recoverySession = null;
      state.recoveryTarget = null;
      clearAuthSecrets();
      $('#form-recovery-passphrase')?.reset();
      try {
        await loadEntries();
      } catch (err) {
        console.warn(err);
      }
      showVault();
      toast('Passphrase réinitialisée. La clé utilisée est maintenant invalide.', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
      btn.disabled = false;
    }
  });

  $('#form-unlock')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const usePassphrase = !$('#unlock-passphrase-group')?.classList.contains('hidden');
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
      let keys;
      if (usePassphrase) {
        const passphrase = formatPassphraseInput($('#unlock-passphrase')?.value || '');
        if (!passphrase) {
          toast('Veuillez saisir votre passphrase', 'error');
          $('#unlock-passphrase')?.focus();
          return;
        }
        keys = await unlockSessionWithPassphrase(state.authMaterial, passphrase);
      } else {
        const master = $('#unlock-password')?.value || '';
        if (!master) {
          toast('Veuillez saisir votre mot de passe maître', 'error');
          $('#unlock-password')?.focus();
          return;
        }
        keys = await unlockSession(state.authMaterial, master);
      }
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
      if (usePassphrase) {
        toast('Passphrase incorrecte', 'error');
        if ($('#unlock-passphrase')) $('#unlock-passphrase').value = '';
        $('#unlock-passphrase')?.focus();
      } else {
        toast('Mot de passe maître incorrect', 'error');
        if ($('#unlock-password')) $('#unlock-password').value = '';
        $('#unlock-password')?.focus();
      }
    } finally {
      hideLoading();
      if (btn) btn.disabled = false;
    }
  });

  $('#btn-unlock-logout')?.addEventListener('click', () => hardLogout('manual'));
}
