# Architecture — Clefkey.

## Vue d’ensemble

```
Navigateur (frontend/)
  ├─ UI (HTML / CSS / JS)
  ├─ WebCrypto + Argon2 (dérivation de clés, AES-GCM)
  └─ api.js → HTTP JSON
         │
         ▼
Django (coffre/ + vault/)  ──JWT──► PostgreSQL (Supabase)
  ├─ Auth (register / login / me / recovery)
  ├─ Entrées (blobs chiffrés) + shares
  ├─ Favicon proxy (anti-SSRF)
  ├─ Username-check proxy (base Sherlock)
  └─ Rate limit (Upstash en prod)
```

Récit détaillé des concepts et flux : [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md).

## Stack

| Couche | Techno |
|--------|--------|
| Backend | Django 5+ / 6, WSGI (`coffre.wsgi`) |
| Frontend | Vanilla JS (modules ES), CSS, PWA |
| Base | PostgreSQL via Supabase (ou SQLite en local sans `DATABASE_URL`) |
| Auth | JWT Bearer (Django), **pas** Supabase Auth |
| Rate limit | Upstash Redis REST (obligatoire sur Vercel) |
| Hébergement prod | Vercel (fonction Python) + Supabase |

## Dossiers

```
coffre/           # Settings, URLs racine, WSGI
vault/            # Modèles, vues API, recovery, shares, favicon
frontend/         # index.html, css/, js/, icons/, sw.js, manifest
supabase/         # schema.sql, exemples d’env Vercel (placeholders)
scripts/          # Génération icônes PWA, vendor, sync listes
cli/              # Client CLI optionnel
backend/          # Archive FastAPI (non utilisée)
docs/             # Cette documentation
```

Secrets : uniquement via variables d’environnement (fichier `.env` local gitignoré, dashboard Vercel en prod). Jamais de valeurs réelles dans les fichiers versionnés (dépôt public).

## Flux crypto (simplifié)

1. **Inscription** : le client dérive (Argon2id) un matériel d’auth et une clé de coffre, génère une paire de clés, chiffre la vault key et la clé privée, enregistre un chemin de recovery, envoie les blobs + un `auth_verifier`.
2. **Connexion** : salt (éventuellement factice) → dérivation du verifier → JWT si OK → déchiffrement local de la vault key.
3. **Entrées** : JSON clair (titre, type `login`|`api_key`, username, password, notes, URL) chiffré AES-GCM ; la base ne stocke que `encrypted_data` (BYTEA).
4. **Recovery** : preuve scellée côté serveur (HMAC), jamais le code de récupération en clair en base.

## Tables principales

| Table | Rôle |
|-------|------|
| `users` | Compte + matériel crypto (salt, verifier, clés chiffrées, recovery) |
| `vault_entries` | Entrées du coffre (`encrypted_data`, `owner_id`) |
| tables shares | Partages d’entrées (blobs / métadonnées non sensibles en clair) |

Schéma SQL de référence : `supabase/schema.sql`.

## Frontend

- UI vanilla dans `frontend/` (HTML / CSS / modules ES)
- Modules notables : `crypto.js`, `session.js`, `auth-screens.js`, `recovery-input.js`, `app.js`, `api.js`, `vault-views.js`, `generator.js`, `shortcuts.js`
- Crypto & icônes **vendored** dans `frontend/vendor/` (pas de CDN)
- Listes SecLists (sélection) : `frontend/data/` + chargement 2 phases
- Sync listes : `python scripts/sync_common_password_lists.py`
- Régénération vendor : `python scripts/vendor_frontend_deps.py`
- Archive : `backend/` (FastAPI) n’est **pas** déployé

## Générateur & vérification d’usernames

- Moteur de vérification : `vault/username_check.py` (asyncio + `httpx`) — déduit la disponibilité d’un username depuis la réponse des sites (code HTTP, message d’erreur ou redirection).
- Base des sites : `vault/data/sherlock-data.json` (~480 sites, format officiel Sherlock).
- Sync base : `python scripts/sync_sherlock_data.py` (télécharge le `data.json` officiel, exclut `$schema` et les sites NSFW).
- Endpoints : `GET /vault/username-check` (1 username) et `GET /vault/usernames-check` (lot ≤ 12, 1 requête), rate limit 20/min.
- Utilisé par l’onglet **Username** du Générateur et le mode **Username** de l’Audit.

## Mode développement UI

`frontend/js/dev.js` : sur localhost, bypass API avec des entrées mock **fictives**. Inactif hors localhost (sauf `?dev=1`). Aucune clé réelle dans ces mocks.
