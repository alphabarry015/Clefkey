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
  const byId = new Map(list.map((item) => [item?.id, item]));
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    const name = normalizeFolderName(item?.name);
    if (!id || !name || seen.has(id)) continue;
    let parentId = (typeof item?.parentId === 'string' ? item.parentId.trim() : '');
    if (parentId === id) parentId = '';
    const parent = byId.get(parentId);
    if (!parentId || !parent) {
      parentId = '';
    } else if (folderHasAncestor(parent, byId, new Set([id]))) {
      // Cycle détecté (parent ou ascendant pointe vers ce dossier) → dossier racine.
      parentId = '';
    }
    seen.add(id);
    out.push({ id, name, parentId });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

function folderHasAncestor(folder, byId, visited) {
  let cursor = folder;
  while (cursor) {
    if (visited.has(cursor.id)) return true;
    visited.add(cursor.id);
    const parentId = typeof cursor?.parentId === 'string' ? cursor.parentId.trim() : '';
    if (!parentId || parentId === cursor.id) return false;
    cursor = byId.get(parentId) || null;
  }
  return false;
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

export function topLevelFolders(folders) {
  return (folders || []).filter((f) => !f.parentId);
}

export function folderChildren(folders, parentId) {
  if (!parentId) return [];
  return (folders || [])
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
}

export function hasFolderChildren(folders, parentId) {
  return (folders || []).some((f) => f.parentId === parentId);
}

/** Ids de tous les descendants (toutes profondeurs) d’un dossier, lui-même exclu. */
export function folderDescendantIds(folders, folderId) {
  const ids = new Set();
  const walk = (id) => {
    for (const f of folders || []) {
      if (f.parentId === id && !ids.has(f.id)) {
        ids.add(f.id);
        walk(f.id);
      }
    }
  };
  walk(folderId);
  return ids;
}

/** true si `maybeDescendantId` est un descendant (ou lui-même) de `folderId`. */
export function isFolderDescendant(folders, folderId, maybeDescendantId) {
  const ids = folderDescendantIds(folders, folderId);
  ids.add(folderId);
  return ids.has(maybeDescendantId);
}

/** Profondeur d’un dossier (0 = racine). */
export function folderDepth(folders, folderId) {
  const byId = new Map((folders || []).map((f) => [f.id, f]));
  let depth = 0;
  let cursor = byId.get(folderId);
  const guard = 0;
  while (cursor && cursor.parentId && depth < 1000) {
    depth += 1;
    cursor = byId.get(cursor.parentId);
    if (!cursor || cursor.id === folderId) break;
  }
  return depth;
}
