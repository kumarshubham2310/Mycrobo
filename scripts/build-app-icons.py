from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "apps" / "client" / "assets"
SOURCE = ASSETS / "mycrobo-app-v2-source.png"


def contain_mark(source: Image.Image, canvas_size: int, padding_ratio: float) -> Image.Image:
    mark = source.convert("RGBA")
    alpha_bbox = mark.getchannel("A").getbbox()
    if not alpha_bbox:
        raise ValueError("The icon master has no visible pixels.")
    mark = mark.crop(alpha_bbox)
    usable = round(canvas_size * (1 - (padding_ratio * 2)))
    scale = min(usable / mark.width, usable / mark.height)
    target = (
        max(1, round(mark.width * scale)),
        max(1, round(mark.height * scale)),
    )
    mark = mark.resize(target, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = ((canvas_size - mark.width) // 2, (canvas_size - mark.height) // 2)
    canvas.alpha_composite(mark, offset)
    return canvas


def rounded_app_icon(mark: Image.Image, size: int) -> Image.Image:
    # A light surface keeps the black identity mark legible in both light and dark OS themes.
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mask = Image.new("L", (size, size), 0)
    radius = round(size * 0.22)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1),
        radius=radius,
        fill=255,
    )
    surface = Image.new("RGBA", (size, size), (250, 252, 251, 255))
    canvas.paste(surface, (0, 0), mask)
    canvas.alpha_composite(mark.resize((size, size), Image.Resampling.LANCZOS))
    return canvas


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    source = Image.open(SOURCE)
    transparent_master = contain_mark(source, 1024, 0.14)
    transparent_master.save(ASSETS / "mycrobo-app-v2-master.png", optimize=True)

    # The mark is deliberately given more breathing room inside the OS-managed icon tile.
    icon_mark = contain_mark(source, 1024, 0.19)
    icon_1024 = rounded_app_icon(icon_mark, 1024)
    for size in (192, 512):
        icon_1024.resize((size, size), Image.Resampling.LANCZOS).save(
            ASSETS / f"mycrobo-app-v2-{size}.png",
            optimize=True,
        )
    icon_1024.save(
        ASSETS / "mycrobo-app-v2.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
