/**
 * Écrans auth / landing + modale des clés de récupération.
 * Extrait de app.js pour limiter le monolithe UI.
 */

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

  function showScreen(name) {
    Object.values(screens).forEach((s) => s?.classList.remove('active'));
    screens[name]?.classList.add('active');
  }

  function hideAllAuthForms() {
    $('#form-login')?.classList.add('hidden');
    $('#form-register')?.classList.add('hidden');
    $('#form-recovery')?.classList.add('hidden');
    $('#form-recovery-reset')?.classList.add('hidden');
    $('#form-unlock')?.classList.add('hidden');
  }

  function openAuthTab(tab = 'login') {
    const onLogin = tab === 'login';
    const onRegister = tab === 'register';
    const onRecovery = tab === 'recovery';
    const onRecoveryReset = tab === 'recovery-reset';
    const onRecoveryFlow = onRecovery || onRecoveryReset;
    $('#tab-login')?.classList.toggle('active', onLogin);
    $('#tab-register')?.classList.toggle('active', onRegister);
    $('.auth-tabs')?.classList.toggle('hidden', onRecoveryFlow);
    hideAllAuthForms();
    if (onLogin) $('#form-login')?.classList.remove('hidden');
    if (onRegister) $('#form-register')?.classList.remove('hidden');
    if (onRecovery) $('#form-recovery')?.classList.remove('hidden');
    if (onRecoveryReset) $('#form-recovery-reset')?.classList.remove('hidden');
    if (onRegister) prefetchCommonPasswords();
    if (!onRecoveryFlow) state.recoverySession = null;
    showScreen('auth');
    refreshIcons($('#screen-auth'));
  }

  /** Écran soft-lock : mot de passe maître uniquement. */
  function openUnlockScreen() {
    $('.auth-tabs')?.classList.add('hidden');
    hideAllAuthForms();
    $('#form-unlock')?.classList.remove('hidden');
    const email = state.user?.email || '';
    const label = $('#unlock-user-label');
    if (label) {
      label.textContent = email ? `Compte : ${email}` : '';
      label.classList.toggle('hidden', !email);
    }
    const input = $('#unlock-password');
    if (input) input.value = '';
    showScreen('auth');
    refreshIcons($('#screen-auth'));
    setTimeout(() => input?.focus(), 50);
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
    list.innerHTML = codes.map((code, i) => `
      <li><span class="rk-slot">${i + 1}</span><span>${esc(code)}</span></li>
    `).join('');
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

    $('#btn-landing-start')?.addEventListener('click', goRegister);
    $('#btn-landing-start-footer')?.addEventListener('click', goRegister);
    $('#btn-landing-login')?.addEventListener('click', goLogin);
    $('#btn-back-landing')?.addEventListener('click', () => {
      const onUnlock = !$('#form-unlock')?.classList.contains('hidden');
      if (onUnlock && typeof onUnlockBack === 'function') {
        onUnlockBack();
        return;
      }
      showScreen('landing');
      refreshIcons($('#screen-landing'));
    });
    $('#tab-login')?.addEventListener('click', () => openAuthTab('login'));
    $('#tab-register')?.addEventListener('click', () => openAuthTab('register'));
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
    openUnlockScreen,
    showRecoveryKeysModal,
    recoveryExportMeta,
    bindLandingNavigation,
    bindRecoveryExportButtons,
  };
}
