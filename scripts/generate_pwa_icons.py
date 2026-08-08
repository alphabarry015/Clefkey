#!/usr/bin/env python3
"""Génère les icônes PNG PWA Clefkey à partir du logo chevalier."""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"], stdout=subprocess.DEVNULL)
    from PIL import Image, ImageDraw, ImageFont

ACCENT = (37, 99, 235, 255)  # #2563eb
BRAND_BLUE = (54, 98, 215, 255)  # #3662D7 (point du logo)
BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)
BRAND_FONT_CANDIDATES = (
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)
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


def _brand_font(size: int) -> ImageFont.FreeTypeFont:
    for path in BRAND_FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_brand_favicon(size: int) -> Image.Image:
    """Favicon Clefkey : fond noir, « C » blanc suivi du point bleu."""
    img = Image.new("RGBA", (size, size), BLACK)
    draw = ImageDraw.Draw(img)

    # Marge de 8 % : le glyphe doit remplir l'icône sans toucher les bords.
    target = size * 0.84
    font = _brand_font(int(size * 0.9))
    while True:
        box = draw.textbbox((0, 0), "C.", font=font, anchor="ls")
        if (box[2] - box[0] <= target and box[3] - box[1] <= target) or font.size <= 6:
            break
        font = _brand_font(font.size - 1)

    box = draw.textbbox((0, 0), "C.", font=font, anchor="ls")
    # Origine (x, baseline) telle que la boîte du glyphe soit centrée.
    origin_x = (size - (box[2] - box[0])) / 2 - box[0]
    baseline_y = (size - (box[3] - box[1])) / 2 - box[1]

    draw.text((origin_x, baseline_y), "C", font=font, fill=WHITE, anchor="ls")
    draw.text(
        (origin_x + draw.textlength("C", font=font), baseline_y),
        ".",
        font=font,
        fill=BRAND_BLUE,
        anchor="ls",
    )
    return img


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mask = _load_alpha_mask()
    make_colored(mask, ACCENT, 512).save(OUT_DIR / "logo-chevalier.png", "PNG")
    make_colored(mask, ACCENT, 512).save(OUT_DIR / "icon-mark.png", "PNG")
    draw_icon(192).save(OUT_DIR / "icon-192.png", "PNG")
    draw_icon(512).save(OUT_DIR / "icon-512.png", "PNG")
    draw_icon(512, padding_ratio=0.18).save(OUT_DIR / "icon-512-maskable.png", "PNG")
    # Favicon multi-tailles pour les navigateurs qui demandent /favicon.ico
    draw_brand_favicon(48).save(
        OUT_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"Icônes générées dans {OUT_DIR}")


if __name__ == "__main__":
    main()
