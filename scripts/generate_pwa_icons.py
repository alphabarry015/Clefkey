#!/usr/bin/env python3
"""Génère les icônes PNG PWA Gardefort à partir du logo chevalier."""

from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"], stdout=subprocess.DEVNULL)
    from PIL import Image, ImageDraw

ACCENT = (37, 99, 235, 255)  # #2563eb
WHITE = (255, 255, 255, 255)
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "icons"
SOURCE_CANDIDATES = (
    OUT_DIR / "chevalier-source.png",
    OUT_DIR / "logo-chevalier.png",
)


def _load_alpha_mask() -> Image.Image:
    src = next((p for p in SOURCE_CANDIDATES if p.exists()), None)
    if src is None:
        raise FileNotFoundError(
            "Logo source introuvable (frontend/icons/chevalier-source.png). "
            "Placez le PNG chevalier puis relancez."
        )
    img = Image.open(src).convert("RGBA")
    # Silhouette noire sur fond transparent → alpha ; sinon luminosité.
    alpha = img.split()[3]
    if sum(1 for v in alpha.get_flattened_data() if v > 10) < 100:
        # Fallback blanc sur noir
        pixels = img.load()
        alpha = Image.new("L", img.size, 0)
        ap = alpha.load()
        for y in range(img.height):
            for x in range(img.width):
                r, g, b, _a = pixels[x, y]
                ap[x, y] = (r + g + b) // 3
    bbox = alpha.getbbox()
    if not bbox:
        raise ValueError("Impossible d'extraire la silhouette du logo")
    pad = 8
    x0 = max(0, bbox[0] - pad)
    y0 = max(0, bbox[1] - pad)
    x1 = min(img.width, bbox[2] + pad)
    y1 = min(img.height, bbox[3] + pad)
    return alpha.crop((x0, y0, x1, y1))


def make_colored(mask: Image.Image, color, size: int) -> Image.Image:
    canvas = Image.new("L", (size, size), 0)
    mw, mh = mask.size
    scale = min(size / mw, size / mh) * 0.9
    nw, nh = max(1, int(mw * scale)), max(1, int(mh * scale))
    resized = mask.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2))
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    solid = Image.new("RGBA", (size, size), color)
    out.paste(solid, (0, 0), canvas)
    return out


def draw_icon(size: int, padding_ratio: float = 0.1) -> Image.Image:
    mask = _load_alpha_mask()
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    pad = int(size * padding_ratio)
    radius = int(size * 0.18)
    draw.rounded_rectangle(
        [pad, pad, size - pad - 1, size - pad - 1],
        radius=radius,
        fill=ACCENT,
    )
    knight = make_colored(mask, WHITE, size)
    inset = int(size * 0.16)
    knight = knight.resize((size - 2 * inset, size - 2 * inset), Image.Resampling.LANCZOS)
    base.paste(knight, (inset, inset), knight)
    return base


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mask = _load_alpha_mask()
    make_colored(mask, ACCENT, 512).save(OUT_DIR / "logo-chevalier.png", "PNG")
    make_colored(mask, ACCENT, 512).save(OUT_DIR / "icon-mark.png", "PNG")
    draw_icon(192).save(OUT_DIR / "icon-192.png", "PNG")
    draw_icon(512).save(OUT_DIR / "icon-512.png", "PNG")
    draw_icon(512, padding_ratio=0.18).save(OUT_DIR / "icon-512-maskable.png", "PNG")
    print(f"Icônes générées dans {OUT_DIR}")


if __name__ == "__main__":
    main()
