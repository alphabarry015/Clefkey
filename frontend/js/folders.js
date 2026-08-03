/**
 * Projets / dossiers — métadonnées chiffrées dans le coffre (zero-knowledge).
 * Les partages restent hors de ce système.
 */

export const FOLDERS_META_TYPE = 'vault_meta';
export const FOLDERS_META_KIND = 'folders';

export function isFoldersMetaEntry(entry) {
  return entry?.type === FOLDERS_META_TYPE && entry?.metaKind === FOLDERS_META_KIND;
}

export function isVaultMetaEntry(entry) {
  return entry?.type === FOLDERS_META_TYPE;
}

export function newFolderId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeFolderName(name) {
  return String(name || '').trim().slice(0, 80);
}

export function normalizeFoldersList(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const name = normalizeFolderName(item?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

export function foldersFromMetaEntry(entry) {
  if (!isFoldersMetaEntry(entry)) return [];
  return normalizeFoldersList(entry.folders);
}

/** Payload chiffré pour la meta dossiers (entrée spéciale, non affichée). */
export function createFoldersMetaPayload(folders) {
  return {
    type: FOLDERS_META_TYPE,
    metaKind: FOLDERS_META_KIND,
    title: '__gardefort_folders__',
    username: '',
    password: '·',
    url: '',
    notes: '',
    folders: normalizeFoldersList(folders),
  };
}

export function entryFolderId(entry) {
  const id = entry?.folderId;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/** true si l’entrée a un folderId connu dans la liste. */
export function entryInKnownFolder(entry, folders) {
  const id = entryFolderId(entry);
  if (!id) return false;
  return folders.some((f) => f.id === id);
}

export function folderNameById(folders, folderId) {
  if (!folderId) return null;
  return folders.find((f) => f.id === folderId)?.name || null;
}
