# Guide utilisateur — Clefkey.

## À quoi sert Clefkey. ?

Clefkey. stocke vos identifiants (sites, emails, mots de passe, notes, clés API) de façon chiffrée. Le **mot de passe maître** (et la **passphrase** pour le soft-lock) permettent de les lire **uniquement dans votre navigateur**. Voir aussi la [cartographie](./CARTOGRAPHIE-COFFRE.md) pour le fonctionnement détaillé.

## Écrans principaux

### 1. Landing

Page d’accueil avec le nom **Clefkey.**, un lien vers le dépôt GitHub public du projet, et les actions **Créer un compte** / **Se connecter**. Un widget **Audit** (fuite de mot de passe / e-mail) est aussi disponible directement.

### 2. Inscription

Renseignez prénom, nom (deuxième prénom optionnel), email, mot de passe maître (**min. 8 caractères**, majuscules, minuscules, chiffre, caractère spécial, **pas dans les listes de mots de passe courants**), une **passphrase** (min. 3 mots, majuscule forcée en début de phrase et après chaque point) et confirmations.

**Important** : ne laissez **pas** le navigateur enregistrer le mot de passe maître (l’app désactive volontairement cette suggestion).

Le mot de passe maître **n’est pas envoyé** au serveur : le navigateur en dérive des clés, puis envoie uniquement des données déjà chiffrées.

Conservez les **7 clés de récupération** affichées après inscription : sans maître, sans passphrase **et** sans ces clés, le coffre est irrécupérable.

### 3. Connexion

Email + mot de passe maître → déverrouillage du coffre.

### 3 bis. Soft-lock et déconnexion

Deux comportements distincts :

| Situation | Effet | Pour rouvrir |
|-----------|--------|----------------|
| **F5**, verrouillage manuel, ou onglet en arrière-plan **≥ 5 min** | Soft-lock : JWT + blobs chiffrés gardés, clés en clair effacées | **Passphrase** *ou* **mot de passe maître** (choix libre) |
| **Inactivité 15 min** | Déconnexion complète (hard logout) | Email + mot de passe maître |

L’écran soft-lock propose deux onglets : *Passphrase* et *Mot de passe*. Pas besoin de ressaisir l’email.

**Passphrase oubliée** : depuis le soft-lock → lien dédié → une de vos clés de récupération → nouvelle passphrase (la clé utilisée est invalidée).

Sur `localhost` uniquement : laisser les champs **vides** charge un mode démo (données **fictives** en mémoire). Désactiver avec `?dev=0`.

### 4. Coffre (espace connecté)

Une fois connecté, la **topbar** et la **sidebar** donnent accès à toutes les pages. La topbar contient le bouton **thème clair/sombre** et l’**avatar** (ouvre la page Profil). La sidebar liste : **Dashboard**, **Toutes les clés**, **Projets**, **Audit**, **Générateur**, puis **Partages reçus**, **Partages envoyés**, **Contacts**.

#### Dashboard

Page d’accueil : vue d’ensemble et actions rapides, sans liste de clés.

- **Aperçu** — 4 compteurs cliquables : **Clés**, **Projets**, **Contacts**, **Partages**. Cliquer sur un compteur ouvre la page correspondante.
- **Actions rapides** — boutons : **Nouvelle clé**, **Mot de passe fort**, **Username**, **Passphrase**, **Audit**, **Projet**. Les trois boutons « générer » ouvrent le Générateur sur l’onglet correspondant.
- **Analyse** — deux graphiques (barres, sans données personnelles exposées) : **Clés par type** (Connexions / OAuth / API / SSH) et **Clés par projet**.

#### Toutes les clés

Liste complète des clés sous forme de **tuiles** (même rendu que l’ancien dashboard), avec recherche instantanée et filtres **Tous**, **Connexions**, **OAuth**, **Clés API**, **SSH / stockage**, et **projets** (Tous les projets / Sans projet / chaque projet). Cliquer sur une tuile ouvre le détail ; le bouton **+** ajoute une clé.

#### Audit

L’entrée **Audit** de la sidebar vérifie si un mot de passe, une adresse e-mail **ou un username** a fuité en ligne. Un switch bascule entre les trois modes :

- **Mot de passe** — API Have I Been Pwned en mode **k-anonymity** : le mot de passe est hashé localement et seuls 5 caractères du hash sont transmis.
- **Adresse e-mail** — API publique XposedOrNot, qui liste les fuites connues associées à l’adresse.
- **Username** — vérification de disponibilité d’un pseudo via le proxy Sherlock intégré (voir [API](./API.md)).

Le widget de l’Audit est aussi disponible sur la landing page (modes mot de passe / e-mail). Voir la [documentation dédiée](./AUDIT-MOT-DE-PASSE.md).

#### Générateur

Outil intégré pour créer des secrets forts, avec trois onglets :

- **Mot de passe** — longueur, minuscules, majuscules, chiffres, symboles ; affiche la robustesse.
- **Username** — propose un nom de base et génère plusieurs variantes, puis **vérifie leur disponibilité** sur ~15 sites (badge « Disponible », « Utilisé » ou « Indéterminé »). Si le nom de base est déjà pris, il propose un ajout.
- **Passphrase** — phrase de plusieurs mots (ex. XKCD), plus facile à retenir.

Les raccourcis du Dashboard (**Mot de passe fort**, **Username**, **Passphrase**) ouvrent directement l’onglet correspondant.

#### Partages & Contacts

- **Partages reçus / envoyés** — clés partagées avec d’autres comptes, avec états (en attente, acceptés, refusés, révoqués).
- **Contacts** — destinataires mémorisés pour accélérer un futur partage.

#### Profil

Ouvert depuis l’**avatar** en haut à droite (ou « Profil » dans la sidebar) :

- Infos compte (édition inline) et tags techniques
- **Changer le mot de passe maître** — page dédiée, sans consommer les clés de récupération
- **Changer la passphrase** — même principe (actuelle + nouvelle, ou création si compte ancien sans passphrase)
- **Verrouiller le coffre** — soft-lock : passphrase **ou** maître pour rouvrir

## Passphrase (déverrouillage rapide)

| Règle | Détail |
|-------|--------|
| Création | À l’**inscription** (obligatoire pour les nouveaux comptes) |
| Format | Min. **3 mots** ; majuscule **forcée** en début de phrase et après chaque `.` |
| Usage | Soft-lock uniquement (au choix avec le mot de passe maître) |
| Première connexion | Toujours email + **mot de passe maître** |
| Oubli | Reset via **clé de récupération** (comme le reset du maître) |
| Profil | Section dédiée pour la modifier |

La passphrase ne remplace pas le maître pour la connexion initiale : elle enveloppe une copie de la clé de coffre pour rouvrir rapidement après un soft-lock.

## Types d’entrées

| Type | Usage |
|------|--------|
| Connexion | Site web : URL, identifiant, mot de passe |
| OAuth / SSO | Connexion sociale : **pas de mot de passe**. Nom de la plateforme sur laquelle le compte est créé, email optionnel, notes (lien du site pour le favicon). |
| Clé API | Secret technique : titre, clé, URL optionnelle, notes |
| Clé SSH / stockage | Clé privée (PEM / OpenSSH) ou secret de stockage ; hôte optionnel (`git@…`, serveur). Bouton **Générer une clé Ed25519** remplit uniquement le champ secret avec la clé privée. |

Les quatre types sont chiffrés de la même façon ; seul le contenu JSON côté navigateur change.

## Projets (dossiers)

Les clés peuvent être rangées dans un **projet**. La liste des projets et l’appartenance d’une clé sont chiffrées dans le coffre (zero-knowledge). Bouton **Projets** pour créer, renommer ou supprimer.

- Une clé reste dans son projet jusqu’à déplacement manuel.
- Supprimer un projet envoie ses clés en **Sans projet** (elles ne sont pas effacées).
- Les **partages** restent hors des projets.

## Raccourcis clavier

| Raccourci | Effet |
|-----------|-------|
| **Ctrl+K** (ou **Ctrl+N**, ⌘ sur Mac) | Ouvre le formulaire « Nouvelle clé », depuis n’importe quelle page |
| **Échap** | Ferme la modale ouverte |

## Actions courantes

| Action | Comment |
|--------|---------|
| Ajouter une entrée | Bouton **+** / Nouvelle clé, ou raccourci **Ctrl+N** ; choisir le type |
| Copier un secret | Icône copier sur une carte ou dans le détail |
| Supprimer | Demande de confirmation en retapant le titre |
| Verrouiller | Sidebar, profil ou topbar → soft-lock (passphrase ou maître) |
| Changer la passphrase | Profil → Changer la passphrase |
| Passphrase oubliée | Soft-lock → Passphrase oubliée ? → clé de récupération |

## PWA

Clefkey. peut s’installer comme application (manifest + service worker). Après une mise à jour du site, un rechargement peut être nécessaire pour vider l’ancien cache.

## Vie privée (dépôt public)

Ne publiez jamais vos vrais mots de passe, codes de récupération, dumps de base ou captures d’écran contenant des secrets dans des issues GitHub ou des commits.