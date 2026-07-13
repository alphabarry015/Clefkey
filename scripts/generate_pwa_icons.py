#!/usr/bin/env python3
"""Génère les icônes PNG pour la PWA Coffre-Fort."""

from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"], stdout=subprocess.DEVNULL)
    from PIL import Image, ImageDraw

ACCENT = (37, 99, 235)
WHITE = (255, 255, 255)
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "icons"


def draw_icon(size: int, padding_ratio: float = 0.1) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    pad = int(size * padding_ratio)
    radius = int(size * 0.18)
    draw.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=radius,
        fill=ACCENT + (255,),
    )

    cx, cy = size // 2, size // 2
    s = size * 0.2
    shield = [
        (cx, cy - s * 1.15),
        (cx + s * 0.95, cy - s * 0.45),
        (cx + s * 0.95, cy + s * 0.25),
        (cx, cy + s * 1.15),
        (cx - s * 0.95, cy + s * 0.25),
        (cx - s * 0.95, cy - s * 0.45),
    ]
    draw.polygon(shield, outline=WHITE + (255,), width=max(3, size // 24))

    line_w = max(3, size // 28)
    draw.line(
        [(cx - s * 0.4, cy + s * 0.05), (cx - s * 0.05, cy + s * 0.45), (cx + s * 0.5, cy - s * 0.35)],
        fill=WHITE + (255,),
        width=line_w,
    )
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    draw_icon(192).save(OUT_DIR / "icon-192.png", "PNG")
    draw_icon(512).save(OUT_DIR / "icon-512.png", "PNG")
    draw_icon(512, padding_ratio=0.2).save(OUT_DIR / "icon-512-maskable.png", "PNG")
    print(f"Icônes générées dans {OUT_DIR}")


if __name__ == "__main__":
    main()
