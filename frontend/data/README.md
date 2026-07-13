# Listes de mots de passe courants

Vérification **côté navigateur** à l’inscription (le maître n’est jamais envoyé au serveur pour ce check).

Chargement en 2 phases (`priority` puis reste) pour ne pas bloquer l’inscription.

Source : [SecLists / Passwords](https://github.com/danielmiessler/SecLists/tree/master/Passwords) (sélection, pas le repo entier).

| Dossier / fichier | Contenu |
|-------------------|---------|
| `100k-most-used-passwords-NCSC.txt` | NCSC / UK |
| `common-credentials/` | Tops Pwdb/xato/darkweb, saisons, corporate, etc. |
| `language-specific/` | Listes par langue |
| `keyboard-walks/` | Combinaisons clavier (`qwerty` walks…) |
| `default-credentials/` | MDP par défaut (normalisés, sans `user:`) |

## Hors périmètre

Pas de `Leaked-Databases`, `Fuzzing`, `Discovery`, listes 1M/10M, etc. — trop lourds ou hors sujet pour l’inscription.

## Mise à jour

```bash
python scripts/sync_common_password_lists.py
```

Puis incrémenter `CACHE_VERSION` dans `frontend/sw.js` si besoin.
