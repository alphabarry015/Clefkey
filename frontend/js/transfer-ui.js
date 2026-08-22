/**
 * Modale de transfert de clés entre projets.
 */
import { folderNameById, entryFolderId, topLevelFolders, folderChildren } from './folders.js';
import {
  $, $$, esc, setHtml, fillSelect, toast, openModal, closeModal,
} from './ui.js';

export function createTransfer(deps) {
  const { state, refreshIcons } = deps;

  function syncTransferEntryButtons() {
    const unassignedCount = deps.getUnassignedEntries().length;
    const foldersBtn = $('#btn-folders-transfer');
    if (foldersBtn) {
      foldersBtn.disabled = unassignedCount === 0;
      foldersBtn.classList.toggle('is-disabled', unassignedCount === 0);
      foldersBtn.title = unassignedCount === 0
        ? 'Aucune clé sans projet'
        : `${unassignedCount} clé${unassignedCount > 1 ? 's' : ''} sans projet`;
    }
  }

  function populateTransferFolderSelect(selectedId = '', {
    excludeFolderId = '',
    allowUnassign = false,
  } = {}) {
    const sel = $('#transfer-folder');
    if (!sel) return;
    const valid = (f) => f.id !== excludeFolderId;
    const options = [{ value: '', label: 'Choisir une destination…' }];
    if (allowUnassign) {
      options.push({ value: '__unassign__', label: 'Sans projet' });
    }
    const walk = (f, depth) => {
      folderChildren(state.folders, f.id).filter(valid).forEach((c) => {
        options.push({ value: c.id, label: `${'— '.repeat(depth)}${c.name}` });
        walk(c, depth + 1);
      });
    };
    topLevelFolders(state.folders).filter(valid).forEach((f) => {
      options.push({ value: f.id, label: f.name });
      walk(f, 1);
    });
    const folders = state.folders.filter(valid);
    let pick = selectedId || '';
    if (!pick) {
      if (folders.length === 1) pick = folders[0].id;
      else if (folders.length === 0 && allowUnassign) pick = '__unassign__';
    }
    if (pick === '__unassign__' && allowUnassign) {
      fillSelect(sel, options, '__unassign__');
    } else if (pick && folders.some((f) => f.id === pick)) {
      fillSelect(sel, options, pick);
    } else {
      fillSelect(sel, options, '');
    }
  }

  function populateDetailFolderSelect(selectedId = '') {
    const tree = $('#detail-folder-tree');
    const hidden = $('#detail-move-folder');
    if (!tree || !hidden) return;

    const current = selectedId || '';
    const pick = current && state.folders.some((f) => f.id === current) ? current : '';
    hidden.value = pick;

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
    refreshIcons(tree);
    tree.classList.add('is-collapsed');
    tree.classList.remove('is-open');
    syncDetailProjectPicker(pick);
    syncDetailMoveButton();
  }

  function syncDetailProjectPicker(folderId) {
    const pickerName = $('#detail-project-picker-name');
    const picker = $('#detail-project-picker');
    if (pickerName) {
      const name = folderId ? folderNameById(state.folders, folderId) : 'Sans projet';
      pickerName.textContent = name || 'Sans projet';
    }
    if (picker) {
      picker.setAttribute('aria-expanded', 'false');
    }
  }

  function syncDetailMoveButton() {
    const hidden = $('#detail-move-folder');
    const btn = $('#btn-detail-move-folder');
    const entry = state.entries.find((e) => e.id === state.detailEntryId);
    if (!hidden || !btn || !entry) {
      if (btn) btn.disabled = true;
      return;
    }
    const current = entryFolderId(entry) || '';
    const next = (hidden.value || '').trim();
    btn.disabled = next === current || (next !== '' && !state.folders.some((f) => f.id === next));
  }

  function syncDetailProjectField(entry, { editable = false } = {}) {
    const field = $('#detail-project-field');
    const hint = $('#detail-project-hint');
    if (!field) return;
    if (!editable || entry?.isShare) {
      field.classList.add('hidden');
      return;
    }
    field.classList.remove('hidden');
    populateDetailFolderSelect(entryFolderId(entry) || '');
    const hasFolder = !!folderNameById(state.folders, entryFolderId(entry));
    hint?.classList.toggle('hidden', hasFolder || state.folders.length === 0);
    if (hint && !hasFolder && state.folders.length === 0) {
      hint.textContent = 'Créez d’abord un projet pour y ranger cette clé.';
    } else if (hint && !hasFolder) {
      hint.textContent = 'Assignez cette clé à un projet pour l’organiser.';
    }
  }

  function updateTransferSelectionUi() {
    const boxes = Array.from(document.querySelectorAll('#transfer-entry-list input[type="checkbox"]'));
    const checked = boxes.filter((b) => b.checked);
    const countEl = $('#transfer-selection-count');
    const n = checked.length;
    if (countEl) {
      countEl.textContent = n <= 1 ? `${n} sélectionnée` : `${n} sélectionnées`;
    }
    const all = $('#transfer-select-all');
    if (all) {
      all.checked = boxes.length > 0 && checked.length === boxes.length;
      all.indeterminate = checked.length > 0 && checked.length < boxes.length;
    }
    const folderVal = ($('#transfer-folder')?.value || '').trim();
    const submit = $('#btn-transfer-submit');
    // Destination valide : projet choisi OU « Sans projet »
    const destOk = folderVal === '__unassign__' || (folderVal !== '' && folderVal !== '__unassign__');
    if (submit) submit.disabled = n === 0 || !destOk;
  }

  function renderTransferEntryList(entries) {
    const list = $('#transfer-entry-list');
    const empty = $('#transfer-empty');
    if (!list) return;
    const items = Array.isArray(entries) ? entries : deps.getUnassignedEntries();
    if (items.length === 0) {
      list.replaceChildren();
      empty?.classList.remove('hidden');
      if (empty) {
        empty.textContent = state.transferAllowUnassign
          ? 'Aucune clé à transférer.'
          : 'Aucune clé sans projet.';
      }
      updateTransferSelectionUi();
      return;
    }
    empty?.classList.add('hidden');
    setHtml(list, items.map((e) => `
      <li class="transfer-entry-item">
        <label class="transfer-entry-item-label">
          <input type="checkbox" value="${esc(e.id)}" checked>
          <span class="transfer-entry-info">
            <span class="transfer-entry-title">${esc(e.title)}</span>
            <span class="transfer-entry-meta">${esc(deps.entryTypeLabel(deps.entryType(e)))}</span>
          </span>
        </label>
      </li>
    `).join(''));
    updateTransferSelectionUi();
  }

  function openTransferModal({
    preselectIds = null,
    preferredFolderId = '',
    entries = null,
    allowUnassign = false,
    excludeFolderId = '',
    hint = '',
    emptyMessage = '',
  } = {}) {
    try {
      const listEntries = Array.isArray(entries) ? entries : deps.getUnassignedEntries();
      state.transferAllowUnassign = !!allowUnassign;
      state.transferExcludeFolderId = excludeFolderId || '';

      if (!allowUnassign && state.folders.length === 0) {
        toast('Créez d’abord un projet', 'info');
        deps.openProjectsPage();
        return;
      }

      if (listEntries.length === 0) {
        toast(
          allowUnassign
            ? 'Aucune clé à transférer'
            : 'Toutes vos clés sont déjà dans un projet',
          'info',
        );
        return;
      }

      const destFolders = state.folders.filter((f) => f.id !== excludeFolderId);
      if (!allowUnassign && destFolders.length === 0) {
        toast('Aucun projet de destination disponible', 'info');
        return;
      }

      const hintEl = $('#transfer-hint');
      if (hintEl) {
        hintEl.textContent = hint
          || (allowUnassign
            ? 'Sélectionnez les clés, puis choisissez le projet de destination (ou Sans projet).'
            : 'Sélectionnez les clés sans projet, puis choisissez le projet de destination.');
      }
      const empty = $('#transfer-empty');
      if (empty && emptyMessage) empty.textContent = emptyMessage;

      const modal = $('#modal-transfer');
      if (!modal) {
        toast('Modale de transfert introuvable — rechargez la page (Ctrl+Shift+R)', 'error');
        return;
      }

      populateTransferFolderSelect(preferredFolderId, { excludeFolderId, allowUnassign });
      renderTransferEntryList(listEntries);
      if (Array.isArray(preselectIds) && preselectIds.length) {
        const set = new Set(preselectIds.map(String));
        Array.from(document.querySelectorAll('#transfer-entry-list input[type="checkbox"]')).forEach((box) => {
          box.checked = set.has(String(box.value));
        });
      }
      updateTransferSelectionUi();
      closeModal($('#modal-folders'));
      openModal(modal);
      refreshIcons(modal);
    } catch (err) {
      console.error('openTransferModal', err);
      toast(err?.message || 'Impossible d’ouvrir le transfert', 'error');
    }
  }

  function openProjectDetailTransfer() {
    try {
      const folderId = state.activeProjectId;
      if (!folderId) {
        toast('Ouvrez d’abord un projet', 'error');
        return;
      }
      const selected = (state.projectDetailSelectedIds || []).map(String);
      const inProject = deps.getProjectDetailEntries();
      const sourceEntries = selected.length
        ? inProject.filter((e) => selected.includes(String(e.id)))
        : inProject;
      if (!sourceEntries.length) {
        toast('Aucune clé à transférer dans ce projet', 'info');
        return;
      }
      openTransferModal({
        entries: sourceEntries,
        preselectIds: sourceEntries.map((e) => String(e.id)),
        allowUnassign: true,
        excludeFolderId: folderId,
        hint: 'Choisissez le projet de destination (ou Sans projet), puis validez.',
        emptyMessage: 'Aucune clé dans ce projet.',
      });
    } catch (err) {
      console.error('openProjectDetailTransfer', err);
      toast(err?.message || 'Transfert impossible', 'error');
    }
  }

  return {
    syncTransferEntryButtons,
    populateTransferFolderSelect,
    populateDetailFolderSelect,
    syncDetailMoveButton,
    syncDetailProjectField,
    updateTransferSelectionUi,
    renderTransferEntryList,
    openTransferModal,
    openProjectDetailTransfer,
  };
}
