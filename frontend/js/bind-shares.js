/**
 * Listeners partages + contacts.
 */
import { api } from './api.js';
import { fromB64, toB64, encryptForRecipient } from './crypto.js';
import {
  $, toast, showLoading, hideLoading, openModal, closeModal,
} from './ui.js';

export function bindShares(deps) {
  const {
    state,
    renderContactsPage, getShareContacts, removeShareContact,
    openSharePickEntryModal, openShareModal, renderSharePickEntryList,
    rememberShareContact, loadShares, showDeleteConfirm, entryType,
    closeModal: _cm, openModal: _om,
  } = deps;
  void _cm; void _om;

  $('#btn-close-share')?.addEventListener('click', () => closeModal($('#modal-share')));

  $('#btn-contacts-back')?.addEventListener('click', () => {
    state.contactsSelectedEmail = null;
    renderContactsPage();
  });

  $('#btn-contact-share')?.addEventListener('click', () => {
    if (!state.contactsSelectedEmail) return;
    openSharePickEntryModal(state.contactsSelectedEmail);
  });

  $('#btn-contact-remove')?.addEventListener('click', () => {
    if (!state.contactsSelectedEmail) return;
    const email = state.contactsSelectedEmail;
    const contact = getShareContacts().find((c) => c.email === email);
    const label = contact?.display_name || email;
    if (contact?.share_count > 0) {
      toast('Révoquez d’abord les partages actifs avec ce contact', 'error');
      return;
    }
    showDeleteConfirm(
      { title: label },
      () => {
        removeShareContact(email);
        toast('Contact retiré de la liste', 'info');
      },
      {
        title: 'Retirer le contact',
        message: 'Ce contact sera retiré de votre liste. Vous pourrez le retrouver en partageant à nouveau.',
      },
    );
  });

  $('#btn-close-share-pick')?.addEventListener('click', () => {
    closeModal($('#modal-share-pick-entry'));
    state.sharePrefillEmail = null;
  });

  $('#share-pick-search')?.addEventListener('input', (e) => {
    state.sharePickSearch = e.target.value || '';
    renderSharePickEntryList();
  });

  $('#form-share')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const entryId = state.shareEntryId;
    const entry = state.entries.find((x) => x.id === entryId);
    const email = $('#share-email')?.value.trim().toLowerCase();
    if (!entry || !email) {
      toast('Email du destinataire requis', 'error');
      return;
    }
    if (state.user?.email && email === String(state.user.email).toLowerCase()) {
      toast('Vous ne pouvez pas partager avec vous-même', 'error');
      return;
    }

    const btn = $('#btn-share-submit');
    btn.disabled = true;
    showLoading('Chiffrement du partage...');
    try {
      const recipient = await api.lookupUser(state.token, email);
      const shareNote = ($('#share-note')?.value || '').trim().slice(0, 500);
    const payload = {
        title: entry.title,
        username: entry.username || '',
        password: entry.password || '',
        url: entry.url || '',
        notes: entry.notes || '',
        type: entryType(entry),
        // Pas de folderId : les partages restent hors projets
        share_note: shareNote,
        shared_by: state.user.display_name,
        shared_by_email: state.user.email,
      };
      const encrypted = await encryptForRecipient(payload, fromB64(recipient.public_key));
      await api.createShare(state.token, {
        entry_id: entry.id,
        recipient_email: recipient.email,
        encrypted_data: toB64(encrypted),
      });
      rememberShareContact({
        email: recipient.email,
        display_name: recipient.display_name,
      });
      await loadShares();
      closeModal($('#modal-share'));
      toast(`Partagé avec ${recipient.display_name || recipient.email}`, 'success');
      if (state.page === 'contacts') renderContactsPage();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      hideLoading();
      btn.disabled = false;
    }
  });
}
