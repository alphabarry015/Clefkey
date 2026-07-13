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
