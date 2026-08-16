/**
 * Application principale — Clefkey (orchestrateur).
 *
 * État + navigation + câblage des factories ES modules.
 */

import { initIcons, refreshIcons } from './icons.js';
import { updateDevEntry } from './dev.js';
import { setupFaviconImages } from './favicon.js';
import { prefetchCommonPasswords } from './common-passwords.js';
import { saveSession, startIdleWatch } from './session.js';
import { showCompatBannerIfNeeded, copyToClipboard } from './compat.js';
import {
  recoveryCodesAsText,
  downloadRecoveryKeysPng,
  downloadRecoveryKeysPdf,
  downloadRecoveryKeysTxt,
} from './recovery-export.js';
import {
  isVaultMetaEntry,
  entryFolderId,
} from './folders.js';
import { createAuthScreens } from './auth-screens.js';
import { initTheme } from './theme.js';
import {
  bindRecoveryCodeInput,
} from './recovery-input.js';
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
import { bindBreachWidget } from './breach-check.js';
import { createAuthSession } from './auth-session.js';
import { bindAuth } from './bind-auth.js';
import { bindVault } from './bind-vault.js';
import { bindProjects } from './bind-projects.js';
import { bindShares } from './bind-shares.js';
import { bindGlobalShortcuts } from './shortcuts.js';

const state = {
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
    try { return localStorage.getItem('clefkey.viewMode') === 'list' ? 'list' : 'grid'; }
    catch { return 'grid'; }
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

const {
  fillEntryDetailCommon,
  syncFolderFilterButtons, populateFolderSelect,
  openProjectsPage, openProjectPage, openProjectDetailTransfer,
  createFolderByName, deleteFolder, persistFoldersMeta,
  renderFoldersManageList, getProjectDetailEntries,
  clearProjectDetailSelection, syncProjectDetailSelectionUi,
  toggleProjectDetailSelection, renderProjectDetailPage, renderProjectsPage,
  showEntryFolderCreate, hideEntryFolderCreate,
  syncTransferEntryButtons, updateTransferSelectionUi, openTransferModal,
  syncDetailMoveButton, syncDetailProjectField,
  setEntryFolder, assignEntriesToFolder, getUnassignedEntries,
  loadShares, renderSharesReceived, renderSharesSent, renderContactsPage,
  getShareContacts, removeShareContact, rememberShareContact,
  openShareModal, openSharePickEntryModal, renderSharePickEntryList,
  installShareGlobals,
  loadEntries, refreshCurrentView, updateEntryCounts,
  renderDashboard, renderEntries, setViewMode, openAddModal, openEditModal, readEntryFormData,
  installVaultGlobals, showEntry, entryType,
  syncTypeFilterButtons, syncAddEntryButtonLabels, setEntryFormType,
  resetEntryFormModal,
  normalizeUser, userFromProfile, applyUserToUI, renderProfile,
  closeAllProfileFieldEdits, initProfileFieldEdits,
  authMaterialFromPayload,
  hardLogout, lockVault,
  isRecoveryKeysModalOpen, clearDetailSecrets, closeAllModals,
  resetDeleteConfirm, settleMasterConfirm, requestMasterPasswordConfirmation,
  showDeleteConfirm, clearLoginForm, validateLoginForm, restoreSessionIfAny,
  verifyMasterPasswordForCurrentVault,
  renderAudit,
  renderGenerator,
} = deps;

installVaultGlobals();
installShareGlobals();

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
  esc,
});

deps.showScreen = showScreen;
deps.openAuthTab = openAuthTab;
deps.openUnlockScreen = openUnlockScreen;
deps.showRecoveryKeysModal = showRecoveryKeysModal;
deps.authMaterialFromPayload = authMaterialFromPayload;
deps.userFromProfile = userFromProfile;
deps.syncFolderFilterButtons = syncFolderFilterButtons;
deps.populateFolderSelect = populateFolderSelect;
deps.loadEntries = loadEntries;
deps.refreshCurrentView = refreshCurrentView;
deps.loadShares = loadShares;
deps.showDeleteConfirm = showDeleteConfirm;
deps.renderProjectsPage = renderProjectsPage;
deps.renderProjectDetailPage = renderProjectDetailPage;
deps.renderSharesReceived = renderSharesReceived;
deps.renderSharesSent = renderSharesSent;
deps.renderContactsPage = renderContactsPage;
deps.renderProfile = renderProfile;
deps.openAddModal = openAddModal;
deps.openEditModal = openEditModal;
deps.readEntryFormData = readEntryFormData;
deps.resetEntryFormModal = resetEntryFormModal;
deps.setEntryFormType = setEntryFormType;
deps.syncTypeFilterButtons = syncTypeFilterButtons;
deps.syncAddEntryButtonLabels = syncAddEntryButtonLabels;
deps.entryType = entryType;
deps.showEntry = showEntry;
deps.renderDashboard = renderDashboard;
deps.renderEntries = renderEntries;
deps.setViewMode = setViewMode;
deps.openShareModal = openShareModal;
deps.openSharePickEntryModal = openSharePickEntryModal;
deps.renderSharePickEntryList = renderSharePickEntryList;
deps.getShareContacts = getShareContacts;
deps.removeShareContact = removeShareContact;
deps.rememberShareContact = rememberShareContact;
deps.fillEntryDetailCommon = fillEntryDetailCommon;
deps.normalizeUser = normalizeUser;
deps.openProjectsPage = openProjectsPage;
deps.openProjectPage = openProjectPage;
deps.openProjectDetailTransfer = openProjectDetailTransfer;
deps.createFolderByName = createFolderByName;
deps.deleteFolder = deleteFolder;
deps.persistFoldersMeta = persistFoldersMeta;
deps.renderFoldersManageList = renderFoldersManageList;
deps.getProjectDetailEntries = getProjectDetailEntries;
deps.clearProjectDetailSelection = clearProjectDetailSelection;
deps.syncProjectDetailSelectionUi = syncProjectDetailSelectionUi;
deps.toggleProjectDetailSelection = toggleProjectDetailSelection;
deps.openTransferModal = openTransferModal;
deps.updateTransferSelectionUi = updateTransferSelectionUi;
deps.assignEntriesToFolder = assignEntriesToFolder;
deps.syncTransferEntryButtons = syncTransferEntryButtons;
deps.setEntryFolder = setEntryFolder;
deps.syncDetailMoveButton = syncDetailMoveButton;
deps.syncDetailProjectField = syncDetailProjectField;
deps.showEntryFolderCreate = showEntryFolderCreate;
deps.hideEntryFolderCreate = hideEntryFolderCreate;
deps.getUnassignedEntries = getUnassignedEntries;
deps.hardLogout = hardLogout;
deps.lockVault = lockVault;
deps.settleMasterConfirm = settleMasterConfirm;
deps.resetDeleteConfirm = resetDeleteConfirm;
deps.clearLoginForm = clearLoginForm;
deps.validateLoginForm = validateLoginForm;
deps.verifyMasterPasswordForCurrentVault = verifyMasterPasswordForCurrentVault;
deps.requestMasterPasswordConfirmation = requestMasterPasswordConfirmation;
deps.clearDetailSecrets = clearDetailSecrets;
deps.closeAllModals = closeAllModals;
deps.isRecoveryKeysModalOpen = isRecoveryKeysModalOpen;
deps.closeModal = closeModal;
deps.openModal = openModal;

bindLandingNavigation({ onUnlockBack: () => hardLogout('unlock_back') });
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

// ── Navigation ─────────────────────────────────────────

const PAGE_TITLES = {
  dashboard: { title: 'Accueil', subtitle: 'Vos connexions en un coup d\'œil' },
  vault: { title: 'Toutes les clés', subtitle: 'Votre coffre complet' },
  projects: { title: 'Projets', subtitle: 'Organisez vos clés par dossier' },
  'project-detail': { title: 'Projet', subtitle: 'Clés de ce projet' },
  'shares-received': { title: 'Partage · Reçu', subtitle: 'Clés partagées avec vous' },
  'shares-sent': { title: 'Partage · Envoyé', subtitle: 'Clés que vous avez partagées' },
  contacts: { title: 'Contacts', subtitle: 'Destinataires de vos partages' },
  profile: { title: 'Mon profil', subtitle: 'Informations de votre compte' },
  audit: { title: 'Audit', subtitle: 'Vérifiez si un mot de passe a fuité' },
  generator: { title: 'Générateur', subtitle: 'Mots de passe et passphrases sécurisés' },
};

function updatePageTitle() {
  if (state.page === 'project-detail') {
    const folder = state.folders.find((f) => f.id === state.activeProjectId);
    $('#page-title').textContent = folder?.name || 'Projet';
    const n = folder
      ? state.entries.filter((e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folder.id).length
      : 0;
    $('#page-subtitle').textContent = n <= 1 ? `${n} clé dans ce projet` : `${n} clés dans ce projet`;
    $('#fab-add').classList.remove('hidden');
    return;
  }
  const page = PAGE_TITLES[state.page] || PAGE_TITLES.dashboard;
  $('#page-title').textContent = page.title;
  $('#page-subtitle').textContent = page.subtitle;
  const onProfile = state.page === 'profile';
  const onAudit = state.page === 'audit';
  const onGenerator = state.page === 'generator';
  const onShares = state.page === 'shares-received' || state.page === 'shares-sent' || state.page === 'contacts';
  const onProjects = state.page === 'projects';
  $('#fab-add').classList.toggle('hidden', onProfile || onShares || onProjects || onAudit || onGenerator);
}

function switchPage(page) {
  if (!PAGE_TITLES[page]) page = 'dashboard';
  if (page !== 'profile') closeAllProfileFieldEdits();
  if (page !== 'project-detail') {
    state.activeProjectId = null;
    state.projectDetailSelectedIds = [];
  }
  if (page !== 'contacts') state.contactsSelectedEmail = null;
  state.page = page;
  $$('.nav-item').forEach((b) => {
    const active = b.dataset.page === page
      || (page === 'project-detail' && b.dataset.page === 'projects');
    b.classList.toggle('active', active);
  });
  $('#dashboard-view').classList.toggle('hidden', page !== 'dashboard');
  $('#vault-view').classList.toggle('hidden', page !== 'vault');
  $('#projects-view')?.classList.toggle('hidden', page !== 'projects');
  $('#project-detail-view')?.classList.toggle('hidden', page !== 'project-detail');
  $('#shares-received-view')?.classList.toggle('hidden', page !== 'shares-received');
  $('#shares-sent-view')?.classList.toggle('hidden', page !== 'shares-sent');
  $('#contacts-view')?.classList.toggle('hidden', page !== 'contacts');
  $('#profile-view').classList.toggle('hidden', page !== 'profile');
  $('#audit-view')?.classList.toggle('hidden', page !== 'audit');
  $('#generator-view')?.classList.toggle('hidden', page !== 'generator');
  updatePageTitle();
  updateEntryCounts();
  $('.vault-main')?.scrollTo(0, 0);
  try {
    if (page === 'dashboard') renderDashboard();
    else if (page === 'vault') renderEntries();
    else if (page === 'projects') renderProjectsPage();
    else if (page === 'project-detail') renderProjectDetailPage();
    else if (page === 'shares-received') renderSharesReceived();
    else if (page === 'shares-sent') renderSharesSent();
    else if (page === 'contacts') renderContactsPage();
    else if (page === 'profile') renderProfile();
    else if (page === 'audit') renderAudit();
    else if (page === 'generator') renderGenerator();
  } catch (err) {
    console.error('Erreur affichage page:', err);
    toast('Impossible d\'afficher cette page', 'error');
  }
}

deps.switchPage = switchPage;
deps.updatePageTitle = updatePageTitle;

const MOBILE_BREAKPOINT = 900;

const SIDEBAR_STORAGE_KEY = 'clefkey.sidebarCollapsed';

function isMobileLayout() {
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

function getSidebarPreference() {
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) !== '1';
}

function setSidebarExpanded(expanded) {
  $('#screen-vault').classList.toggle('sidebar-expanded', expanded);
}

function applySidebarState() {
  setSidebarExpanded(isMobileLayout() ? false : getSidebarPreference());
}

function collapseSidebar() {
  setSidebarExpanded(false);
}

function toggleSidebar() {
  const expanded = !$('#screen-vault').classList.contains('sidebar-expanded');
  setSidebarExpanded(expanded);
  if (!isMobileLayout()) {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, expanded ? '0' : '1');
  }
}

deps.isMobileLayout = isMobileLayout;
deps.collapseSidebar = collapseSidebar;

$('#btn-menu').addEventListener('click', toggleSidebar);
$('#sidebar-overlay').addEventListener('click', collapseSidebar);

window.addEventListener('resize', () => {
  if (!$('#screen-vault').classList.contains('active')) return;
  applySidebarState();
});

function showVault() {
  showScreen('vault');
  if (!state.user) return;
  const user = normalizeUser(state.user);
  state.user = user;
  applyUserToUI(user);
  applySidebarState();
  state.page = 'dashboard';
  switchPage('dashboard');
  if (!state.devMode) {
    saveSession(state);
    startIdleWatch(() => state, (reason) => lockVault(reason || 'idle'));
    loadShares().catch((err) => console.warn('Partages:', err));
  }
}

deps.showVault = showVault;

bindAuth(deps);
bindVault(deps);
bindProjects(deps);
bindShares(deps);
bindGlobalShortcuts(deps);

showScreen('landing');
clearLoginForm();
initTheme();
initIcons();
initProfileFieldEdits();
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
restoreSessionIfAny();
