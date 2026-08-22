#!/usr/bin/env python3
"""Génère les icônes PNG PWA Clefkey (logo C. blanc + point bleu)."""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    import subprocess
    import sys

    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow"], stdout=subprocess.DEVNULL)
    from PIL import Image, ImageDraw, ImageFont

BRAND_BLUE = (54, 98, 215, 255)  # #3662D7
BLACK = (0, 0, 0, 255)
WHITE = (255, 255, 255, 255)
BRAND_FONT_CANDIDATES = (
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)
OUT_DIR = Path(__file__).resolve().parent.parent / "frontend" / "icons"


def _brand_font(size: int) -> ImageFont.FreeTypeFont:
    for path in BRAND_FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def draw_brand_icon(size: int, content_ratio: float = 0.84) -> Image.Image:
    """Fond noir, « C » blanc suivi du point bleu, centré."""
    img = Image.new("RGBA", (size, size), BLACK)
    draw = ImageDraw.Draw(img)

    target = size * content_ratio
    font = _brand_font(max(8, int(size * content_ratio)))
    while True:
        box = draw.textbbox((0, 0), "C.", font=font, anchor="ls")
        if (box[2] - box[0] <= target and box[3] - box[1] <= target) or font.size <= 6:
            break
        font = _brand_font(font.size - 1)

    box = draw.textbbox((0, 0), "C.", font=font, anchor="ls")
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
    draw_brand_icon(192).save(OUT_DIR / "icon-192.png", "PNG")
    draw_brand_icon(512).save(OUT_DIR / "icon-512.png", "PNG")
    draw_brand_icon(180).save(OUT_DIR / "apple-touch-icon.png", "PNG")
    # Zone sûre maskable (~80 % au centre).
    draw_brand_icon(512, content_ratio=0.64).save(OUT_DIR / "icon-512-maskable.png", "PNG")
    draw_brand_icon(48).save(
        OUT_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
    )
    print(f"Icônes C. générées dans {OUT_DIR}")


if __name__ == "__main__":
    main()
