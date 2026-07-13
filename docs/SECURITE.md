# Sécurité — BINALPH93

## Modèle zero-knowledge

- Le **mot de passe maître** ne quitte pas le navigateur.
- Le serveur stocke des **blobs chiffrés** (clés et entrées) et un `auth_verifier` pour la connexion.
- Une compromission de la base seule ne donne pas les mots de passe en clair (sans le maître).

## Mesures en place

| Domaine | Mesure |
|---------|--------|
| Transport | HTTPS en production (Vercel) |
| Auth session | JWT Bearer à durée limitée |
| Entrées | Chiffrement client (AES-GCM via WebCrypto) |
| Favicons | Proxy avec filtrage anti-SSRF (pas d’IP privées) |
| Secrets | `.env` / `.env.local` dans `.gitignore` |
| Host | `ALLOWED_HOSTS` + détection Vercel (`.vercel.app`) |

## Limites / responsabilités

- La force du coffre dépend du **mot de passe maître** (longueur, unicité).
- XSS dans le frontend pourrait cibler des données déjà déchiffrées en session : garder les deps à jour, éviter HTML non échappé (le code utilise déjà un échappement pour l’UI).
- JWT et `SECRET_KEY` : une fuite de `SECRET_KEY` permet de forger des tokens (pas de déchiffrer le coffre sans le maître).
- Mode démo localhost : ne contient pas de vrais secrets, mais ne l’activez pas en production (`?dev=1`).

## Bonnes pratiques opérateur

1. `DEBUG=false` sur Vercel.
2. `SECRET_KEY` longue et unique.
3. Mot de passe base Supabase fort ; reset si exposé.
4. Ne jamais committer `.env`.
5. Vérifier les utilisateurs via Table Editor `users` ou `python manage.py shell` (pas via Supabase Auth).
