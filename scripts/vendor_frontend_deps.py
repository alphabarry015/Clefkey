#!/usr/bin/env python3
"""Régénère frontend/vendor/ (hash-wasm, @noble/curves, lucide) sans CDN."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VENDOR = ROOT / "frontend" / "vendor"

LUCIDE_ENTRY = """\
export { createIcons } from 'lucide';
import {
  ShieldCheck, ArrowLeft, Mail, Lock, Eye, EyeOff, ArrowRight, User, UserPlus,
  Plus, LayoutDashboard, KeySquare, LogOut, Menu, Layers, Search, X, KeyRound,
  SearchX, Calendar, IdCard, Pencil, UserRound, Users, Copy, Fingerprint,
  CalendarCheck, ChevronRight, ExternalLink, Trash2, Dices, Save,
  CheckCircle, XCircle, Info
} from 'lucide';

export const icons = {
  ShieldCheck, ArrowLeft, Mail, Lock, Eye, EyeOff, ArrowRight, User, UserPlus,
  Plus, LayoutDashboard, KeySquare, LogOut, Menu, Layers, Search, X, KeyRound,
  SearchX, Calendar, IdCard, Pencil, UserRound, Users, Copy, Fingerprint,
  CalendarCheck, ChevronRight, ExternalLink, Trash2, Dices, Save,
  CheckCircle, XCircle, Info,
};
"""


def main() -> None:
    VENDOR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="binalph-vendor-") as tmp:
        tmp_path = Path(tmp)
        subprocess.check_call(["npm", "init", "-y"], cwd=tmp_path, stdout=subprocess.DEVNULL)
        subprocess.check_call(
            [
                "npm",
                "install",
                "hash-wasm@4.12.0",
                "@noble/curves@1.8.1",
                "lucide@0.468.0",
                "esbuild",
            ],
            cwd=tmp_path,
        )
        (tmp_path / "lucide-entry.js").write_text(LUCIDE_ENTRY, encoding="utf-8")
        subprocess.check_call(
            [
                "npx",
                "esbuild",
                "lucide-entry.js",
                "--bundle",
                "--format=esm",
                "--platform=browser",
                "--outfile=lucide.bundle.js",
                "--minify",
            ],
            cwd=tmp_path,
        )
        subprocess.check_call(
            [
                "npx",
                "esbuild",
                "node_modules/@noble/curves/esm/ed25519.js",
                "--bundle",
                "--format=esm",
                "--platform=browser",
                "--outfile=noble-ed25519.bundle.js",
                "--minify",
            ],
            cwd=tmp_path,
        )
        shutil.copy(
            tmp_path / "node_modules" / "hash-wasm" / "dist" / "index.esm.min.js",
            VENDOR / "hash-wasm.esm.min.js",
        )
        shutil.copy(tmp_path / "lucide.bundle.js", VENDOR / "lucide.bundle.js")
        shutil.copy(tmp_path / "noble-ed25519.bundle.js", VENDOR / "noble-ed25519.bundle.js")

    print(f"Vendor mis à jour dans {VENDOR}")


if __name__ == "__main__":
    main()
