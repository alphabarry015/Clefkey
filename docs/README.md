# Documentation Clefkey.

**Clefkey.** est un gestionnaire de mots de passe web **zero-knowledge** : le serveur ne voit jamais les mots de passe en clair. Le chiffrement et le déchiffrement se font dans le navigateur.

Le dépôt GitHub est **public**. Ne committez jamais `.env`, clés API, jetons Supabase/Upstash, dumps de base ni données personnelles réelles. Les fichiers `*.example` ne contiennent que des placeholders.

| Document | Contenu |
|----------|---------|
| [CARTOGRAPHIE-COFFRE.md](./CARTOGRAPHIE-COFFRE.md) | Concepts, flux, rôles (récit d’architecture) |
| [GUIDE-UTILISATEUR.md](./GUIDE-UTILISATEUR.md) | Utilisation du site (landing, compte, coffre, générateur, partages, raccourcis) |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Stack, dossiers, flux crypto |
| [API.md](./API.md) | Endpoints HTTP (dont vérification d’usernames / Sherlock) |
| [DEPLOIEMENT.md](./DEPLOIEMENT.md) | Local, Supabase, Vercel |
| [SECURITE.md](./SECURITE.md) | Modèle de menace et bonnes pratiques |
| [AUDIT-MOT-DE-PASSE.md](./AUDIT-MOT-DE-PASSE.md) | Audit de compromission mot de passe (HIBP, k-anonymity) et e-mail (XposedOrNot) |
| [AUDIT.md](./AUDIT.md) | Audit sécurité / performance / maintenance |

Repo : [Clefkey.](https://github.com/alphabarry015/Gardefort)
