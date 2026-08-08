/**
 * Utilitaires DOM / UI partagés (toasts, modales, avatars, helpers).
 */

import { refreshIcons } from './icons.js';
import { copyToClipboard } from './compat.js';

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];
export const EMPTY_VALUE = '…';

export const AVATAR_COLORS = [
  ['#3b82f6', '#2563eb'], ['#34d399', '#10b981'], ['#60a5fa', '#3b82f6'],
  ['#f472b6', '#ec4899'], ['#fbbf24', '#f59e0b'], ['#a78bfa', '#8b5cf6'],
  ['#2dd4bf', '#14b8a6'], ['#fb923c', '#f97316'],
];

export function getInitials(name) {
  return (name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function getAvatarColor(str) {
  const value = str || '';
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = value.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function setAvatar(el, name) {
  if (!el) return;
  const [c1, c2] = getAvatarColor(name);
  el.textContent = getInitials(name);
  el.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Remplace le contenu HTML sans assigner `.innerHTML` (réduit le risque XSS / alertes scanners). */
export function setHtml(el, html) {
  el.replaceChildren();
  const source = String(html ?? '');
  if (!source) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  el.appendChild(range.createContextualFragment(source));
}

/** Remplit un <select> via le DOM (pas d'innerHTML). */
export function fillSelect(sel, options, selectedValue = '') {
  sel.replaceChildren();
  for (const { value, label } of options) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (selectedValue !== '' && [...sel.options].some((o) => o.value === selectedValue)) {
    sel.value = selectedValue;
  } else if (selectedValue === '' && [...sel.options].some((o) => o.value === '')) {
    sel.value = '';
  } else if (sel.options.length) {
    sel.selectedIndex = 0;
  }
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function toast(msg, type = 'info') {
  const icons = { success: 'check-circle', error: 'x-circle', info: 'info' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', icons[type] || 'info');
  const span = document.createElement('span');
  span.textContent = msg || '';
  el.append(icon, span);
  $('#toasts').appendChild(el);
  refreshIcons(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 350); }, 3200);
}

export function showLoading(msg = 'Dérivation de clé en cours...') {
  $('#loading-text').textContent = msg;
  $('#loading').classList.remove('hidden');
}

export function hideLoading() {
  $('#loading').classList.add('hidden');
}

export function syncBodyModalLock() {
  document.body.classList.toggle('modal-open', !!document.querySelector('.modal.open'));
}

export function openModal(modal) {
  if (!modal) return;
  modal.classList.add('open');
  const body = modal.querySelector('.modal-body');
  if (body) body.scrollTop = 0;
  syncBodyModalLock();
}

export function closeModal(modal) {
  if (!modal) return;
  modal.classList.remove('open');
  syncBodyModalLock();
}

export async function copyText(text, btn) {
  const ok = await copyToClipboard(text);
  if (!ok) {
    toast('Impossible de copier — autorisez le presse-papiers ou copiez manuellement', 'error');
    return false;
  }
  if (btn) {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 1500);
  }
  return true;
}
