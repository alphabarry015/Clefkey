#!/usr/bin/env python3
"""Interface CLI du gestionnaire de mots de passe."""

import getpass
import sys

from client import VaultSession

try:
    import pyperclip
    HAS_CLIPBOARD = True
except ImportError:
    HAS_CLIPBOARD = False


def prompt_password(label: str = "Mot de passe maître") -> str:
    return getpass.getpass(f"{label}: ")


def cmd_register(session: VaultSession):
    email = input("Email: ").strip()
    name = input("Nom affiché: ").strip()
    master = prompt_password()
    confirm = prompt_password("Confirmer le mot de passe maître")
    if master != confirm:
        print("✗ Les mots de passe ne correspondent pas.")
        return
    try:
        session.register(email, name, master)
        print(f"✓ Compte créé pour {name} ({email})")
    except Exception as e:
        print(f"✗ Erreur: {e}")


def cmd_login(session: VaultSession):
    email = input("Email: ").strip()
    master = prompt_password()
    try:
        session.login(email, master)
        print(f"✓ Connecté en tant que {session.display_name}")
    except Exception as e:
        print(f"✗ Erreur de connexion: {e}")


def cmd_add(session: VaultSession):
    title = input("Titre (ex: Netflix): ").strip()
    username = input("Identifiant: ").strip()
    choice = input("Mot de passe [g]énérer / [s]aisir: ").strip().lower()
    if choice == "g":
        password = session.generate_password()
        print(f"  Généré: {password}")
    else:
        password = prompt_password("Mot de passe")
    url = input("URL (optionnel): ").strip()
    notes = input("Notes (optionnel): ").strip()
    try:
        session.add_entry(title, username, password, url, notes)
        print(f"✓ Entrée '{title}' ajoutée")
    except Exception as e:
        print(f"✗ Erreur: {e}")


def cmd_list(session: VaultSession):
    try:
        entries = session.list_entries()
        if not entries:
            print("  (coffre vide)")
            return
        for i, e in enumerate(entries, 1):
            print(f"  {i}. 🔒 {e['title']:<20} {e['username']}")
    except Exception as e:
        print(f"✗ Erreur: {e}")


def cmd_show(session: VaultSession, index: str):
    try:
        entries = session.list_entries()
        idx = int(index) - 1
        if idx < 0 or idx >= len(entries):
            print("✗ Numéro invalide")
            return
        e = entries[idx]
        print(f"\n  {e['title']}")
        print(f"  Identifiant : {e['username']}")
        print(f"  Mot de passe: {e['password']}")
        if e.get("url"):
            print(f"  URL         : {e['url']}")
        if e.get("notes"):
            print(f"  Notes       : {e['notes']}")
        print()
    except Exception as e:
        print(f"✗ Erreur: {e}")


def cmd_copy(session: VaultSession, index: str):
    if not HAS_CLIPBOARD:
        print("✗ pyperclip non installé — impossible de copier")
        return
    try:
        entries = session.list_entries()
        idx = int(index) - 1
        if idx < 0 or idx >= len(entries):
            print("✗ Numéro invalide")
            return
        pyperclip.copy(entries[idx]["password"])
        print(f"✓ Mot de passe '{entries[idx]['title']}' copié")
    except Exception as e:
        print(f"✗ Erreur: {e}")


def cmd_delete(session: VaultSession, index: str):
    try:
        entries = session.list_entries()
        idx = int(index) - 1
        if idx < 0 or idx >= len(entries):
            print("✗ Numéro invalide")
            return
        entry = entries[idx]
        confirm = input(f"Supprimer '{entry['title']}' ? [o/N]: ").strip().lower()
        if confirm == "o":
            session.delete_entry(entry["id"])
            print(f"✓ '{entry['title']}' supprimé")
    except Exception as e:
        print(f"✗ Erreur: {e}")


def cmd_generate(session: VaultSession):
    pwd = session.generate_password()
    print(f"  {pwd}")
    if HAS_CLIPBOARD:
        pyperclip.copy(pwd)
        print("  (copié dans le presse-papiers)")


def print_help():
    print("""
Commandes disponibles:
  register          Créer un compte
  login             Se connecter
  add               Ajouter une entrée
  list              Lister le coffre
  show <n>          Afficher l'entrée n°n
  copy <n>          Copier le mot de passe n°n
  delete <n>        Supprimer l'entrée n°n
  generate          Générer un mot de passe
  lock              Verrouiller le coffre
  help              Afficher cette aide
  quit              Quitter
""")


def main():
    session = VaultSession()
    print("🔐 Gestionnaire de Mots de Passe")
    print("Tapez 'help' pour la liste des commandes.\n")

    while True:
        try:
            if session.token:
                prompt = f"{session.display_name}> "
            else:
                prompt = "> "
            line = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            print("\nAu revoir.")
            break

        if not line:
            continue

        parts = line.split()
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else None

        if cmd == "quit":
            session.lock()
            session.close()
            print("Coffre verrouillé. Au revoir.")
            break
        elif cmd == "help":
            print_help()
        elif cmd == "register":
            cmd_register(session)
        elif cmd == "login":
            cmd_login(session)
        elif cmd == "add":
            if not session.token:
                print("✗ Connectez-vous d'abord (login)")
            else:
                cmd_add(session)
        elif cmd == "list":
            if not session.token:
                print("✗ Connectez-vous d'abord (login)")
            else:
                cmd_list(session)
        elif cmd == "show" and arg:
            if not session.token:
                print("✗ Connectez-vous d'abord (login)")
            else:
                cmd_show(session, arg)
        elif cmd == "copy" and arg:
            if not session.token:
                print("✗ Connectez-vous d'abord (login)")
            else:
                cmd_copy(session, arg)
        elif cmd == "delete" and arg:
            if not session.token:
                print("✗ Connectez-vous d'abord (login)")
            else:
                cmd_delete(session, arg)
        elif cmd == "generate":
            cmd_generate(session)
        elif cmd == "lock":
            session.lock()
            print("✓ Coffre verrouillé")
        else:
            print("✗ Commande inconnue. Tapez 'help'.")


if __name__ == "__main__":
    main()
