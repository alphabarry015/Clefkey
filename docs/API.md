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
| POST | `/auth/password` | Oui | Change le mot de passe maître (session déverrouillée, sans clés de récupération) |
| POST | `/auth/passphrase` | Oui | Crée / change la passphrase (soft-lock) |
| POST | `/auth/recovery/begin` | Non | Démarre la récupération (preuve / challenge) |
| POST | `/auth/recovery/complete` | Non | Termine la récupération (nouveau mot de passe maître) |
| POST | `/auth/recovery/passphrase` | Non | Termine la récupération (nouvelle passphrase) |

### POST `/auth/register` (corps typique)

Champs texte : `email`, `first_name`, `middle_name`, `last_name`  
Champs base64 : `salt` (16 o), `auth_verifier` (32 o), `public_key` (32 o), `encrypted_vault_key` / `encrypted_private_key` (AES-GCM 60–512 o), `passphrase_salt`, `passphrase_verifier`, `encrypted_vault_key_passphrase`, plus `recovery_keys` (exactement 7 paquets).

Réponse **201** : `access_token`, `user_id`, `email`, noms, blobs crypto (nécessaires au client pour déverrouiller — pas renvoyés ensuite par `/auth/me`).

### GET / PATCH `/auth/me`

Profil uniquement (noms, email, `entries_count`). Le matériel crypto n’est **pas** exposé : il reste disponible après login / register / recovery, et en session locale (`authMaterial`).

### POST `/auth/password`

Session JWT + preuve de l’ancien maître (vérificateur dérivé). Corps :

```json
{
  "current_auth_verifier": "<base64>",
  "auth_verifier": "<base64>",
  "encrypted_vault_key": "<base64>"
}
```

Le serveur compare le vérificateur actuel, remplace le vérificateur et le blob de `vaultKey`. Les clés de récupération **ne sont pas** consommées. Réponse : même forme que login (`access_token` + matériaux, y compris passphrase si configurée).

### POST `/auth/passphrase`

Crée ou change la passphrase (soft-lock). Corps :

```json
{
  "current_passphrase_verifier": "<base64>",
  "passphrase_salt": "<base64>",
  "passphrase_verifier": "<base64>",
  "encrypted_vault_key_passphrase": "<base64>"
}
```

`current_passphrase_verifier` est **requis** seulement si une passphrase existe déjà. Les clés de récupération **ne sont pas** consommées. Réponse : même forme que login (`has_passphrase`, blobs passphrase).

### POST `/auth/recovery/passphrase`

Après `recovery/begin` (unwrap local de `vaultKey`), le client envoie une nouvelle passphrase + `verifier` + `key_proof`. La clé de récupération utilisée est **invalidée**. Réponse : session + matériaux (comme login).

### POST `/auth/login`

```json
{ "email": "utilisateur@exemple.org", "auth_verifier": "<base64>" }
```

Réponse : JWT + blobs crypto, dont `passphrase_salt` / `encrypted_vault_key_passphrase` si le compte en a (`has_passphrase: true`).

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

\* Le proxy favicon est public mais restreint (pas d’IP privées) et rate-limité.

Le **type** d’entrée (`login`, `oauth`, `api_key` ou `ssh_key`) vit uniquement dans le JSON chiffré côté client. L’API ne le distingue pas : elle stocke un blob opaque (plafond ~256 KiB décodés).

## Rate limiting

Réponses **429** si trop de requêtes (par IP, fenêtre ~60 s) :

| Scope | Limite / min (approx.) |
|-------|------------------------|
| Register | 5 |
| Login | 10 |
| Salt | 20 |
| Favicon | 60 |
| Generate-password | 30 |

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
