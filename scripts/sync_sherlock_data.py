#!/usr/bin/env python3
"""Synchronise la base Sherlock (data.json) utilisée pour l'énumération d'usernames."""

from __future__ import annotations

import json
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "vault" / "data"
SHERLOCK_JSON = DATA / "sherlock-data.json"

RAW = "https://raw.githubusercontent.com/sherlock-project/sherlock/master/sherlock_project/resources/data.json"


def download(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=180) as resp:
        return resp.read()


def main() -> None:
    raw = download(RAW)
    data = json.loads(raw.decode("utf-8"))
    sites = {name: site for name, site in data.items() if name != "$schema"}
    if len(sites) < 100:
        raise SystemExit("data.json invalide : trop peu de sites.")
    DATA.mkdir(parents=True, exist_ok=True)
    SHERLOCK_JSON.write_text(json.dumps(sites, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  OK {SHERLOCK_JSON.relative_to(ROOT)} ({len(sites)} sites)")


if __name__ == "__main__":
    main()