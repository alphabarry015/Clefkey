/**
 * Composition des factories UI du coffre (état + deps).
 */

import { refreshIcons } from './icons.js';
import { updateDevEntry } from './dev.js';
import { setFaviconAuth, setupFaviconImages } from './favicon.js';
import {
  $, $$, EMPTY_VALUE, esc, setHtml, toast,
  showLoading, hideLoading, openModal, closeModal, copyText,
  getAvatarColor,
} from './ui.js';
import { createEntryUi } from './entry-ui.js';
import { createEntryMarkup } from './entry-markup.js';
import { createProjects } from './projects-ui.js';
import { createTransfer } from './transfer-ui.js';
import { createShares } from './shares-ui.js';
import { createVaultViews } from './vault-views.js';
import { createProfile } from './profile-ui.js';
import { createAudit } from './audit.js';
import { createGenerator } from './generator.js';
import { createAuthSession } from './auth-session.js';

function createInitialState() {
  return {
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
    devMode: false,
    page: 'dashboard',
    search: '',
    viewMode: (() => {
      try {
        return localStorage.getItem('clefkey.viewMode') === 'list' ? 'list' : 'grid';
      } catch {
        return 'grid';
      }
    })(),
    projectsViewMode: (() => {
      try {
        return localStorage.getItem('clefkey.projectsView') === 'list' ? 'list' : 'grid';
      } catch {
        return 'grid';
      }
    })(),
    dashTab: 'recent',
    dashSearch: '',
    typeFilter: 'all',
    folderFilter: 'all',
    activeProjectId: null,
    projectDetailSearch: '',
    projectDetailSelectedIds: [],
    transferAllowUnassign: false,
    transferExcludeFolderId: '',
    collapsedProjectIds: [],
    folders: [],
    foldersMetaEntryId: null,
    confirmCallback: null,
    confirmDeleteName: null,
    detailEntryId: null,
    editingEntryId: null,
    authMaterial: null,
    masterConfirmResolve: null,
    shareEntryId: null,
    recoverySession: null,
    pendingRecoveryCodes: null,
    afterRecoveryKeys: null,
  };
}

export function createAppContext() {
  const state = createInitialState();
  setFaviconAuth(() => state.token);
  const deps = {
    state,
    refreshIcons,
    setupFaviconImages,
    updateDevEntry,
    getAvatarColor,
    $,
    $$,
    toast,
    showLoading,
    hideLoading,
    openModal,
    closeModal,
    esc,
    setHtml,
    copyText,
    EMPTY_VALUE,
  };

  Object.assign(deps, createEntryUi(deps));
  Object.assign(deps, createEntryMarkup(deps));
  Object.assign(deps, createAuthSession(deps));
  Object.assign(deps, createProfile(deps));
  Object.assign(deps, createProjects(deps));
  Object.assign(deps, createTransfer(deps));
  Object.assign(deps, createShares(deps));
  Object.assign(deps, createVaultViews(deps));
  Object.assign(deps, createAudit(deps));
  Object.assign(deps, createGenerator(deps));

  deps.installVaultGlobals();
  deps.installShareGlobals();

  return { state, deps };
}
