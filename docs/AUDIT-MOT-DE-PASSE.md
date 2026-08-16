# Audit de compromission

Clefkey propose un **audit de compromission** intégré au site, accessible :

- depuis la **landing page**, juste en dessous du champ principal ;
- depuis le **coffre connecté**, via le menu **Audit** de la sidebar.

Un **switch** permet de basculer entre les modes :

| Mode | Service interrogé | Donnée transmise |
| --- | --- | --- |
| Mot de passe (icône cadenas) | [Have I Been Pwned — Pwned Passwords](https://haveibeenpwned.com/Passwords) | 5 caractères du hash SHA-1 |
| Adresse e-mail (icône enveloppe) | [XposedOrNot](https://xposedornot.com/) | l'adresse e-mail |
| Username (icône utilisateur) | Proxy Sherlock intégré | le username public (+ aucune donnée du coffre) |

Le widget est implémenté dans `frontend/js/breach-check.js` et partagé entre la landing page et la page d'audit du coffre. Sur la landing page, seuls les modes mot de passe et e-mail sont proposés.

## Mode mot de passe

### Zero-knowledge

1. Le navigateur calcule le hash **SHA-1** du mot de passe localement, avec l'API Web Crypto du navigateur.
2. Seuls les **5 premiers caractères** du hash sont envoyés au service [Have I Been Pwned — Pwned Passwords](https://haveibeenpwned.com/Passwords).
3. L'API renvoie une liste de suffixes de hash ayant fuité, accompagnés du nombre d'occurrences.
4. Le navigateur compare le suffixe du mot de passe testé. Si une correspondance est trouvée, le mot de passe est compromis.

Aucun mot de passe complet, ni hash complet, n'est envoyé sur le réseau.

### K-anonymity

Cette méthode est appelée **k-anonymity** : le service ne peut pas différencier le mot de passe testé des milliers d'autres partageant le même préfixe SHA-1.

### Utilisation

1. Sélectionnez l'onglet **Mot de passe**.
2. Saisissez le mot de passe à vérifier dans le champ arrondi.
3. Cliquez sur l'icône **œil** pour afficher ou masquer le texte en clair.
4. Cliquez sur **Vérifier**.
5. Le résultat apparaît directement sous le champ :
   - **Mot de passe non compromis** (icône coche, vert) : il n'a pas été trouvé dans les bases de fuites connues.
   - **Compromis N fois** (icône alerte, rouge) : le mot de passe a fuité ; changez-le.

## Mode adresse e-mail

Le mode e-mail interroge l'API publique et gratuite de **XposedOrNot** (sans clé API) :

```
GET https://api.xposedornot.com/v1/check-email/{email}
```

- Une réponse **404** ou un champ `Error` signifie qu'aucune fuite connue ne concerne cette adresse (résultat vert).
- Sinon, la liste `breaches` renvoie les plateformes compromises, affichées avec leur nombre (résultat rouge).

Contrairement au mode mot de passe, **l'adresse e-mail est transmise en clair** au service : c'est inhérent à l'API. Aucune donnée du coffre Clefkey n'accompagne la requête.

### Utilisation

1. Sélectionnez l'onglet **Adresse e-mail**.
2. Saisissez l'adresse à tester (le bouton œil disparaît, le champ passe en type `email`).
3. Cliquez sur **Vérifier**.

## Mode username

Disponible dans le coffre connecté uniquement (page Audit, onglet **Username**). Le serveur Clefkey fait office de **proxy Sherlock** (`GET /vault/username-check`) : il interroge ~60 sites publics pour savoir si le username est déjà pris, en déduisant la réponse depuis le code HTTP, le message d’erreur ou la redirection de chaque site.

Le résultat indique si le username est **disponible**, **déjà utilisé** ou **indéterminé** (sites inaccessibles), et le serveur applique un rate limit de 20 requêtes/min.

- La même vérification alimente l'onglet **Username** du Générateur (vérification en lot de variantes).
- Aucune donnée du coffre n'accompagne la requête : seul le username public est transmis aux sites tiers.
- Voir [API.md](./API.md) pour les paramètres (`username`, `limit`).

## Limites

- Le test indique une fuite **connue et publique** : un résultat « non compromis » peut malgré tout correspondre à une base non répertoriée.
- Pwned Passwords couvre principalement les mots de passe d'usage courant. Des mots de passe très uniques (et longs) peuvent ne pas y figurer.
- L'audit ne teste pas la robustesse, seulement l'existence dans des fuites.
- Les deux services sont externes : une indisponibilité réseau affiche un message d'erreur.

## Mode clair / sombre

Le switch, le champ d'audit et le message de résultat s'adaptent automatiquement au thème choisi dans l'application (clair ou sombre).

## Confidentialité

- Le calcul SHA-1 est réalisé **côté client**.
- En mode mot de passe, l'appel réseau envoie 5 caractères de hash uniquement (`https://api.pwnedpasswords.com/range/…`).
- En mode e-mail, seule l'adresse saisie est transmise à XposedOrNot ; elle n'est ni stockée ni liée à votre compte.
- En mode username, le navigateur n'appelle que **votre** serveur Clefkey (même origine) ; c'est le serveur qui interroge les sites tiers, avec rate limit.
- Aucune information liée au compte Clefkey n'est transmise à ces services.
- La CSP (`vault/middleware.py`) autorise explicitement `api.pwnedpasswords.com` et `api.xposedornot.com` dans `connect-src`.
