/**
 * Markup avatars / tuiles dashboard pour les clés.
 */
import { getSiteDomain, entryFaviconSource, setupFaviconImages } from './favicon.js';
import { esc, getAvatarColor } from './ui.js';

export function createEntryMarkup(deps) {
  function entryLetter(entry) {
    return esc((entry.title?.[0] || '?').toUpperCase());
  }

  function dashTileIconMarkup(entry) {
    const letter = entryLetter(entry);
    if (deps.entryType(entry) === 'ssh_key') {
      return `<span class="dash-tile-letter">${letter}</span>`;
    }
    const siteUrl = entryFaviconSource(entry);
    if (!getSiteDomain(siteUrl)) return `<span class="dash-tile-letter">${letter}</span>`;

    return `
      <span class="dash-tile-logo">
        <img
          class="dash-tile-favicon"
          alt=""
          loading="lazy"
          decoding="async"
          data-site-url="${esc(siteUrl)}"
        >
        <span class="dash-tile-letter dash-tile-letter-fallback">${letter}</span>
      </span>`;
  }

  function dashTileClassName(entry) {
    if (deps.entryType(entry) === 'ssh_key') return 'dash-tile';
    return getSiteDomain(entryFaviconSource(entry)) ? 'dash-tile dash-tile-branded' : 'dash-tile';
  }

  function dashTileStyle(entry, index) {
    const delay = `animation-delay:${index * 0.03}s`;
    if (deps.entryType(entry) !== 'ssh_key' && getSiteDomain(entryFaviconSource(entry))) return delay;
    const [c1, c2] = getAvatarColor(entry.title);
    return `background:linear-gradient(160deg,${c1},${c2});${delay}`;
  }

  function entryAvatarMarkup(entry) {
    const letter = entryLetter(entry);
    const [c1, c2] = getAvatarColor(entry.title);
    if (deps.entryType(entry) === 'ssh_key') {
      return `<div class="entry-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${letter}</div>`;
    }
    const siteUrl = entryFaviconSource(entry);
    if (!getSiteDomain(siteUrl)) {
      return `<div class="entry-avatar" style="background:linear-gradient(135deg,${c1},${c2})">${letter}</div>`;
    }
    return `
      <div class="entry-avatar entry-icon entry-icon-branded">
        <img
          class="entry-favicon"
          alt=""
          width="24"
          height="24"
          loading="lazy"
          decoding="async"
          data-site-url="${esc(siteUrl)}"
        >
        <span class="entry-letter">${letter}</span>
      </div>`;
  }

  function setEntryAvatar(el, entry) {
    const letter = entryLetter(entry);
    const [c1, c2] = getAvatarColor(entry.title);
    if (deps.entryType(entry) === 'ssh_key') {
      el.className = 'entry-avatar lg';
      el.style.background = `linear-gradient(135deg,${c1},${c2})`;
      el.textContent = (entry.title?.[0] || '?').toUpperCase();
      return;
    }
    const siteUrl = entryFaviconSource(entry);
    el.className = 'entry-avatar lg entry-icon entry-icon-branded';
    el.style.background = '';
    if (!getSiteDomain(siteUrl)) {
      el.style.background = `linear-gradient(135deg,${c1},${c2})`;
      el.textContent = (entry.title?.[0] || '?').toUpperCase();
      return;
    }
    el.classList.add('entry-icon');
    const img = document.createElement('img');
    img.className = 'entry-favicon';
    img.alt = '';
    img.width = 28;
    img.height = 28;
    img.decoding = 'async';
    img.dataset.siteUrl = siteUrl || '';
    const letterEl = document.createElement('span');
    letterEl.className = 'entry-letter';
    letterEl.textContent = letter;
    el.replaceChildren(img, letterEl);
    setupFaviconImages(el);
  }

  return {
    entryLetter, dashTileIconMarkup, dashTileClassName, dashTileStyle,
    entryAvatarMarkup, setEntryAvatar,
  };
}
