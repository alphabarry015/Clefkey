# Audit — sécurité, performance, maintenance

Date de révision : 2026-07-15 · Périmètre : Django (`coffre/`, `vault/`) + frontend PWA + docs.

Document vivant : mettre à jour après changements majeurs. Cartographie narrative : [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md).

Dépôt **public** : aucun secret de production, jeton, chaîne de connexion réelle ni donnée personnelle réelle ne doit figurer dans Git. `.env` est ignoré ; les `*.example` ne portent que des placeholders.

---

## Synthèse

| Domaine | Verdict |
|---------|---------|
| Modèle zero-knowledge | Solide (chiffrement client, blobs serveur) |
| Auth / JWT / recovery | Correct avec durcissements (HMAC key_proof, sel factice) |
| Surface d’attaque | Limitée (SPA same-origin, CSP, rate limit, anti-SSRF favicon) |
| Performance login | Point faible connu : double Argon2 (prepare + unlock) |
| Maintenance | `app.js` volumineux ; docs rattrapées ; `backend/` = archive |

---

## Sécurité

### Correctifs déjà appliqués

| Sévérité | Sujet | Action |
|----------|-------|--------|
| Haute | Énumération `/auth/salt` | Sel factice déterministe si email inconnu |
| Haute | Timing login user absent | `compare_digest` aussi sur vérifieur factice |
| Haute | `SECRET_KEY` dév sur Vercel | `RuntimeError` si clé de dév en prod |
| Haute | key_proof brut en DB | HMAC(SECRET_KEY) au stockage |
| Haute | Favicon redirects SSRF | Follow manuel + revalidation chaque hop |
| Moyenne | Blobs illimités (écritures courantes) | Cap 256 KiB décodés sur create/update |
| Moyenne | Rate limit mémoire multi-instances | Upstash obligatoire sur Vercel (fail-closed) |
| Moyenne | Exemples env avec valeurs réelles | Placeholders uniquement dans `*.example` |
| Basse | UA / cache favicon | UA projet + LRU borné |

### Risques résiduels (ouverts ou acceptés)

| Priorité | Sujet | Notes |
|----------|-------|--------|
| P1 | Tailles BinaryField à l’inscription | Salt / verifier / clés : valider tailles max côté vues register (comme les entrées) |
| P1 | Compat legacy key_proof | Anciennes lignes non scellées : migration ou validation duale documentée |
| P2 | Favicon public + DNS rebinding | Proxy rate-limité ; surveiller abus |
| P2 | Énumération `POST /auth/register` (409) | Difficile sans UX dégradée ; rate limit partiel |
| P2 | `X-Forwarded-For` | OK derrière Vercel ; ne pas exposer sans proxy de confiance |
| Basse | Pas de refresh / révocation JWT | TTL ~60 min acceptable |
| Basse | XSS si `esc()` oublié | CSP + revue PR |
| Info | Dossier `backend/` FastAPI | Non déployé |

### Points forts

Argon2id + AES-GCM + auth_verifier client. CSP stricte, HSTS, framing DENY. Vendor local. Anti-SSRF favicon. SecLists côté navigateur. Anti-autofill maître. Recovery scellée. Types d’entrée (`login` / `api_key`) uniquement dans le JSON client.

---

## Performance

| Sujet | Constat | Statut |
|-------|---------|--------|
| Double Argon2 au login | `prepareLogin` puis `unlockSession` | **P0 ouvert** : mutualiser le dérivé |
| Déchiffrement entrées | Séquentiel après GET | **P1** : paralléliser (Promise.all borné) |
| Listes MDP (~10 Mo) | Inscription | Amélioré : priority puis arrière-plan |
| `toB64` | Gros blobs | Encodage par chunks |
| Liste coffre | Pas de pagination | OK usage perso |
| Argon2id 64 Mo | CPU | Worker `argon2-worker.js` |

---

## Maintenabilité

| Sujet | Constat | Action |
|-------|---------|--------|
| `frontend/js/app.js` | ~1900 lignes | Découpage progressif (`auth-screens.js`, `recovery-input.js`, …) |
| Docs API / guide | Retard recovery, shares, types | Mis à jour 2026-07-15 |
| Tests JS en CI | Absents | Smoke Python OK ; tests front à prévoir |
| Archive FastAPI | `backend/` | Ne pas étendre |

---

## Tests / CI

| Sujet | Statut |
|-------|--------|
| Smoke crypto / auth / recovery / favicon SSRF | `vault/tests/` |
| GitHub Actions | `.github/workflows/ci.yml` (SECRET_KEY de CI factice) |

---

## Checklist opérateur (prod)

1. `SECRET_KEY` unique et long (jamais la valeur d’exemple, jamais dans Git)
2. `DEBUG=false`
3. `DATABASE_URL` (pooler) + migrations
4. Upstash URL + token (obligatoires sur Vercel)
5. Redeploy sur le dernier `main`
6. Ne jamais committer `.env`, dumps DB, exports utilisateur, ni clés API réelles (y compris dans mocks ou captures d’écran)
