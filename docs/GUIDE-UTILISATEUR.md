# Guide utilisateur — Gardefort

## À quoi sert Gardefort ?

Gardefort stocke vos identifiants (sites, emails, mots de passe, notes) de façon chiffrée. Seul **votre mot de passe maître** permet de les lire, dans votre navigateur.

## Écrans principaux

### 1. Landing

Page d’accueil avec :
- le nom **Gardefort**
- **Créer un compte** / **Se connecter**

### 2. Inscription

Renseignez :
- prénom, nom (deuxième prénom optionnel)
- email
- mot de passe maître (**min. 12 caractères**, majuscules, minuscules, chiffre, caractère spécial, **pas dans les listes SecLists de mots de passe courants**) + confirmation

**Important** : ne laissez **pas** le navigateur enregistrer le mot de passe maître (l’app désactive volontairement cette suggestion).

Le mot de passe maître **n’est pas envoyé** au serveur : le navigateur en dérive des clés, puis envoie uniquement des données déjà chiffrées.

### 3. Connexion

Email + mot de passe maître → déverrouillage du coffre.

Sur `localhost` uniquement : laisser les champs **vides** charge un mode démo (données fictives en mémoire). Désactiver avec `?dev=0`.

### 4. Dashboard

Tuiles des clés (populaires, récents, A à Z), recherche, ajout rapide.

### 5. Toutes les clés

Liste complète, recherche (raccourci **Ctrl+K**), ouverture du détail.

### 6. Profil

- Infos compte (édition inline)
- Tags techniques (crypto)
- **Verrouiller le coffre** (fin de session)

## Actions courantes

| Action | Comment |
|--------|---------|
| Ajouter une clé | Bouton **+** / Nouvelle clé |
| Copier un mot de passe | Icône copier sur une carte ou dans le détail |
| Supprimer | Demande de confirmation en retapant le titre |
| Verrouiller | Sidebar ou profil → session fermée |

## PWA

Gardefort peut s’installer comme application (manifest + service worker). Après une mise à jour du site, un rechargement peut être nécessaire pour vider l’ancien cache.
