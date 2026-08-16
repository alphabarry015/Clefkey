# API HTTP — Clefkey.

Base URL : origine du site (`https://…vercel.app` ou `http://127.0.0.1:8000`).

Format : JSON. Erreurs : `{ "detail": "message" }`.

Authentification des routes protégées :

```http
Authorization: Bearer <access_token>
```

Les exemples ci-dessous sont schématiques. N’y placez jamais de jetons, mots de passe ou emails personnels réels dans le dépôt public.

## Santé & assets

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/` | Application (SPA HTML) |
| GET | `/favicon.ico` | Favicon du site |
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
| GET | `/auth/me` | Oui | Profil (noms, email, compteurs — **sans** matériel crypto) |
| PATCH | `/auth/me` | Oui | Mise à jour profil (noms, email) |
| POST | `/auth/recovery/begin` | Non | Démarre la récupération (preuve / challenge) |
| POST | `/auth/recovery/complete` | Non | Termine la récupération et régénère le matériel |

### POST `/auth/register` (corps typique)

Champs texte : `email`, `first_name`, `middle_name`, `last_name`  
Champs base64 : `salt` (16 o), `auth_verifier` (32 o), `public_key` (32 o), `encrypted_vault_key` / `encrypted_private_key` (AES-GCM 60–512 o), plus `recovery_keys` (exactement 7 paquets).

Réponse **201** : `access_token`, `user_id`, `email`, noms, blobs crypto (nécessaires au client pour déverrouiller — pas renvoyés ensuite par `/auth/me`).

### GET / PATCH `/auth/me`

Profil uniquement (noms, email, `entries_count`). Le matériel crypto n’est **pas** exposé : il reste disponible après login / register / recovery, et en session locale (`authMaterial`).

### POST `/auth/login`

```json
{ "email": "utilisateur@exemple.org", "auth_verifier": "<base64>" }
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
| POST | `/vault/shares` | Oui | Créer un partage |
| GET | `/vault/shares/received` | Oui | Partages reçus |
| GET | `/vault/shares/sent` | Oui | Partages envoyés |
| GET / DELETE / … | `/vault/shares/<id>` | Oui | Détail / actions sur un partage |
| GET | `/vault/username-check?username=…&limit=` | Oui | Disponibilité d’un username (proxy Sherlock) |
| GET | `/vault/usernames-check?usernames=a,b,c&limit=` | Oui | Disponibilité en lot (1 requête pour ≤ 12 usernames) |

\* Le proxy favicon est public mais restreint (pas d’IP privées) et rate-limité.

Le **type** d’entrée (`login` ou `api_key`) vit uniquement dans le JSON chiffré côté client. L’API ne le distingue pas : elle stocke un blob opaque (plafond ~256 KiB décodés).

## Vérification d’usernames — `/vault/username-check` et `/vault/usernames-check`

Proxy côté serveur de la base [Sherlock](https://sherlockproject.xyz) (`vault/data/sherlock-data.json`, ~480 sites). Le serveur interroge chaque site avec le username fourni et déduit la disponibilité à partir de la réponse (code HTTP, message d’erreur ou URL de redirection).

### GET `/vault/username-check?username=…&limit=…`

- `username` : 3–30 caractères (lettres, chiffres, `.`, `_`, `-`) — sinon **400**.
- `limit` : nombre de sites vérifiés, par défaut **60**, max **300**.
- Réponse : `{ "username", "attempted", "checked", "failed", "found", "found_count", "not_found_count", "inconclusive_count" }`.

### GET `/vault/usernames-check?usernames=a,b,c&limit=…`

- `usernames` : liste séparée par des virgules, **≤ 12** noms (les suivants sont ignorés).
- `limit` : sites par nom, par défaut **15**, max **30**.
- Compte pour **1 requête** de rate limit.
- Réponse : `{ "usernames": [ {…mêmes champs…} ], "sites_per_name": limit }`.

## Rate limiting

Réponses **429** si trop de requêtes (par IP, fenêtre ~60 s) :

| Scope | Limite / min (approx.) |
|-------|------------------------|
| Register | 5 |
| Login | 10 |
| Salt | 20 |
| Favicon | 60 |
| Generate-password | 30 |
| Username-check | 20 (1 requête lot = 1) |

En production Vercel, le compteur est partagé via Upstash (fail-closed si mal configuré).

## Codes HTTP utiles

| Code | Signification |
|------|----------------|
| 400 | Données invalides |
| 401 | Non authentifié / mauvais credentials |
| 404 | Entrée introuvable |
| 409 | Email déjà utilisé |
| 429 | Trop de tentatives (rate limit) |
| 201 | Compte / ressource créée |
