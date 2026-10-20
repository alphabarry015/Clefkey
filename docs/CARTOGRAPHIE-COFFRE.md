# Cartographie du coffre Clefkey.

Ce document décrit le produit tel qu’il existe aujourd’hui : à quoi sert chaque pièce, comment les flux s’enchaînent, et pourquoi certaines décisions techniques importent. Il est rédigé pour être lu comme un récit d’architecture, sans jargon inutile. Le dépôt GitHub est public : aucune clé réelle, jeton de production, URL de base de données complète ni donnée personnelle réelle ne doit y figurer. Les exemples ci-dessous sont fictifs ou anonymisés.

## L’idée centrale

Clefkey est un gestionnaire de mots de passe web dit zero knowledge. En pratique, le serveur reçoit et stocke uniquement des données déjà rendues inutilisables sans le mot de passe maître. Les secrets en clair existent seulement dans le navigateur, pendant une session déverrouillée. Si quelqu’un copie la base de données, il obtient des blobs, des sels et un vérificateur, pas le contenu des coffres.

Le mot de passe maître joue donc deux rôles à la fois : il authentifie la personne auprès de l’API (via un dérivé), et il déverrouille le matériel cryptographique nécessaire pour lire ou écrire les entrées. Le serveur ne connaît jamais ce mot de passe.

En complément, une **passphrase** (phrase d’au moins trois mots, majuscule forcée) est créée à l’inscription. Elle n’ouvre pas la première connexion : elle enveloppe une seconde copie de la clé de coffre pour le **soft-lock** (F5, verrouillage manuel, onglet en arrière-plan). L’utilisateur choisit librement passphrase **ou** maître pour rouvrir.

## Vue d’ensemble des couches

Le navigateur affiche l’interface (landing, inscription, connexion, dashboard, liste, détail, profil) et exécute toute la cryptographie via WebCrypto et Argon2id. Django, déployé en serverless sur Vercel, expose l’API HTTP, sert les fichiers front, émet les JWT et applique le rate limiting. PostgreSQL (Supabase) conserve les comptes et les blobs. Redis Upstash sert, en production, de compteur partagé pour limiter les abus.

Chaque couche a une responsabilité nette. Le front décide du contenu en clair. Le backend décide qui a le droit de lire ou écrire des blobs. La base ne décide de rien de sensible : elle stocke.

## Compte et matériel cryptographique

À l’inscription, le navigateur génère un sel aléatoire, dérive une clé d’authentification et une clé de coffre à partir du maître (**min. 8 caractères**, complexité, hors listes SecLists), produit une paire de clés pour le partage futur, chiffre la clé de coffre et la clé privée, crée un wrap passphrase (sel dédié + vérificateur + vault key chiffrée), génère 7 clés de récupération, puis n’envoie au serveur que ce qui est déjà protégé. Un exemple concret : Alice s’inscrit avec un maître long et unique plus une passphrase mémorable ; le serveur enregistre son email et des octets chiffrés ; Alice seule peut, plus tard, recalculer les mêmes dérivés sur un autre appareil.

À la connexion, le client demande le sel (l’endpoint répond toujours, même pour un email inconnu, avec un sel factice si besoin, pour ne pas aider à l’énumération), dérive le vérificateur, l’envoie, reçoit un JWT si la comparaison côté serveur réussit, puis déchiffre la clé de coffre en local. La session garde les clés déchiffrées en mémoire vive uniquement. On persiste en `sessionStorage` le JWT et le `authMaterial` (salt + blobs déjà chiffrés, y compris passphrase) : après F5, verrouillage manuel ou onglet caché ≥ 5 min, un écran soft-lock propose **passphrase ou mot de passe maître**. Après **15 min d’inactivité**, hard logout (tout est effacé). La déconnexion manuelle efface tout.

Les **7 clés de récupération** sont des secrets hexadécimaux longs, présentés groupés. Elles ne remplacent pas le maître pour l’usage quotidien : ce sont des voies de secours pour **réinitialiser le maître** ou la **passphrase**. En base, le serveur ne stocke qu’un vérificateur et un blob — jamais la clé en clair ; la preuve de possession de vault key est scellée (HMAC) avec le secret d’application Django.

## Les entrées du coffre

Une entrée est un enregistrement opaque côté serveur : un identifiant, un propriétaire, une date, et surtout un champ binaire `encrypted_data`. Le contenu clair n’existe que dans le JSON chiffré côté client. Ce JSON décrit typiquement un titre, un type (`login`, `oauth`, `api_key` ou `ssh_key`), un identifiant (email, login, nom de clé), un secret optionnel (mot de passe, clé API ou clé privée — vide pour OAuth / SSO), une URL / hôte optionnel, des notes, et des métadonnées d’affichage (favori, dates).

Trois types partagent le même modèle de stockage. Une connexion classique sert un site web (exemple fictif : titre « Messagerie perso », URL `https://mail.exemple.org`, email et mot de passe). Une clé API sert un secret technique (exemple fictif : titre « Clé démo OpenAI », secret du genre `demo-api-key-not-real`). Une clé SSH / stockage sert une clé privée ou un secret de volume (exemple fictif : hôte `git@github.com`, bloc PEM). Le filtre Tous / Connexions / Clés API / SSH ne fait que trier des objets déjà déchiffrés en mémoire ; le serveur ignore le type.

Les **projets** (dossiers) sont aussi purement client : une entrée meta chiffrée liste les projets (`id`, `name`), et chaque clé peut porter un `folderId`. Les partages n’embarquent pas ce `folderId` : ils restent hors du système de projets.

Quand l’utilisateur ajoute ou modifie une entrée, le front chiffre le JSON avec AES-GCM sous la clé de coffre, encode en base64, et appelle l’API. Pour afficher les tuiles, l’inverse se produit : téléchargement des blobs, déchiffrement un par un, rendu. Les favicons passent par un proxy serveur qui refuse les hôtes privés, afin de ne pas transformer l’app en outil de scan du réseau local.

## Partage

Le partage s’appuie sur la paire de clés : la clé publique du destinataire (si le modèle le prévoit) permet d’encapsuler un accès sans exposer la clé de coffre entière en clair. Les endpoints de partage et de recovery complètent le cycle de vie au-delà du simple CRUD d’entrées. Toute preuve ou blob lié à ces flux reste conçu pour que le serveur valide l’opération sans lire le secret métier.

## Flux utilisateur typiques

Inscription. L’utilisateur remplit le formulaire (maître + passphrase), le front refuse un maître trop court / trop courant (SecLists) et une passphrase de moins de 3 mots, calcule le matériel, appelle `POST /auth/register`, puis affiche les **7 clés de récupération**. Les perdre avec le maître et la passphrase rend le coffre irrécupérable.

Connexion. Email et maître, dérivation, `POST /auth/login`, JWT, déchiffrement de la clé de coffre, chargement des entrées. En local uniquement, laisser les champs vides peut activer un mode démo sans toucher la vraie base : utile pour développer l’UI, dangereux à ne jamais activer en production avec des données réelles.

Usage du coffre. Recherche, filtres de type, copie presse-papiers, détail, génération de mot de passe (local WebCrypto ou endpoint authentifié). Le **Générateur** (onglets Mot de passe / Username / Passphrase) aide à créer des secrets forts : pour l’onglet Username, le navigateur demande au serveur (proxy Sherlock) de vérifier la disponibilité de variantes — aucun secret du coffre n’est impliqué, seul un pseudo public est envoyé à des sites tiers. Le **Dashboard** affiche un aperçu (compteurs, actions rapides, graphiques) et renvoie la liste des clés vers « Toutes les clés ». Depuis le **profil**, on peut changer le mot de passe maître et la **passphrase** (sans consommer les clés de récupération pour un changement en session). Soft-lock : passphrase **ou** maître.

## Ce que le serveur voit vraiment

Il voit des emails et des noms de profil (ce sont des données de compte, pas des secrets de sites). Il voit des blobs et des sels. Il voit un vérificateur pour accepter ou refuser le login. Il ne voit pas le maître, ni les mots de passe des sites, ni les clés API en clair. C’est pourquoi une fuite de `SECRET_KEY` Django est grave pour les JWT et pour certaines empreintes scellées, mais ne permet pas à elle seule de lire le contenu des coffres : il manque toujours le maître (ou le chemin de recovery légitime).

## Contrôles transverses

Le rate limiting freine le bruteforce et l’abus du proxy favicon. La CSP restreint les scripts. Les dépendances JavaScript sont vendored dans le dépôt pour éviter un CDN tiers au runtime. Le service worker met en cache l’UI ; chaque release significative incrémente la version de cache pour forcer le renouvellement. Les variables secrètes (`SECRET_KEY`, chaînes Supabase, jetons Upstash) vivent dans l’environnement Vercel ou un fichier `.env` local jamais versionné. Les fichiers `*.example` du dépôt ne portent que des placeholders.

## Performance et dette knownue

Deux dérivations Argon2 se succèdent encore au login (préparation puis déverrouillage), ce qui alourdit l’attente perçue. Le déchiffrement des entrées reste séquentiel. Le fichier `app.js` concentre beaucoup de logique UI. Ces points sont documentés dans l’audit : ce ne sont pas des failles zero knowledge, mais des axes d’amélioration clairs.

## Comment lire le reste de la documentation

Le guide utilisateur explique les écrans. L’architecture détaille dossiers et stack. L’API liste les routes. Le déploiement décrit Supabase et Vercel. La sécurité et l’audit formalisent menaces, correctifs et priorités. Cette cartographie sert de fil conducteur entre tous ces documents : elle dit pourquoi le produit se comporte ainsi, avec des exemples fictifs uniquement, pour un dépôt qui reste public.
