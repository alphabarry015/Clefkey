#!/usr/bin/env python3
"""Synchronise les listes SecLists utiles au refus du mot de passe maître."""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "frontend" / "data"
LANG = DATA / "language-specific"
COMMON = DATA / "common-credentials"
KEYBOARD = DATA / "keyboard-walks"
DEFAULTS = DATA / "default-credentials"

RAW = "https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords"
CC = f"{RAW}/Common-Credentials"

NCSC = "100k-most-used-passwords-NCSC.txt"

LANGUAGE_FILES = [
    "Arabic_common-password-list-top-487.txt",
    "Cantonese_Pwdb_common-password-list-top-150.txt",
    "Chinese-common-password-list-top-100000.txt",
    "Crotian_Pwdb_common-password-list-top-150.txt",
    "Danish_Pwdb_common-password-list-top-150.txt",
    "Estonian_Pwdb_common-password-list-top-150.txt",
    "Finnish_Pwdb_common-password-list-top-150.txt",
    "French-common-password-list-top-20000.txt",
    "French_Pwdb_common-password-list-top-150.txt",
    "German_Pwdb_common-password-list-top-150.txt",
    "German_common-password-list-top-100000.txt",
    "Greek_Pwdb_common-password-list-top-150.txt",
    "Hebrew_Pwdb_common-password-list-top-150.txt",
    "Hindi_Pwdb_common-password-list-top-150.txt",
    "Hungarian_Pwdb_common-password-list-top-150.txt",
    "Icelandic_Pwdb_common-password-list-top-150.txt",
    "Indonesian_Pwdb_common-password-list-top-150.txt",
    "Italian_Pwdb_common-password-list-top-150.txt",
    "Japanese_Pwdb_common-password-list-top-150.txt",
    "Latvian_Pwdb_common-password-list-top-150.txt",
    "Lithuanian_Pwdb_common-password-list-top-150.txt",
    "Malay_Pwdb_common-password-list-top-150.txt",
    "Mandarin_Pwdb_common-password-list-top-150.txt",
    "Norwegian_Pwdb_common-password-list-top-150.txt",
    "Polish_Pwdb_common-password-list-top-150.txt",
    "Portugese_Pwdb_common-password-list-top-150.txt",
    "Russian_Pwdb_common-password-list-top-150.txt",
    "Slovak_Pwdb_common-password-list-top-150.txt",
    "Spanish_1000-common-usernames-and-passwords.txt",
    "Spanish_Pwdb_common-password-list-top-150.txt",
    "Swedish_Pwdb_common-password-list-top-150.txt",
    "Thai_Pwdb_common-password-list-top-150.txt",
    "Turkish_Pwdb_common-password-list-top-150.txt",
    "Ukranian_Pwdb_common-password-list-top-150.txt",
]

LANG_TRUNCATED = {
    "Dutch_common-pasword-list.txt": ("Dutch_common-password-list-top-100000.txt", 100_000),
    "Polish-common-password-list.txt": ("Polish-common-password-list-top-100000.txt", 100_000),
    "Spanish_common-usernames-and-passwords.txt": (
        "Spanish_common-usernames-and-passwords.txt",
        100_000,
    ),
}

# Fichiers Common-Credentials (hors NCSC / Language-Specific), taille navigateur.
COMMON_CREDENTIAL_FILES = [
    "500-worst-passwords.txt",
    "2020-200_most_used_passwords.txt",
    "2023-200_most_used_passwords.txt",
    "2024-197_most_used_passwords.txt",
    "2025-199_most_used_passwords.txt",
    "SplashData-2014.txt",
    "SplashData-2015-1.txt",
    "SplashData-2015-2.txt",
    "Pwdb_top-100000.txt",
    "darkweb2017_top-10000.txt",
    "probable-v2_top-12000.txt",
    "common-passwords-win.txt",
    "medical-devices.txt",
    "top-20-common-SSH-passwords.txt",
    "top-passwords-shortlist.txt",
    "worst-passwords-2017-top100-slashdata.txt",
    "xato-net-10-million-passwords-100000.txt",
]

# Racine Passwords/ (petites listes utiles).
ROOT_PASSWORD_FILES = [
    "corporate_passwords.txt",
    "stupid-ones-in-production.txt",
    "seasons.txt",
    "months.txt",
    "days.txt",
    "Most-Popular-Letter-Passes.txt",
    "clarkson-university-82.txt",
]

DEFAULT_PLAIN = [
    "default-passwords.txt",
    "cirt-net_collection.txt",
]

DEFAULT_USERPASS = [
    "avaya_defaultpasslist.txt",
    "citrix.txt",
    "cryptominers.txt",
    "db2-betterdefaultpasslist.txt",
    "ftp-betterdefaultpasslist.txt",
    "mssql-betterdefaultpasslist.txt",
    "mysql-betterdefaultpasslist.txt",
    "oracle-betterdefaultpasslist.txt",
    "postgres-betterdefaultpasslist.txt",
    "ssh-betterdefaultpasslist.txt",
    "telnet-betterdefaultpasslist.txt",
    "telnet-phenoelit.txt",
    "tomcat-betterdefaultpasslist.txt",
    "vnc-betterdefaultpasslist.txt",
    "windows-betterdefaultpasslist.txt",
]


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=180) as resp:
        return resp.read()


def write_text(path: Path, data: bytes | str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = data.encode("utf-8") if isinstance(data, str) else data
    path.write_bytes(raw)
    print(f"  OK {path.relative_to(ROOT)} ({len(raw):,} octets)")


def lines_to_file(path: Path, values: set[str]) -> None:
    ordered = sorted(v for v in values if v)
    write_text(path, "\n".join(ordered) + ("\n" if ordered else ""))


def extract_userpass_passwords(text: str) -> set[str]:
    out: set[str] = set()
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" in line:
            _user, pwd = line.split(":", 1)
            pwd = pwd.strip()
            if pwd and pwd.upper() not in {"<BLANK>", "BLANK", "(none)", "none"}:
                out.add(pwd)
        else:
            out.add(line)
    return out


def extract_csv_passwords(text: str, password_keys: tuple[str, ...] = ("Password", "password", "pwd")) -> set[str]:
    out: set[str] = set()
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return out
    key = next((k for k in reader.fieldnames if k in password_keys), None)
    if not key:
        # fallback: dernière colonne
        key = reader.fieldnames[-1]
    for row in reader:
        pwd = (row.get(key) or "").strip().strip('"')
        if not pwd or pwd.upper() in {"<BLANK>", "BLANK", "(NONE)", "NONE"}:
            continue
        out.add(pwd)
    return out


def write_manifest() -> None:
    files: list[str] = []
    if (DATA / NCSC).exists():
        files.append(NCSC)
    for folder in ("common-credentials", "language-specific", "keyboard-walks", "default-credentials"):
        d = DATA / folder
        if not d.is_dir():
            continue
        files.extend(f"{folder}/{p.name}" for p in sorted(d.glob("*.txt")))

    # Chargées en premier côté navigateur (validation rapide à l'inscription).
    priority_candidates = [
        NCSC,
        "common-credentials/500-worst-passwords.txt",
        "common-credentials/Pwdb_top-100000.txt",
        "common-credentials/corporate_passwords.txt",
        "common-credentials/seasons.txt",
        "common-credentials/months.txt",
        "language-specific/French-common-password-list-top-20000.txt",
        "keyboard-walks/Keyboard-Combinations.txt",
        "default-credentials/default-passwords.txt",
        "default-credentials/cirt-net_collection.txt",
    ]
    priority = [p for p in priority_candidates if p in files]

    manifest = {
        "source": "https://github.com/danielmiessler/SecLists/tree/master/Passwords",
        "priority": priority,
        "files": files,
        "notes": [
            "NCSC + Language-Specific + Common-Credentials + Keyboard-Walks + Default-Credentials",
            "Pas le repo SecLists entier (Leaked-Databases, Fuzzing, etc.)",
            "Listes trop volumineuses tronquees ou remplacees par top-100000",
            "Default-Credentials normalisees (mot de passe seul, pas user:pass)",
            "priority = fichiers charges en premier pour la validation inscription",
        ],
    }
    path = DATA / "common-passwords-manifest.json"
    path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Manifeste : {len(files)} fichiers -> {path.relative_to(ROOT)}")


def main() -> None:
    print("NCSC…")
    write_text(DATA / NCSC, download(f"{CC}/{NCSC}"))

    print("Common-Credentials…")
    for name in COMMON_CREDENTIAL_FILES:
        write_text(COMMON / name, download(f"{CC}/{name}"))

    print("Passwords (racine)…")
    for name in ROOT_PASSWORD_FILES:
        write_text(COMMON / name, download(f"{RAW}/{name}"))

    print("Language-Specific…")
    for name in LANGUAGE_FILES:
        write_text(LANG / name, download(f"{CC}/Language-Specific/{name}"))
    for remote, (local_name, limit) in LANG_TRUNCATED.items():
        raw = download(f"{CC}/Language-Specific/{remote}").decode("utf-8", errors="replace")
        lines = raw.splitlines()[:limit]
        write_text(LANG / local_name, "\n".join(lines) + ("\n" if lines else ""))

    print("Keyboard-Walks…")
    write_text(
        KEYBOARD / "Keyboard-Combinations.txt",
        download(f"{RAW}/Keyboard-Walks/Keyboard-Combinations.txt"),
    )
    walk = download(f"{RAW}/Keyboard-Walks/walk-the-line.txt").decode("utf-8", errors="replace")
    walk_lines = walk.splitlines()[:100_000]
    write_text(
        KEYBOARD / "walk-the-line-top-100000.txt",
        "\n".join(walk_lines) + ("\n" if walk_lines else ""),
    )

    print("Default-Credentials…")
    for name in DEFAULT_PLAIN:
        write_text(DEFAULTS / name, download(f"{RAW}/Default-Credentials/{name}"))

    merged_userpass: set[str] = set()
    for name in DEFAULT_USERPASS:
        text = download(f"{RAW}/Default-Credentials/{name}").decode("utf-8", errors="replace")
        merged_userpass |= extract_userpass_passwords(text)
    lines_to_file(DEFAULTS / "betterdefaultpasslists-passwords.txt", merged_userpass)

    csv_text = download(f"{RAW}/Default-Credentials/default-passwords.csv").decode(
        "utf-8", errors="replace"
    )
    lines_to_file(DEFAULTS / "default-passwords-from-csv.txt", extract_csv_passwords(csv_text))

    scada = download(f"{RAW}/Default-Credentials/scada-pass.csv").decode("utf-8", errors="replace")
    lines_to_file(DEFAULTS / "scada-pass-passwords.txt", extract_csv_passwords(scada))

    write_manifest()
    print("Terminé.")


if __name__ == "__main__":
    main()
