# Architecture — Gestion’air

## Vue d’ensemble

```
Navigateur (frontend/)
  ├─ UI (HTML / CSS / JS)
  ├─ WebCrypto + Argon2 (dérivation de clés, AES-GCM)
  └─ api.js → HTTP JSON
         │
         ▼
Django (coffre/ + vault/)  ──JWT──► PostgreSQL (Supabase)
  ├─ Auth (register / login / me)
  ├─ Entrées (blobs chiffrés)
  └─ Favicon proxy
```

## Stack

| Couche | Techno |
|--------|--------|
| Backend | Django 5+ / 6, WSGI (`coffre.wsgi`) |
| Frontend | Vanilla JS (modules ES), CSS, PWA |
| Base | PostgreSQL via Supabase (ou SQLite en local sans `DATABASE_URL`) |
| Auth | JWT Bearer (Django), **pas** Supabase Auth |
| Hébergement prod | Vercel (fonction Python) + Supabase |

## Dossiers

```
coffre/           # Settings, URLs racine, WSGI
vault/            # Modèles, vues API, crypto serveur (génération MDP), favicon
frontend/         # index.html, css/, js/, icons/, sw.js, manifest
supabase/         # schema.sql, exemples d’env Vercel
scripts/          # Génération icônes PWA
cli/              # Client CLI optionnel
backend/          # Archive FastAPI (non utilisée)
docs/             # Cette documentation
```

## Flux crypto (simplifié)

1. **Inscription** : le client dérive un salt / clé maître (Argon2), génère une vault key + paire de clés, chiffre la vault key et la clé privée, envoie les blobs + un `auth_verifier`.
2. **Connexion** : le serveur renvoie salt + blobs ; le client vérifie le maître localement et déchiffre.
3. **Entrées** : titre, username, password, notes, URL sont chiffrés côté client ; la base ne stocke que `encrypted_data` (BYTEA).

## Tables principales

| Table | Rôle |
|-------|------|
| `users` | Compte + matériel crypto (salt, verifier, clés chiffrées) |
| `vault_entries` | Entrées du coffre (`encrypted_data`, `owner_id`) |

Schéma SQL de référence : `supabase/schema.sql`.

## Frontend

- UI vanilla dans `frontend/` (HTML / CSS / modules ES)
- Crypto & icônes **vendored** dans `frontend/vendor/` (pas de CDN)
- Listes SecLists (sélection) : `frontend/data/` + `js/common-passwords.js` / `js/master-password.js` (chargement 2 phases)
- Sync listes : `python scripts/sync_common_password_lists.py`
- Régénération vendor : `python scripts/vendor_frontend_deps.py`
- Archive : `backend/` (FastAPI) n’est **pas** déployé — ne pas y ajouter de features

## Mode développement UI

`frontend/js/dev.js` : sur localhost, bypass API avec des entrées mock. Inactif hors localhost (sauf `?dev=1`).
