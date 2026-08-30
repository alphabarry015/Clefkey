/**
 * Partages + contacts UI.
 */
import { api } from './api.js';
import { isVaultMetaEntry } from './folders.js';
import {
  $, $$, esc, setHtml, toast, showLoading, hideLoading,
  openModal, closeModal, getAvatarColor, setAvatar,
} from './ui.js';

export function createShares(deps) {
  const { state, refreshIcons } = deps;

  function renderSharesReceived() {
    const list = $('#shares-received-list');
    const empty = $('#shares-received-empty');
    if (!list || !empty) return;
    deps.updateEntryCounts();
    if (state.sharesReceived.length === 0) {
      list.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    setHtml(list, state.sharesReceived.map((e, i) => `
      <div
        class="entry-card"
        data-id="${esc(e.id)}"
        style="animation-delay:${i * 0.04}s"
        data-action="show-share-received"
      >
        ${deps.entryAvatarMarkup(e)}
        <div class="entry-info">
          <div class="entry-title">${esc(e.title)}</div>
          <div class="entry-username">
            De ${esc(e.sender_display_name || e.sender_email)}${
              e.share_note
                ? ` · ${esc(e.share_note.length > 60 ? `${e.share_note.slice(0, 60)}…` : e.share_note)}`
                : ''
            }
          </div>
        </div>
        <div class="entry-actions">
          <button
            type="button"
            class="btn-icon"
            title="Copier"
            data-action="copy-share-received"
            data-id="${esc(e.id)}"
          >
            <i data-lucide="copy"></i>
          </button>
          <button
            type="button"
            class="btn-icon btn-danger"
            title="Retirer"
            data-action="delete-share"
            data-id="${esc(e.id)}"
          >
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>`).join(''));
    refreshIcons(list);
    deps.setupFaviconImages(list);
  }

  function renderSharesSent() {
    const list = $('#shares-sent-list');
    const empty = $('#shares-sent-empty');
    if (!list || !empty) return;
    deps.updateEntryCounts();
    if (state.sharesSent.length === 0) {
      list.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    setHtml(list, state.sharesSent.map((e, i) => `
      <div class="entry-card" data-id="${esc(e.id)}" style="animation-delay:${i * 0.04}s" data-action="show-share-sent">
        ${deps.entryAvatarMarkup(e)}
        <div class="entry-info">
          <div class="entry-title">${esc(e.title)}</div>
          <div class="entry-username">À ${esc(e.recipient_display_name || e.recipient_email)}</div>
        </div>
        <div class="entry-actions">
          <button
            type="button"
            class="btn-icon btn-danger"
            title="Révoquer"
            data-action="delete-share"
            data-id="${esc(e.id)}"
          >
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>`).join(''));
    refreshIcons(list);
    deps.setupFaviconImages(list);
  }

  function contactsStorageKey() {
    const uid = state.user?.id || state.user?.email || 'anon';
    return `clefkey_share_contacts_${uid}`;
  }

  function loadStoredContacts() {
    try {
      const raw = localStorage.getItem(contactsStorageKey());
      const list = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(list)) return [];
      return list
        .filter((c) => c && typeof c.email === 'string' && c.email.includes('@'))
        .map((c) => ({
          email: String(c.email).trim().toLowerCase(),
          display_name: String(c.display_name || '').trim(),
          last_shared_at: c.last_shared_at || null,
        }));
    } catch {
      return [];
    }
  }

  function saveStoredContacts(list) {
    try {
      localStorage.setItem(contactsStorageKey(), JSON.stringify(list.slice(0, 100)));
    } catch {
      /* ignore */
    }
  }

  function rememberShareContact({ email, display_name } = {}) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized.includes('@')) return;
    const stored = loadStoredContacts().filter((c) => c.email !== normalized);
    stored.unshift({
      email: normalized,
      display_name: String(display_name || '').trim(),
      last_shared_at: new Date().toISOString(),
    });
    saveStoredContacts(stored);
  }

  function syncContactsFromShares() {
    const map = new Map(loadStoredContacts().map((c) => [c.email, { ...c }]));
    for (const s of state.sharesSent) {
      const email = String(s.recipient_email || '').trim().toLowerCase();
      if (!email.includes('@')) continue;
      const prev = map.get(email) || { email, display_name: '', last_shared_at: null };
      const dates = [prev.last_shared_at, s.created_at].filter(Boolean).sort();
      map.set(email, {
        email,
        display_name: String(s.recipient_display_name || prev.display_name || '').trim(),
        last_shared_at: dates.length ? dates[dates.length - 1] : null,
      });
    }
    saveStoredContacts(Array.from(map.values()));
  }

  function removeShareContact(email) {
    const normalized = String(email || '').trim().toLowerCase();
    saveStoredContacts(loadStoredContacts().filter((c) => c.email !== normalized));
    if (state.contactsSelectedEmail === normalized) state.contactsSelectedEmail = null;
    deps.updateEntryCounts();
    if (state.page === 'contacts') renderContactsPage();
  }

  /** Agrège contacts stockés + destinataires des partages envoyés. */
  function getShareContacts() {
    const byEmail = new Map();

    for (const c of loadStoredContacts()) {
      byEmail.set(c.email, {
        email: c.email,
        display_name: c.display_name || '',
        last_shared_at: c.last_shared_at || null,
        share_count: 0,
        shares: [],
      });
    }

    for (const s of state.sharesSent) {
      const email = String(s.recipient_email || '').trim().toLowerCase();
      if (!email) continue;
      const existing = byEmail.get(email) || {
        email,
        display_name: '',
        last_shared_at: null,
        share_count: 0,
        shares: [],
      };
      existing.display_name = s.recipient_display_name || existing.display_name || '';
      existing.shares.push(s);
      existing.share_count = existing.shares.length;
      const created = s.created_at || null;
      if (created && (!existing.last_shared_at || created > existing.last_shared_at)) {
        existing.last_shared_at = created;
      }
      byEmail.set(email, existing);
    }

    return Array.from(byEmail.values()).sort((a, b) => {
      const da = a.last_shared_at || '';
      const db = b.last_shared_at || '';
      return db.localeCompare(da);
    });
  }

  function formatContactDate(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return '';
    }
  }

  function contactInitials(contact) {
    const name = (contact.display_name || contact.email || '?').trim();
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  function renderContactsPage() {
    const listPanel = $('#contacts-list-panel');
    const detailPanel = $('#contacts-detail-panel');
    if (!listPanel || !detailPanel) return;
    deps.updateEntryCounts();

    if (state.contactsSelectedEmail) {
      listPanel.classList.add('hidden');
      detailPanel.classList.remove('hidden');
      renderContactDetail(state.contactsSelectedEmail);
      return;
    }

    detailPanel.classList.add('hidden');
    listPanel.classList.remove('hidden');

    const list = $('#contacts-list');
    const empty = $('#contacts-empty');
    if (!list || !empty) return;
    const contacts = getShareContacts();
    if (contacts.length === 0) {
      list.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    setHtml(list, contacts.map((c, i) => {
      const label = c.display_name || c.email;
      const meta = c.share_count > 0
        ? `${c.share_count} clé${c.share_count > 1 ? 's' : ''} partagée${c.share_count > 1 ? 's' : ''}`
        : 'Aucun partage actif';
      const when = formatContactDate(c.last_shared_at);
      const [c1, c2] = getAvatarColor(label);
      return `
        <button
          type="button"
          class="contact-card"
          data-action="show-contact"
          data-email="${esc(c.email)}"
          style="animation-delay:${i * 0.04}s"
        >
          <div
            class="contact-avatar"
            aria-hidden="true"
            style="background:linear-gradient(135deg,${c1},${c2})"
          >${esc(contactInitials(c))}</div>
          <div class="contact-info">
            <div class="contact-name">${esc(label)}</div>
            <div class="contact-email">${esc(c.email)}</div>
            <div class="contact-meta">${esc(meta)}</div>
            ${when ? `<div class="contact-date">${esc(when)}</div>` : ''}
          </div>
          <span class="contact-open">Voir</span>
        </button>`;
    }).join(''));
    refreshIcons(list);
  }

  function renderContactDetail(email) {
    const contact = getShareContacts().find((c) => c.email === email);
    if (!contact) {
      state.contactsSelectedEmail = null;
      renderContactsPage();
      return;
    }

    const name = contact.display_name || contact.email;
    const when = formatContactDate(contact.last_shared_at);
    const count = contact.share_count || 0;

    $('#contacts-detail-name').textContent = name;
    const emailEl = $('#contacts-detail-email');
    if (emailEl) {
      emailEl.textContent = contact.email;
      emailEl.href = `mailto:${contact.email}`;
    }
    if ($('#contacts-detail-share-count')) {
      $('#contacts-detail-share-count').textContent = String(count);
    }
    if ($('#contacts-detail-share-label')) {
      $('#contacts-detail-share-label').textContent = count <= 1 ? 'active' : 'actives';
    }
    if ($('#contacts-detail-last-share')) {
      $('#contacts-detail-last-share').textContent = when || '—';
    }
    if ($('#contacts-detail-meta')) {
      $('#contacts-detail-meta').textContent = when
        ? `Dernier envoi le ${when}`
        : 'Aucun historique récent';
    }
    setAvatar($('#contacts-detail-avatar'), name);

    const sharesList = $('#contacts-detail-shares');
    const sharesEmpty = $('#contacts-detail-shares-empty');
    if (sharesList && sharesEmpty) {
      if (!contact.shares.length) {
        sharesList.replaceChildren();
        sharesEmpty.classList.remove('hidden');
      } else {
        sharesEmpty.classList.add('hidden');
        setHtml(sharesList, contact.shares.map((e, i) => `
          <div
            class="entry-card"
            data-id="${esc(e.id)}"
            style="animation-delay:${i * 0.04}s"
            data-action="show-share-sent"
          >
            ${deps.entryAvatarMarkup(e)}
            <div class="entry-info">
              <div class="entry-title">${esc(e.title)}</div>
              <div class="entry-username">${esc(e.username || e.recipient_email || '')}</div>
            </div>
            <div class="entry-actions">
              <button
                type="button"
                class="btn-icon btn-danger"
                title="Révoquer"
                data-action="delete-share"
                data-id="${esc(e.id)}"
              >
                <i data-lucide="trash-2"></i>
              </button>
            </div>
          </div>`).join(''));
        refreshIcons(sharesList);
        deps.setupFaviconImages(sharesList);
      }
    }
    refreshIcons($('#contacts-detail-panel'));
  }

  function renderShareContactChips() {
    const wrap = $('#share-contacts');
    const chips = $('#share-contacts-chips');
    if (!wrap || !chips) return;
    const contacts = getShareContacts().slice(0, 8);
    if (!contacts.length) {
      wrap.classList.add('hidden');
      chips.replaceChildren();
      return;
    }
    wrap.classList.remove('hidden');
    setHtml(chips, contacts.map((c) => {
      const label = c.display_name || c.email;
      return `
        <button type="button" class="share-contact-chip"
          data-action="pick-share-contact" data-email="${esc(c.email)}"
          title="${esc(c.email)}">${esc(label)}</button>`;
    }).join(''));
  }

  function openShareModal(entryId, { email = '' } = {}) {
    const entry = state.entries.find((x) => x.id === entryId);
    if (!entry) return;
    if (state.devMode) {
      toast('Le partage n’est pas disponible en mode développement', 'info');
      return;
    }
    state.shareEntryId = entryId;
    const prefill = String(email || state.sharePrefillEmail || '').trim().toLowerCase();
    state.sharePrefillEmail = null;
    $('#share-entry-title').textContent = `Partager « ${entry.title} »`;
    $('#share-email').value = prefill;
    if ($('#share-note')) $('#share-note').value = '';
    renderShareContactChips();
    openModal($('#modal-share'));
    refreshIcons($('#modal-share'));
    setTimeout(() => {
      if (prefill) $('#share-note')?.focus();
      else $('#share-email')?.focus();
    }, 50);
  }

  function openSharePickEntryModal(email) {
    if (state.devMode) {
      toast('Le partage n’est pas disponible en mode développement', 'info');
      return;
    }
    state.sharePrefillEmail = String(email || '').trim().toLowerCase();
    state.sharePickSearch = '';
    if ($('#share-pick-search')) $('#share-pick-search').value = '';
    const contact = getShareContacts().find((c) => c.email === state.sharePrefillEmail);
    const label = contact?.display_name || state.sharePrefillEmail;
    if ($('#share-pick-hint')) {
      $('#share-pick-hint').textContent = `Choisissez la clé à partager avec ${label}.`;
    }
    renderSharePickEntryList();
    openModal($('#modal-share-pick-entry'));
    refreshIcons($('#modal-share-pick-entry'));
    setTimeout(() => $('#share-pick-search')?.focus(), 50);
  }

  function renderSharePickEntryList() {
    const list = $('#share-pick-entry-list');
    const empty = $('#share-pick-empty');
    if (!list || !empty) return;
    const entries = deps.filterEntriesByQuery(state.entries, state.sharePickSearch)
      .filter((e) => !e.isShare && !isVaultMetaEntry(e));
    if (!entries.length) {
      list.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    setHtml(list, entries.slice(0, 40).map((e) => `
      <button type="button" class="share-pick-item" data-action="pick-share-entry" data-id="${esc(e.id)}">
        ${deps.entryAvatarMarkup(e)}
        <div class="entry-info">
          <div class="entry-title">${esc(e.title)}</div>
          <div class="entry-username">${esc(e.username || e.url || '')}</div>
        </div>
      </button>`).join(''));
    refreshIcons(list);
    deps.setupFaviconImages(list);
  }

  function showShareReceived(id) {
    const e = state.sharesReceived.find((x) => x.id === id);
    if (!e) return;
    state.detailEntryId = null;
    deps.fillEntryDetailCommon(e);
    deps.syncDetailProjectField(e, { editable: false });
    const shareNoteField = $('#detail-share-note-field');
    if (e.share_note) {
      shareNoteField?.classList.remove('hidden');
      $('#detail-share-note').textContent = e.share_note;
    } else {
      shareNoteField?.classList.add('hidden');
    }
    $('#detail-share-note-field')?.classList.add('hidden');
    deps.setDetailDateMeta(null, { visible: false });
    deps.setDetailActionButtonsVisible({});
    openModal($('#modal-detail'));
    refreshIcons($('#modal-detail'));
  };

  function showShareSent(id) {
    const s = state.sharesSent.find((x) => x.id === id);
    if (!s) return;
    if (s.entry_id && state.entries.some((e) => e.id === s.entry_id)) {
      deps.showEntry(s.entry_id);
      return;
    }
    toast(`Partagé avec ${s.recipient_display_name || s.recipient_email}`, 'info');
  };

  function deleteShare(id) {
    const received = state.sharesReceived.find((x) => x.id === id);
    const sent = state.sharesSent.find((x) => x.id === id);
    const label = received?.title || sent?.title || 'ce partage';
    deps.showDeleteConfirm(
      { title: label },
      async () => {
        try {
          await api.deleteShare(state.token, id);
          await deps.loadShares();
          toast('Partage retiré', 'info');
        } catch (err) {
          toast(err.message, 'error');
        }
      },
      {
        title: 'Retirer le partage',
        message: 'Le destinataire n’aura plus accès à cette copie. Votre clé d’origine reste intacte.',
      },
    );
  };

  function installShareGlobals() {
    window.showShareReceived = showShareReceived;
    window.showShareSent = showShareSent;
    window.deleteShare = deleteShare;
  }

  return {
    renderSharesReceived, renderSharesSent,
    contactsStorageKey, loadStoredContacts, saveStoredContacts,
    rememberShareContact, syncContactsFromShares, removeShareContact, getShareContacts,
    formatContactDate, contactInitials, renderContactsPage, renderContactDetail,
    renderShareContactChips, openShareModal, openSharePickEntryModal, renderSharePickEntryList,
    installShareGlobals,
  };
}
