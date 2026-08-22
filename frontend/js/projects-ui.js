/**
 * Projets / dossiers : CRUD UI et pages projet.
 */
import { api } from './api.js';
import { toB64, encryptData } from './crypto.js';
import { deleteDevEntry } from './dev.js';
import {
  newFolderId, normalizeFolderName, normalizeFoldersList,
  createFoldersMetaPayload, entryFolderId, entryInKnownFolder,
  folderNameById, isVaultMetaEntry, topLevelFolders, folderChildren,
  isFolderDescendant, folderDescendantIds,
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

  async function createFolderByName(rawName, { parentId = '', selectInEntryForm = false } = {}) {
    const name = normalizeFolderName(rawName);
    if (!name) {
      toast('Nom du projet requis', 'error');
      return null;
    }
    if (parentId) {
      const parent = state.folders.find((f) => f.id === parentId);
      if (!parent) {
        toast('Projet parent invalide', 'error');
        return null;
      }
    }
    if (state.folders.some((f) => f.parentId === parentId && f.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce nom est déjà utilisé', 'error');
      return null;
    }
    const folder = { id: newFolderId(), name, parentId };
    state.folders = normalizeFoldersList([...state.folders, folder]);
    await persistFoldersMeta();
    syncFolderFilterButtons();
    populateFolderSelect(selectInEntryForm ? folder.id : undefined);
    deps.populateTransferFolderSelect(folder.id);
    deps.syncTransferEntryButtons();
    renderFoldersManageList();
    deps.refreshCurrentView();
    toast(parentId ? 'Sous-projet créé' : 'Projet créé', 'success');
    return folder;
  }

  async function moveFolderToParent(folderId, newParentId = '') {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return false;
    if (newParentId === folderId) {
      toast('Un projet ne peut pas être son propre parent', 'error');
      return false;
    }
    if (newParentId) {
      const target = state.folders.find((f) => f.id === newParentId);
      if (!target) {
        toast('Projet parent invalide', 'error');
        return false;
      }
      if (isFolderDescendant(state.folders, folderId, newParentId)) {
        toast('Impossible de déplacer dans un de ses sous-projets', 'error');
        return false;
      }
    }
    if (state.folders.some((f) => f.id !== folderId && f.parentId === newParentId
      && f.name.toLowerCase() === folder.name.toLowerCase())) {
      toast('Ce nom existe déjà à cet emplacement', 'error');
      return false;
    }
    if ((folder.parentId || '') === newParentId) return true;
    state.folders = normalizeFoldersList(
      state.folders.map((f) => (f.id === folderId ? { ...f, parentId: newParentId } : f)),
    );
    await persistFoldersMeta();
    syncFolderFilterButtons();
    populateFolderSelect();
    renderFoldersManageList();
    deps.refreshCurrentView();
    toast('Projet déplacé', 'success');
    return true;
  }

  function syncFolderFilterButtons() {
    const renderList = (containerId) => {
      const el = $(containerId);
      if (!el) return;
      const buttons = [];
      const walk = (folder, depth) => {
        buttons.push({ id: folder.id, name: folder.name, depth });
        folderChildren(state.folders, folder.id).forEach((c) => walk(c, depth + 1));
      };
      topLevelFolders(state.folders).forEach((f) => walk(f, 0));
      setHtml(el, buttons.map((f) => `
        <button
          type="button"
          class="folder-filter${state.folderFilter === f.id ? ' active' : ''}${f.depth ? ' child' : ''}"
          data-folder-filter="${esc(f.id)}"
        >${'&nbsp;&nbsp;'.repeat(f.depth)}${esc(f.name)}</button>
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

  function syncEntryFolderPicker(folderId) {
    const pickerName = $('#entry-folder-picker-name');
    const picker = $('#entry-folder-picker');
    if (pickerName) {
      const name = folderId ? folderNameById(state.folders, folderId) : 'Sans projet';
      pickerName.textContent = name || 'Sans projet';
    }
    if (picker) picker.setAttribute('aria-expanded', 'false');
  }

  function populateFolderSelect(selectedId = '') {
    const tree = $('#entry-folder-tree');
    const hidden = $('#entry-folder');
    if (!tree || !hidden) return;

    const current = selectedId !== undefined ? String(selectedId) : (hidden.value || '');
    const pick = current && state.folders.some((f) => f.id === current) ? current : '';

    const rootRow = (selected) => `
      <div
        class="entry-folder-tree-row entry-folder-tree-row-root${selected ? ' is-selected' : ''}"
        data-folder-id=""
        role="radio"
        aria-checked="${selected ? 'true' : 'false'}"
        tabindex="0"
      >
        <span class="entry-folder-tree-icon" aria-hidden="true"><i data-lucide="layers"></i></span>
        <span class="entry-folder-tree-name">Sans projet</span>
        <span class="entry-folder-tree-check" aria-hidden="true"><i data-lucide="check-circle"></i></span>
      </div>`;

    const row = (f, { selected = false, child = false, expanded = true } = {}) => {
      const children = folderChildren(state.folders, f.id);
      const hasChildren = children.length > 0;
      return `
      <div class="entry-folder-tree-children${expanded ? ' is-expanded' : ''}" data-folder-id="${esc(f.id)}">
        <div
          class="entry-folder-tree-row${selected ? ' is-selected' : ''}${child ? ' is-child' : ''}"
          data-folder-id="${esc(f.id)}"
          role="radio"
          aria-checked="${selected ? 'true' : 'false'}"
          tabindex="0"
        >
          ${hasChildren ? `
          <button
            type="button"
            class="entry-folder-tree-toggle"
            data-action="toggle-folder-tree"
            data-parent-id="${esc(f.id)}"
            aria-expanded="${expanded ? 'true' : 'false'}"
            tabindex="-1"
          >
            <i data-lucide="chevron-right" class="entry-folder-tree-chevron"></i>
          </button>` : '<span class="entry-folder-tree-spacer" aria-hidden="true"></span>'}
          <span class="entry-folder-tree-icon" aria-hidden="true"><i data-lucide="layers"></i></span>
          <span class="entry-folder-tree-name">${esc(f.name)}</span>
          <span class="entry-folder-tree-check" aria-hidden="true"><i data-lucide="check-circle"></i></span>
        </div>
        ${hasChildren ? `
        <div class="entry-folder-tree-branch${expanded ? '' : ' is-collapsed'}">
          ${children.map((c) => row(c, { selected: c.id === pick, child: true, expanded: true })).join('')}
        </div>` : ''}
      </div>`;
    };

    tree.replaceChildren();
    setHtml(
      tree,
      rootRow(pick === '') + topLevelFolders(state.folders).map((f) => row(f, { selected: f.id === pick })).join(''),
    );
    hidden.value = pick;
    refreshIcons(tree);
    tree.classList.add('is-collapsed');
    syncEntryFolderPicker(pick);
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

  async function deleteEntriesInFolder(folderId) {
    const affected = state.entries.filter((e) => !e.isShare && !isVaultMetaEntry(e)
      && entryFolderId(e) === folderId);
    for (const e of affected) {
      if (state.devMode) {
        deleteDevEntry(state.entries, e.id);
      } else {
        await api.deleteEntry(state.token, e.id);
      }
    }
    if (!state.devMode && affected.length) await deps.loadEntries();
    return affected.length;
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

  function folderSelectEntries(excludeId = '', { excludeTree = false } = {}) {
    const blocked = new Set();
    if (excludeId) {
      blocked.add(excludeId);
      if (excludeTree) {
        folderDescendantIds(state.folders, excludeId).forEach((id) => blocked.add(id));
      }
    }
    const entries = [];
    const walk = (folder, depth) => {
      folderChildren(state.folders, folder.id).forEach((c) => {
        if (blocked.has(c.id)) return;
        entries.push({ value: c.id, label: `${'\u00a0\u00a0'.repeat(depth)}${c.name}` });
        walk(c, depth + 1);
      });
    };
    topLevelFolders(state.folders).forEach((f) => {
      if (blocked.has(f.id)) return;
      entries.push({ value: f.id, label: f.name });
      walk(f, 1);
    });
    return entries;
  }

  function fillFolderSelect(sel, {
    excludeId = '',
    selectedId = '',
    excludeTree = false,
    rootLabel = 'Projet principal',
  } = {}) {
    if (!sel) return;
    fillSelect(
      sel,
      [{ value: '', label: rootLabel }, ...folderSelectEntries(excludeId, { excludeTree })],
      selectedId || '',
    );
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
    const manageItem = (f, depth) => `
      <li class="folders-manage-item" data-folder-id="${esc(f.id)}" style="--m-depth:${depth}">
        <div class="folder-manage-main">
          <input
            type="text"
            class="folder-rename-input"
            value="${esc(f.name)}"
            maxlength="80"
            aria-label="Nom du projet"
          >
        </div>
        <div class="folder-manage-actions">
          <button
            type="button"
            class="btn btn-ghost btn-icon btn-sm folder-rename-save"
            title="Enregistrer"
            aria-label="Enregistrer"
          >
            <i data-lucide="check-circle"></i>
          </button>
          <select class="folder-move-parent" aria-label="Déplacer sous"></select>
          <button
            type="button"
            class="btn btn-ghost btn-icon btn-sm folder-move-save"
            title="Déplacer"
            aria-label="Déplacer"
          >
            <i data-lucide="arrow-right"></i>
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-icon btn-sm btn-danger folder-delete-btn"
            title="Supprimer"
            aria-label="Supprimer"
          >
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </li>`;
    const items = [];
    const walk = (folder, depth) => {
      items.push(manageItem(folder, depth));
      folderChildren(state.folders, folder.id).forEach((c) => walk(c, depth + 1));
    };
    topLevelFolders(state.folders).forEach((f) => walk(f, 0));
    setHtml(list, items.join(''));
    list.querySelectorAll('select.folder-move-parent').forEach((sel) => {
      const id = sel.closest('[data-folder-id]')?.dataset.folderId;
      const folder = state.folders.find((f) => f.id === id);
      if (!folder) return;
      fillFolderSelect(sel, {
        excludeId: folder.id,
        selectedId: folder.parentId || '',
        excludeTree: true,
      });
    });
    refreshIcons(list);
  }

  function openFoldersModal({ parentId = '' } = {}) {
    renderFoldersManageList();
    deps.syncTransferEntryButtons();
    const input = $('#folder-new-name');
    if (input) input.value = '';
    const parentSel = $('#folder-new-parent');
    if (parentSel) {
      fillFolderSelect(parentSel, { selectedId: parentId || '' });
      if (parentId && state.folders.some((f) => f.id === parentId)) {
        parentSel.value = parentId;
      }
    }
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
          <input
            type="checkbox"
            data-action="toggle-select"
            data-id="${esc(e.id)}"
            ${selected
            ?
            'checked'
            :
            ''}
            aria-label="Sélectionner ${esc(e.title)}"
          >
        </label>` : '';
    return `
      <div
        class="entry-card${selectable ? ' entry-card-selectable' : ''}${selected ? ' is-selected' : ''}"
        data-id="${esc(e.id)}"
        style="animation-delay:${i * 0.04}s"
        data-action="show-entry"
      >
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
                : deps.entryType(e) === 'oauth' && deps.displayUsername(e.username) === 'none'
                  ? 'Connexion sociale'
                  : deps.entryType(e) === 'login' && deps.displayUsername(e.username) === 'none'
                    ? 'Connexion'
                    : deps.displayUsername(e.username)
          )}</div>
        </div>
        <div class="entry-actions">
          <button type="button" class="btn-icon" title="Copier" data-action="copy-password" data-id="${esc(e.id)}">
            <i data-lucide="copy"></i>
          </button>
          <button
            type="button"
            class="btn-icon btn-danger"
            title="Supprimer"
            data-action="delete-entry"
            data-id="${esc(e.id)}"
          >
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
    const all = $('#project-detail-select-all');
    const transferBtn = $('#btn-project-detail-transfer');

    bar?.classList.toggle('hidden', n === 0);
    if (countEl) {
      countEl.textContent = n <= 1 ? `${n} sélectionnée` : `${n} sélectionnées`;
    }
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
    $('#btn-project-detail-subproject')?.classList.toggle('hidden', !!folder.parentId);
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
    const isList = state.projectsViewMode === 'list';
    grid.classList.toggle('is-folders', isList);
    $$('#projects-view [data-projects-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.projectsView === (isList ? 'list' : 'grid'));
    });
    if (state.folders.length === 0) {
      grid.replaceChildren();
      empty?.classList.remove('hidden');
      refreshIcons($('#projects-view'));
      return;
    }
    empty?.classList.add('hidden');
    const countLabelFor = (id) => {
      const count = countEntriesInFolder(id);
      return count <= 1 ? `${count} clé` : `${count} clés`;
    };

    const folderSvg = `
      <svg class="project-folder-svg" xmlns="http://www.w3.org/2000/svg"
        width="20" height="20" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round"
        stroke-linejoin="round" aria-hidden="true">
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9
          L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
      </svg>`;

    const folderRow = (f, depth) => {
      const children = folderChildren(state.folders, f.id);
      const collapsed = state.collapsedProjectIds?.includes(f.id);
      const childCount = children.length;
      return `
      <div
        class="project-folder${collapsed ? ' is-collapsed' : ''}"
        data-folder-id="${esc(f.id)}"
        role="listitem"
        style="--folder-depth:${depth}"
      >
        <div class="project-folder-row">
          ${childCount ? `
          <button
            type="button"
            class="project-folder-toggle"
            data-action="toggle-subs"
            data-parent-id="${esc(f.id)}"
            aria-expanded="${collapsed ? 'false' : 'true'}"
            title="Déplier / replier"
            aria-label="Déplier / replier"
          >
            <i data-lucide="chevron-right" class="project-subs-chevron"></i>
          </button>` : `<span class="project-folder-toggle-spacer" aria-hidden="true"></span>`}
          <button type="button" class="project-folder-main" data-action="open-project" title="Ouvrir ${esc(f.name)}">
            <span class="project-folder-icon" aria-hidden="true">${folderSvg}</span>
            <span class="project-folder-name">${esc(f.name)}</span>
            <span class="project-folder-meta">${esc(countLabelFor(f.id))}${
              childCount ? ` · ${childCount} dossier${childCount > 1 ? 's' : ''}` : ''
            }</span>
          </button>
          <div class="project-folder-actions">
            <button
              type="button"
              class="project-row-btn"
              data-action="toggle-move-project"
              title="Déplacer"
              aria-label="Déplacer"
            >
              <i data-lucide="arrow-right"></i>
            </button>
            <button
              type="button"
              class="project-row-btn"
              data-action="rename-project"
              title="Renommer"
              aria-label="Renommer"
            >
              <i data-lucide="pencil"></i>
            </button>
            <button
              type="button"
              class="project-row-btn project-row-btn-danger"
              data-action="delete-project"
              title="Supprimer le projet"
              aria-label="Supprimer le projet"
            >
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>
        ${childCount ? `
        <div class="project-folder-children${collapsed ? ' is-collapsed' : ''}" data-parent-id="${esc(f.id)}">
          ${children.map((c) => folderRow(c, depth + 1)).join('')}
        </div>` : ''}
      </div>`;
    };

    const projectCardNode = (f) => {
      const initial = esc((f.name?.[0] || '?').toUpperCase());
      const children = folderChildren(state.folders, f.id);
      const collapsed = state.collapsedProjectIds?.includes(f.id);
      const descendants = folderDescendantIds(state.folders, f.id);
      const subItem = (c) => {
        const subChildren = folderChildren(state.folders, c.id);
        const subCollapsed = state.collapsedProjectIds?.includes(c.id);
        return `
        <li class="project-sub-item${subCollapsed ? ' is-collapsed' : ''}" data-folder-id="${esc(c.id)}">
          <div class="project-sub-row">
            ${subChildren.length ? `
            <button
              type="button"
              class="project-sub-toggle"
              data-action="toggle-subs"
              data-parent-id="${esc(c.id)}"
              aria-expanded="${subCollapsed ? 'false' : 'true'}"
              title="Déplier / replier"
              aria-label="Déplier / replier"
            >
              <i data-lucide="chevron-right" class="project-subs-chevron"></i>
            </button>` : `<span class="project-sub-spacer" aria-hidden="true"></span>`}
            <button type="button" class="project-sub-main" data-action="open-project" title="Ouvrir ${esc(c.name)}">
              <span class="project-sub-dot" aria-hidden="true"></span>
              <span class="project-sub-name">${esc(c.name)}</span>
              <span class="project-sub-meta">${esc(countLabelFor(c.id))}</span>
            </button>
            <div class="project-sub-actions">
              <button
                type="button"
                class="project-row-btn"
                data-action="toggle-move-project"
                title="Déplacer"
                aria-label="Déplacer"
              >
                <i data-lucide="arrow-right"></i>
              </button>
              <button
                type="button"
                class="project-row-btn"
                data-action="rename-project"
                title="Renommer"
                aria-label="Renommer"
              >
                <i data-lucide="pencil"></i>
              </button>
              <button
                type="button"
                class="project-row-btn project-row-btn-danger"
                data-action="delete-project"
                title="Supprimer le sous-projet"
                aria-label="Supprimer le sous-projet"
              >
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>
          ${subChildren.length ? `
          <ul class="project-sub-list${subCollapsed ? ' is-collapsed' : ''}" data-parent-id="${esc(c.id)}">
            ${subChildren.map(subItem).join('')}
          </ul>` : ''}
        </li>`;
      };
      return `
        <div class="project-group${collapsed ? ' is-collapsed' : ''}" role="listitem">
          <article class="project-row" data-folder-id="${esc(f.id)}">
            <button
              type="button"
              class="project-row-delete"
              data-action="delete-project"
              title="Supprimer le projet"
              aria-label="Supprimer le projet"
            >
              <i data-lucide="trash-2"></i>
            </button>
            <button type="button" class="project-row-main" data-action="open-project" title="Ouvrir ${esc(f.name)}">
              <span class="project-row-avatar" aria-hidden="true">${initial}</span>
              <span class="project-row-body">
                <span class="project-row-name">${esc(f.name)}</span>
                <span class="project-row-meta">${esc(countLabelFor(f.id))}${
                  descendants.size ? ` · ${descendants.size} sous-projet${descendants.size > 1 ? 's' : ''}` : ''
                }</span>
              </span>
              <span class="project-row-open">Ouvrir</span>
            </button>
          </article>
          ${children.length ? `
          <div class="project-subs${collapsed ? ' is-collapsed' : ''}" data-parent-id="${esc(f.id)}">
            <button
              type="button"
              class="project-subs-toggle"
              data-action="toggle-subs"
              data-parent-id="${esc(f.id)}"
              aria-expanded="${collapsed ? 'false' : 'true'}"
            >
              <i data-lucide="chevron-right" class="project-subs-chevron"></i>
              <span>${children.length} sous-projet${children.length > 1 ? 's' : ''}</span>
            </button>
            <ul class="project-sub-list">
              ${children.map(subItem).join('')}
            </ul>
          </div>` : ''}
        </div>`;
    };

    setHtml(
      grid,
      isList
        ? topLevelFolders(state.folders).map((f) => folderRow(f, 0)).join('')
        : topLevelFolders(state.folders).map(projectCardNode).join(''),
    );
    refreshIcons($('#projects-view'));
  }

  async function performDeleteFolder(folderId, { deleteKeys = false, keepChildren = false } = {}) {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    showLoading('Mise à jour des projets...');
    try {
      const descendants = folderDescendantIds(state.folders, folderId);
      const removedIds = keepChildren ? [] : [...descendants];
      const toRemove = [folderId, ...removedIds];
      for (const id of toRemove) {
        if (deleteKeys) await deleteEntriesInFolder(id);
        else await clearFolderIdOnEntries(id);
      }
      state.folders = state.folders
        .filter((f) => !toRemove.includes(f.id))
        .map((f) => (keepChildren && f.parentId === folderId ? { ...f, parentId: '' } : f));
      state.folders = normalizeFoldersList(state.folders);
      await persistFoldersMeta();
      if (toRemove.includes(state.folderFilter)) state.folderFilter = 'all';
      if (toRemove.includes(state.activeProjectId)) state.activeProjectId = null;
      syncFolderFilterButtons();
      populateFolderSelect();
      renderFoldersManageList();
      deps.refreshCurrentView();
      toast(deleteKeys ? 'Projet et clés supprimés' : 'Projet supprimé — les clés ont été conservées', 'info');
    } finally {
      hideLoading();
    }
  }

  function deleteFolder(folderId) {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const children = folderChildren(state.folders, folderId);
    const descendants = folderDescendantIds(state.folders, folderId);
    const keysCount = countEntriesInFolder(folderId);
    const optionsHtml = `
      <label class="confirm-option">
        <input type="checkbox" id="confirm-delete-keys">
        <span class="confirm-option-body">
          <span class="confirm-option-title">Supprimer aussi les clés de ce projet</span>
          <span class="confirm-option-hint">${keysCount} clé(s). Sinon elles passeront en « Sans projet ».</span>
        </span>
      </label>
      ${descendants.size ? `
      <label class="confirm-option">
        <input type="checkbox" id="confirm-keep-children">
        <span class="confirm-option-body">
          <span class="confirm-option-title">Conserver les sous-projets et leurs clés</span>
          <span class="confirm-option-hint">
            ${descendants.size} sous-projet(s) conservés, premier niveau en projet principal.
          </span>
        </span>
      </label>` : ''}`;
    deps.showDeleteConfirm(
      { title: folder.name },
      async () => {
        const deleteKeys = !!$('#confirm-delete-keys')?.checked;
        const keepChildren = !!$('#confirm-keep-children')?.checked;
        try {
          await performDeleteFolder(folderId, { deleteKeys, keepChildren });
        } catch (err) {
          toast(err.message || 'Suppression impossible', 'error');
        }
      },
      {
        title: descendants.size ? 'Supprimer le projet et ses sous-projets' : 'Supprimer le projet',
        message: 'Cette action est irréversible. Choisissez ce qui doit être conservé.',
        placeholder: 'Nom du projet',
        optionsHtml,
      },
    );
  }

  function openCreateSubprojectModal(parentId) {
    const parent = state.folders.find((f) => f.id === parentId);
    if (!parent) {
      toast('Projet parent invalide', 'error');
      return;
    }
    state.subprojectParentId = parentId;
    const label = $('#subproject-parent-name');
    if (label) label.textContent = parent.name;
    const input = $('#subproject-name');
    if (input) input.value = '';
    openModal($('#modal-subproject'));
    refreshIcons($('#modal-subproject'));
    setTimeout(() => input?.focus(), 50);
  }

  function syncMoveProjectPreview() {
    const select = $('#move-project-parent');
    const target = $('#move-project-to');
    if (!select || !target) return;
    const parent = state.folders.find((f) => f.id === select.value);
    target.textContent = parent ? parent.name : 'Projet principal';
  }

  function openMoveProjectModal(folderId) {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    state.moveProjectId = folderId;
    const nameEl = $('#move-project-name');
    if (nameEl) nameEl.textContent = folder.name;
    const fromEl = $('#move-project-from');
    if (fromEl) {
      const parent = state.folders.find((f) => f.id === folder.parentId);
      fromEl.textContent = parent ? parent.name : 'Projet principal';
    }
    const select = $('#move-project-parent');
    if (select) {
      fillFolderSelect(select, {
        excludeId: folderId,
        selectedId: folder.parentId || '',
        excludeTree: true,
      });
    }
    syncMoveProjectPreview();
    openModal($('#modal-move-project'));
    refreshIcons($('#modal-move-project'));
    setTimeout(() => $('#move-project-parent')?.focus(), 50);
  }

  function setProjectsViewMode(mode) {
    const next = mode === 'list' ? 'list' : 'grid';
    if (next === state.projectsViewMode) {
      renderProjectsPage();
      return;
    }
    state.projectsViewMode = next;
    try { localStorage.setItem('clefkey.projectsView', next); } catch { /* ignore */ }
    renderProjectsPage();
  }

  return {
    hideEntryFolderCreate, showEntryFolderCreate, createFolderByName,
    syncFolderFilterButtons, populateFolderSelect, defaultFolderIdFromFilter,
    syncEntryFolderPicker,
    persistFoldersMeta, clearFolderIdOnEntries, getUnassignedEntries,
    setEntryFolder, assignEntriesToFolder,
    renderFoldersManageList, openFoldersModal, openProjectsPage, moveFolderToParent,
    countEntriesInFolder, openProjectPage, getProjectDetailEntries,
    entryListCardMarkup, clearProjectDetailSelection, syncProjectDetailSelectionUi,
    toggleProjectDetailSelection, renderProjectDetailPage, openProjectFilter,
    renderProjectsPage, performDeleteFolder, deleteFolder,
    setProjectsViewMode,
    openCreateSubprojectModal, openMoveProjectModal, syncMoveProjectPreview,
    deleteEntriesInFolder,
  };
}
