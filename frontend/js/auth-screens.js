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

  function openAuthTab(tab = 'login') {
    const onLogin = tab === 'login';
    const onRegister = tab === 'register';
    const onRecovery = tab === 'recovery';
    const onRecoveryReset = tab === 'recovery-reset';
    const onRecoveryFlow = onRecovery || onRecoveryReset;
    $('#tab-login')?.classList.toggle('active', onLogin);
    $('#tab-register')?.classList.toggle('active', onRegister);
    $('.auth-tabs')?.classList.toggle('hidden', onRecoveryFlow);
    $('#form-login')?.classList.toggle('hidden', !onLogin);
    $('#form-register')?.classList.toggle('hidden', !onRegister);
    $('#form-recovery')?.classList.toggle('hidden', !onRecovery);
    $('#form-recovery-reset')?.classList.toggle('hidden', !onRecoveryReset);
    if (onRegister) prefetchCommonPasswords();
    if (!onRecoveryFlow) state.recoverySession = null;
    showScreen('auth');
    refreshIcons($('#screen-auth'));
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

  function bindGithubLabelAlternator() {
    const label = $('.lp-github-label');
    if (!label) return;

    const labels = (label.dataset.labels || 'GitHub|Gardefort').split('|').map((s) => s.trim()).filter(Boolean);
    if (labels.length < 2) return;

    let index = 0;
    let timer = null;

    const tick = () => {
      if (!screens.landing?.classList.contains('active')) return;
      if (document.visibilityState === 'hidden') return;
      label.classList.add('is-swap');
      window.setTimeout(() => {
        index = (index + 1) % labels.length;
        label.textContent = labels[index];
        label.classList.remove('is-swap');
      }, 220);
    };

    const start = () => {
      if (timer) return;
      timer = window.setInterval(tick, 7000);
    };

    const stop = () => {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    };

    const sync = () => {
      if (screens.landing?.classList.contains('active') && document.visibilityState === 'visible') {
        start();
      } else {
        stop();
      }
    };

    document.addEventListener('visibilitychange', sync);
    const landingObserver = new MutationObserver(sync);
    if (screens.landing) {
      landingObserver.observe(screens.landing, { attributes: true, attributeFilter: ['class'] });
    }
    sync();
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
    bindGithubLabelAlternator();
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
    showRecoveryKeysModal,
    recoveryExportMeta,
    bindLandingNavigation,
    bindRecoveryExportButtons,
  };
}
