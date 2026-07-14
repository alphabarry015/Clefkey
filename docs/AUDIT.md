# Audit — sécurité, performance, maintenance

Date : 2026-07-13 · Périmètre : Django (`coffre/`, `vault/`) + frontend PWA + docs.

Document vivant : mettre à jour après changements majeurs. Synthèse visuelle : canvas IDE si disponible.

---

## Synthèse

| Domaine | Verdict |
|---------|---------|
| Modèle zero-knowledge | Solide (chiffrement client, blobs serveur) |
| Auth / JWT | Correct avec durcissements récents |
| Surface d’attaque | Limitée (SPA same-origin, CSP, rate limit) |
| Performance inscription | Améliorée (chargement listes en 2 phases) |
| Maintenance | `backend/` FastAPI = archive ; Django = source de vérité |

---

## Sécurité

### Correctifs appliqués (cette passe)

| Sévérité | Sujet | Action |
|----------|-------|--------|
| Haute | Énumération via `/auth/salt` (404) | Sel factice déterministe si email inconnu |
| Haute | Timing login si user absent | `compare_digest` aussi sur vérifieur factice |
| Haute | `SECRET_KEY` par défaut sur Vercel | `RuntimeError` si clé de dév en prod |
| Moyenne | Blobs `encrypted_data` illimités | Cap 256 KiB décodés |
| Moyenne | Exemple Vercel avec clé réelle | Placeholder dans `supabase/vercel.env.example` |
| Basse | UA favicon obsolète | `Gardefort/1.0` |
| Basse | Cache favicon non borné | LRU max 256 entrées |

### Risques résiduels (acceptés ou à traiter plus tard)

| Sévérité | Sujet | Notes |
|----------|-------|--------|
| Moyenne | Énumération via `POST /auth/register` (409 email) | Difficile sans UX dégradée ; rate limit partiel |
| — | Rate limit mémoire sans Upstash | **Corrigé 2026-07-14** : Upstash obligatoire sur Vercel, fail-closed |
| Haute | key_proof brut en DB | **Corrigé 2026-07-14** : HMAC(SECRET_KEY) au stockage |
| Haute | Favicon redirects SSRF | **Corrigé 2026-07-14** : follow manuel + revalidation chaque hop |
| Moyenne | `X-Forwarded-For` pour l’IP | OK derrière Vercel ; ne pas exposer l’app sans proxy de confiance |
| Basse | XSS si `esc()` oublié dans un futur template | CSP + discipline `esc()` ; revue PR |
| Basse | Pas de refresh token / révocation JWT | TTL 60 min ; acceptable pour ce modèle |
| Info | Dossier `backend/` FastAPI | Non déployé ; ne pas confondre avec l’API active |

### Déjà en place (points forts)

- Argon2id + AES-GCM + auth_verifier dérivé côté client
- CSP `script-src 'self'`, HSTS, COOP, framing DENY
- Vendor local (plus de CDN esm.sh)
- Anti-SSRF favicon (pas d’IP privée / localhost)
- Listes SecLists côté navigateur uniquement
- Anti-autofill maître

---

## Performance

| Sujet | Constat | Action / statut |
|-------|---------|-----------------|
| Listes MDP (~10 Mo, 69 fichiers) | Bloquait l’inscription | Chargement **priority** puis reste en arrière-plan |
| `toB64` spread | Risque stack overflow gros blobs | Encodage par chunks |
| Liste coffre | Pas de pagination | OK pour usage perso ; à prévoir si > quelques milliers d’entrées |
| Favicon | Cache mémoire | Borné à 256 clés |
| Argon2id (64 Mo) | Coût CPU inscription/login | Worker `argon2-worker.js` (fallback thread UI) |

## Tests / CI (2026-07-14)

| Sujet | Statut |
|-------|--------|
| Smoke crypto / auth / recovery / favicon SSRF | `vault/tests/` |
| GitHub Actions | `.github/workflows/ci.yml` |
| Découpage UI auth | `frontend/js/auth-screens.js` |

---

## Maintenance / propreté

| Sujet | Action |
|-------|--------|
| Source de vérité API | `vault/` + `coffre/` uniquement |
| Archive FastAPI | `backend/` — ne plus étendre ; documenté ici et dans README |
| Sync listes | `python scripts/sync_common_password_lists.py` |
| Vendor JS | `python scripts/vendor_frontend_deps.py` + bump `CACHE_VERSION` |
| Schéma SQL | Commentaire Vercel migrate corrigé (`supabase/schema.sql`) |
| Docs | Index, SECURITE, API, ce fichier AUDIT |

### Conventions utiles

- Modules Python : docstring de module en tête
- Erreurs API : `{ "detail": "…" }`
- Secrets : jamais dans le repo (`.env`, clés d’exemple factices)
- PWA : incrémenter `frontend/sw.js` → `CACHE_VERSION` après assets

---

## Checklist opérateur (prod)

1. `SECRET_KEY` unique et long (pas la valeur d’exemple)
2. `DEBUG=false`
3. `DATABASE_URL` (pooler) + migrations appliquées (local ou SQL Editor)
4. Upstash recommandé pour le rate limit
5. Redeploy Vercel sur le dernier `main`
6. Ne pas committer `.env`
