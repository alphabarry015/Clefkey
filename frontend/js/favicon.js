/* Favicons via le serveur local (fichiers publics des sites, comme un navigateur). */

export function normalizeEntryUrl(url) {
  const value = (url || '').trim();
  if (!value) return '';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withProtocol);
    if (!parsed.hostname) return '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

export function getSiteDomain(url) {
  const normalized = normalizeEntryUrl(url);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

export function getFaviconUrl(url) {
  const pageUrl = normalizeEntryUrl(url);
  if (!pageUrl) return null;
  return `${window.location.origin}/vault/favicon?url=${encodeURIComponent(pageUrl)}&v=8`;
}

/** Premier lien http(s) ou domaine trouvé dans un texte (notes OAuth). */
export function firstUrlFromText(text) {
  const value = (text || '').trim();
  if (!value) return '';
  const match = value.match(/https?:\/\/[^\s<>"'()]+/i)
    || value.match(/\b(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'()]*)?/i);
  return match ? normalizeEntryUrl(match[0].replace(/[.,;:!?)]+$/, '')) : '';
}

/** URL utilisée pour le favicon : notes pour OAuth, sinon champ URL. */
export function entryFaviconSource(entry) {
  if (!entry || entry.type === 'ssh_key') return '';
  if (entry.type === 'oauth') {
    return firstUrlFromText(entry.notes) || normalizeEntryUrl(entry.url);
  }
  return normalizeEntryUrl(entry.url);
}

export function prepareEntry(entry) {
  if (!entry) return entry;
  const prepared = { ...entry };
  // Les hôtes SSH (git@…, user@host) ne sont pas des URLs web.
  if (prepared.url && prepared.type !== 'ssh_key') {
    prepared.url = normalizeEntryUrl(prepared.url);
  }
  return prepared;
}

export function preloadFavicon(url) {
  const src = getFaviconUrl(url);
  if (!src) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

export function onFaviconError(img) {
  const wrapper = img?.closest?.('.dash-tile-logo, .entry-icon');
  if (!wrapper) return;

  const siteUrl = img.dataset.siteUrl;
  if (siteUrl && !wrapper.dataset.faviconRetried) {
    try {
      const origin = new URL(normalizeEntryUrl(siteUrl)).origin;
      const retryUrl = getFaviconUrl(origin);
      if (retryUrl && retryUrl !== img.src) {
        wrapper.dataset.faviconRetried = '1';
        img.addEventListener('error', () => {
          wrapper.classList.add('is-fallback');
        }, { once: true });
        img.src = retryUrl;
        return;
      }
    } catch {
      /* noop */
    }
  }

  wrapper.classList.add('is-fallback');
}

export function setupFaviconImages(root = document) {
  root.querySelectorAll('img.entry-favicon, img.dash-tile-favicon').forEach((img) => {
    if (img.dataset.faviconBound) return;
    img.dataset.faviconBound = '1';
    if (img.complete && img.naturalHeight === 0) onFaviconError(img);
    else img.addEventListener('error', () => onFaviconError(img), { once: true });
  });
}

window.onFaviconError = onFaviconError;
