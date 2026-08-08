/**
 * Projets / dossiers : CRUD UI et pages projet.
 */
import { api } from './api.js';
import { toB64, encryptData } from './crypto.js';
import {
  newFolderId, normalizeFolderName, normalizeFoldersList,
  createFoldersMetaPayload, entryFolderId, entryInKnownFolder,
  folderNameById, isVaultMetaEntry,
} from './folders.js';
import {
  $, $$, esc, setHtml, fillSelect, toast, showLoading, hideLoading, openModal, closeModal,
} from './ui.js';

export function createProjects(deps) {
  const { state, refreshIcons, entryEncryptedPayload } = deps;

  function hideEntryFolderCreate() {
    const panel = $('#entry-folder-create');
    const toggle = $('#btn-entry-folder-toggle');
    const input = $('#entry-folder-new-name');
    panel?.classList.add('hidden');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (input) input.value = '';
  }

  function showEntryFolderCreate() {
    const panel = $('#entry-folder-create');
    const toggle = $('#btn-entry-folder-toggle');
    panel?.classList.remove('hidden');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    setTimeout(() => $('#entry-folder-new-name')?.focus(), 40);
  }

  async function createFolderByName(rawName, { selectInEntryForm = false } = {}) {
    const name = normalizeFolderName(rawName);
    if (!name) {
      toast('Nom du projet requis', 'error');
      return null;
    }
    if (state.folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce projet existe déjà', 'error');
      return null;
    }
    const folder = { id: newFolderId(), name };
    state.folders = normalizeFoldersList([...state.folders, folder]);
    await persistFoldersMeta();
    syncFolderFilterButtons();
    populateFolderSelect(selectInEntryForm ? folder.id : undefined);
    deps.populateTransferFolderSelect(folder.id);
    deps.syncTransferEntryButtons();
    renderFoldersManageList();
    deps.refreshCurrentView();
    toast('Projet créé', 'success');
    return folder;
  }

  function syncFolderFilterButtons() {
    const renderList = (containerId) => {
      const el = $(containerId);
      if (!el) return;
      setHtml(el, state.folders.map((f) => `
        <button type="button" class="folder-filter${state.folderFilter === f.id ? ' active' : ''}" data-folder-filter="${esc(f.id)}">${esc(f.name)}</button>
      `).join(''));
    };
    renderList('#dash-folder-filter-list');
    renderList('#vault-folder-filter-list');
    $$('.folder-filters > .folder-filter[data-folder-filter="all"]').forEach((btn) => {
      btn.classList.toggle('active', state.folderFilter === 'all');
    });
    $$('.folder-filters > .folder-filter[data-folder-filter="none"]').forEach((btn) => {
      btn.classList.toggle('active', state.folderFilter === 'none');
    });
  }

  function populateFolderSelect(selectedId = '') {
    const sel = $('#entry-folder');
    if (!sel) return;
    const current = selectedId || sel.value || '';
    const pick = current && state.folders.some((f) => f.id === current) ? current : '';
    fillSelect(sel, [
      { value: '', label: 'Sans projet' },
      ...state.folders.map((f) => ({ value: f.id, label: f.name })),
    ], pick);
  }

  function defaultFolderIdFromFilter() {
    if (state.page === 'project-detail' && state.activeProjectId
        && state.folders.some((f) => f.id === state.activeProjectId)) {
      return state.activeProjectId;
    }
    if (state.folderFilter && state.folderFilter !== 'all' && state.folderFilter !== 'none'
        && state.folders.some((f) => f.id === state.folderFilter)) {
      return state.folderFilter;
    }
    return '';
  }

  async function persistFoldersMeta() {
    const payload = createFoldersMetaPayload(state.folders);
    if (state.devMode) {
      // Meta hors liste visible : stockée à part en mémoire via foldersMetaEntryId factice
      state.foldersMetaEntryId = state.foldersMetaEntryId || 'dev-folders-meta';
      return;
    }
    const encrypted = await encryptData(payload, state.vaultKey);
    const b64 = toB64(encrypted);
    if (state.foldersMetaEntryId) {
      await api.updateEntry(state.token, state.foldersMetaEntryId, b64);
    } else {
      const created = await api.createEntry(state.token, b64);
      state.foldersMetaEntryId = created?.id || state.foldersMetaEntryId;
      // Recharger pour récupérer l’id si la réponse ne le donne pas
      if (!state.foldersMetaEntryId) await deps.loadEntries();
    }
  }

  async function clearFolderIdOnEntries(folderId) {
    const affected = state.entries.filter((e) => entryFolderId(e) === folderId);
    for (const e of affected) {
      const payload = { ...entryEncryptedPayload({ ...e, folderId: '' }), folderId: '' };
      if (state.devMode) {
        deps.updateDevEntry(state.entries, e.id, payload);
      } else {
        const encrypted = await encryptData(payload, state.vaultKey);
        await api.updateEntry(state.token, e.id, toB64(encrypted));
      }
    }
    if (!state.devMode && affected.length) await deps.loadEntries();
  }

  function getUnassignedEntries() {
    return state.entries
      .filter((e) => !e.isShare && !isVaultMetaEntry(e) && !entryInKnownFolder(e, state.folders))
      .sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  }

  async function setEntryFolder(entryId, folderId, { reload = true } = {}) {
    const entry = state.entries.find((e) => e.id === entryId);
    if (!entry || entry.isShare) throw new Error('Clé introuvable');
    const nextId = typeof folderId === 'string' ? folderId.trim() : '';
    if (nextId && !state.folders.some((f) => f.id === nextId)) {
      throw new Error('Projet invalide');
    }
    const payload = nextId
      ? entryEncryptedPayload({ ...entry, folderId: nextId })
      : { ...entryEncryptedPayload({ ...entry, folderId: '' }), folderId: '' };
    if (state.devMode) {
      deps.updateDevEntry(state.entries, entryId, payload);
    } else {
      const encrypted = await encryptData(payload, state.vaultKey);
      await api.updateEntry(state.token, entryId, toB64(encrypted));
      if (reload) await deps.loadEntries();
    }
  }

  async function assignEntriesToFolder(entryIds, folderId) {
    const targetFolderId = typeof folderId === 'string' ? folderId.trim() : '';
    if (targetFolderId && !state.folders.some((f) => f.id === targetFolderId)) {
      throw new Error('Choisissez un projet valide');
    }
    const idSet = new Set(entryIds.map(String));
    const targets = state.entries.filter(
      (e) => idSet.has(String(e.id)) && !e.isShare && !isVaultMetaEntry(e),
    );
    if (!targets.length) return 0;

    for (const e of targets) {
      await setEntryFolder(e.id, targetFolderId, { reload: false });
    }
    if (!state.devMode) await deps.loadEntries();
    return targets.length;
  }

  function renderFoldersManageList() {
    const list = $('#folders-manage-list');
    const empty = $('#folders-manage-empty');
    if (!list) return;
    if (state.folders.length === 0) {
      list.replaceChildren();
      empty?.classList.remove('hidden');
      return;
    }
    empty?.classList.add('hidden');
    setHtml(list, state.folders.map((f) => `
      <li class="folders-manage-item" data-folder-id="${esc(f.id)}">
        <input type="text" class="folder-rename-input" value="${esc(f.name)}" maxlength="80" aria-label="Nom du projet">
        <button type="button" class="btn btn-ghost btn-sm folder-rename-save" title="Enregistrer">OK</button>
        <button type="button" class="btn btn-ghost btn-sm btn-danger folder-delete-btn" title="Supprimer">
          <i data-lucide="trash-2"></i>
        </button>
      </li>
    `).join(''));
    refreshIcons(list);
  }

  function openFoldersModal() {
    renderFoldersManageList();
    deps.syncTransferEntryButtons();
    const input = $('#folder-new-name');
    if (input) input.value = '';
    openModal($('#modal-folders'));
    refreshIcons($('#modal-folders'));
    setTimeout(() => input?.focus(), 50);
  }

  function openProjectsPage() {
    closeModal($('#modal-folders'));
    deps.switchPage('projects');
    if (deps.isMobileLayout()) deps.collapseSidebar();
  }

  function countEntriesInFolder(folderId) {
    return state.entries.filter(
      (e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folderId,
    ).length;
  }

  function openProjectPage(folderId) {
    if (!folderId || !state.folders.some((f) => f.id === folderId)) {
      toast('Projet introuvable', 'error');
      deps.switchPage('projects');
      return;
    }
    state.activeProjectId = folderId;
    state.projectDetailSearch = '';
    state.projectDetailSelectedIds = [];
    const input = $('#project-detail-search-input');
    if (input) input.value = '';
    $('#btn-clear-project-detail-search')?.classList.add('hidden');
    deps.switchPage('project-detail');
    if (deps.isMobileLayout()) deps.collapseSidebar();
  }

  function getProjectDetailEntries() {
    const folderId = state.activeProjectId;
    let list = state.entries.filter(
      (e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folderId,
    );
    const q = state.projectDetailSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((e) =>
        e.title.toLowerCase().includes(q)
        || (e.username || '').toLowerCase().includes(q)
        || (e.url && e.url.toLowerCase().includes(q))
        || (e.notes && e.notes.toLowerCase().includes(q)),
      );
    }
    return list.sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
  }

  function entryListCardMarkup(e, i, { selectable = false, selected = false } = {}) {
    const selectMarkup = selectable ? `
        <label class="entry-card-select" data-action="toggle-select" data-id="${esc(e.id)}" title="Sélectionner">
          <input type="checkbox" data-action="toggle-select" data-id="${esc(e.id)}" ${selected ? 'checked' : ''} aria-label="Sélectionner ${esc(e.title)}">
        </label>` : '';
    return `
      <div class="entry-card${selectable ? ' entry-card-selectable' : ''}${selected ? ' is-selected' : ''}" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-entry">
        ${selectMarkup}
        ${deps.entryAvatarMarkup(e)}
        <div class="entry-info">
          <div class="entry-title-row">
            <div class="entry-title">${esc(e.title)}</div>
            ${deps.entryTypeBadgeMarkup(e)}
          </div>
          <div class="entry-username">${esc(
            deps.entryType(e) === 'api_key' && deps.displayUsername(e.username) === 'none'
              ? 'Secret API'
              : deps.entryType(e) === 'ssh_key' && deps.displayUsername(e.username) === 'none'
                ? 'Clé SSH / stockage'
                : deps.displayUsername(e.username)
          )}</div>
        </div>
        <div class="entry-actions">
          <button type="button" class="btn-icon" title="Copier" data-action="copy-password" data-id="${esc(e.id)}">
            <i data-lucide="copy"></i>
          </button>
          <button type="button" class="btn-icon btn-danger" title="Supprimer" data-action="delete-entry" data-id="${esc(e.id)}">
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>`;
  }

  function clearProjectDetailSelection() {
    state.projectDetailSelectedIds = [];
    syncProjectDetailSelectionUi();
  }

  function syncProjectDetailSelectionUi() {
    const visibleIds = new Set(getProjectDetailEntries().map((e) => e.id));
    state.projectDetailSelectedIds = state.projectDetailSelectedIds.filter((id) => visibleIds.has(id));
    const n = state.projectDetailSelectedIds.length;
    const bar = $('#project-detail-select-bar');
    const countEl = $('#project-detail-selection-count');
    const moveBtn = $('#btn-project-detail-move');
    const all = $('#project-detail-select-all');
    const transferBtn = $('#btn-project-detail-transfer');

    bar?.classList.toggle('hidden', n === 0);
    if (countEl) {
      countEl.textContent = n <= 1 ? `${n} sélectionnée` : `${n} sélectionnées`;
    }
    if (moveBtn) moveBtn.disabled = n === 0;
    if (all) {
      const total = visibleIds.size;
      all.checked = total > 0 && n === total;
      all.indeterminate = n > 0 && n < total;
    }
    if (transferBtn) {
      transferBtn.disabled = visibleIds.size === 0;
      transferBtn.classList.toggle('is-disabled', visibleIds.size === 0);
    }

    $$('#project-detail-list .entry-card[data-id]').forEach((card) => {
      const id = card.dataset.id;
      const on = state.projectDetailSelectedIds.includes(id);
      card.classList.toggle('is-selected', on);
      const box = card.querySelector('input[data-action="toggle-select"]');
      if (box) box.checked = on;
    });
  }

  function toggleProjectDetailSelection(id, force) {
    if (!id) return;
    const set = new Set(state.projectDetailSelectedIds);
    const next = typeof force === 'boolean' ? force : !set.has(id);
    if (next) set.add(id);
    else set.delete(id);
    state.projectDetailSelectedIds = [...set];
    syncProjectDetailSelectionUi();
  }

  function renderProjectDetailPage() {
    const folder = state.folders.find((f) => f.id === state.activeProjectId);
    if (!folder) {
      state.activeProjectId = null;
      deps.switchPage('projects');
      return;
    }

    deps.updateEntryCounts();
    const allInProject = state.entries.filter(
      (e) => !e.isShare && !isVaultMetaEntry(e) && entryFolderId(e) === folder.id,
    );
    const entries = getProjectDetailEntries();
    const list = $('#project-detail-list');
    const empty = $('#project-detail-empty');
    const avatar = $('#project-detail-avatar');
    const nameEl = $('#project-detail-name');
    const metaEl = $('#project-detail-meta');
    const emptyTitle = $('#project-detail-empty-title');
    const emptyText = $('#project-detail-empty-text');

    if (avatar) avatar.textContent = (folder.name?.[0] || '?').toUpperCase();
    if (nameEl) nameEl.textContent = folder.name;
    if (metaEl) {
      const n = allInProject.length;
      metaEl.textContent = n <= 1 ? `${n} clé` : `${n} clés`;
    }

    deps.updatePageTitle();

    if (!list) return;
    if (entries.length === 0) {
      list.replaceChildren();
      clearProjectDetailSelection();
      empty?.classList.remove('hidden');
      if (state.projectDetailSearch.trim()) {
        if (emptyTitle) emptyTitle.textContent = 'Aucun résultat';
        if (emptyText) emptyText.textContent = 'Essayez un autre terme de recherche.';
        $('#btn-project-detail-add-empty')?.classList.add('hidden');
      } else {
        if (emptyTitle) emptyTitle.textContent = 'Aucune clé dans ce projet';
        if (emptyText) emptyText.textContent = 'Ajoutez une clé pour l’organiser ici.';
        $('#btn-project-detail-add-empty')?.classList.remove('hidden');
      }
      refreshIcons($('#project-detail-view'));
      return;
    }

    empty?.classList.add('hidden');
    const selected = new Set(state.projectDetailSelectedIds);
    setHtml(list, entries.map((e, i) => entryListCardMarkup(e, i, {
      selectable: true,
      selected: selected.has(e.id),
    })).join(''));
    refreshIcons(list);
    deps.setupFaviconImages(list);
    syncProjectDetailSelectionUi();
  }

  function openProjectFilter(folderId) {
    openProjectPage(folderId);
  }

  function renderProjectsPage() {
    deps.updateEntryCounts();
    deps.syncTransferEntryButtons();
    const grid = $('#projects-grid');
    const empty = $('#projects-empty');
    const countLabel = $('#projects-count-label');

    if (countLabel) {
      const n = state.folders.length;
      countLabel.textContent = n === 0 ? '0' : String(n);
    }

    if (!grid) return;
    if (state.folders.length === 0) {
      grid.replaceChildren();
      empty?.classList.remove('hidden');
      refreshIcons($('#projects-view'));
      return;
    }
    empty?.classList.add('hidden');
    setHtml(grid, state.folders.map((f) => {
      const count = countEntriesInFolder(f.id);
      const countLabelText = count <= 1 ? `${count} clé` : `${count} clés`;
      const initial = esc((f.name?.[0] || '?').toUpperCase());
      return `
        <article class="project-row" data-folder-id="${esc(f.id)}" role="listitem">
          <button type="button" class="project-row-main" data-action="open-project" title="Ouvrir ${esc(f.name)}">
            <span class="project-row-avatar" aria-hidden="true">${initial}</span>
            <span class="project-row-body">
              <span class="project-row-name">${esc(f.name)}</span>
              <span class="project-row-meta">${esc(countLabelText)}</span>
            </span>
            <span class="project-row-open">Ouvrir</span>
          </button>
          <div class="project-row-actions">
            <button type="button" class="project-row-btn" data-action="rename-project" title="Renommer" aria-label="Renommer">
              <i data-lucide="pencil"></i>
            </button>
            <button type="button" class="project-row-btn project-row-btn-danger" data-action="delete-project" title="Supprimer" aria-label="Supprimer">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </article>`;
    }).join(''));
    refreshIcons($('#projects-view'));
  }

  async function performDeleteFolder(folderId) {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    showLoading('Mise à jour des projets...');
    try {
      await clearFolderIdOnEntries(folderId);
      state.folders = state.folders.filter((f) => f.id !== folderId);
      await persistFoldersMeta();
      if (state.folderFilter === folderId) state.folderFilter = 'all';
      if (state.activeProjectId === folderId) state.activeProjectId = null;
      syncFolderFilterButtons();
      populateFolderSelect();
      renderFoldersManageList();
      deps.refreshCurrentView();
      toast('Projet supprimé — les clés sont passées en « Sans projet »', 'info');
    } finally {
      hideLoading();
    }
  }

  function deleteFolder(folderId) {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    deps.showDeleteConfirm(
      { title: folder.name },
      async () => {
        try {
          await performDeleteFolder(folderId);
        } catch (err) {
          toast(err.message || 'Suppression impossible', 'error');
        }
      },
      {
        title: 'Supprimer le projet',
        message: 'Cette action est irréversible. Les clés de ce projet passeront en « Sans projet ».',
        placeholder: 'Nom du projet',
      },
    );
  }

  return {
    hideEntryFolderCreate, showEntryFolderCreate, createFolderByName,
    syncFolderFilterButtons, populateFolderSelect, defaultFolderIdFromFilter,
    persistFoldersMeta, clearFolderIdOnEntries, getUnassignedEntries,
    setEntryFolder, assignEntriesToFolder,
    renderFoldersManageList, openFoldersModal, openProjectsPage,
    countEntriesInFolder, openProjectPage, getProjectDetailEntries,
    entryListCardMarkup, clearProjectDetailSelection, syncProjectDetailSelectionUi,
    toggleProjectDetailSelection, renderProjectDetailPage, openProjectFilter,
    renderProjectsPage, performDeleteFolder, deleteFolder,
  };
}
