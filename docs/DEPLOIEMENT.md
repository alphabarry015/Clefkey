# Déploiement — Clefkey.

Dépôt **public** : ne versionnez jamais un `.env` rempli, ni collage de secrets dans la doc ou les issues. Utilisez uniquement les placeholders des fichiers `*.example`.

## Développement local

```bash
pip install -r requirements.txt
cp .env.example .env
# Renseigner SECRET_KEY, DATABASE_URL, DIRECT_DATABASE_URL (voir ci-dessous)
python manage.py migrate
python manage.py runserver
```

Ouvrir `http://127.0.0.1:8000/`.

Sans `DATABASE_URL` → SQLite (`vault.db`).

## Variables d’environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `SECRET_KEY` | Oui (prod) | Clé Django / JWT |
| `DEBUG` | Non | `true` local, `false` Vercel |
| `DATABASE_URL` | Oui (prod) | Pooler Supabase port **6543** |
| `DIRECT_DATABASE_URL` | Recommandé | Direct `db.…:5432` pour migrations locales |
| `ALLOWED_HOSTS` | Non sur Vercel | Domaine custom optionnel (`.vercel.app` auto) |
| `UPSTASH_REDIS_REST_URL` | **Oui (Vercel)** | Rate limit partagé (Upstash) — obligatoire en prod |
| `UPSTASH_REDIS_REST_TOKEN` | **Oui (Vercel)** | Token REST Upstash |
| `RATE_LIMIT_ALLOW_MEMORY` | Non | Contournement déconseillé si Upstash absent |

### Format URLs Supabase

```env
DATABASE_URL=postgresql://postgres.[REF]:[MDP]@aws-0-[REGION].pooler.supabase.com:6543/postgres?sslmode=require
DIRECT_DATABASE_URL=postgresql://postgres:[MDP]@db.[REF].supabase.co:5432/postgres?sslmode=require
```

Notes :
- Encoder les caractères spéciaux du mot de passe (`@` → `%40`, `!` → `%21`).
- **Ne pas** laisser `pgbouncer=true` dans l’URL (incompatible psycopg3 ; Django le retire aussi automatiquement).
- Les anon key / Project URL Supabase **ne sont pas** utilisées.

### Créer les tables

```bash
python manage.py migrate
```

Ou SQL Editor Supabase → contenu de `supabase/schema.sql`.

## Vercel

1. Importer le dépôt GitHub.
2. Variables (Production + Preview) :

| Name | Value |
|------|--------|
| `SECRET_KEY` | même que local |
| `DEBUG` | `false` |
| `DATABASE_URL` | pooler 6543 |
| `DIRECT_DATABASE_URL` | direct 5432 (optionnel runtime) |

3. Ne pas définir `ALLOWED_HOSTS` (sauf domaine perso).
4. Deploy.

Fichiers :
- `vercel.json` — build (icônes PWA), timeout, headers
- `pyproject.toml` — entrypoint `coffre.wsgi:application`
- `.vercelignore` — exclut archive FastAPI / CLI / SQLite

Le build **ne lance pas** `migrate` (connexion directe IPv6 souvent inaccessible depuis Vercel). Migrer en local une fois.

### Vérifications

- `GET /health/` → `{"status":"ok"}`
- Inscription réelle → ligne dans Table Editor Supabase → `users`
- Commit déployé = dernier `main` (éviter « Redeploy » d’un ancien déploiement)

## PWA

Après modification des assets : incrémenter `CACHE_VERSION` dans `frontend/sw.js`.
