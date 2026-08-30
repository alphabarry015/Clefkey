#!/usr/bin/env python3
"""Génère les icônes PNG PWA Clefkey à partir du heaume (logo-chevalier)."""

from pathlib import Path

try:
    from PIL import Image
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"], stdout=subprocess.DEVNULL)
    from PIL import Image

BLACK = (0, 0, 0, 255)
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "icons"
SOURCE = OUT_DIR / "logo-chevalier.png"


def draw_brand_icon(size: int, content_ratio: float = 0.86) -> Image.Image:
    """Fond noir, heaume centré (zone sûre maskable via content_ratio)."""
    canvas = Image.new("RGBA", (size, size), BLACK)
    src = Image.open(SOURCE).convert("RGBA")
    box = int(size * content_ratio)
    fitted = src.resize((box, box), Image.Resampling.LANCZOS)
    x = (size - box) // 2
    y = (size - box) // 2
    canvas.paste(fitted, (x, y), fitted)
    return canvas


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Logo source introuvable : {SOURCE}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    draw_brand_icon(192).save(OUT_DIR / "icon-192.png", "PNG")
    draw_brand_icon(512).save(OUT_DIR / "icon-512.png", "PNG")
    draw_brand_icon(180).save(OUT_DIR / "apple-touch-icon.png", "PNG")
    draw_brand_icon(512, content_ratio=0.72).save(OUT_DIR / "icon-512-maskable.png", "PNG")
    draw_brand_icon(48).save(
        OUT_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"Icônes heaume générées dans {OUT_DIR}")


if __name__ == "__main__":
    main()
