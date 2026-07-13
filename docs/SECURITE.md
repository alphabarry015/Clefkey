# Sécurité — BINALPH93

## Modèle zero-knowledge

- Le **mot de passe maître** ne quitte pas le navigateur.
- Le serveur stocke des **blobs chiffrés** (clés et entrées) et un `auth_verifier` pour la connexion.
- Une compromission de la base seule ne donne pas les mots de passe en clair (sans le maître).

## Mesures en place

| Domaine | Mesure |
|---------|--------|
| Transport | HTTPS en production (Vercel) + HSTS |
| Auth session | JWT Bearer à durée limitée |
| Entrées | Chiffrement client (AES-GCM via WebCrypto) |
| Mot de passe maître | Min. 12 car., maj/min/chiffre/spécial (inscription) |
| Rate limiting | Login, register, salt, favicon, generate-password |
| Generate-password | Authentifié (JWT) |
| Headers | CSP, X-Frame-Options DENY, nosniff, Referrer-Policy |
| Favicons | Proxy avec filtrage anti-SSRF (pas d’IP privée) |
| Secrets | `.env` / `.env.local` dans `.gitignore` |
| Host | `ALLOWED_HOSTS` + détection Vercel (`.vercel.app`) |

## Limites / responsabilités

- La force du coffre dépend du **mot de passe maître** (longueur, unicité).
- XSS dans le frontend pourrait cibler des données déjà déchiffrées en session : CSP + échappement HTML réduisent le risque.
- JWT et `SECRET_KEY` : une fuite de `SECRET_KEY` permet de forger des tokens (pas de déchiffrer le coffre sans le maître).
- Rate limit en mémoire : efficace par instance Vercel, pas un WAF global.
- Mode démo localhost : ne contient pas de vrais secrets ; ne pas forcer `?dev=1` en production.

## Bonnes pratiques opérateur

1. `DEBUG=false` sur Vercel.
2. `SECRET_KEY` longue et unique.
3. Mot de passe base Supabase fort ; reset si exposé.
4. Ne jamais committer `.env`.
5. Vérifier les utilisateurs via Table Editor `users` ou `python manage.py shell` (pas via Supabase Auth).
