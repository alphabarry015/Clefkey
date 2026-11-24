/**
 * Écrans auth / landing + modale des clés de récupération.
 * Extrait de app.js pour limiter le monolithe UI.
 */

import { deviceUnlockLabel, deviceUnlockSupported, hasDeviceUnlock } from './device-unlock.js';

export function createAuthScreens({
  $,
  state,
  refreshIcons,
  prefetchCommonPasswords,
  openModal,
  closeModal,
  esc,
}) {
  const screens = {
    landing: $('#screen-landing'),
    auth: $('#screen-auth'),
    vault: $('#screen-vault'),
  };

  function setHtml(el, html) {
    el.replaceChildren();
    const source = String(html ?? '');
    if (!source) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    el.appendChild(range.createContextualFragment(source));
  }

  function showScreen(name) {
    Object.values(screens).forEach((s) => s?.classList.remove('active'));
    screens[name]?.classList.add('active');
  }

  function hideAllAuthForms() {
    $('#form-login')?.classList.add('hidden');
    $('#form-totp')?.classList.add('hidden');
    $('#form-register')?.classList.add('hidden');
    $('#form-recovery')?.classList.add('hidden');
    $('#form-recovery-reset')?.classList.add('hidden');
    $('#form-recovery-passphrase')?.classList.add('hidden');
    $('#form-unlock')?.classList.add('hidden');
  }

  function setAuthCopy(heroTitle, heroLine, panelTitle) {
    if ($('#auth-hero-title')) $('#auth-hero-title').textContent = heroTitle;
    if ($('#auth-hero-line')) $('#auth-hero-line').textContent = heroLine;
    if ($('#auth-panel-title')) $('#auth-panel-title').textContent = panelTitle;
  }

  function showRegisterStep(step, { animate = true } = {}) {
    const root = $('#register-steps');
    if (!root) return;
    const next = String(step) === '2' ? '2' : '1';
    const prev = root.dataset.step || '1';
    root.dataset.step = next;
    root.classList.toggle('is-back', animate && next === '1' && prev === '2');
    root.querySelectorAll('.auth-step').forEach((el) => {
      const on = el.dataset.step === next;
      el.classList.toggle('is-active', on);
      if (on) el.removeAttribute('inert');
      else el.setAttribute('inert', '');
    });
    if (next === '2') $('#register-password')?.focus();
  }

  function registerIdentityValid() {
    const fields = ['#register-first-name', '#register-last-name', '#register-email'];
    for (const sel of fields) {
      const el = $(sel);
      if (el && !el.reportValidity()) return false;
    }
    return true;
  }

  function openAuthTab(tab = 'login') {
    const onLogin = tab === 'login';
    const onRegister = tab === 'register';
    const onRecovery = tab === 'recovery';
    const onRecoveryReset = tab === 'recovery-reset';
    const onRecoveryPassphrase = tab === 'recovery-passphrase';
    const onRecoveryFlow = onRecovery || onRecoveryReset || onRecoveryPassphrase;
    if (onLogin) setAuthCopy('Connexion', 'Retrouvez votre coffre', 'Connexion');
    else if (onRegister) setAuthCopy('Créer un compte', 'Ouvrez votre coffre', 'Créer un compte');
    else if (onRecovery) setAuthCopy('Mot de passe oublié', 'Récupérez l’accès', 'Récupération');
    else if (onRecoveryReset) setAuthCopy('Nouveau mot de passe', 'Choisissez-en un nouveau', 'Nouveau mot de passe');
    else if (onRecoveryPassphrase) setAuthCopy('Nouvelle passphrase', 'Choisissez-en une nouvelle', 'Passphrase');
    $('#auth-panel-title')?.classList.toggle('hidden', onLogin || onRegister);
    $('#tab-login')?.classList.toggle('active', onLogin);
    $('#tab-login')?.classList.toggle('tab-active', onLogin);
    $('#tab-login')?.setAttribute('aria-selected', onLogin ? 'true' : 'false');
    $('#tab-register')?.classList.toggle('active', onRegister);
    $('#tab-register')?.classList.toggle('tab-active', onRegister);
    $('#tab-register')?.setAttribute('aria-selected', onRegister ? 'true' : 'false');
    $('.auth-tabs')?.classList.toggle('hidden', onRecoveryFlow);
    hideAllAuthForms();
    if (onLogin) $('#form-login')?.classList.remove('hidden');
    if (onRegister) $('#form-register')?.classList.remove('hidden');
    if (onRecovery) $('#form-recovery')?.classList.remove('hidden');
    if (onRecoveryReset) $('#form-recovery-reset')?.classList.remove('hidden');
    if (onRecoveryPassphrase) $('#form-recovery-passphrase')?.classList.remove('hidden');
    if (onRegister) {
      prefetchCommonPasswords();
      showRegisterStep(1, { animate: false });
    }
    if (!onRecoveryFlow) {
      state.recoverySession = null;
      state.recoveryTarget = null;
    }
    showScreen('auth');
    const shown = onLogin ? $('#form-login')
      : onRegister ? $('#form-register')
      : onRecovery ? $('#form-recovery')
      : onRecoveryReset ? $('#form-recovery-reset')
      : $('#form-recovery-passphrase');
    refreshIcons(shown);
  }

  function openTotpChallenge() {
    setAuthCopy('Authentificateur', 'Deuxième étape', 'Authentificateur');
    $('#auth-panel-title')?.classList.remove('hidden');
    $('.auth-tabs')?.classList.add('hidden');
    hideAllAuthForms();
    $('#form-totp')?.classList.remove('hidden');
    showScreen('auth');
    refreshIcons($('#form-totp'));
    const input = $('#totp-code');
    if (input) input.value = '';
    setTimeout(() => input?.focus(), 50);
  }

  function setUnlockMode(mode = 'passphrase') {
    const usePassphrase = mode === 'passphrase';
    $('#unlock-mode-passphrase')?.classList.toggle('active', usePassphrase);
    $('#unlock-mode-passphrase')?.classList.toggle('tab-active', usePassphrase);
    $('#unlock-mode-master')?.classList.toggle('active', !usePassphrase);
    $('#unlock-mode-master')?.classList.toggle('tab-active', !usePassphrase);
    $('#unlock-passphrase-group')?.classList.toggle('hidden', !usePassphrase);
    $('#unlock-password-group')?.classList.toggle('hidden', usePassphrase);
    const focusEl = usePassphrase ? $('#unlock-passphrase') : $('#unlock-password');
    setTimeout(() => focusEl?.focus(), 50);
  }

  /** Écran soft-lock : passphrase ou mot de passe maître (email jamais affiché). */
  function openUnlockScreen() {
    setAuthCopy('Coffre verrouillé', 'Déverrouillez pour continuer', 'Déverrouiller');
    $('#auth-panel-title')?.classList.remove('hidden');
    $('.auth-tabs')?.classList.add('hidden');
    hideAllAuthForms();
    $('#form-unlock')?.classList.remove('hidden');
    const hasPassphrase = Boolean(
      state.authMaterial?.passphrase_salt && state.authMaterial?.encrypted_vault_key_passphrase,
    );
    $('#unlock-passphrase') && ($('#unlock-passphrase').value = '');
    $('#unlock-password') && ($('#unlock-password').value = '');
    const modePassphraseBtn = $('#unlock-mode-passphrase');
    if (modePassphraseBtn) modePassphraseBtn.disabled = !hasPassphrase;
    setUnlockMode(hasPassphrase ? 'passphrase' : 'master');
    showScreen('auth');
    refreshIcons($('#form-unlock'));
    void refreshDeviceUnlockButton();
  }

  async function refreshDeviceUnlockButton() {
    const button = $('#btn-device-unlock-open');
    const hint = $('#device-unlock-or');
    const label = $('#device-unlock-open-label');
    if (!button) return;
    const show = !state.devMode
      && await deviceUnlockSupported()
      && await hasDeviceUnlock(state.user);
    button.classList.toggle('hidden', !show);
    hint?.classList.toggle('hidden', !show);
    if (show && label) {
      const name = await deviceUnlockLabel();
      label.textContent = name ? `Déverrouiller avec ${name}` : 'Déverrouiller avec le capteur';
    }
  }

  function recoveryExportMeta() {
    const codes = state.pendingRecoveryCodes;
    const email = $('#btn-recovery-keys-continue')?.dataset.email || state.user?.email || '';
    return { codes, email };
  }

  function showRecoveryKeysModal(codes, { email = '', title = 'Vos 7 clés de récupération', onContinue } = {}) {
    state.pendingRecoveryCodes = codes;
    state.afterRecoveryKeys = onContinue || null;
    $('#recovery-keys-title').textContent = title;
    const list = $('#recovery-keys-list');
    setHtml(list, codes.map((code, i) => `
      <li><span class="rk-slot">${i + 1}</span><span>${esc(code)}</span></li>
    `).join(''));
    const confirm = $('#recovery-keys-confirm');
    const cont = $('#btn-recovery-keys-continue');
    confirm.checked = false;
    cont.disabled = true;
    cont.dataset.email = email || '';
    openModal($('#modal-recovery-keys'));
    refreshIcons($('#modal-recovery-keys'));
  }

  function bindLandingNavigation({ onUnlockBack } = {}) {
    const goRegister = () => openAuthTab('register');
    const goLogin = () => openAuthTab('login');
    const landingRoot = $('#screen-landing');
    const landingHeader = landingRoot?.querySelector('.lp-header');
    const landingMenuBtn = $('#btn-landing-menu');
    const landingMenuCloseBtn = $('#btn-landing-menu-close');
    const closeLandingMenu = () => {
      landingHeader?.classList.remove('menu-open');
      landingMenuBtn?.setAttribute('aria-expanded', 'false');
    };
    const toggleLandingMenu = () => {
      const willOpen = !landingHeader?.classList.contains('menu-open');
      landingHeader?.classList.toggle('menu-open', willOpen);
      landingMenuBtn?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    };

    $('#btn-landing-start')?.addEventListener('click', goRegister);
    $('#btn-landing-start-footer')?.addEventListener('click', goRegister);
    $('#btn-landing-login')?.addEventListener('click', goLogin);
    $('#btn-landing-login-menu')?.addEventListener('click', () => {
      closeLandingMenu();
      goLogin();
    });
    landingMenuBtn?.addEventListener('click', toggleLandingMenu);
    landingMenuCloseBtn?.addEventListener('click', closeLandingMenu);
    landingRoot?.querySelectorAll('.lp-nav a').forEach((link) => {
      link.addEventListener('click', closeLandingMenu);
    });
    $('#btn-back-landing')?.addEventListener('click', () => {
      const onUnlock = !$('#form-unlock')?.classList.contains('hidden');
      if (onUnlock && typeof onUnlockBack === 'function') {
        onUnlockBack();
        return;
      }
      closeLandingMenu();
      showScreen('landing');
      refreshIcons($('#screen-landing'));
    });
    $('#tab-login')?.addEventListener('click', () => openAuthTab('login'));
    $('#tab-register')?.addEventListener('click', () => openAuthTab('register'));
    $('#btn-register-next')?.addEventListener('click', () => {
      if (registerIdentityValid()) showRegisterStep(2);
    });
    $('#btn-register-prev')?.addEventListener('click', () => showRegisterStep(1));
    $('#form-register')?.addEventListener('reset', () => showRegisterStep(1, { animate: false }));
  }

  function bindRecoveryExportButtons({
    toast,
    copyToClipboard,
    recoveryCodesAsText,
    downloadRecoveryKeysPng,
    downloadRecoveryKeysPdf,
    downloadRecoveryKeysTxt,
  }) {
    $('#recovery-keys-confirm')?.addEventListener('change', (e) => {
      $('#btn-recovery-keys-continue').disabled = !e.target.checked;
    });

    $('#btn-copy-recovery-keys')?.addEventListener('click', async () => {
      const { codes, email } = recoveryExportMeta();
      if (!codes?.length) return;
      const ok = await copyToClipboard(recoveryCodesAsText(codes, email));
      toast(ok ? 'Clés copiées' : 'Impossible de copier', ok ? 'success' : 'error');
    });

    $('#btn-download-recovery-png')?.addEventListener('click', async () => {
      const { codes, email } = recoveryExportMeta();
      if (!codes?.length) return;
      try {
        await downloadRecoveryKeysPng(codes, email);
        toast('Image PNG téléchargée — stockez-la hors ligne', 'info');
      } catch (err) {
        toast(err.message || 'Export PNG impossible', 'error');
      }
    });

    $('#btn-download-recovery-pdf')?.addEventListener('click', async () => {
      const { codes, email } = recoveryExportMeta();
      if (!codes?.length) return;
      try {
        await downloadRecoveryKeysPdf(codes, email);
        toast('PDF téléchargé — stockez-le hors ligne', 'info');
      } catch (err) {
        toast(err.message || 'Export PDF impossible', 'error');
      }
    });

    $('#btn-download-recovery-keys')?.addEventListener('click', () => {
      const { codes, email } = recoveryExportMeta();
      if (!codes?.length) return;
      downloadRecoveryKeysTxt(codes, email);
      toast('Fichier TXT téléchargé — stockez-le hors ligne', 'info');
    });

    $('#btn-recovery-keys-continue')?.addEventListener('click', () => {
      if (!$('#recovery-keys-confirm')?.checked) return;
      const next = state.afterRecoveryKeys;
      state.pendingRecoveryCodes = null;
      state.afterRecoveryKeys = null;
      closeModal($('#modal-recovery-keys'));
      if (typeof next === 'function') next();
    });
  }

  return {
    screens,
    showScreen,
    openAuthTab,
    openTotpChallenge,
    openUnlockScreen,
    setUnlockMode,
    showRecoveryKeysModal,
    recoveryExportMeta,
    bindLandingNavigation,
    bindRecoveryExportButtons,
  };
}
