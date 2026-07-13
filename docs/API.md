# API HTTP — BINALPH93

Base URL : origine du site (`https://…vercel.app` ou `http://127.0.0.1:8000`).

Format : JSON. Erreurs : `{ "detail": "message" }`.

Authentification des routes protégées :

```http
Authorization: Bearer <access_token>
```

## Santé & assets

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Application (SPA HTML) |
| GET | `/health/` | `{ "status": "ok" }` |
| GET | `/manifest.webmanifest` | Manifest PWA |
| GET | `/sw.js` | Service worker |
| GET | `/css/…`, `/js/…`, `/icons/…` | Assets statiques |

## Auth — `/auth/`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/auth/register` | Non | Création de compte |
| POST | `/auth/login` | Non | Connexion → JWT |
| GET | `/auth/salt?email=` | Non | Salt pour dérivation client (toujours 200 si email fourni — sel factice si compte inconnu) |
| GET | `/auth/me` | Oui | Profil |
| PATCH | `/auth/me` | Oui | Mise à jour profil (noms, email) |

### POST `/auth/register` (corps typique)

Champs texte : `email`, `first_name`, `middle_name`, `last_name`  
Champs base64 : `salt`, `auth_verifier`, `encrypted_vault_key`, `public_key`, `encrypted_private_key`

Réponse **201** : `access_token`, `user_id`, `email`, noms, blobs crypto.

### POST `/auth/login`

```json
{ "email": "…", "auth_verifier": "<base64>" }
```

## Coffre — `/vault/`

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| GET | `/vault/entries` | Oui | Liste des entrées (blobs) |
| POST | `/vault/entries` | Oui | Créer `{ "encrypted_data": "<base64>" }` |
| GET | `/vault/entries/<id>` | Oui | Détail |
| PUT | `/vault/entries/<id>` | Oui | Remplacer le blob |
| DELETE | `/vault/entries/<id>` | Oui | Supprimer |
| GET | `/vault/favicon?url=` | Non* | Proxy favicon (hôtes publics) |
| POST | `/vault/generate-password` | Oui | Génération côté serveur (le client utilise aussi WebCrypto local) |

\* Le proxy favicon est public mais restreint (pas d’IP privées) et rate-limité.

## Rate limiting

Réponses **429** si trop de requêtes (par IP, fenêtre ~60 s) :

| Scope | Limite / min (approx.) |
|-------|------------------------|
| Register | 5 |
| Login | 10 |
| Salt | 20 |
| Favicon | 60 |
| Generate-password | 30 |

## Codes HTTP utiles

| Code | Signification |
|------|----------------|
| 400 | Données invalides |
| 401 | Non authentifié / mauvais credentials |
| 404 | Entrée introuvable |
| 409 | Email déjà utilisé |
| 429 | Trop de tentatives (rate limit) |
| 201 | Compte / ressource créée |

