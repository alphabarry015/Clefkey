# Guide utilisateur — Gardefort

## À quoi sert Gardefort ?

Gardefort stocke vos identifiants (sites, emails, mots de passe, notes, clés API) de façon chiffrée. Seul **votre mot de passe maître** permet de les lire, dans votre navigateur. Voir aussi la [cartographie](./CARTOGRAPHIE-COFFRE.md) pour le fonctionnement détaillé.

## Écrans principaux

### 1. Landing

Page d’accueil avec le nom **Gardefort**, un lien vers le dépôt GitHub public du projet, et les actions **Créer un compte** / **Se connecter**.

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

Tuiles des clés (populaires, récents, A à Z), recherche, ajout rapide. Filtres **Tous**, **Connexions**, **Clés API**.

### 5. Toutes les clés

Liste complète, recherche (raccourci **Ctrl+K**), ouverture du détail. Chaque entrée affiche un badge selon son type (connexion ou clé API).

### 6. Profil

Infos compte (édition inline), tags techniques, **Verrouiller le coffre** (soft lock : le maître suffit pour rouvrir).

## Types d’entrées

| Type | Usage |
|------|--------|
| Connexion | Site web : URL, identifiant, mot de passe |
| Clé API | Secret technique : titre, clé, URL optionnelle, notes |

Les deux types sont chiffrés de la même façon ; seul le contenu JSON côté navigateur change.

## Actions courantes

| Action | Comment |
|--------|---------|
| Ajouter une entrée | Bouton **+** / Nouvelle clé ; choisir le type |
| Copier un secret | Icône copier sur une carte ou dans le détail |
| Supprimer | Demande de confirmation en retapant le titre |
| Verrouiller | Sidebar ou profil → session fermée |

## PWA

Gardefort peut s’installer comme application (manifest + service worker). Après une mise à jour du site, un rechargement peut être nécessaire pour vider l’ancien cache.

## Vie privée (dépôt public)

Ne publiez jamais vos vrais mots de passe, codes de récupération, dumps de base ou captures d’écran contenant des secrets dans des issues GitHub ou des commits.
