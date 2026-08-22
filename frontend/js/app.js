/**
 * Application principale — Clefkey (orchestrateur).
 *
 * État + navigation + câblage des factories ES modules.
 */

import { initIcons, refreshIcons } from './icons.js';
import { prefetchCommonPasswords } from './common-passwords.js';
import { showCompatBannerIfNeeded, copyToClipboard } from './compat.js';
import {
  recoveryCodesAsText,
  downloadRecoveryKeysPng,
  downloadRecoveryKeysPdf,
  downloadRecoveryKeysTxt,
} from './recovery-export.js';
import { createAuthScreens } from './auth-screens.js';
import { initTheme } from './theme.js';
import { bindRecoveryCodeInput } from './recovery-input.js';
import { $, toast, openModal, closeModal } from './ui.js';
import { bindBreachWidget } from './breach-check.js';
import { bindAuth } from './bind-auth.js';
import { bindVault } from './bind-vault.js';
import { bindProjects } from './bind-projects.js';
import { bindShares } from './bind-shares.js';
import { bindGlobalShortcuts } from './shortcuts.js';
import { createAppContext } from './app-compose.js';
import { installVaultNav } from './app-nav.js';

const { state, deps } = createAppContext();

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
  esc: deps.esc,
});

deps.showScreen = showScreen;
deps.openAuthTab = openAuthTab;
deps.openUnlockScreen = openUnlockScreen;
deps.showRecoveryKeysModal = showRecoveryKeysModal;

bindLandingNavigation({ onUnlockBack: () => deps.hardLogout('unlock_back') });
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

installVaultNav(deps);

bindAuth(deps);
bindVault(deps);
bindProjects(deps);
bindShares(deps);
bindGlobalShortcuts(deps);

showScreen('landing');
deps.clearLoginForm();
initTheme();
initIcons();
deps.initProfileFieldEdits();
deps.initPasswordChangeForm();
refreshIcons($('#screen-landing'));
bindBreachWidget($('#lp-audit'), {
  form: '#lp-audit-form',
  input: '#lp-audit-input',
  result: '#lp-audit-result',
  tabs: '[data-breach-mode]',
  toggle: '#lp-audit-toggle',
  privacy: '#lp-audit-privacy',
});
showCompatBannerIfNeeded();
deps.restoreSessionIfAny();
