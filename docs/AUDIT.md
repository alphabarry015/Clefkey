# Audit — sécurité, performance, maintenance

Date de révision : **2026-08-02** (correctifs P1 appliqués) · Périmètre : Django (`coffre/`, `vault/`) + frontend PWA + docs + Supabase.

Document vivant : mettre à jour après changements majeurs. Cartographie : [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md).

Dépôt **public** : aucun secret de production dans Git. `.env` ignoré ; `*.example` = placeholders.

Canvas IDE : ouvrir [`audit-complet-gardefort.canvas.tsx`](/Users/alpha/.cursor/projects/c-Fichiers-projets-Donn-es-obsidian-Fichiers-projets-Projet-Perso-Repositories-Gestionnnaire-de-mot-de-passe/canvases/audit-complet-gardefort.canvas.tsx) à côté du chat.

---

## Synthèse (2026-08-02)

| Domaine | Score /100 | Verdict |
|---------|------------|---------|
| Sécurité | 84 | P1 unlock + generate-password corrigés ; wipe renforcé |
| Performance | 68 | Decrypt parallèle ×6 ; SecLists 9.7 Mo ; transferts N×API |
| Qualité | 55 | `app.js` volumineux ; duplication listes (dette acceptée) |
| Maintenabilité | 52 | `backend/` archive ; deps `>=` non pinnées |
| Tests / CI | 54 | 21 tests Python ; 0 JS / E2E |

**Verdict global :** aucun P0. P1 audit traités. Reste P2 (favicon ZK, courses meta projets, dette monolithe).

---

## Sécurité — correctifs déjà appliqués

Historique 2026-07-16 : `/auth/me` sans blobs, caps BinaryField, key_proof v2, SSRF favicon, soft lock, RLS schema, hang master-confirm, `data-real` clear, etc.

### Correctifs 2026-08-02

| ID | Sujet | Statut |
|----|-------|--------|
| S-10 | `#unlock-password` (+ recovery / master-confirm) dans `clearAuthSecrets` | **Corrigé** |
| S-11 | Suppression `POST /vault/generate-password` (génération client only) | **Corrigé** |
| S-12 | Générateur MDP client sans biais modulo (rejection sampling) | **Corrigé** |
| S-13 | Wipe notes/username/shares + `wipeKeyBytes` sur verify master | **Corrigé** |

## Sécurité — risques résiduels

| Priorité | ID | Sujet | Action |
|----------|-----|-------|--------|
| P2 | S-14 | Favicon = exception ZK (domaine) | Doc + opt-out |
| P2 | S-15 | `backend/` FastAPI CORS `*` | Ne pas exécuter / retirer plus tard |
| P2 | S-16 | JWT sans révocation | Acceptable TTL 60 min + CSP |

### Points forts

Argon2id + AES-GCM + X25519 shares. Soft lock sans clés claires. Anti-énumération salt / timing. CSP, vendor local. Projets `vault_meta` chiffrés. Ownership + caps 256 KiB.

---

## Bugs récents (feature projets)

| Statut | Sujet |
|--------|--------|
| Corrigé v119 | Clics clés `#project-detail-list` |
| Corrigé v123–v124 | Transférer projet |
| Ouvert | Courses `persistFoldersMeta` |
| Ouvert | Transfert N appels API séquentiels |
| Ouvert | Rename projet via `window.prompt` |

---

## Performance / qualité / tests

Inchangé : voir édition précédente. Pas de gros refactor (ne pas casser ce qui marche).

---

## Checklist opérateur (prod)

1. `SECRET_KEY` unique (jamais la valeur d’exemple)  
2. `DEBUG=false`  
3. `DATABASE_URL` + migrations  
4. Upstash URL + token (Vercel)  
5. RLS Supabase (`enable_rls.sql`)  
6. Ne jamais committer `.env`, dumps, exports utilisateur  
