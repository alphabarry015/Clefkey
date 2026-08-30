/* Favicons via le serveur local (fichiers publics des sites, comme un navigateur). */

let getAuthToken = () => null;

/** Fournit le JWT pour GET /vault/favicon (les <img src> ne peuvent pas envoyer Bearer). */
export function setFaviconAuth(fn) {
  getAuthToken = typeof fn === 'function' ? fn : () => null;
}

export function normalizeEntryUrl(url) {
  const value = (url || '').trim();
  if (!value) return '';
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
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
  return `${window.location.origin}/vault/favicon?url=${encodeURIComponent(pageUrl)}&v=9`;
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

const blobCache = new Map();

function cacheKey(url) {
  return normalizeEntryUrl(url) || '';
}

export async function fetchFaviconBlobUrl(url) {
  const apiUrl = getFaviconUrl(url);
  const token = getAuthToken();
  const key = cacheKey(url);
  if (!apiUrl || !token || !key) return null;

  const hit = blobCache.get(key);
  if (hit?.blobUrl) return hit.blobUrl;
  if (hit?.inflight) return hit.inflight;

  const inflight = (async () => {
    const res = await fetch(apiUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || blob.size === 0) return null;
    return URL.createObjectURL(blob);
  })();

  blobCache.set(key, { inflight });
  try {
    const blobUrl = await inflight;
    if (blobUrl) blobCache.set(key, { blobUrl });
    else blobCache.delete(key);
    return blobUrl;
  } catch {
    blobCache.delete(key);
    return null;
  }
}

export function preloadFavicon(url) {
  return fetchFaviconBlobUrl(url).then(Boolean);
}

export function onFaviconError(img) {
  const wrapper = img?.closest?.('.dash-tile-logo, .entry-icon');
  if (!wrapper) return;

  const siteUrl = img.dataset.siteUrl;
  if (siteUrl && !wrapper.dataset.faviconRetried) {
    try {
      const origin = new URL(normalizeEntryUrl(siteUrl)).origin;
      wrapper.dataset.faviconRetried = '1';
      fetchFaviconBlobUrl(origin).then((blobUrl) => {
        if (blobUrl) {
          img.src = blobUrl;
          return;
        }
        wrapper.classList.add('is-fallback');
      });
      return;
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
    const siteUrl = img.dataset.siteUrl;
    if (!siteUrl) {
      onFaviconError(img);
      return;
    }
    fetchFaviconBlobUrl(siteUrl).then((blobUrl) => {
      if (!blobUrl) {
        onFaviconError(img);
        return;
      }
      img.addEventListener('error', () => onFaviconError(img), { once: true });
      img.src = blobUrl;
    });
  });
}

window.onFaviconError = onFaviconError;
