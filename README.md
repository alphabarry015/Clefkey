# Coffre-Fort — Gestionnaire de mots de passe

Application web **zero-knowledge** : le serveur ne stocke que des blobs chiffrés. Le déchiffrement se fait dans le navigateur avec la clé maître de l'utilisateur.

## Stack

| Couche | Technologie |
|--------|-------------|
| Backend | Django 5+ (`vault/`) |
| Frontend | HTML/CSS/JS vanilla (`frontend/`) |
| Base | SQLite (`vault.db`) |
| Crypto | WebCrypto + Argon2 (client) |

## Démarrage

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Ouvrir `http://127.0.0.1:8000/`.

### Mode développement

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

## PWA

Service worker `frontend/sw.js` — incrémenter `CACHE_VERSION` après modification des assets statiques.
