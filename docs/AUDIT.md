# Audit — sécurité, performance, maintenance

Date de révision : **2026-07-16** · Périmètre : Django (`coffre/`, `vault/`) + frontend PWA + docs + Supabase.

Document vivant : mettre à jour après changements majeurs. Cartographie narrative : [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md).

Dépôt **public** : aucun secret de production, jeton, chaîne de connexion réelle ni donnée personnelle réelle ne doit figurer dans Git. `.env` est ignoré ; les `*.example` ne portent que des placeholders.

Canvas consolidé (IDE) : `audit-complet-gardefort.canvas.tsx`.

---

## Synthèse (2026-07-16)

| Domaine | Score /100 | Verdict |
|---------|------------|---------|
| Sécurité | 74 | ZK solide ; surface JWT élargie via `/auth/me` |
| Performance | 61 | Double Argon2 login ; déchiffrement séquentiel |
| Qualité | 66 | `app.js` ~2131 lignes ; CSS ~3140 |
| Maintenabilité | 58 | `backend/` archive ; deps Python non pinnées |
| Tests / CI | 55 | 16 tests Python OK ; 0 tests JS |

**Verdict global :** aucun P0 de bypass auth / déchiffrement remote. Priorités : retirer le matériel crypto de `/auth/me`, borner les blobs register/recovery, corriger le hang de confirmation maître, purger `data-real`, durcir SSRF CGNAT, activer RLS Supabase.

Tests exécutés : `manage.py check` OK · `manage.py test vault.tests --keepdb` → **16/16 OK**.

---

## Sécurité

### Correctifs déjà appliqués

| Sévérité | Sujet | Action |
|----------|-------|--------|
| Haute | Énumération `/auth/salt` | Sel factice déterministe si email inconnu |
| Haute | Timing login user absent | `compare_digest` aussi sur vérifieur factice |
| Haute | `SECRET_KEY` dév sur Vercel | `RuntimeError` si clé de dév en prod Vercel |
| Haute | key_proof brut en DB | Format v2 : préfixe `\\x01` + HMAC(`SECRET_KEY`) |
| Haute | Favicon redirects SSRF | Follow manuel + revalidation chaque hop |
| Haute | Matériel crypto via `/auth/me` | Retiré de `_profile_payload` (session locale uniquement) |
| Haute | Blobs register / recovery illimités | Tailles fixes (salt 16, verifier/pub 32, wrap 60–512) |
| Haute | Hang confirmation maître | Overlay + `lockVault` appellent `settleMasterConfirm(false)` |
| Haute | Secret dans `data-real` après close | `clearDetailSecrets()` sur fermeture détail / lock |
| Moyenne | CGNAT favicon | Filtre `not ip.is_global` + pin IP après résolution DNS |
| Moyenne | RLS Supabase | `ENABLE ROW LEVEL SECURITY` + `REVOKE` anon/authenticated |
| Moyenne | Blobs illimités (écritures courantes) | Cap 256 KiB décodés sur create/update |
| Moyenne | Rate limit mémoire multi-instances | Upstash obligatoire sur Vercel (fail-closed) |
| Moyenne | Exemples env avec valeurs réelles | Placeholders uniquement dans `*.example` |
| Basse | UA / cache favicon | UA projet + LRU borné |

### Risques résiduels (ouverts)

| Priorité | ID | Sujet | Notes |
|----------|-----|-------|--------|
| ~~P1~~ | ~~S-01~~ | ~~Matériel crypto via `/auth/me`~~ | **Corrigé 2026-07-16** |
| ~~P1~~ | ~~S-02~~ | ~~Tailles BinaryField inscription / recovery~~ | **Corrigé 2026-07-16** |
| ~~P1~~ | ~~S-03~~ | ~~Compat legacy `key_proof`~~ | **Corrigé** : format v2 ; migration `0006` ; `reseal_key_proofs` |
| ~~P1~~ | ~~S-04~~ | ~~Favicon SSRF / rebinding~~ | **Corrigé** (`is_global` + pin IP DNS) |
| ~~P1~~ | ~~S-05~~ | ~~Hang confirmation maître~~ | **Corrigé 2026-07-16** |
| ~~P1~~ | ~~S-06~~ | ~~Secret dans `data-real`~~ | **Corrigé 2026-07-16** |
| ~~P1~~ | ~~S-07~~ | ~~RLS Supabase~~ | **Corrigé dans schema** ; exécuter `supabase/enable_rls.sql` sur bases existantes |
| ~~P1~~ | ~~S-08~~ | ~~`SECRET_KEY` dév hors Vercel~~ | **Corrigé** : refus dès `DEBUG=false` |
| P2 | — | Favicon = exception ZK | URL claire envoyée au proxy + fallbacks tiers |
| P2 | — | `sessionStorage` JWT + vaultKey + privateKey | XSS / poste partagé = coffre ouvert |
| P2 | — | Énumération `POST /auth/register` (409) | Difficile sans UX dégradée ; rate limit partiel |
| P2 | — | `X-Forwarded-For` | OK derrière Vercel ; ne pas exposer sans proxy de confiance |
| Basse | — | Pas de refresh / révocation JWT | TTL ~60 min acceptable |
| Basse | — | XSS si `esc()` oublié | CSP + revue PR |
| Info | — | Dossier `backend/` FastAPI | Non déployé ; à retirer de `main` |

### Points forts

Argon2id + AES-GCM + `auth_verifier` client. CSP stricte, HSTS, framing DENY. Vendor local. Anti-SSRF favicon (hops). SecLists côté navigateur. Anti-autofill maître. Recovery scellée. Ownership des entrées. Cap 256 KiB entrées/shares.

---

## Performance

| Sujet | Constat | Statut |
|-------|---------|--------|
| Double Argon2 au login | `prepareLogin` puis `unlockSession` | **P1 ouvert** : mutualiser le dérivé |
| Déchiffrement entrées | Séquentiel après GET | **P1** : paralléliser (`Promise.all` borné) |
| Favicon proxy | Jusqu’à 12 fetches × 6s ; body non streamé | **P2** : stream + plafond + moins de candidats |
| Listes MDP (~10 Mo) | Inscription | Amélioré : priority puis arrière-plan |
| `toB64` | Gros blobs | Encodage par chunks |
| Liste coffre | Pas de pagination | OK usage perso |
| Argon2id 64 Mo | CPU | Worker `argon2-worker.js` |

---

## Qualité / maintenabilité

| Sujet | Constat | Action |
|-------|---------|--------|
| `frontend/js/app.js` | ~2131 lignes | Découpage (`entries/`, `shares/`, `master-confirm`) |
| `vault/views.py` | ~727 lignes | `auth_views` / `vault_views` / `share_views` |
| Note de partage reçue | Non affichée | Réafficher le champ note |
| Docs API / guide | Globalement à jour | Écarts mineurs API shares / Upstash |
| Deps Python | Bornes `>=` sans lockfile | `uv.lock` / pins hashées |
| Archive FastAPI | `backend/` | Ne pas étendre ; retirer de `main` |
| Deux schémas | migrate vs `schema.sql` | Migrations Django canoniques |

---

## Tests / CI

| Sujet | Statut |
|-------|--------|
| Smoke crypto / auth / recovery / favicon SSRF | `vault/tests/` — **16/16 OK** |
| GitHub Actions | `.github/workflows/ci.yml` (SECRET_KEY de CI factice) |
| Tests JS / WebCrypto | Absents |
| CRUD entries + shares E2E | Absents |
| PostgreSQL / RLS | Absents |

---

## Plan d’action recommandé

**Sprint immédiat** — fait 2026-07-16 (S-01, S-02, S-04 CGNAT, S-05, S-06, S-07 schema).

**Ensuite**

1. Mutualiser Argon2 login (P-01)
2. Tests shares + master-confirm (T-01)
3. Sur prod Supabase : exécuter `supabase/enable_rls.sql` si pas déjà fait
4. Si recovery impossible après déploiement v2 : `python manage.py reseal_key_proofs --legacy-raw`

---

## Checklist opérateur (prod)

1. `SECRET_KEY` unique et long (jamais la valeur d’exemple, jamais dans Git)
2. `DEBUG=false`
3. `DATABASE_URL` (pooler) + migrations
4. Upstash URL + token (obligatoires sur Vercel)
5. Vérifier Security Advisors Supabase (RLS / exposition `public`)
6. Redeploy sur le dernier `main`
7. Ne jamais committer `.env`, dumps DB, exports utilisateur, ni clés API réelles (y compris dans mocks ou captures d’écran)
