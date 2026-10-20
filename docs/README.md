# Documentation Clefkey.

**Clefkey.** est un gestionnaire de mots de passe web **zero-knowledge** : le serveur ne voit jamais les mots de passe en clair. Le chiffrement et le déchiffrement se font dans le navigateur.

Nouveautés notables : **passphrase** (soft-lock, min. 3 mots), mot de passe maître min. **8** caractères, soft-lock **5 min** (onglet) vs déconnexion **15 min** (inactivité).

Le dépôt GitHub est **public**. Ne committez jamais `.env`, clés API, jetons Supabase/Upstash, dumps de base ni données personnelles réelles. Les fichiers `*.example` ne contiennent que des placeholders.

| Document | Contenu |
|----------|---------|
| [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md) | Concepts, flux, rôles (récit d’architecture) |
| [GUIDE-UTILISATEUR.md](./GUIDE-UTILISATEUR.md) | Utilisation (compte, **passphrase**, soft-lock, coffre, générateur, partages) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, dossiers, flux crypto (maître + passphrase) |
| [API.md](./API.md) | Endpoints HTTP (auth, passphrase, recovery, vault, Sherlock) |
| [DEPLOIEMENT.md](./DEPLOIEMENT.md) | Local, Supabase, Vercel |
| [SECURITE.md](./SECURITE.md) | Modèle de menace et bonnes pratiques |
| [EXTENSION-NAVIGATEUR.md](./EXTENSION-NAVIGATEUR.md) | Spec extension (soft-lock passphrase / maître) |
| [AUDIT-MOT-DE-PASSE.md](./AUDIT-MOT-DE-PASSE.md) | Audit de compromission mot de passe (HIBP, k-anonymity) et e-mail (XposedOrNot) |
| [AUDIT.md](./AUDIT.md) | Audit sécurité / performance / maintenance |

Repo : [Clefkey.](https://github.com/alphabarry015/Gardefort)
