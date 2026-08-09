/**
 * Listeners coffre : navigation listes, détail, formulaire clé, modales.
 */
import {
  toB64, encryptData, generatePassword, generateSshEd25519KeyPair,
} from './crypto.js';
import { api } from './api.js';
import { createDevEntry, updateDevEntry } from './dev.js';
import { preloadFavicon } from './favicon.js';
import { copyToClipboard } from './compat.js';
import { setLucideIcon } from './icons.js';
import {
  $, $$, EMPTY_VALUE, debounce, toast, showLoading, hideLoading,
  openModal, closeModal, copyText, setHtml,
} from './ui.js';

export function bindVault(deps) {
  const {
    state,
    renderDashboard, renderEntries, renderContactsPage,
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

    const root = target.closest('#dash-tiles-grid, #entries-list, #project-detail-list, #shares-received-list, #shares-sent-list, #contacts-list, #contacts-detail-shares, #share-pick-entry-list, #share-contacts-chips');
    if (!root) return;

    if (target.closest('.entry-card-select')) return;

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
    }
  }

  document.addEventListener('click', handleEntryClick);

  function toggleListSelection(id) {
    if (!id) return;
    const set = new Set(state.selectedIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    state.selectedIds = [...set];

    const card = $('#entries-list .entry-card[data-id="' + id + '"]');
    if (card) card.classList.toggle('is-selected', set.has(id));
    const box = card?.querySelector('input[data-action="toggle-select"]');
    if (box) box.checked = set.has(id);
  }

  $('#entries-list')?.addEventListener('change', (e) => {
    const box = e.target.closest('input[data-action="toggle-select"]');
    if (box) toggleListSelection(box.dataset.id);
  });

  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const page = btn.dataset.page;
      if (!page) return;
      switchPage(page);
      if (isMobileLayout()) collapseSidebar();
    });
  });

  $('#btn-dash-add').addEventListener('click', openAddModal);
  $('#btn-dash-add-empty').addEventListener('click', openAddModal);
  $('#btn-entries-empty-add')?.addEventListener('click', openAddModal);

  $$('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      state.dashTab = tab.dataset.dashTab;
      renderDashboard();
    });
  });

  const debouncedRenderDashboard = debounce(() => renderDashboard());
  const debouncedRenderEntries = debounce(() => renderEntries());

  $('#dash-search-input').addEventListener('input', (e) => {
    state.dashSearch = e.target.value;
    $('#btn-clear-dash-search').classList.toggle('hidden', !state.dashSearch);
    debouncedRenderDashboard();
  });

  $('#btn-clear-dash-search').addEventListener('click', () => {
    $('#dash-search-input').value = '';
    state.dashSearch = '';
    $('#btn-clear-dash-search').classList.add('hidden');
    renderDashboard();
  });

  $('#btn-profile-sidebar').addEventListener('click', () => {
    switchPage('profile');
    if (window.innerWidth <= 900) collapseSidebar();
  });

  $('#btn-profile-lock').addEventListener('click', () => lockVault('manual'));

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

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (state.token && state.page === 'vault') { $('#search-input').focus(); }
    }
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
    if (!(await copyText($('#detail-password').dataset.real, $('#btn-copy-detail')))) return;
    const entry = state.entries.find((x) => x.id === state.detailEntryId)
      || state.sharesReceived.find((x) => x.id === state.detailEntryId);
    const type = entry ? entryType(entry) : 'login';
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

  document.querySelector('.entry-type-pills')?.addEventListener('click', (e) => {
    const pill = e.target.closest('.entry-type-pill[data-entry-type]');
    if (!pill) return;
    setEntryFormType(pill.dataset.entryType);
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
