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
  prepareEntry, preloadFavicon, setupFaviconImages, normalizeEntryUrl,
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
    } else if (state.page === 'dashboard') {
      renderDashboard();
    }
  }

  function dashTileMetaMarkup(entry) {
    const badges = [];
    if (deps.entryType(entry) === 'login') {
      badges.push('<span class="dash-tile-badge dash-tile-badge-login">Connexion</span>');
    }
    if (deps.entryType(entry) === 'api_key') {
      badges.push('<span class="dash-tile-badge dash-tile-badge-api">API</span>');
    }
    if (deps.entryType(entry) === 'ssh_key') {
      badges.push('<span class="dash-tile-badge dash-tile-badge-ssh">SSH</span>');
    }
    if (deps.entryType(entry) === 'oauth') {
      badges.push('<span class="dash-tile-badge dash-tile-badge-oauth">OAuth</span>');
    }
    const folder = folderNameById(state.folders, entryFolderId(entry));
    const project = folder
      ? `<span class="dash-tile-meta"><span class="dash-tile-project">${esc(folder)}</span></span>`
      : '';
    // Badges en absolute (coin) — le bandeau meta ne porte que le projet
    return `${badges.join('')}${project}`;
  }

  function entryRecency(entry) {
    const updated = Date.parse(entry?.updated_at);
    if (Number.isFinite(updated)) return updated;
    const created = Date.parse(entry?.created_at);
    return Number.isFinite(created) ? created : 0;
  }

  function dashBarRowMarkup(label, count, pct, fillClass, action, extra) {
    const fill = fillClass ? ` ${fillClass}` : '';
    return `
      <button type="button" class="dash-bar-row" data-action="${esc(action)}" ${extra}
        title="${esc(label)}">
        <span class="dash-bar-label">${esc(label)}</span>
        <span class="dash-bar-track">
          <span class="dash-bar-fill${fill}" style="width:${pct}%"></span>
        </span>
        <span class="dash-bar-value">${count}</span>
      </button>`;
  }

  function renderDashboardRecent() {
    const grid = $('#dash-recent-grid');
    const empty = $('#dash-recent-empty');
    if (!grid || !empty) return;
    const recent = [...state.entries]
      .sort((a, b) => entryRecency(b) - entryRecency(a))
      .slice(0, 8);
    if (recent.length === 0) {
      grid.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    const markup = recent.map((e, i) => `
      <button type="button" class="${deps.dashTileClassName(e)}"
        style="${deps.dashTileStyle(e, i)}" data-action="show-entry"
        data-id="${esc(e.id)}" title="${esc(e.title)}">
        ${deps.dashTileIconMarkup(e)}
        <span class="dash-tile-name">${esc(e.title)}</span>
        ${dashTileMetaMarkup(e)}
      </button>`).join('');
    setHtml(grid, markup);
    refreshIcons(grid);
    setupFaviconImages(grid);
  }

  function renderDashboardStats() {
    const stats = $('#dash-stats-grid');
    const graphTypes = $('#dash-graph-types');
    const graphProjects = $('#dash-graph-projects');
    if (!stats) return;

    const contacts = deps.getShareContacts().length;
    const shares = state.sharesReceived.length + state.sharesSent.length;
    setHtml(stats, `
      <button type="button" class="dash-stat" data-action="dash-stat" data-target="vault"
        title="Voir toutes les clés">
        <span class="dash-stat-value">${state.entries.length}</span>
        <span class="dash-stat-label">Clés</span>
      </button>
      <button type="button" class="dash-stat" data-action="dash-stat" data-target="projects"
        title="Voir les projets">
        <span class="dash-stat-value">${state.folders.length}</span>
        <span class="dash-stat-label">Projets</span>
      </button>
      <button type="button" class="dash-stat" data-action="dash-stat" data-target="contacts"
        title="Voir les contacts">
        <span class="dash-stat-value">${contacts}</span>
        <span class="dash-stat-label">Contacts</span>
      </button>
      <button type="button" class="dash-stat" data-action="dash-stat"
        data-target="shares-received" title="Voir les partages">
        <span class="dash-stat-value">${shares}</span>
        <span class="dash-stat-label">Partages</span>
      </button>`);

    if (graphTypes) {
      const counts = { login: 0, oauth: 0, api_key: 0, ssh_key: 0 };
      for (const e of state.entries) {
        const t = deps.entryType(e);
        if (counts[t] !== undefined) counts[t] += 1;
      }
      const total = Math.max(1, state.entries.length);
      const pct = (n) => Math.round((n / total) * 100);
      setHtml(graphTypes, [
        dashBarRowMarkup('Connexions', counts.login, pct(counts.login), '',
          'dash-filter-type', 'data-type="login"'),
        dashBarRowMarkup('OAuth', counts.oauth, pct(counts.oauth), 'is-orange',
          'dash-filter-type', 'data-type="oauth"'),
        dashBarRowMarkup('API', counts.api_key, pct(counts.api_key), 'is-success',
          'dash-filter-type', 'data-type="api_key"'),
        dashBarRowMarkup('SSH', counts.ssh_key, pct(counts.ssh_key), 'is-indigo',
          'dash-filter-type', 'data-type="ssh_key"'),
      ].join(''));
    }

    if (graphProjects) {
      const perProject = state.folders
        .map((f) => ({
          id: f.id,
          name: f.name,
          count: state.entries.filter((e) => entryFolderId(e) === f.id).length,
        }))
        .filter((p) => p.count > 0)
        .sort((a, b) => b.count - a.count)
        .slice(0, 3);
      const unassigned = state.entries.filter((e) => !entryFolderId(e)).length;
      const rows = [...perProject];
      if (unassigned > 0) {
        rows.push({ id: 'none', name: 'Sans projet', count: unassigned });
      }
      if (rows.length === 0) {
        setHtml(graphProjects, '<p class="dash-graph-empty">Aucune clé pour l\'instant.</p>');
        return;
      }
      const max = Math.max(1, ...rows.map((r) => r.count));
      setHtml(graphProjects, rows.map((r) => dashBarRowMarkup(
        r.name,
        r.count,
        Math.round((r.count / max) * 100),
        '',
        'dash-open-project',
        `data-id="${esc(r.id)}"`,
      )).join(''));
    }
  }

  function renderDashboard() {
    updateEntryCounts();
    renderDashboardStats();
    renderDashboardRecent();
  }

  function entryListRowMarkup(entry, index) {
    return `
      <button
        type="button"
        class="entry-list-row"
        data-action="show-entry"
        data-id="${esc(entry.id)}"
        title="Ouvrir ${esc(entry.title)}"
        style="animation-delay:${index * 0.02}s"
      >
        <span class="entry-list-marker" aria-hidden="true"></span>
        <span class="entry-list-name">${esc(entry.title)}</span>
      </button>`;
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
    syncViewModeToggle();

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

    const isList = state.viewMode === 'list';
    const entriesMarkup = list.map((e, i) => (
      isList
        ? entryListRowMarkup(e, i)
        : `<button type="button" class="${deps.dashTileClassName(e)}"
            style="${deps.dashTileStyle(e, i)}" data-action="show-entry"
            data-id="${esc(e.id)}" title="${esc(e.title)}">
          ${deps.dashTileIconMarkup(e)}
          <span class="dash-tile-name">${esc(e.title)}</span>
          ${dashTileMetaMarkup(e)}
        </button>`
    )).join('');

    const addMarkup = isList
      ? `<button type="button" class="entry-list-row entry-list-row-add" data-action="add-entry">
          <span class="entry-list-name">${esc(deps.addEntryTileLabel())}</span>
        </button>`
      : `<button type="button" class="dash-tile dash-tile-add" data-action="add-entry">
          <span class="dash-tile-add-icon"><i data-lucide="plus"></i></span>
          <span class="dash-tile-name">${esc(deps.addEntryTileLabel())}</span>
        </button>`;

    container.classList.toggle('is-list', isList);
    setHtml(container, entriesMarkup + addMarkup);
    refreshIcons(container);
    setupFaviconImages(container);
  }

  function setViewMode(mode) {
    const next = mode === 'list' ? 'list' : 'grid';
    if (next === state.viewMode) {
      syncViewModeToggle();
      return;
    }
    state.viewMode = next;
    try { localStorage.setItem('clefkey.viewMode', next); } catch { /* ignore */ }
    syncViewModeToggle();
    if (state.page === 'vault') renderEntries();
  }

  function syncViewModeToggle() {
    $$('.view-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.viewMode === state.viewMode);
    });
    const container = $('#entries-list');
    if (container) container.classList.toggle('is-list', state.viewMode === 'list');
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
    if (deps.entryType(e) === 'oauth') {
      const email = (e.username || '').trim();
      if (!email) {
        toast('Pas de mot de passe — connexion via le fournisseur', 'info');
        return;
      }
      if (!(await copyToClipboard(email))) {
        toast('Impossible de copier — autorisez le presse-papiers ou copiez manuellement', 'error');
        return;
      }
      toast(`Email « ${e.title} » copié`, 'success');
      return;
    }
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
    if (type !== 'oauth') $('#entry-url').value = e.url || '';
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
    const urlRaw = type === 'oauth' ? '' : $('#entry-url').value.trim();
    const url = type === 'ssh_key' ? urlRaw : (type === 'oauth' ? '' : normalizeEntryUrl(urlRaw));
    const notes = $('#entry-notes').value.trim();
    const folderId = ($('#entry-folder')?.value || '').trim();

    if (!title) {
      toast(deps.entryTitleRequiredLabel(type), 'error');
      $('#entry-title').focus();
      return null;
    }
    if (type !== 'oauth' && !password) {
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
    dashTileMetaMarkup, renderDashboard, renderEntries,
    setViewMode, syncViewModeToggle,
    showEntry, copyPassword, openAddModal, openEditModal, readEntryFormData, deleteEntry,
    installVaultGlobals,
  };
}
