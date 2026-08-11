# Audit de mot de passe

Clefkey propose un **audit de mot de passe** intégré au site, accessible :

- depuis la **landing page**, juste en dessous du champ principal ;
- depuis le **coffre connecté**, via le menu **Audit** de la sidebar.

L'audit indique si un mot de passe a déjà fuité dans une branche de données publiques, sans jamais transmettre le mot de passe complet.

## Fonctionnement

### Zero-knowledge

1. Le navigateur calcule le hash **SHA-1** du mot de passe localement, avec l'API Web Crypto du navigateur.
2. Seuls les **5 premiers caractères** du hash sont envoyés au service [Have I Been Pwned — Pwned Passwords](https://haveibeenpwned.com/Passwords).
3. L'API renvoie une liste de suffixes de hash ayant fuité, accompagnés du nombre d'occurrences.
4. Le navigateur compare le suffixe du mot de passe testé. Si une correspondance est trouvée, le mot de passe est compromis.

Aucun mot de passe complet, ni hash complet, n'est envoyé sur le réseau.

### K-anonymity

Cette méthode est appelée **k-anonymity** : le service ne peut pas différencier le mot de passe testé des milliers d'autres partageant le même préfixe SHA-1.

## Utilisation

1. Saisissez le mot de passe à vérifier dans le champ arrondi.
2. Cliquez sur **Afficher** si vous voulez visualiser le texte en clair.
3. Cliquez sur **Vérifier**.
4. Le résultat apparaît directement sous le champ :
   - 🟢 **Mot de passe non compromis** : il n'a pas été trouvé dans les bases de fuites connues.
   - 🔴 **Compromis N fois** : le mot de passe a fuité ; changez-le.

## Limites

- Le test indique une fuite **connue et publique** : un mot de passe noté « non compromis » peut avoir fuité dans une base non répertoriée.
- Pwned Passwords couvre principalement les mots de passe d'usage courant. Des mots de passe très uniques (et longs) peuvent ne pas y figurer.
- L'audit ne teste pas la robustesse, seulement l'existence dans des fuites.

## Mode clair / sombre

Le champ d'audit et le message de résultat s'adaptent automatiquement au thème choisi dans l'application (clair ou sombre).

## Confidentialité

- Le calcul SHA-1 est réalisé **côté client**.
- L'appel réseau envoie 5 caractères de hash uniquement (`https://api.pwnedpasswords.com/range/…`).
- Aucune information liée au compte Clefkey n'est transmise à Have I Been Pwned.
