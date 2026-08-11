# Guide utilisateur — Clefkey.

## À quoi sert Clefkey. ?

Clefkey. stocke vos identifiants (sites, emails, mots de passe, notes, clés API) de façon chiffrée. Seul **votre mot de passe maître** permet de les lire, dans votre navigateur. Voir aussi la [cartographie](./CARTOGRAPHIE-COFFRE.md) pour le fonctionnement détaillé.

## Écrans principaux

### 1. Landing

Page d’accueil avec le nom **Clefkey.**, un lien vers le dépôt GitHub public du projet, et les actions **Créer un compte** / **Se connecter**.

### 2. Inscription

Renseignez prénom, nom (deuxième prénom optionnel), email, mot de passe maître (**min. 12 caractères**, majuscules, minuscules, chiffre, caractère spécial, **pas dans les listes de mots de passe courants**) et confirmation.

**Important** : ne laissez **pas** le navigateur enregistrer le mot de passe maître (l’app désactive volontairement cette suggestion).

Le mot de passe maître **n’est pas envoyé** au serveur : le navigateur en dérive des clés, puis envoie uniquement des données déjà chiffrées.

Conservez le **code de récupération** affiché après inscription (groupes de caractères) : sans maître ni code, le coffre est irrécupérable.

### 3. Connexion

Email + mot de passe maître → déverrouillage du coffre.

Après **F5**, inactivité (15 min) ou onglet en arrière-plan, un écran demande uniquement le **mot de passe maître** (pas besoin de ressaisir l’email). **Se déconnecter** efface toute la session.

Sur `localhost` uniquement : laisser les champs **vides** charge un mode démo (données **fictives** en mémoire). Désactiver avec `?dev=0`.

### 4. Dashboard

Tuiles des clés (populaires, récents, A à Z), recherche, ajout rapide. Filtres **Tous**, **Connexions**, **Clés API**, **SSH / stockage**, et **projets** (Tous les projets / Sans projet / chaque projet).

### Audit

L'entrée **Audit** de la sidebar permet de vérifier si un mot de passe **ou une adresse e-mail** a fuité en ligne. Un switch bascule entre les deux modes :

- **Mot de passe** — API Have I Been Pwned en mode **k-anonymity** : le mot de passe est hashé localement et seuls 5 caractères du hash sont transmis.
- **Adresse e-mail** — API publique XposedOrNot, qui liste les fuites connues associées à l'adresse.

Le même widget est disponible sur la landing page. Voir la [documentation dédiée](./AUDIT-MOT-DE-PASSE.md).

### 5. Toutes les clés

Liste complète, recherche (raccourci **Ctrl+K**), ouverture du détail. Chaque entrée affiche un badge selon son type (connexion, clé API ou SSH / stockage) et son projet le cas échéant.

### 6. Profil

Infos compte (édition inline), tags techniques, **Verrouiller le coffre** (soft lock : le maître suffit pour rouvrir).

## Types d’entrées

| Type | Usage |
|------|--------|
| Connexion | Site web : URL, identifiant, mot de passe |
| Clé API | Secret technique : titre, clé, URL optionnelle, notes |
| Clé SSH / stockage | Clé privée (PEM / OpenSSH) ou secret de stockage ; hôte optionnel (`git@…`, serveur). Bouton **Générer une clé Ed25519** remplit uniquement le champ secret avec la clé privée. |

Les trois types sont chiffrés de la même façon ; seul le contenu JSON côté navigateur change.

## Projets (dossiers)

Les clés peuvent être rangées dans un **projet**. La liste des projets et l’appartenance d’une clé sont chiffrées dans le coffre (zero-knowledge). Bouton **Projets** pour créer, renommer ou supprimer.

- Une clé reste dans son projet jusqu’à déplacement manuel.
- Supprimer un projet envoie ses clés en **Sans projet** (elles ne sont pas effacées).
- Les **partages** restent hors des projets.

## Actions courantes

| Action | Comment |
|--------|---------|
| Ajouter une entrée | Bouton **+** / Nouvelle clé ; choisir le type |
| Copier un secret | Icône copier sur une carte ou dans le détail |
| Supprimer | Demande de confirmation en retapant le titre |
| Verrouiller | Sidebar ou profil → session fermée |

## PWA

Clefkey. peut s’installer comme application (manifest + service worker). Après une mise à jour du site, un rechargement peut être nécessaire pour vider l’ancien cache.

## Vie privée (dépôt public)

Ne publiez jamais vos vrais mots de passe, codes de récupération, dumps de base ou captures d’écran contenant des secrets dans des issues GitHub ou des commits.
