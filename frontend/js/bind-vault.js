/**
 * Listeners coffre : navigation listes, détail, formulaire clé, modales.
 */
import {
  toB64, encryptData, generatePassword, generateSshEd25519KeyPair,
} from './crypto.js';
import { api } from './api.js';
import { createDevEntry, updateDevEntry } from './dev.js';
import { preloadFavicon } from './favicon.js';
import { downloadEntriesTxt, downloadEntriesPdf } from './export-entries.js';
import { copyToClipboard } from './compat.js';
import { setLucideIcon } from './icons.js';
import {
  $, $$, EMPTY_VALUE, debounce, toast, showLoading, hideLoading,
  openModal, closeModal, copyText, setHtml,
} from './ui.js';

export function bindVault(deps) {
  const {
    state,
    renderDashboard, renderEntries, setViewMode, renderContactsPage,
    openAddModal, openEditModal, readEntryFormData, resetEntryFormModal,
    setEntryFormType, syncTypeFilterButtons, syncAddEntryButtonLabels,
    syncFolderFilterButtons, refreshCurrentView, loadEntries,
    openShareModal, entryType,
    requestMasterPasswordConfirmation, showEntry,
    clearDetailSecrets, closeAllModals, settleMasterConfirm,
    isRecoveryKeysModalOpen, closeModal: _cm, openModal: _om,
    switchPage, collapseSidebar, isMobileLayout, lockVault,
  } = deps;
  void _cm; void _om;

  function resolveEventElement(event) {
    const t = event.target;
    if (t instanceof Element) return t;
    if (t && t.parentElement) return t.parentElement;
    if (typeof event.composedPath === 'function') {
      for (const node of event.composedPath()) {
        if (node instanceof Element) return node;
      }
    }
    return null;
  }

  function handleEntryClick(event) {
    const target = resolveEventElement(event);
    if (!target) return;

    const root = target.closest(
      '#dashboard-view, #dash-tiles-grid, #entries-list, #project-detail-list, '
      + '#shares-received-list, #shares-sent-list, #contacts-list, '
      + '#contacts-detail-shares, #share-pick-entry-list, #share-contacts-chips',
    );
    if (!root) return;

    const actionEl = target.closest('[data-action]');
    if (!actionEl || !root.contains(actionEl)) return;

    const action = actionEl.dataset.action;
    const id = actionEl.dataset.id
      || actionEl.closest('[data-id]')?.dataset.id;
    const email = actionEl.dataset.email;

    if (action === 'show-entry' && id) {
      window.showEntry(id);
      return;
    }
    if (action === 'show-contact' && email) {
      state.contactsSelectedEmail = email;
      renderContactsPage();
      return;
    }
    if (action === 'pick-share-contact' && email) {
      event.preventDefault();
      if ($('#share-email')) $('#share-email').value = email;
      $('#share-note')?.focus();
      return;
    }
    if (action === 'pick-share-entry' && id) {
      event.preventDefault();
      closeModal($('#modal-share-pick-entry'));
      openShareModal(id, { email: state.sharePrefillEmail || '' });
      return;
    }
    if (action === 'show-share-received' && id) {
      window.showShareReceived(id);
      return;
    }
    if (action === 'show-share-sent' && id) {
      window.showShareSent(id);
      return;
    }
    if (action === 'copy-password' && id) {
      event.stopPropagation();
      window.copyPassword(id);
      return;
    }
    if (action === 'copy-share-received' && id) {
      event.stopPropagation();
      const e = state.sharesReceived.find((x) => x.id === id);
      if (e?.password) {
        copyToClipboard(e.password).then((ok) => {
          toast(ok ? `"${e.title}" copié` : 'Impossible de copier', ok ? 'success' : 'error');
        }).catch(() => toast('Impossible de copier', 'error'));
      }
      return;
    }
    if (action === 'delete-entry' && id) {
      event.stopPropagation();
      window.deleteEntry(id);
      return;
    }
    if (action === 'delete-share' && id) {
      event.stopPropagation();
      window.deleteShare(id);
      return;
    }
    if (action === 'add-entry') {
      openAddModal();
      return;
    }
    if (action === 'dash-stat' || action === 'dash-action') {
      const target = actionEl.dataset.target;
      if (!target) return;
      if (action === 'dash-action' && target === 'new-key') {
        openAddModal();
        return;
      }
      if (action === 'dash-action' && (target === 'password' || target === 'passphrase')) {
        switchPage('generator');
        const tab = document.querySelector(`#generator-view [data-gen-mode="${target}"]`);
        if (tab) tab.click();
        return;
      }
      const pageMap = {
        vault: 'vault',
        projects: 'projects',
        contacts: 'contacts',
        'shares-received': 'shares-received',
        password: 'generator',
        passphrase: 'generator',
        audit: 'audit',
        project: 'projects',
      };
      const page = pageMap[target];
      if (page) switchPage(page);
      return;
    }
  }

  document.addEventListener('click', handleEntryClick);

  $$('.view-mode-btn[data-view-mode]').forEach((btn) => {
    btn.addEventListener('click', () => setViewMode(btn.dataset.viewMode));
  });


  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (!page) return;
      switchPage(page);
      if (isMobileLayout()) collapseSidebar();
    });
  });

  $('#btn-entries-empty-add')?.addEventListener('click', openAddModal);

  const debouncedRenderEntries = debounce(() => renderEntries());

  $('#btn-profile-sidebar').addEventListener('click', () => {
    switchPage('profile');
  });

  $('#btn-profile-lock').addEventListener('click', () => lockVault('manual'));

  /** Export local de toutes les clés du compte (jamais les partages reçus). */
  async function exportAllEntries(format) {
    const entries = state.entries.filter((e) => !e.isShare);
    if (!entries.length) {
      toast('Aucune clé à exporter', 'info');
      return;
    }
    const confirmed = await requestMasterPasswordConfirmation();
    if (!confirmed) {
      toast('Export annulé', 'info');
      return;
    }
    showLoading('Préparation de l\'export...');
    try {
      const meta = { email: state.user?.email || '', folders: state.folders };
      if (format === 'pdf') await downloadEntriesPdf(entries, meta);
      else downloadEntriesTxt(entries, meta);
      toast(`Export ${format.toUpperCase()} téléchargé — conservez-le hors ligne`, 'success');
    } catch (err) {
      toast(err.message || 'Export impossible', 'error');
    } finally {
      hideLoading();
    }
  }

  $('#btn-profile-export-txt')?.addEventListener('click', () => exportAllEntries('txt'));
  $('#btn-profile-export-pdf')?.addEventListener('click', () => exportAllEntries('pdf'));

  $('#btn-copy-profile-email').addEventListener('click', async () => {
    const email = $('#profile-detail-email').textContent;
    if (!email || email === EMPTY_VALUE) return;
    if (!(await copyText(email, $('#btn-copy-profile-email')))) return;
    toast('Email copié', 'success');
  });

  $('#btn-copy-profile-id').addEventListener('click', async () => {
    const id = $('#profile-detail-id').dataset.full;
    if (!id) return;
    if (!(await copyText(id, $('#btn-copy-profile-id')))) return;
    toast('Identifiant copié', 'success');
  });

  $('#search-input').addEventListener('input', (e) => {
    state.search = e.target.value;
    $('#btn-clear-search').classList.toggle('hidden', !state.search);
    debouncedRenderEntries();
  });

  $('#btn-clear-search').addEventListener('click', () => {
    $('#search-input').value = '';
    state.search = '';
    $('#btn-clear-search').classList.add('hidden');
    renderEntries();
  });

  $('#btn-edit-detail')?.addEventListener('click', () => {
    if (!state.detailEntryId) return;
    openEditModal(state.detailEntryId);
  });

  $('#btn-share-detail')?.addEventListener('click', () => {
    if (!state.detailEntryId) return;
    openShareModal(state.detailEntryId);
  });

  $('#btn-delete-detail').addEventListener('click', () => {
    if (!state.detailEntryId) return;
    window.deleteEntry(state.detailEntryId);
  });

  $('#btn-toggle-pwd').addEventListener('click', () => {
    const el = $('#detail-password');
    const icon = $('#btn-toggle-pwd').querySelector('[data-lucide], .lucide');
    const visible = el.dataset.visible === 'true';
    el.textContent = visible ? '••••••••••••' : el.dataset.real;
    el.dataset.visible = visible ? 'false' : 'true';
    if (icon) setLucideIcon(icon, visible ? 'eye' : 'eye-off');
  });

  $('#btn-copy-detail').addEventListener('click', async () => {
    const entry = state.entries.find((x) => x.id === state.detailEntryId)
      || state.sharesReceived.find((x) => x.id === state.detailEntryId);
    const type = entry ? entryType(entry) : 'login';
    if (type === 'oauth') {
      toast('Pas de mot de passe — connexion via le fournisseur', 'info');
      return;
    }
    if (!(await copyText($('#detail-password').dataset.real, $('#btn-copy-detail')))) return;
    const msg = type === 'ssh_key'
      ? 'Clé copiée'
      : type === 'api_key'
        ? 'Secret copié'
        : 'Mot de passe copié';
    toast(msg, 'success');
  });

  $$('.btn-copy-field[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = document.getElementById(btn.dataset.copy).textContent;
      if (!(await copyText(text, btn))) return;
      toast('Copié', 'success');
    });
  });

  $('#btn-close-detail').addEventListener('click', () => {
    closeModal($('#modal-detail'));
    clearDetailSecrets();
    state.detailEntryId = null;
  });

  $('#btn-add-sidebar').addEventListener('click', () => {
    openAddModal();
    if (window.innerWidth <= 900) collapseSidebar();
  });
  $('#fab-add').addEventListener('click', openAddModal);
  $('#btn-close-add').addEventListener('click', () => {
    resetEntryFormModal();
    closeModal($('#modal-add'));
  });

  $('#btn-generate').addEventListener('click', () => {
    const pwd = generatePassword(20);
    $('#entry-password').value = pwd;
    $('#entry-generated').textContent = pwd;
    $('#entry-generated').classList.remove('hidden');
  });

  $('#btn-generate-ssh')?.addEventListener('click', async () => {
    const btn = $('#btn-generate-ssh');
    if (btn) btn.disabled = true;
    try {
      const comment = ($('#entry-username')?.value || '').trim()
        || ($('#entry-title')?.value || '').trim()
        || 'clefkey';
      const pair = await generateSshEd25519KeyPair(comment);
      if ($('#entry-secret-block')) $('#entry-secret-block').value = pair.privateKey;
      $('#entry-generated')?.classList.add('hidden');
      toast('Clé Ed25519 générée', 'success');
    } catch (err) {
      toast(err.message || 'Génération SSH impossible', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.querySelector('#entry-type-menu')?.addEventListener('click', (e) => {
    const option = e.target.closest('.entry-type-option[data-entry-type]');
    if (!option) return;
    setEntryFormType(option.dataset.entryType);
    const menu = $('#entry-type-menu');
    const picker = $('#entry-type-picker');
    menu?.classList.add('is-collapsed');
    picker?.setAttribute('aria-expanded', 'false');
  });

  $('#entry-type-picker')?.addEventListener('click', () => {
    const menu = $('#entry-type-menu');
    const picker = $('#entry-type-picker');
    if (!menu || !picker) return;
    const shouldOpen = menu.classList.contains('is-collapsed');
    menu.classList.toggle('is-collapsed', !shouldOpen);
    picker.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    if (shouldOpen) {
      $('#entry-folder-tree')?.classList.add('is-collapsed');
      $('#entry-folder-picker')?.setAttribute('aria-expanded', 'false');
    }
  });

  $('#entry-oauth-providers')?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-oauth-provider]');
    if (!chip) return;
    const title = $('#entry-title');
    if (title) title.value = chip.dataset.oauthProvider || title.value;
  });

  $$('.type-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.typeFilter = btn.dataset.typeFilter || 'all';
      syncTypeFilterButtons();
      syncAddEntryButtonLabels();
      refreshCurrentView();
    });
  });

  document.addEventListener('click', (e) => {
    const folderBtn = e.target.closest('.folder-filter[data-folder-filter]');
    if (!folderBtn || folderBtn.classList.contains('folder-filter-manage')) return;
    if (!folderBtn.closest('.folder-filters')) return;
    state.folderFilter = folderBtn.dataset.folderFilter || 'all';
    syncFolderFilterButtons();
    refreshCurrentView();
  });

  $('#form-entry').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = readEntryFormData();
    if (!data) return;

    const btn = $('#btn-save-entry');
    const editingId = state.editingEntryId;
    btn.disabled = true;
    try {
      if (state.devMode) {
        if (editingId) {
          updateDevEntry(state.entries, editingId, data);
        } else {
          createDevEntry(state.entries, data);
        }
        if (data.url) void preloadFavicon(data.url);
        refreshCurrentView();
        closeModal($('#modal-add'));
        resetEntryFormModal();
        toast(editingId ? `"${data.title}" mis à jour` : `"${data.title}" ajouté`, 'success');
        if (editingId && state.detailEntryId === editingId) {
          showEntry(editingId);
        }
        return;
      }

      if (editingId) {
        const confirmed = await requestMasterPasswordConfirmation();
        if (!confirmed) {
          toast('Mise à jour annulée', 'info');
          return;
        }
        const encrypted = await encryptData(data, state.vaultKey);
        await api.updateEntry(state.token, editingId, toB64(encrypted));
        await loadEntries();
        if (data.url) void preloadFavicon(data.url);
        refreshCurrentView();
        closeModal($('#modal-add'));
        resetEntryFormModal();
        toast(`"${data.title}" mis à jour`, 'success');
        if (state.detailEntryId === editingId) {
          showEntry(editingId);
        }
        return;
      }

      const encrypted = await encryptData(data, state.vaultKey);
      await api.createEntry(state.token, toB64(encrypted));
      await loadEntries();
      if (data.url) void preloadFavicon(data.url);
      refreshCurrentView();
      closeModal($('#modal-add'));
      resetEntryFormModal();
      toast(`"${data.title}" ajouté`, 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── Modales ──────────────────────────────────────────────

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (isRecoveryKeysModalOpen()) {
        toast('Confirmez d’abord avoir sauvegardé vos 7 clés', 'error');
        return;
      }
      closeAllModals();
    }
  });

  $$('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target !== overlay) return;
      const modal = overlay.closest('.modal');
      if (modal?.id === 'modal-recovery-keys') {
        toast('Confirmez d’abord avoir sauvegardé vos 7 clés', 'error');
        return;
      }
      if (modal?.id === 'modal-master-confirm') {
        settleMasterConfirm(false);
        return;
      }
      if (modal?.id === 'modal-detail') {
        clearDetailSecrets();
        state.detailEntryId = null;
      }
      closeModal(modal);
    });
  });
}
