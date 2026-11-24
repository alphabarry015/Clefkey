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

  function senderKey(share) {
    return String(share.sender_email || '').trim().toLowerCase() || 'inconnu';
  }

  /** Agrège les partages reçus par expéditeur. */
  function getReceivedSenders() {
    const byEmail = new Map();
    for (const s of state.sharesReceived) {
      const email = senderKey(s);
      const existing = byEmail.get(email) || {
        email,
        display_name: '',
        last_shared_at: null,
        shares: [],
      };
      existing.display_name = s.sender_display_name || existing.display_name || '';
      existing.shares.push(s);
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

  /** Relie un envoi à la clé du coffre (type, URL, notes) pour le favicon. */
  function withVaultEntry(share) {
    const entry = state.entries.find((e) => String(e.id) === String(share.entry_id));
    if (!entry) return share;
    return {
      ...share,
      type: entry.type || share.type || 'login',
      title: entry.title || share.title,
      username: entry.username || share.username || '',
      url: entry.url || share.url || '',
      notes: entry.notes || share.notes || '',
      password: entry.password || share.password || '',
    };
  }

  function shareKeyCard(e, i, mode) {
    const note = mode === 'received' ? (e.share_note || '').trim() : '';
    const noteLabel = note ? (note.length > 60 ? `${note.slice(0, 60)}…` : note) : '';
    const subtitle = [e.username, noteLabel].filter(Boolean).join(' · ');
    const action = mode === 'received' ? 'show-share-received' : 'show-share-sent';
    const removeTitle = mode === 'received' ? 'Retirer' : 'Révoquer';
    return `
      <div
        class="entry-card share-key-card"
        data-id="${esc(e.id)}"
        style="animation-delay:${i * 0.04}s"
        data-action="${action}"
      >
        ${deps.entryAvatarMarkup(e)}
        <div class="entry-info">
          <div class="entry-title">${esc(e.title)}</div>
          <div class="entry-username">${esc(subtitle)}</div>
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
            title="${removeTitle}"
            data-action="delete-share"
            data-id="${esc(e.id)}"
          >
            <i data-lucide="trash-2"></i>
          </button>
        </div>
      </div>`;
  }

  function personCard(person, i, action, meta) {
    const label = person.display_name || person.email;
    const when = formatContactDate(person.last_shared_at);
    const [c1, c2] = getAvatarColor(label);
    const mail = person.email.includes('@') ? person.email : '';
    return `
      <button
        type="button"
        class="contact-card share-person-card"
        data-action="${action}"
        data-email="${esc(person.email)}"
        style="animation-delay:${i * 0.04}s"
      >
        <div
          class="contact-avatar"
          aria-hidden="true"
          style="background:linear-gradient(135deg,${c1},${c2})"
        >${esc(contactInitials(person))}</div>
        <div class="contact-info">
          <div class="contact-name">${esc(label)}</div>
          <div class="contact-email">${esc(mail)}</div>
          <div class="contact-meta">${esc(meta)}</div>
          ${when ? `<div class="contact-date">${esc(when)}</div>` : ''}
        </div>
        <span class="contact-open">Voir</span>
      </button>`;
  }

  function renderReceivedSenderDetail(email) {
    const sender = getReceivedSenders().find((s) => s.email === email);
    if (!sender) {
      state.receivedSenderEmail = null;
      renderSharesReceived();
      return;
    }

    const name = sender.display_name || sender.email;
    const when = formatContactDate(sender.last_shared_at);
    const count = sender.shares.length;

    $('#received-detail-name').textContent = name;
    const emailEl = $('#received-detail-email');
    if (emailEl) {
      const mail = sender.email.includes('@') ? sender.email : '';
      emailEl.textContent = mail || 'Expéditeur inconnu';
      emailEl.href = mail ? `mailto:${mail}` : '#';
    }
    if ($('#received-detail-share-count')) {
      $('#received-detail-share-count').textContent = String(count);
    }
    if ($('#received-detail-share-label')) {
      $('#received-detail-share-label').textContent = count <= 1 ? 'active' : 'actives';
    }
    if ($('#received-detail-last-share')) {
      $('#received-detail-last-share').textContent = when || '—';
    }
    if ($('#received-detail-meta')) {
      $('#received-detail-meta').textContent = when
        ? `Dernier envoi le ${when}`
        : 'Aucun historique récent';
    }
    setAvatar($('#received-detail-avatar'), name);

    const sharesList = $('#received-detail-shares');
    if (sharesList) {
      setHtml(sharesList, sender.shares.map((e, i) => shareKeyCard(e, i, 'received')).join(''));
      refreshIcons(sharesList);
      deps.setupFaviconImages(sharesList);
      bindShareKeyClicks(sharesList);
    }
    refreshIcons($('#shares-received-detail-panel'));
  }

  function renderSharesReceived() {
    const listPanel = $('#shares-received-list-panel');
    const detailPanel = $('#shares-received-detail-panel');
    const list = $('#shares-received-list');
    const empty = $('#shares-received-empty');
    if (!listPanel || !detailPanel || !list || !empty) return;
    deps.updateEntryCounts();

    if (state.sharesReceived.length === 0) {
      state.receivedSenderEmail = null;
      detailPanel.classList.add('hidden');
      listPanel.classList.remove('hidden');
      list.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }

    if (state.receivedSenderEmail) {
      const sender = getReceivedSenders().find((s) => s.email === state.receivedSenderEmail);
      if (!sender) state.receivedSenderEmail = null;
    }

    if (state.receivedSenderEmail) {
      listPanel.classList.add('hidden');
      detailPanel.classList.remove('hidden');
      renderReceivedSenderDetail(state.receivedSenderEmail);
      return;
    }

    detailPanel.classList.add('hidden');
    listPanel.classList.remove('hidden');
    empty.classList.add('hidden');

    const senders = getReceivedSenders();
    setHtml(list, senders.map((s, i) => {
      const count = s.shares.length;
      const meta = `${count} clé${count > 1 ? 's' : ''} reçue${count > 1 ? 's' : ''}`;
      return personCard(s, i, 'show-received-sender', meta);
    }).join(''));
    refreshIcons(list);
  }

  function recipientKey(share) {
    return String(share.recipient_email || '').trim().toLowerCase() || 'inconnu';
  }

  /** Agrège les partages envoyés par destinataire. */
  function getSentRecipients() {
    const byEmail = new Map();
    for (const s of state.sharesSent) {
      const email = recipientKey(s);
      const existing = byEmail.get(email) || {
        email,
        display_name: '',
        last_shared_at: null,
        shares: [],
      };
      existing.display_name = s.recipient_display_name || existing.display_name || '';
      existing.shares.push(withVaultEntry(s));
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

  function renderSentRecipientDetail(email) {
    const recipient = getSentRecipients().find((s) => s.email === email);
    if (!recipient) {
      state.sentRecipientEmail = null;
      renderSharesSent();
      return;
    }

    const name = recipient.display_name || recipient.email;
    const when = formatContactDate(recipient.last_shared_at);
    const count = recipient.shares.length;

    $('#sent-detail-name').textContent = name;
    const emailEl = $('#sent-detail-email');
    if (emailEl) {
      const mail = recipient.email.includes('@') ? recipient.email : '';
      emailEl.textContent = mail || 'Destinataire inconnu';
      emailEl.href = mail ? `mailto:${mail}` : '#';
    }
    if ($('#sent-detail-share-count')) {
      $('#sent-detail-share-count').textContent = String(count);
    }
    if ($('#sent-detail-share-label')) {
      $('#sent-detail-share-label').textContent = count <= 1 ? 'active' : 'actives';
    }
    if ($('#sent-detail-last-share')) {
      $('#sent-detail-last-share').textContent = when || '—';
    }
    if ($('#sent-detail-meta')) {
      $('#sent-detail-meta').textContent = when
        ? `Dernier envoi le ${when}`
        : 'Aucun historique récent';
    }
    setAvatar($('#sent-detail-avatar'), name);

    const sharesList = $('#sent-detail-shares');
    if (sharesList) {
      setHtml(sharesList, recipient.shares.map((e, i) => shareKeyCard(e, i, 'sent')).join(''));
      refreshIcons(sharesList);
      deps.setupFaviconImages(sharesList);
      bindShareKeyClicks(sharesList);
    }
    refreshIcons($('#shares-sent-detail-panel'));
  }

  function renderSharesSent() {
    state.sharesSent = state.sharesSent.map(withVaultEntry);
    const listPanel = $('#shares-sent-list-panel');
    const detailPanel = $('#shares-sent-detail-panel');
    const list = $('#shares-sent-list');
    const empty = $('#shares-sent-empty');
    if (!listPanel || !detailPanel || !list || !empty) return;
    deps.updateEntryCounts();

    if (state.sharesSent.length === 0) {
      state.sentRecipientEmail = null;
      detailPanel.classList.add('hidden');
      listPanel.classList.remove('hidden');
      list.replaceChildren();
      empty.classList.remove('hidden');
      return;
    }

    if (state.sentRecipientEmail) {
      const recipient = getSentRecipients().find((s) => s.email === state.sentRecipientEmail);
      if (!recipient) state.sentRecipientEmail = null;
    }

    if (state.sentRecipientEmail) {
      listPanel.classList.add('hidden');
      detailPanel.classList.remove('hidden');
      renderSentRecipientDetail(state.sentRecipientEmail);
      return;
    }

    detailPanel.classList.add('hidden');
    listPanel.classList.remove('hidden');
    empty.classList.add('hidden');

    const recipients = getSentRecipients();
    setHtml(list, recipients.map((s, i) => {
      const count = s.shares.length;
      const meta = `${count} clé${count > 1 ? 's' : ''} envoyée${count > 1 ? 's' : ''}`;
      return personCard(s, i, 'show-sent-recipient', meta);
    }).join(''));
    refreshIcons(list);
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
      existing.shares.push(withVaultEntry(s));
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
    state.sharesSent = state.sharesSent.map(withVaultEntry);
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
        setHtml(sharesList, contact.shares.map((e, i) => shareKeyCard(e, i, 'sent')).join(''));
        refreshIcons(sharesList);
        deps.setupFaviconImages(sharesList);
        bindShareKeyClicks(sharesList);
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

  function bindShareKeyClicks(root) {
    root.querySelectorAll('.entry-card[data-id]').forEach((card) => {
      card.addEventListener('click', (event) => {
        if (event.target.closest('.entry-actions')) return;
        const id = card.dataset.id;
        if (card.dataset.action === 'show-share-received') showShareReceived(id);
        else if (card.dataset.action === 'show-share-sent') showShareSent(id);
      });
    });
  }

  function openShareDetail(entry, note) {
    state.detailEntryId = null;
    deps.fillEntryDetailCommon(entry);
    deps.syncDetailProjectField(entry, { editable: false });
    const shareNoteField = $('#detail-share-note-field');
    const text = (note || '').trim();
    if (text) {
      shareNoteField?.classList.remove('hidden');
      if ($('#detail-share-note')) $('#detail-share-note').textContent = text;
    } else {
      shareNoteField?.classList.add('hidden');
    }
    deps.setDetailDateMeta(null, { visible: false });
    deps.setDetailActionButtonsVisible({});
    openModal($('#modal-detail'));
    refreshIcons($('#modal-detail'));
  }

  function showShareReceived(id) {
    const e = state.sharesReceived.find((x) => String(x.id) === String(id));
    if (!e) return;
    openShareDetail(e, e.share_note);
  };

  function showShareSent(id) {
    const s = state.sharesSent.find((x) => String(x.id) === String(id));
    if (!s) return;
    const owned = s.entry_id
      && state.entries.find((e) => String(e.id) === String(s.entry_id));
    if (owned) {
      deps.showEntry(owned.id);
      return;
    }
    openShareDetail(s);
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
