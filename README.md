# BINALPH93 — Gestionnaire de mots de passe

Application web **zero-knowledge** : le serveur ne stocke que des blobs chiffrés. Le déchiffrement se fait dans le navigateur avec la clé maître de l'utilisateur.

## Documentation

Toute la doc détaillée est dans [`docs/`](./docs/) :

| Fichier | Contenu |
|---------|---------|
| [docs/README.md](./docs/README.md) | Index |
| [docs/GUIDE-UTILISATEUR.md](./docs/GUIDE-UTILISATEUR.md) | Utilisation du site |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Stack et flux |
| [docs/API.md](./docs/API.md) | Endpoints HTTP |
| [docs/DEPLOIEMENT.md](./docs/DEPLOIEMENT.md) | Local, Supabase, Vercel |
| [docs/SECURITE.md](./docs/SECURITE.md) | Modèle de sécurité |

## Démarrage rapide

```bash
pip install -r requirements.txt
cp .env.example .env
# Renseigner DATABASE_URL et DIRECT_DATABASE_URL (Supabase)
python manage.py migrate
python manage.py runserver
```

Ouvrir `http://127.0.0.1:8000/`.

Sans `DATABASE_URL`, Django utilise SQLite (`vault.db`).

## Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Django (`vault/`, `coffre/`) |
| Frontend | HTML/CSS/JS (`frontend/`) |
| Base | PostgreSQL (Supabase) |
| Prod | Vercel + Supabase |

> Supabase = **hébergeur PostgreSQL uniquement**. Auth = JWT Django, pas Supabase Auth.

## Structure

```
coffre/      Settings Django, WSGI
vault/       API auth + coffre
frontend/    UI PWA
supabase/    schema.sql
docs/        Documentation
cli/         CLI optionnel
backend/     Archive FastAPI (non utilisée)
```

## Licence / repo

https://github.com/alphabarry015/Gestionnnaire-de-mot-de-passe
