/**
 * Vues coffre : markup, chargement, dashboard, liste, détail, CRUD.
 */
import { api } from './api.js';
import {
  fromB64, toB64, encryptData, decryptData,
  decryptFromSender,
} from './crypto.js';
import { createDevEntry, updateDevEntry, deleteDevEntry } from './dev.js';
import {
  isFoldersMetaEntry, isVaultMetaEntry, foldersFromMetaEntry, entryFolderId, folderNameById,
} from './folders.js';
import {
  prepareEntry, preloadFavicon, setupFaviconImages, getSiteDomain, normalizeEntryUrl,
} from './favicon.js';
import { copyToClipboard } from './compat.js';
import {
  $, $$, esc, setHtml, toast, openModal, closeModal,
} from './ui.js';

export function createVaultViews(deps) {
  const { state, refreshIcons } = deps;
  
  async function loadEntries() {
    if (state.devMode) return;
    const raw = await api.getEntries(state.token);
    if (!raw.length) {
      state.entries = [];
      state.folders = [];
      state.foldersMetaEntryId = null;
      deps.syncFolderFilterButtons();
      deps.populateFolderSelect();
      return;
    }
    const concurrency = 6;
    const decrypted = new Array(raw.length);
    let next = 0;

    async function worker() {
      while (next < raw.length) {
        const index = next++;
        const e = raw[index];
        try {
          const encrypted = fromB64(e.encrypted_data);
          const data = await decryptData(encrypted, state.vaultKey);
          decrypted[index] = prepareEntry({ ...data, ...e });
        } catch (err) {
          console.warn('Clé ignorée (déchiffrement impossible):', e.id, err);
          decrypted[index] = null;
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, raw.length) }, () => worker()),
    );
    const all = decrypted.filter(Boolean);
    const meta = all.find((e) => isFoldersMetaEntry(e));
    state.foldersMetaEntryId = meta?.id || null;
    state.folders = meta ? foldersFromMetaEntry(meta) : [];
    state.entries = all.filter((e) => !isVaultMetaEntry(e));
    if (state.folderFilter !== 'all' && state.folderFilter !== 'none'
        && !state.folders.some((f) => f.id === state.folderFilter)) {
      state.folderFilter = 'all';
    }
    deps.syncFolderFilterButtons();
    deps.populateFolderSelect();
  }

  function getFilteredEntries() {
    return deps.filterEntriesByQuery(state.entries, state.search);
  }

  function refreshCurrentView() {
    if (state.page === 'dashboard') renderDashboard();
    else if (state.page === 'vault') renderEntries();
    else if (state.page === 'projects') deps.renderProjectsPage();
    else if (state.page === 'project-detail') deps.renderProjectDetailPage();
    else if (state.page === 'shares-received') deps.renderSharesReceived();
    else if (state.page === 'shares-sent') deps.renderSharesSent();
    else if (state.page === 'contacts') deps.renderContactsPage();
    else if (state.page === 'profile') deps.renderProfile();
  }

  function updateEntryCounts() {
    $('#entry-count').textContent = state.entries.length;
    $('#nav-count-all').textContent = state.entries.length;
    const projectsCount = $('#nav-count-projects');
    if (projectsCount) projectsCount.textContent = state.folders.length;
    const recv = $('#nav-count-received');
    const sent = $('#nav-count-sent');
    const contacts = $('#nav-count-contacts');
    if (recv) recv.textContent = state.sharesReceived.length;
    if (sent) sent.textContent = state.sharesSent.length;
    if (contacts) contacts.textContent = deps.getShareContacts().length;
  }

  async function loadShares() {
    if (state.devMode || !state.token || !state.privateKey) {
      state.sharesReceived = [];
      state.sharesSent = [];
      updateEntryCounts();
      return;
    }
    const [rawReceived, rawSent] = await Promise.all([
      api.getSharesReceived(state.token),
      api.getSharesSent(state.token),
    ]);

    state.sharesReceived = [];
    for (const s of rawReceived) {
      try {
        const data = await decryptFromSender(fromB64(s.encrypted_data), state.privateKey);
        state.sharesReceived.push({
          ...prepareEntry(data),
          id: s.id,
          shareId: s.id,
          isShare: true,
          share_note: (data.share_note || '').trim(),
          sender_email: s.sender_email,
          sender_display_name: s.sender_display_name,
          created_at: s.created_at,
        });
      } catch (err) {
        console.warn('Partage reçu ignoré:', s.id, err);
      }
    }

    state.sharesSent = rawSent.map((s) => {
      const entry = state.entries.find((e) => e.id === s.entry_id);
      return {
        id: s.id,
        shareId: s.id,
        entry_id: s.entry_id,
        title: entry?.title || 'Clé partagée',
        username: entry?.username || s.recipient_email,
        url: entry?.url || '',
        password: entry?.password || '',
        recipient_email: s.recipient_email,
        recipient_display_name: s.recipient_display_name,
        created_at: s.created_at,
        isShare: true,
        isSent: true,
      };
    });

    deps.syncContactsFromShares();

    updateEntryCounts();
    if (state.page === 'shares-received' || state.page === 'shares-sent' || state.page === 'contacts') {
      refreshCurrentView();
    }
  }

  function getDashboardEntries() {
    const list = deps.filterEntriesByQuery(state.entries, state.dashSearch);
    if (state.dashTab === 'az') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }));
    }
    if (state.dashTab === 'popular') {
      // Sites avec URL / favicon d’abord, puis récents
      return [...list].sort((a, b) => {
        const score = (e) => (getSiteDomain(e.url) ? 2 : 0) + (deps.entryType(e) === 'login' ? 1 : 0);
        const diff = score(b) - score(a);
        if (diff) return diff;
        return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0);
      });
    }
    return [...list].sort(
      (a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
    );
  }

  function dashTileMetaMarkup(entry) {
    const badges = [];
    if (deps.entryType(entry) === 'api_key') badges.push('<span class="dash-tile-badge">API</span>');
    if (deps.entryType(entry) === 'ssh_key') badges.push('<span class="dash-tile-badge dash-tile-badge-ssh">SSH</span>');
    const folder = folderNameById(state.folders, entryFolderId(entry));
    const project = folder
      ? `<span class="dash-tile-meta"><span class="dash-tile-project">${esc(folder)}</span></span>`
      : '';
    // Badges en absolute (coin) — le bandeau meta ne porte que le projet
    return `${badges.join('')}${project}`;
  }

  function renderDashboard() {
    updateEntryCounts();
    deps.syncTypeFilterButtons();
    deps.syncFolderFilterButtons();
    deps.syncAddEntryButtonLabels();
    deps.syncTransferEntryButtons();
    const entries = getDashboardEntries();
    const grid = $('#dash-tiles-grid');
    const empty = $('#dash-tiles-empty');

    $$('.dash-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.dashTab === state.dashTab);
    });

    if (entries.length === 0 && state.entries.length === 0) {
      setHtml(grid, `
        <button type="button" class="dash-tile dash-tile-add dash-tile-add-hero" id="dash-tile-add-only">
          <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
          <span class="dash-tile-name">${esc(deps.addEntryTileLabel())}</span>
          <span class="dash-tile-add-hint">Connexion, API ou SSH</span>
        </button>`);
      empty.classList.add('hidden');
      $('#dash-tile-add-only')?.addEventListener('click', openAddModal);
      refreshIcons(grid);
      return;
    }

    if (entries.length === 0) {
      grid.replaceChildren();
      empty.classList.remove('hidden');
      const title = $('#dash-empty-title');
      const text = $('#dash-empty-text');
      if (state.dashSearch.trim()) {
        if (title) title.textContent = 'Aucun résultat';
        if (text) text.textContent = 'Essayez un autre terme, ou élargissez type / projet.';
      } else if (state.typeFilter !== 'all' || state.folderFilter !== 'all') {
        if (title) title.textContent = 'Aucune clé ici';
        if (text) text.textContent = 'Rien ne correspond à ces filtres. Changez de type ou de projet.';
      } else {
        if (title) title.textContent = 'Aucune clé';
        if (text) text.textContent = 'Ajoutez votre première clé pour commencer.';
      }
      deps.syncAddEntryButtonLabels();
      refreshIcons(empty);
      return;
    }

    empty.classList.add('hidden');
    deps.syncAddEntryButtonLabels();
    setHtml(grid, entries.map((e, i) => `
        <button type="button" class="${deps.dashTileClassName(e)}" style="${deps.dashTileStyle(e, i)}" data-action="show-entry" data-id="${esc(e.id)}" title="${esc(e.title)}">
          ${deps.dashTileIconMarkup(e)}
          <span class="dash-tile-name">${esc(e.title)}</span>
          ${dashTileMetaMarkup(e)}
        </button>`).join('') + `
      <button type="button" class="dash-tile dash-tile-add" data-action="add-entry">
        <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
        <span class="dash-tile-name">${esc(deps.addEntryTileLabel())}</span>
      </button>`);

    refreshIcons(grid);
    setupFaviconImages(grid);
  }

  function renderEntries() {
    const list = getFilteredEntries();
    const container = $('#entries-list');
    const empty = $('#entries-empty');
    const noResults = $('#entries-no-results');

    updateEntryCounts();
    deps.syncTypeFilterButtons();
    deps.syncFolderFilterButtons();
    deps.syncAddEntryButtonLabels();
    deps.syncTransferEntryButtons();

    empty.classList.add('hidden');
    noResults.classList.add('hidden');

    if (state.entries.length === 0) {
      container.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }

    if (list.length === 0) {
      container.replaceChildren();
      noResults.classList.remove('hidden');
      return;
    }

    const visibleIds = new Set(list.map((e) => e.id));
    state.selectedIds = state.selectedIds.filter((id) => visibleIds.has(id));
    const selected = new Set(state.selectedIds);

    setHtml(container, list.map((e, i) => {
      const isSelected = selected.has(e.id);
      return `
      <div class="entry-card entry-card-selectable${isSelected ? ' is-selected' : ''}" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-entry">
        <label class="entry-card-select" data-action="toggle-select" data-id="${esc(e.id)}" title="Sélectionner">
          <input type="checkbox" data-action="toggle-select" data-id="${esc(e.id)}" ${isSelected ? 'checked' : ''} aria-label="Sélectionner ${esc(e.title)}">
        </label>
        ${deps.entryAvatarMarkup(e)}
        <div class="entry-info">
          <div class="entry-title-row">
            <div class="entry-title">${esc(e.title)}</div>
            ${deps.entryTypeBadgeMarkup(e)}
            ${folderNameById(state.folders, entryFolderId(e))
              ? `<span class="entry-folder-badge">${esc(folderNameById(state.folders, entryFolderId(e)))}</span>`
              : ''}
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
    }).join(''));
    refreshIcons(container);
    setupFaviconImages(container);
  }

  function showEntry(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return;

    state.detailEntryId = id;
    deps.fillEntryDetailCommon(e);
    deps.syncDetailProjectField(e, { editable: true });
    $('#detail-share-note-field')?.classList.add('hidden');
    deps.setDetailDateMeta(e, { visible: true });
    deps.setDetailActionButtonsVisible({ edit: true, share: true, delete: true });
    openModal($('#modal-detail'));
    refreshIcons($('#modal-detail'));
  };

  async function copyPassword(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return;
    if (!(await copyToClipboard(e.password))) {
      toast('Impossible de copier — autorisez le presse-papiers ou copiez manuellement', 'error');
      return;
    }
    toast(`"${e.title}" copié`, 'success');
  };

  function openAddModal(options = {}) {
    deps.resetEntryFormModal();
    $('#form-entry').reset();
    if ($('#entry-secret-block')) $('#entry-secret-block').value = '';
    const type = deps.defaultEntryTypeFromFilter();
    deps.setEntryFormType(type);
    const folderId = options.folderId !== undefined
      ? options.folderId
      : deps.defaultFolderIdFromFilter();
    deps.populateFolderSelect(folderId || '');
    $('#modal-entry-title').textContent = deps.ENTRY_TYPES.includes(state.typeFilter)
      ? deps.addEntryModalTitle(type)
      : 'Ajouter une clé';
    $('#entry-generated').classList.add('hidden');
    openModal($('#modal-add'));
    refreshIcons($('#modal-add'));
    setTimeout(() => $('#entry-title')?.focus(), 50);
  }

  function openEditModal(entryId) {
    const e = state.entries.find((x) => x.id === entryId);
    if (!e) return;

    state.editingEntryId = entryId;
    deps.hideEntryFolderCreate();
    $('#form-entry').reset();
    const type = deps.entryType(e);
    deps.setEntryFormType(type);
    deps.populateFolderSelect(entryFolderId(e) || '');
    $('#entry-title').value = e.title;
    $('#entry-username').value = e.username || '';
    if (type === 'ssh_key') {
      if ($('#entry-secret-block')) $('#entry-secret-block').value = e.password || '';
    } else {
      $('#entry-password').value = e.password || '';
    }
    $('#entry-url').value = e.url || '';
    $('#entry-notes').value = e.notes || '';
    $('#entry-generated').classList.add('hidden');
    $('#modal-entry-title').textContent = 'Modifier la clé';
    setHtml($('#btn-save-entry'), '<i data-lucide="check-circle"></i> Mettre à jour');
    closeModal($('#modal-detail'));
    openModal($('#modal-add'));
    refreshIcons($('#modal-add'));
    setTimeout(() => $('#entry-title')?.focus(), 50);
  }

  function readEntryFormData() {
    const type = deps.normalizeEntryType($('#entry-type')?.value);
    const title = $('#entry-title').value.trim();
    const username = $('#entry-username').value.trim();
    const password = type === 'ssh_key'
      ? ($('#entry-secret-block')?.value || '').trim()
      : $('#entry-password').value;
    const urlRaw = $('#entry-url').value.trim();
    const url = type === 'ssh_key' ? urlRaw : normalizeEntryUrl(urlRaw);
    const notes = $('#entry-notes').value.trim();
    const folderId = ($('#entry-folder')?.value || '').trim();

    if (!title) {
      toast(deps.entryTitleRequiredLabel(type), 'error');
      $('#entry-title').focus();
      return null;
    }
    if (!password) {
      toast(deps.entrySecretRequiredLabel(type), 'error');
      if (type === 'ssh_key') $('#entry-secret-block')?.focus();
      else $('#entry-password').focus();
      return null;
    }

    return deps.entryEncryptedPayload({ type, title, username, password, url, notes, folderId });
  }

  function deleteEntry(id) {
    const e = state.entries.find(x => x.id === id);
    if (!e) return;
    deps.showDeleteConfirm(e, async () => {
      try {
          if (state.devMode) {
            deleteDevEntry(state.entries, id);
            if ($('#modal-detail').classList.contains('open')) {
              closeModal($('#modal-detail'));
              deps.clearDetailSecrets();
              state.detailEntryId = null;
            }
            refreshCurrentView();
            toast(`"${e.title}" supprimé`, 'info');
            return;
          }
          await api.deleteEntry(state.token, id);
          await loadEntries();
          if ($('#modal-detail').classList.contains('open')) {
            closeModal($('#modal-detail'));
            deps.clearDetailSecrets();
            state.detailEntryId = null;
          }
        refreshCurrentView();
        toast(`"${e.title}" supprimé`, 'info');
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  };

  function installVaultGlobals() {
    window.showEntry = showEntry;
    window.copyPassword = copyPassword;
    window.deleteEntry = deleteEntry;
  }

  return {
    loadEntries, loadShares, getFilteredEntries, refreshCurrentView, updateEntryCounts,
    getDashboardEntries, dashTileMetaMarkup, renderDashboard, renderEntries,
    showEntry, copyPassword, openAddModal, openEditModal, readEntryFormData, deleteEntry,
    installVaultGlobals,
  };
}
