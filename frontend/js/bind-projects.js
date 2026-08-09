/**
 * Listeners projets / transfert / dossiers.
 */
import {
  normalizeFolderName, normalizeFoldersList, folderNameById,
} from './folders.js';
import {
  $, $$, toast, showLoading, hideLoading, openModal, closeModal,
} from './ui.js';

export function bindProjects(deps) {
  const {
    state,
    switchPage, openProjectsPage, openProjectPage, openProjectDetailTransfer,
    createFolderByName, deleteFolder, persistFoldersMeta, openAddModal, openFoldersModal,
    moveFolderToParent, openCreateSubprojectModal, openMoveProjectModal, syncMoveProjectPreview,
    syncFolderFilterButtons, populateFolderSelect, renderFoldersManageList,
    refreshCurrentView, getProjectDetailEntries,
    clearProjectDetailSelection, syncProjectDetailSelectionUi,
    toggleProjectDetailSelection, renderProjectDetailPage,
    openTransferModal, updateTransferSelectionUi, assignEntriesToFolder,
    syncTransferEntryButtons, setEntryFolder, syncDetailMoveButton,
    syncDetailProjectField, fillEntryDetailCommon,
    showEntryFolderCreate, hideEntryFolderCreate,
  } = deps;

  async function promptRenameFolder(folderId) {
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;
    const name = normalizeFolderName(
      window.prompt('Nouveau nom du projet', folder.name) || '',
    );
    if (!name || name === folder.name) return;
    if (state.folders.some((f) => f.id !== folderId
      && (f.parentId || '') === (folder.parentId || '')
      && f.name.toLowerCase() === name.toLowerCase())) {
      toast('Ce projet existe déjà', 'error');
      return;
    }
    try {
      state.folders = normalizeFoldersList(
        state.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
      );
      await persistFoldersMeta();
      syncFolderFilterButtons();
      populateFolderSelect();
      renderFoldersManageList();
      refreshCurrentView();
      toast('Projet renommé', 'success');
    } catch (err) {
      toast(err.message || 'Renommage impossible', 'error');
    }
  }

  $('#btn-dash-create-project')?.addEventListener('click', openProjectsPage);
  $('#btn-close-folders')?.addEventListener('click', () => closeModal($('#modal-folders')));

  const closeSubprojectModal = () => {
    state.subprojectParentId = null;
    closeModal($('#modal-subproject'));
  };
  const closeMoveProjectModal = () => {
    state.moveProjectId = null;
    closeModal($('#modal-move-project'));
  };

  $('#btn-close-subproject')?.addEventListener('click', closeSubprojectModal);
  $('#btn-subproject-cancel')?.addEventListener('click', closeSubprojectModal);
  $('#btn-close-move-project')?.addEventListener('click', closeMoveProjectModal);
  $('#btn-move-project-cancel')?.addEventListener('click', closeMoveProjectModal);
  $('#move-project-parent')?.addEventListener('change', () => syncMoveProjectPreview());

  $('#form-subproject')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parentId = state.subprojectParentId;
    if (!parentId) return;
    const btn = $('#btn-subproject-submit');
    if (btn) btn.disabled = true;
    try {
      const folder = await createFolderByName($('#subproject-name')?.value, { parentId });
      if (folder) closeSubprojectModal();
    } catch (err) {
      toast(err.message || 'Création impossible', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#form-move-project')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const folderId = state.moveProjectId;
    if (!folderId) return;
    const btn = $('#btn-move-project-submit');
    if (btn) btn.disabled = true;
    try {
      const ok = await moveFolderToParent(folderId, ($('#move-project-parent')?.value || '').trim());
      if (ok) closeMoveProjectModal();
    } catch (err) {
      toast(err.message || 'Déplacement impossible', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#form-project-page-create')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btn-project-page-create');
    if (btn) btn.disabled = true;
    try {
      const folder = await createFolderByName($('#project-page-new-name')?.value);
      if (folder && $('#project-page-new-name')) $('#project-page-new-name').value = '';
    } catch (err) {
      toast(err.message || 'Impossible de créer le projet', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#btn-project-detail-back')?.addEventListener('click', () => switchPage('projects'));
  $('#btn-project-detail-add')?.addEventListener('click', () => {
    openAddModal({ folderId: state.activeProjectId || '' });
  });
  $('#btn-project-detail-add-empty')?.addEventListener('click', () => {
    openAddModal({ folderId: state.activeProjectId || '' });
  });

  // Délégation : résiste au re-render / cache SW partiel
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#btn-project-detail-transfer');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    openProjectDetailTransfer();
  });

  $('#btn-project-detail-select-clear')?.addEventListener('click', clearProjectDetailSelection);
  $('#project-detail-select-all')?.addEventListener('change', (e) => {
    const checked = !!e.target.checked;
    const ids = getProjectDetailEntries().map((entry) => entry.id);
    state.projectDetailSelectedIds = checked ? ids : [];
    syncProjectDetailSelectionUi();
  });

  $('#project-detail-list')?.addEventListener('change', (e) => {
    const box = e.target.closest('input[data-action="toggle-select"]');
    if (!box) return;
    toggleProjectDetailSelection(box.dataset.id, box.checked);
  });

  $('#project-detail-search-input')?.addEventListener('input', (e) => {
    state.projectDetailSearch = e.target.value;
    $('#btn-clear-project-detail-search')?.classList.toggle('hidden', !e.target.value);
    if (state.page === 'project-detail') renderProjectDetailPage();
  });

  $('#btn-clear-project-detail-search')?.addEventListener('click', () => {
    state.projectDetailSearch = '';
    const input = $('#project-detail-search-input');
    if (input) input.value = '';
    $('#btn-clear-project-detail-search')?.classList.add('hidden');
    if (state.page === 'project-detail') renderProjectDetailPage();
  });

  $('#projects-grid')?.addEventListener('click', async (e) => {
    const toggleSubs = e.target.closest('[data-action="toggle-subs"]');
    if (toggleSubs) {
      const parentId = toggleSubs.dataset.parentId;
      const set = new Set(state.collapsedProjectIds || []);
      if (set.has(parentId)) set.delete(parentId);
      else set.add(parentId);
      state.collapsedProjectIds = [...set];
      const box = toggleSubs.closest('.project-subs');
      box?.classList.toggle('is-collapsed', set.has(parentId));
      toggleSubs.setAttribute('aria-expanded', set.has(parentId) ? 'false' : 'true');
      return;
    }

    const card = e.target.closest('.project-sub-item[data-folder-id], .project-row[data-folder-id], .project-card[data-folder-id]');
    if (!card) return;
    const folderId = card.dataset.folderId;
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;

    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action || action === 'open-project') {
      openProjectPage(folderId);
      return;
    }

    if (action === 'toggle-create-subproject') {
      openCreateSubprojectModal(folderId);
      return;
    }

    if (action === 'toggle-move-project') {
      openMoveProjectModal(folderId);
      return;
    }

    if (action === 'delete-project') {
      deleteFolder(folderId);
      return;
    }

    if (action === 'rename-project') {
      await promptRenameFolder(folderId);
    }
  });

  $('#btn-project-detail-subproject')?.addEventListener('click', () => {
    if (state.activeProjectId) openCreateSubprojectModal(state.activeProjectId);
  });
  $('#btn-project-detail-move')?.addEventListener('click', () => {
    if (state.activeProjectId) openMoveProjectModal(state.activeProjectId);
  });
  $('#btn-project-detail-rename')?.addEventListener('click', () => {
    if (state.activeProjectId) void promptRenameFolder(state.activeProjectId);
  });

  $('#btn-folders-transfer')?.addEventListener('click', () => openTransferModal());
  $('#btn-close-transfer')?.addEventListener('click', () => closeModal($('#modal-transfer')));

  $('#transfer-select-all')?.addEventListener('change', (e) => {
    const checked = !!e.target.checked;
    $$('#transfer-entry-list input[type="checkbox"]').forEach((box) => {
      box.checked = checked;
    });
    updateTransferSelectionUi();
  });

  $('#transfer-entry-list')?.addEventListener('change', (e) => {
    if (e.target.matches('input[type="checkbox"]')) updateTransferSelectionUi();
  });

  $('#transfer-folder')?.addEventListener('change', updateTransferSelectionUi);

  $('#btn-transfer-submit')?.addEventListener('click', async () => {
    const ids = $$('#transfer-entry-list input[type="checkbox"]:checked').map((b) => b.value);
    const rawDest = ($('#transfer-folder')?.value || '').trim();
    const folderId = rawDest === '__unassign__' ? '' : rawDest;
    const btn = $('#btn-transfer-submit');
    if (!ids.length) {
      toast('Sélectionnez au moins une clé', 'error');
      return;
    }
    if (!rawDest) {
      toast('Choisissez une destination', 'error');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      showLoading(folderId ? 'Transfert vers le projet...' : 'Retrait du projet...');
      const count = await assignEntriesToFolder(ids, folderId);
      const name = folderId ? (folderNameById(state.folders, folderId) || 'projet') : null;
      closeModal($('#modal-transfer'));
      state.projectDetailSelectedIds = state.projectDetailSelectedIds.filter((id) => !ids.includes(id));
      syncTransferEntryButtons();
      refreshCurrentView();
      toast(
        name
          ? (count <= 1
            ? `1 clé déplacée vers « ${name} »`
            : `${count} clés déplacées vers « ${name} »`)
          : (count <= 1
            ? '1 clé retirée du projet'
            : `${count} clés retirées du projet`),
        'success',
      );
    } catch (err) {
      toast(err.message || 'Transfert impossible', 'error');
    } finally {
      hideLoading();
      if (btn) btn.disabled = false;
      updateTransferSelectionUi();
    }
  });

  $('#detail-move-folder')?.addEventListener('change', syncDetailMoveButton);

  $('#btn-detail-move-folder')?.addEventListener('click', async () => {
    const entryId = state.detailEntryId;
    if (!entryId) return;
    const folderId = ($('#detail-move-folder')?.value || '').trim();
    const btn = $('#btn-detail-move-folder');
    if (btn) btn.disabled = true;
    try {
      showLoading('Mise à jour du projet...');
      await setEntryFolder(entryId, folderId);
      refreshCurrentView();
      const entry = state.entries.find((e) => e.id === entryId);
      if (entry) {
        fillEntryDetailCommon(entry);
        syncDetailProjectField(entry, { editable: true });
      }
      const name = folderNameById(state.folders, folderId);
      toast(name ? `Clé déplacée vers « ${name} »` : 'Clé retirée du projet', 'success');
      syncTransferEntryButtons();
    } catch (err) {
      toast(err.message || 'Déplacement impossible', 'error');
    } finally {
      hideLoading();
      syncDetailMoveButton();
    }
  });

  $('#btn-entry-folder-toggle')?.addEventListener('click', () => {
    const panel = $('#entry-folder-create');
    if (panel?.classList.contains('hidden')) showEntryFolderCreate();
    else hideEntryFolderCreate();
  });

  $('#btn-entry-folder-cancel')?.addEventListener('click', hideEntryFolderCreate);

  $('#btn-entry-folder-create')?.addEventListener('click', async () => {
    const btn = $('#btn-entry-folder-create');
    if (btn) btn.disabled = true;
    try {
      const folder = await createFolderByName($('#entry-folder-new-name')?.value, {
        selectInEntryForm: true,
      });
      if (folder) hideEntryFolderCreate();
    } catch (err) {
      toast(err.message || 'Impossible de créer le projet', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#entry-folder-new-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#btn-entry-folder-create')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      hideEntryFolderCreate();
    }
  });

  $('#form-folder-create')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#btn-folder-create');
    if (btn) btn.disabled = true;
    try {
      const parentId = $('#folder-new-parent')?.value || '';
      const folder = await createFolderByName($('#folder-new-name')?.value, { parentId });
      if (folder) {
        if ($('#folder-new-name')) $('#folder-new-name').value = '';
        if ($('#folder-new-parent')) $('#folder-new-parent').value = '';
      }
    } catch (err) {
      toast(err.message || 'Impossible de créer le projet', 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  $('#folders-manage-list')?.addEventListener('click', async (e) => {
    const row = e.target.closest('.folders-manage-item');
    if (!row) return;
    const folderId = row.dataset.folderId;
    const folder = state.folders.find((f) => f.id === folderId);
    if (!folder) return;

    if (e.target.closest('.folder-delete-btn')) {
      deleteFolder(folderId);
      return;
    }

    if (e.target.closest('.folder-rename-save')) {
      const input = row.querySelector('.folder-rename-input');
      const name = normalizeFolderName(input?.value);
      if (!name) {
        toast('Nom du projet requis', 'error');
        return;
      }
      if (state.folders.some((f) => f.id !== folderId && f.name.toLowerCase() === name.toLowerCase())) {
        toast('Ce projet existe déjà', 'error');
        return;
      }
      try {
        state.folders = normalizeFoldersList(
          state.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
        );
        await persistFoldersMeta();
        syncFolderFilterButtons();
        populateFolderSelect();
        renderFoldersManageList();
        refreshCurrentView();
        toast('Projet renommé', 'success');
      } catch (err) {
        toast(err.message || 'Renommage impossible', 'error');
      }
    }

    if (e.target.closest('.folder-move-save')) {
      const select = row.querySelector('.folder-move-parent');
      const newParentId = (select?.value || '').trim();
      if (newParentId === folderId) {
        toast('Un projet ne peut pas être son propre parent', 'error');
        return;
      }
      if (newParentId) {
        const target = state.folders.find((f) => f.id === newParentId);
        if (!target || target.parentId) {
          toast('Projet parent invalide', 'error');
          return;
        }
        const childIds = state.folders.filter((f) => f.parentId === folderId).map((c) => c.id);
        if (childIds.includes(newParentId)) {
          toast('Impossible de déplacer dans un sous-projet', 'error');
          return;
        }
      }
      if (state.folders.some((f) => f.id !== folderId && f.parentId === newParentId && f.name.toLowerCase() === folder.name.toLowerCase())) {
        toast('Ce nom existe déjà à cet emplacement', 'error');
        return;
      }
      try {
        state.folders = normalizeFoldersList(
          state.folders.map((f) => (f.id === folderId ? { ...f, parentId: newParentId } : f)),
        );
        await persistFoldersMeta();
        syncFolderFilterButtons();
        populateFolderSelect();
        renderFoldersManageList();
        refreshCurrentView();
        toast('Projet déplacé', 'success');
      } catch (err) {
        toast(err.message || 'Déplacement impossible', 'error');
      }
    }
  });
}
