# Coffre-Fort — Gestionnaire de mots de passe

Application web **zero-knowledge** : le serveur ne stocke que des blobs chiffrés. Le déchiffrement se fait dans le navigateur avec la clé maître de l'utilisateur.

## Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Django 5+ (`vault/`) |
| Frontend | HTML/CSS/JS vanilla (`frontend/`) |
| Base | **PostgreSQL** (hébergé sur [Supabase](https://supabase.com)) |
| Crypto | WebCrypto + Argon2 (client) |

> Supabase sert ici **uniquement d'hébergeur PostgreSQL**. L'authentification reste gérée par Django (JWT maison), pas par Supabase Auth.

## Démarrage

```bash
pip install -r requirements.txt
cp .env.example .env
# Renseigner DATABASE_URL et DIRECT_DATABASE_URL dans .env
python manage.py migrate
python manage.py runserver
```

Ouvrir `http://127.0.0.1:8000/`.

### Dev local sans Supabase

Si `DATABASE_URL` n'est pas défini, Django utilise **SQLite** (`vault.db`) automatiquement.

```bash
python manage.py migrate
python manage.py runserver
```

### Configuration Supabase

1. Créer un projet sur [supabase.com](https://supabase.com)
2. **Project Settings → Database → Connection string**
3. Copier dans `.env` :
   - **Transaction pooler** (port `6543`) → `DATABASE_URL` (runtime)
   - **Direct connection** (port `5432`) → `DIRECT_DATABASE_URL` (migrations)

```env
DATABASE_URL=postgresql://postgres.[REF]:[PWD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
DIRECT_DATABASE_URL=postgresql://postgres.[REF]:[PWD]@db.[REF].supabase.co:5432/postgres?sslmode=require
```

4. Appliquer le schéma Django :

```bash
python manage.py migrate
```

Les commandes `migrate`, `makemigrations`, etc. utilisent automatiquement `DIRECT_DATABASE_URL` si elle est définie.

### Mode développement UI

Sur `localhost`, laisser email et mot de passe **vides** à la connexion charge l'interface avec des entrées de démonstration en mémoire (aucun appel API).

Désactiver : `?dev=0` dans l'URL.

## Structure du projet

```
coffre/          # Settings Django, routes racine
vault/           # API auth + coffre + favicons
frontend/        # UI PWA (dashboard, modales, crypto client)
cli/             # Client ligne de commande optionnel
backend/         # ⚠️ Ancienne API FastAPI — non utilisée, conservée à titre d'archive
```

## API principale

| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/auth/register` | Création de compte |
| POST | `/auth/login` | Connexion (JWT) |
| GET/PATCH | `/auth/me` | Profil utilisateur |
| GET/POST | `/vault/entries` | Lister / créer des entrées |
| GET/PUT/DELETE | `/vault/entries/<id>` | Détail / modifier / supprimer |
| GET | `/vault/favicon?url=` | Proxy favicon public |
| GET | `/health/` | Santé du service |

## Sécurité

- Mots de passe et métadonnées d'entrées chiffrés **avant** envoi au serveur
- JWT Bearer pour les routes protégées
- Favicons : requêtes sortantes limitées aux hôtes publics (pas d'IP privée)
- Ne jamais committer `.env` (mot de passe base Supabase)

## PWA

Service worker `frontend/sw.js` — incrémenter `CACHE_VERSION` après modification des assets statiques.

## Déploiement Vercel

Le projet est prêt pour Vercel (Django zero-config + PostgreSQL Supabase obligatoire en production).

### Prérequis

1. Projet [Supabase](https://supabase.com) avec `DATABASE_URL` (pooler, port **6543**) et `DIRECT_DATABASE_URL` (direct, port **5432**)
2. Compte [Vercel](https://vercel.com) connecté au dépôt GitHub

### Variables d'environnement Vercel

| Variable | Valeur |
|----------|--------|
| `SECRET_KEY` | Clé secrète Django (générer une valeur aléatoire) |
| `DEBUG` | `false` |
| `DATABASE_URL` | Pooler Supabase (runtime) |
| `DIRECT_DATABASE_URL` | Connexion directe Supabase (migrations au build) |
| `ALLOWED_HOSTS` | Domaine personnalisé (optionnel) |

> Sur Vercel, SQLite n'est pas utilisable. `DATABASE_URL` est **obligatoire**.

### Déployer

**Via le dashboard** : importer le repo GitHub sur [vercel.com/new](https://vercel.com/new). Vercel détecte `manage.py` et `coffre/wsgi.py` automatiquement.

**Via la CLI** :

```bash
npm i -g vercel
vercel login
vercel link
vercel env pull .env.local
vercel deploy --prod
```

Le build génère les icônes PWA. Les migrations se font **en local** (la connexion directe Supabase est souvent inaccessible depuis les builders Vercel / IPv6) :

```bash
python manage.py migrate
```

Ou exécutez `supabase/schema.sql` dans le SQL Editor Supabase.

### Fichiers de configuration

| Fichier | Rôle |
|---------|------|
| `vercel.json` | Build, durée max des fonctions, en-têtes PWA |
| `pyproject.toml` | Entrypoint WSGI et script de build |
| `.vercelignore` | Exclut `backend/`, `cli/`, SQLite du bundle |

### Vérifier en production

- `GET /health/` → `{"status": "ok"}`
- Inscription / connexion avec un compte réel (le mode dev UI est désactivé hors localhost)

