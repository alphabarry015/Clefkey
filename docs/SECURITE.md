# Sécurité — Clefkey.

## Modèle zero-knowledge

- Le **mot de passe maître** ne quitte pas le navigateur.
- Le serveur stocke des **blobs chiffrés** (clés et entrées) et un `auth_verifier` pour la connexion.
- Une compromission de la base seule ne donne pas les mots de passe en clair (sans le maître).

## Mesures en place

| Domaine | Mesure |
|---------|--------|
| Transport | HTTPS en production (Vercel) + HSTS |
| Auth session | JWT Bearer à durée limitée |
| Session navigateur | Soft-lock : `sessionStorage` = JWT + `authMaterial` (blobs chiffrés, y compris wrap passphrase). **Jamais** de clés en clair |
| Verrouillage | Soft-lock : F5, manuel, onglet caché **≥ 5 min** → écran **passphrase ou maître**. Inactivité **15 min** → hard logout. Déconnexion manuelle = hard logout |
| Entrées | Chiffrement client (AES-GCM via WebCrypto) ; blob max 256 KiB |
| Audit fuites | HIBP k-anonymity : empreinte SHA-1 **uniquement** pour matcher l’index public (5 caractères transmis). Pas utilisé pour stocker ou dériver la clé du coffre |
| Mot de passe maître | Min. **8** car., complexité, **refus listes SecLists**. Changement profil : JWT + `current_auth_verifier`, sans consommer les clés de récupération |
| Passphrase | Min. **3 mots**, formatage auto (majuscule initiale / après `.`). Wrap dédié de `vaultKey` (`passphrase_salt` / `passphrase_verifier` / `encrypted_vault_key_passphrase`). Soft-lock : **passphrase ou maître**. Création à l’inscription ; changement profil (`POST /auth/passphrase`) ; oubli via recovery (`POST /auth/recovery/passphrase`) |
| Autofill navigateur | Désactivé volontairement (autocomplete off + clear secrets) |
| Rate limiting | Login/register/… ; Upstash Redis si configuré, sinon mémoire |
| Login | `hmac.compare_digest` même si le compte n’existe pas |
| Salt | `/auth/salt` renvoie toujours un sel (factice si inconnu) — anti-énumération |
| Generate-password | Authentifié (JWT) |
| Headers | CSP stricte (`script-src 'self'`), X-Frame-Options DENY, nosniff |
| Dépendances JS | Vendored dans `/vendor` (plus de CDN esm.sh) |
| Favicons | Proxy anti-SSRF + cache borné |
| Secrets | `.env` ignoré ; `SECRET_KEY` de dév **refusée** sur Vercel |
| Host | `ALLOWED_HOSTS` + détection Vercel (`.vercel.app`) |

## Limites / responsabilités

- La force du coffre dépend du **mot de passe maître** (longueur, unicité) et, pour le soft-lock, de la **passphrase** (plusieurs mots).
- XSS dans le frontend pourrait cibler des données déjà déchiffrées **en mémoire** pendant la session : CSP + échappement HTML. Le soft-lock ne stocke que des blobs déjà chiffrés + JWT (pas de `vaultKey` claire en `sessionStorage`).
- JWT et `SECRET_KEY` : une fuite de `SECRET_KEY` permet de forger des tokens (pas de déchiffrer le coffre sans le maître).
- Sans Upstash, le rate limit est par instance Vercel.
- L’inscription peut encore révéler un email déjà pris (409) — limité par rate limit.
- Mode démo localhost : ne contient pas de vrais secrets ; ne pas forcer `?dev=1` en production.

Audit détaillé : [AUDIT.md](./AUDIT.md).

## Régénérer dépendances / listes

```bash
python scripts/vendor_frontend_deps.py
python scripts/sync_common_password_lists.py
```

Puis incrémenter `CACHE_VERSION` dans `frontend/sw.js`.

## Bonnes pratiques opérateur

1. `DEBUG=false` sur Vercel.
2. `SECRET_KEY` longue et unique (obligatoire sur Vercel) — **jamais** dans Git (dépôt public).
3. Mot de passe base Supabase fort ; reset si exposé.
4. Ne jamais committer `.env`, dumps DB, exports utilisateur, ni clés réelles (y compris dans mocks, issues ou captures).
5. Vérifier les utilisateurs via Table Editor `users` ou `python manage.py shell` (pas via Supabase Auth).
6. Upstash obligatoire en production multi-instances (Vercel).

Cartographie : [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md).
