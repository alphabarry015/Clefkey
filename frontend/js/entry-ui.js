/**
 * UI des clés : types, labels, détail, filtres type.
 */
import { entryFolderId, folderNameById, entryInKnownFolder, isVaultMetaEntry } from './folders.js';
import { setLucideIcon } from './icons.js';
import { $, $$, EMPTY_VALUE, esc, setHtml } from './ui.js';

export function createEntryUi(deps) {
  const { state, refreshIcons } = deps;

  function formatEntryDateTime(iso) {
    if (!iso) return EMPTY_VALUE;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return EMPTY_VALUE;
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatEntryDateCompact(iso) {
    if (!iso) return EMPTY_VALUE;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return EMPTY_VALUE;
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    return d.toLocaleString('fr-FR', {
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' }),
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function entryWasUpdated(entry) {
    const created = Date.parse(entry?.created_at);
    const updated = Date.parse(entry?.updated_at);
    if (!Number.isFinite(created) || !Number.isFinite(updated)) return false;
    // Tolérance : à la création Django fixe created_at et updated_at quasi simultanément.
    return updated - created > 2000;
  }

  function setDetailDateMeta(entry, { visible = true } = {}) {
    const meta = $('#detail-date-meta');
    if (!meta) return;
    if (!visible || !entry?.created_at) {
      meta.classList.add('hidden');
      meta.removeAttribute('title');
      return;
    }
    const wasUpdated = entryWasUpdated(entry);
    const iso = wasUpdated ? entry.updated_at : entry.created_at;
    $('#detail-date-label').textContent = wasUpdated ? 'Modifiée' : 'Créée';
    $('#detail-date-value').textContent = formatEntryDateCompact(iso);
    meta.title = `${wasUpdated ? 'Modifiée' : 'Créée'} le ${formatEntryDateTime(iso)}`;
    meta.classList.toggle('is-updated', wasUpdated);
    meta.classList.remove('hidden');
  }

  function setDetailActionButtonsVisible({ edit = false, share = false, delete: del = false } = {}) {
    $('#btn-edit-detail')?.classList.toggle('hidden', !edit);
    $('#btn-share-detail')?.classList.toggle('hidden', !share);
    $('#btn-delete-detail')?.classList.toggle('hidden', !del);
  }

  function fillEntryDetailCommon(e) {
    deps.setEntryAvatar($('#detail-avatar'), e);
    applyDetailTypeLabels(e);
    $('#detail-title').textContent = e.title;
    const folderLabel = folderNameById(state.folders, entryFolderId(e));
    const badge = $('#detail-type-badge');
    // applyDetailTypeLabels already set type badge; append project hint on title area via notes of badge sibling
    let folderBadge = $('#detail-folder-badge');
    if (!folderBadge && badge?.parentElement) {
      folderBadge = document.createElement('span');
      folderBadge.id = 'detail-folder-badge';
      folderBadge.className = 'entry-folder-badge';
      badge.parentElement.appendChild(folderBadge);
    }
    if (folderBadge) {
      if (folderLabel && !e.isShare) {
        folderBadge.textContent = folderLabel;
        folderBadge.classList.remove('hidden');
      } else {
        folderBadge.classList.add('hidden');
      }
    }
    const usernameText = displayUsername(e.username);
    $('#detail-username').textContent = entryType(e) === 'oauth' && usernameText === 'none'
      ? 'Compte fournisseur'
      : usernameText;
    $('#detail-password').textContent = '••••••••••••';
    $('#detail-password').dataset.real = e.password || '';
    $('#detail-password').dataset.visible = 'false';
    $('#detail-password-field')?.classList.toggle('hidden', entryType(e) === 'oauth');
    const icon = $('#btn-toggle-pwd')?.querySelector('[data-lucide], .lucide');
    if (icon) setLucideIcon(icon, 'eye');

    const urlField = $('#detail-url-field');
    const link = $('#detail-url');
    const linkIcon = urlField?.querySelector('.field-link-icon');
    if (e.url && entryType(e) !== 'oauth') {
      urlField.classList.remove('hidden');
      link.textContent = e.url;
      if (entryType(e) === 'ssh_key' && !/^https?:\/\//i.test(e.url)) {
        link.removeAttribute('href');
        link.removeAttribute('target');
        link.classList.add('detail-url-plain');
        linkIcon?.classList.add('hidden');
      } else {
        link.href = e.url.startsWith('http') ? e.url : `https://${e.url}`;
        link.target = '_blank';
        link.rel = 'noopener';
        link.classList.remove('detail-url-plain');
        linkIcon?.classList.remove('hidden');
      }
    } else {
      urlField.classList.add('hidden');
    }

    const notesField = $('#detail-notes-field');
    if (e.notes) {
      notesField.classList.remove('hidden');
      $('#detail-notes').textContent = e.notes;
    } else {
      notesField.classList.add('hidden');
    }
  }

  function resetEntryFormModal() {
    state.editingEntryId = null;
    $('#modal-entry-title').textContent = ENTRY_TYPES.includes(state.typeFilter)
      ? addEntryModalTitle(defaultEntryTypeFromFilter())
      : 'Ajouter une clé';
    const btn = $('#btn-save-entry');
    if (btn) setHtml(btn, '<i data-lucide="check-circle"></i> Enregistrer');
    deps.hideEntryFolderCreate?.();
    const typeMenu = $('#entry-type-menu');
    const typePicker = $('#entry-type-picker');
    typeMenu?.classList.add('is-collapsed');
    typePicker?.setAttribute('aria-expanded', 'false');
  }

  function displayUsername(username) {
    const value = (username || '').trim();
    if (!value || value === EMPTY_VALUE || value === '...' || value === '…') return 'none';
    return value;
  }

  const ENTRY_TYPES = ['login', 'oauth', 'api_key', 'ssh_key'];

  function normalizeEntryType(value) {
    return ENTRY_TYPES.includes(value) ? value : 'login';
  }

  function entryType(entry) {
    return normalizeEntryType(entry?.type);
  }

  function entryTypeLabel(type) {
    const t = normalizeEntryType(type);
    if (t === 'oauth') return 'OAuth / SSO';
    if (t === 'api_key') return 'Clé API';
    if (t === 'ssh_key') return 'SSH / stockage';
    return 'Connexion';
  }

  /** Type prérempli selon le filtre actif (Tous → connexion). */
  function defaultEntryTypeFromFilter() {
    return ENTRY_TYPES.includes(state.typeFilter) ? state.typeFilter : 'login';
  }

  function addEntryModalTitle(type) {
    const t = normalizeEntryType(type);
    if (t === 'oauth') return 'Ajouter une connexion OAuth';
    if (t === 'api_key') return 'Ajouter une clé API';
    if (t === 'ssh_key') return 'Ajouter une clé SSH';
    return 'Ajouter une clé de connexion';
  }

  function addEntryActionLabel(type = null) {
    const filter = type ?? state.typeFilter;
    if (filter === 'oauth') return 'Ajouter une connexion OAuth';
    if (filter === 'api_key') return 'Ajouter une clé API';
    if (filter === 'ssh_key') return 'Ajouter une clé SSH';
    if (filter === 'login') return 'Ajouter une clé de connexion';
    return 'Ajouter une clé';
  }

  function addEntryTileLabel(type = null) {
    const filter = type ?? state.typeFilter;
    if (filter === 'oauth') return 'Nouvelle connexion OAuth';
    if (filter === 'api_key') return 'Nouvelle clé API';
    if (filter === 'ssh_key') return 'Nouvelle clé SSH';
    if (filter === 'login') return 'Nouvelle connexion';
    return 'Nouvelle clé';
  }

  function syncAddEntryButtonLabels() {
    const label = addEntryActionLabel();
    const short = state.typeFilter === 'api_key'
      ? 'Clé API'
      : state.typeFilter === 'ssh_key'
        ? 'Clé SSH'
        : state.typeFilter === 'oauth'
          ? 'OAuth'
          : state.typeFilter === 'login'
            ? 'Connexion'
            : 'Nouveau';
    $$('.add-entry-label').forEach((el) => {
      if (el.closest('#btn-dash-add')) el.textContent = short;
      else el.textContent = label;
    });
  }

  function entryTypeBadgeMarkup(entry) {
    const type = entryType(entry);
    return `<span class="entry-type-badge entry-type-badge-${type}">${esc(entryTypeLabel(type))}</span>`;
  }

  function entrySecretRequiredLabel(type) {
    const t = normalizeEntryType(type);
    if (t === 'oauth') return '';
    if (t === 'api_key') return 'Le secret / API key est requis';
    if (t === 'ssh_key') return 'La clé privée / secret de stockage est requis';
    return 'Le mot de passe est requis';
  }

  function entryTitleRequiredLabel(type) {
    const t = normalizeEntryType(type);
    if (t === 'oauth') return 'Le nom de la plateforme est requis';
    return t === 'login' ? 'Le titre est requis' : 'Le nom est requis';
  }

  function entryTypeIcon(type) {
    const t = normalizeEntryType(type);
    if (t === 'oauth') return 'fingerprint';
    if (t === 'api_key') return 'key-round';
    if (t === 'ssh_key') return 'terminal';
    return 'globe';
  }

  function syncEntryTypePills(type = 'login') {
    const t = normalizeEntryType(type);
    const input = $('#entry-type');
    if (input) input.value = t;
    const name = $('#entry-type-picker-name');
    if (name) name.textContent = entryTypeLabel(t);
    const iconWrap = $('#entry-type-picker-icon');
    const icon = iconWrap?.querySelector('[data-lucide], .lucide');
    if (icon) setLucideIcon(icon, entryTypeIcon(t));
    $$('.entry-type-option').forEach((btn) => {
      const selected = btn.dataset.entryType === t;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function setEntryFormType(type) {
    const t = normalizeEntryType(type);
    syncEntryTypePills(t);
    applyEntryFormLabels(t);
    $('#entry-generated')?.classList.add('hidden');
    if (!state.editingEntryId) {
      $('#modal-entry-title').textContent = addEntryModalTitle(t);
    }
  }

  function applyEntryFormLabels(type = 'login') {
    const t = normalizeEntryType(type);
    const isApi = t === 'api_key';
    const isSsh = t === 'ssh_key';
    const isOauth = t === 'oauth';
    const titleLabel = $('#label-entry-title');
    const userLabel = $('#label-entry-username');
    const passLabel = $('#label-entry-password');
    const urlLabel = $('#label-entry-url');
    const notesLabel = $('#label-entry-notes');
    if (titleLabel) titleLabel.textContent = isApi || isSsh
      ? 'Nom'
      : isOauth
        ? 'Nom de la plateforme sur laquelle le compte est créé'
        : 'Titre';
    if (userLabel) {
      if (isSsh) {
        setHtml(userLabel, 'Commentaire / utilisateur <span class="optional">(optionnel)</span>');
      } else if (isApi) {
        setHtml(userLabel, 'Client ID / Identifiant <span class="optional">(optionnel)</span>');
      } else if (isOauth) {
        setHtml(userLabel, 'Email du compte <span class="optional">(optionnel)</span>');
      } else {
        setHtml(userLabel, 'Identifiant <span class="optional">(optionnel)</span>');
      }
    }
    if (passLabel) {
      if (isSsh) passLabel.textContent = 'Clé privée / secret';
      else if (isApi) passLabel.textContent = 'Secret / API key';
      else passLabel.textContent = 'Mot de passe';
      passLabel.setAttribute('for', isSsh ? 'entry-secret-block' : 'entry-password');
    }
    if (urlLabel) {
      if (isSsh) {
        setHtml(urlLabel, 'Hôte / alias <span class="optional">(optionnel)</span>');
      } else if (isApi) {
        setHtml(urlLabel, 'Console / endpoint <span class="optional">(optionnel)</span>');
      } else {
        setHtml(urlLabel, 'URL <span class="optional">(optionnel)</span>');
      }
    }
    if (notesLabel) {
      if (isSsh) {
        notesLabel.textContent = 'Clé publique / fingerprint (optionnel)';
      } else if (isApi) {
        notesLabel.textContent = 'Scopes / notes (optionnel)';
      } else if (isOauth) {
        notesLabel.textContent = 'Sites liés (optionnel)';
      } else {
        notesLabel.textContent = 'Notes (optionnel)';
      }
    }
    const notesHeading = $('#entry-notes-heading');
    if (notesHeading) {
      if (isSsh) {
        setHtml(notesHeading, 'Clé publique / fingerprint <span class="optional">optionnel</span>');
      } else if (isApi) {
        setHtml(notesHeading, 'Scopes / notes <span class="optional">optionnel</span>');
      } else if (isOauth) {
        setHtml(notesHeading, 'Sites liés <span class="optional">optionnel</span>');
      } else {
        setHtml(notesHeading, 'Notes <span class="optional">optionnel</span>');
      }
    }
    const titleInput = $('#entry-title');
    const userInput = $('#entry-username');
    const passInput = $('#entry-password');
    const secretBlock = $('#entry-secret-block');
    const passRow = $('#entry-password-row');
    const urlInput = $('#entry-url');
    const notesInput = $('#entry-notes');
    if (titleInput) {
      titleInput.placeholder = isSsh
        ? 'GitHub, VPS, NAS, disque…'
        : isApi
          ? 'OpenAI, Stripe, AWS…'
          : isOauth
            ? 'Google, GitHub, Apple…'
            : 'Netflix, Gmail, Banque...';
    }
    if (userInput) {
      userInput.placeholder = isSsh
        ? 'user@host ou commentaire de clé'
        : isApi
          ? 'client_id ou account id'
          : isOauth
            ? 'email du compte Google, GitHub…'
            : 'email ou nom d\'utilisateur';
    }
    if (passInput) passInput.placeholder = isApi ? 'sk-… / secret' : 'Mot de passe';
    if (secretBlock) {
      secretBlock.placeholder = isSsh
        ? 'Collez la clé SSH privée'
        : '';
    }
    if (urlInput) {
      urlInput.placeholder = isSsh
        ? 'git@github.com ou serveur.exemple.com'
        : isApi
          ? 'https://console.exemple.com'
          : 'exemple.com ou https://...';
    }
    if (notesInput) {
      notesInput.placeholder = isSsh
        ? 'ssh-ed25519 AAAA… fingerprint…'
        : isApi
          ? 'Scopes, environnement, JSON…'
          : isOauth
            ? 'https://exemple.com — sites liés'
            : 'Informations supplémentaires';
    }

    $('#entry-oauth-providers')?.classList.toggle('hidden', !isOauth);
    $('#entry-secret-group')?.classList.toggle('hidden', isOauth);
    $('#entry-url-group')?.classList.toggle('hidden', isOauth);
    if (isOauth && urlInput) urlInput.value = '';

    if (passRow && secretBlock && passInput) {
      if (isOauth) {
        passRow.classList.add('hidden');
        secretBlock.classList.add('hidden');
        passInput.required = false;
        passInput.value = '';
        secretBlock.required = false;
        secretBlock.value = '';
      } else if (isSsh) {
        passRow.classList.add('hidden');
        secretBlock.classList.remove('hidden');
        passInput.required = false;
        passInput.value = '';
        secretBlock.required = true;
      } else {
        passRow.classList.remove('hidden');
        secretBlock.classList.add('hidden');
        secretBlock.required = false;
        secretBlock.value = '';
        passInput.required = true;
      }
    }
    $('#btn-generate')?.classList.toggle('hidden', isApi || isSsh || isOauth);
    $('#btn-generate-ssh')?.classList.toggle('hidden', !isSsh);
    $('#entry-ssh-hint')?.classList.toggle('hidden', !isSsh);
  }

  function applyDetailTypeLabels(entry) {
    const type = entryType(entry);
    const isApi = type === 'api_key';
    const isSsh = type === 'ssh_key';
    const isOauth = type === 'oauth';
    const badge = $('#detail-type-badge');
    if (badge) {
      badge.textContent = entryTypeLabel(type);
      badge.className = `entry-type-badge entry-type-badge-${type}`;
      badge.classList.remove('hidden');
    }
    const userLabel = $('#detail-username-label');
    const passLabel = $('#detail-password-label');
    const urlLabel = $('#detail-url-label');
    const passEl = $('#detail-password');
    if (userLabel) {
      userLabel.textContent = isSsh
        ? 'Commentaire / utilisateur'
        : isApi
          ? 'Client ID / Identifiant'
          : isOauth
            ? 'Email du compte'
            : 'Identifiant';
    }
    if (passLabel) {
      passLabel.textContent = isSsh
        ? 'Clé privée / secret'
        : isApi
          ? 'Secret / API key'
          : 'Mot de passe';
    }
    if (urlLabel) {
      urlLabel.textContent = isSsh
        ? 'Hôte / alias'
        : isApi
          ? 'Console / endpoint'
          : 'URL';
    }
    if (isOauth) $('#detail-url-field')?.classList.add('hidden');
    passEl?.classList.toggle('detail-secret-block', isSsh);
  }

  function syncTypeFilterButtons() {
    $$('.type-filter').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.typeFilter === state.typeFilter);
    });
  }

  function entryEncryptedPayload(data) {
    const payload = {
      type: normalizeEntryType(data.type),
      title: data.title,
      username: data.username || '',
      password: data.password || '',
      url: data.url || '',
      notes: data.notes || '',
    };
    const folderId = typeof data.folderId === 'string' ? data.folderId.trim() : '';
    if (folderId && state.folders.some((f) => f.id === folderId)) {
      payload.folderId = folderId;
    }
    return payload;
  }

  function filterEntriesByQuery(list, query) {
    let filtered = list.filter((e) => !isVaultMetaEntry(e));
    if (ENTRY_TYPES.includes(state.typeFilter)) {
      filtered = filtered.filter((e) => entryType(e) === state.typeFilter);
    }
    if (state.folderFilter === 'none') {
      filtered = filtered.filter((e) => !entryInKnownFolder(e, state.folders));
    } else if (state.folderFilter && state.folderFilter !== 'all') {
      filtered = filtered.filter((e) => entryFolderId(e) === state.folderFilter);
    }
    if (!query) return filtered;
    const q = query.toLowerCase();
    return filtered.filter(e =>
      e.title.toLowerCase().includes(q) ||
      (e.username || '').toLowerCase().includes(q) ||
      (e.url && e.url.toLowerCase().includes(q)) ||
      (e.notes && e.notes.toLowerCase().includes(q))
    );
  }

  return {
    ENTRY_TYPES,
    formatEntryDateTime, formatEntryDateCompact, entryWasUpdated,
    setDetailDateMeta, setDetailActionButtonsVisible, fillEntryDetailCommon,
    resetEntryFormModal, displayUsername,
    normalizeEntryType, entryType, entryTypeLabel,
    defaultEntryTypeFromFilter, addEntryModalTitle, addEntryActionLabel, addEntryTileLabel,
    syncAddEntryButtonLabels, entryTypeBadgeMarkup,
    entrySecretRequiredLabel, entryTitleRequiredLabel,
    syncEntryTypePills, setEntryFormType, applyEntryFormLabels, applyDetailTypeLabels,
    syncTypeFilterButtons, entryEncryptedPayload, filterEntriesByQuery,
  };
}
