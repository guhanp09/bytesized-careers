#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Union

from PIL import Image, ImageDraw, ImageFont


OFF_WHITE = "#F2F2F2"
DARK_BG = "#0B0B0C"
CANVAS = 512


@dataclass(frozen=True)
class RoundedRect:
    x1: float
    y1: float
    x2: float
    y2: float
    radius: float


@dataclass(frozen=True)
class Polygon:
    points: tuple[tuple[float, float], ...]


Shape = Union[RoundedRect, Polygon]


PRIMARY_SOLIDS: tuple[Shape, ...] = (
    RoundedRect(62, 86, 286, 366, 70),
    Polygon(((95, 328), (190, 286), (122, 378))),
    RoundedRect(220, 130, 450, 352, 84),
    Polygon(((314, 352), (362, 352), (314, 390))),
)

PRIMARY_CUTS: tuple[Shape, ...] = (
    RoundedRect(128, 166, 224, 288, 34),
    RoundedRect(278, 190, 394, 296, 42),
    Polygon(((222, 254), (304, 212), (332, 228), (250, 278))),
    Polygon(((224, 186), (280, 160), (304, 178), (250, 206))),
    Polygon(((224, 302), (280, 274), (282, 306), (236, 334))),
)

MICRO_SOLIDS: tuple[Shape, ...] = (
    RoundedRect(74, 104, 292, 370, 78),
    Polygon(((104, 324), (196, 288), (132, 382))),
    RoundedRect(206, 144, 440, 358, 84),
    Polygon(((314, 358), (362, 358), (314, 394))),
)

MICRO_CUTS: tuple[Shape, ...] = (
    RoundedRect(142, 178, 236, 288, 38),
    RoundedRect(278, 196, 390, 296, 42),
    Polygon(((214, 260), (300, 220), (322, 236), (248, 278))),
)


def _svg_shape(shape: Shape) -> str:
    if isinstance(shape, RoundedRect):
        width = shape.x2 - shape.x1
        height = shape.y2 - shape.y1
        return (
            f"<rect x='{shape.x1}' y='{shape.y1}' width='{width}' height='{height}' "
            f"rx='{shape.radius}' ry='{shape.radius}'/>"
        )
    points = " ".join(f"{x},{y}" for x, y in shape.points)
    return f"<polygon points='{points}'/>"


def _draw_shape(draw: ImageDraw.ImageDraw, shape: Shape, *, fill: int) -> None:
    if isinstance(shape, RoundedRect):
        draw.rounded_rectangle((shape.x1, shape.y1, shape.x2, shape.y2), radius=shape.radius, fill=fill)
    else:
        draw.polygon(shape.points, fill=fill)


def build_mask(solids: Iterable[Shape], cuts: Iterable[Shape], size: int = CANVAS) -> Image.Image:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    draw = ImageDraw.Draw(mask)
    for shape in solids:
        _draw_shape(draw, shape, fill=255)
    for shape in cuts:
        _draw_shape(draw, shape, fill=0)
    if size != CANVAS:
        mask = mask.resize((size, size), Image.Resampling.LANCZOS)
    return mask


def render_mark(solids: Iterable[Shape], cuts: Iterable[Shape], size: int) -> Image.Image:
    alpha = build_mask(solids, cuts, size=size)
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    color = Image.new("RGBA", (size, size), OFF_WHITE)
    image.paste(color, (0, 0), alpha)
    return image


def optimize_svg(svg: str) -> str:
    compact = " ".join(svg.replace("\n", " ").split())
    compact = compact.replace("> <", "><")
    return compact


def build_mark_svg(solids: Iterable[Shape], cuts: Iterable[Shape]) -> str:
    solid_markup = "".join(_svg_shape(shape) for shape in solids)
    cut_markup = "".join(_svg_shape(shape) for shape in cuts)
    raw = f"""
<svg xmlns='http://www.w3.org/2000/svg' width='{CANVAS}' height='{CANVAS}' viewBox='0 0 {CANVAS} {CANVAS}' fill='none'>
  <defs>
    <mask id='cut-mask' maskUnits='userSpaceOnUse' x='0' y='0' width='{CANVAS}' height='{CANVAS}'>
      <rect width='{CANVAS}' height='{CANVAS}' fill='white'/>
      <g fill='black'>{cut_markup}</g>
    </mask>
  </defs>
  <g fill='{OFF_WHITE}' mask='url(#cut-mask)'>{solid_markup}</g>
</svg>
"""
    return optimize_svg(raw)


def _load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = []
    if bold:
        candidates.extend(
            [
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/Library/Fonts/Arial Bold.ttf",
            ]
        )
    candidates.extend(
        [
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/Library/Fonts/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        ]
    )
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def build_lockup_svg() -> str:
    solids = "".join(_svg_shape(shape) for shape in PRIMARY_SOLIDS)
    cuts = "".join(_svg_shape(shape) for shape in PRIMARY_CUTS)
    raw = f"""
<svg xmlns='http://www.w3.org/2000/svg' width='900' height='240' viewBox='0 0 900 240' fill='none'>
  <defs>
    <mask id='lockup-cut' maskUnits='userSpaceOnUse' x='0' y='0' width='{CANVAS}' height='{CANVAS}'>
      <rect width='{CANVAS}' height='{CANVAS}' fill='white'/>
      <g fill='black'>{cuts}</g>
    </mask>
  </defs>
  <g transform='translate(12,12) scale(0.421875)'>
    <g fill='{OFF_WHITE}' mask='url(#lockup-cut)'>{solids}</g>
  </g>
  <text
    x='250'
    y='146'
    fill='{OFF_WHITE}'
    font-size='72'
    font-family='Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif'
    font-weight='600'
    letter-spacing='0.2'
  >CreatorJobs</text>
</svg>
"""
    return optimize_svg(raw)


def render_lockup_png(width: int, height: int, icon: Image.Image) -> Image.Image:
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    icon_size = int(height * 0.76)
    icon_resized = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    icon_y = (height - icon_size) // 2
    canvas.paste(icon_resized, (12, icon_y), icon_resized)

    draw = ImageDraw.Draw(canvas)
    font = _load_font(int(height * 0.42), bold=True)
    text_x = 12 + icon_size + int(height * 0.11)
    text = "CreatorJobs"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_h = bbox[3] - bbox[1]
    text_y = (height - text_h) // 2 - 1
    draw.text((text_x, text_y), text, fill=OFF_WHITE, font=font)
    return canvas


def render_preview(path: Path, primary: Image.Image, micro: Image.Image) -> None:
    preview = Image.new("RGBA", (1180, 430), DARK_BG)
    draw = ImageDraw.Draw(preview)
    label_font = _load_font(20, bold=True)
    size_font = _load_font(14, bold=False)

    draw.text((32, 24), "Primary mark", fill=OFF_WHITE, font=label_font)
    primary_sizes = [16, 20, 24, 28, 32, 48, 64]
    x = 32
    y = 64
    for size in primary_sizes:
        resized = primary.resize((size, size), Image.Resampling.LANCZOS)
        preview.paste(resized, (x, y), resized)
        draw.text((x, y + 76), f"{size}px", fill="#BEBEC2", font=size_font)
        x += 86

    draw.text((32, 210), "Micro mark", fill=OFF_WHITE, font=label_font)
    micro_sizes = [16, 20, 24, 32]
    x = 32
    y = 252
    for size in micro_sizes:
        resized = micro.resize((size, size), Image.Resampling.LANCZOS)
        preview.paste(resized, (x, y), resized)
        draw.text((x, y + 52), f"{size}px", fill="#BEBEC2", font=size_font)
        x += 86

    preview.save(path)


def write_text(path: Path, content: str) -> None:
    path.write_text(content + "\n", encoding="utf-8")


def main() -> None:
    base = Path(__file__).resolve().parent

    primary_svg = build_mark_svg(PRIMARY_SOLIDS, PRIMARY_CUTS)
    micro_svg = build_mark_svg(MICRO_SOLIDS, MICRO_CUTS)
    lockup_svg = build_lockup_svg()

    write_text(base / "logo-mark-primary.svg", primary_svg)
    write_text(base / "logo-mark-micro.svg", micro_svg)
    write_text(base / "favicon.svg", micro_svg)
    write_text(base / "logo-lockup.svg", lockup_svg)

    primary_512 = render_mark(PRIMARY_SOLIDS, PRIMARY_CUTS, 512)
    primary_512.save(base / "logo-mark-primary-512.png")
    primary_512.resize((256, 256), Image.Resampling.LANCZOS).save(base / "logo-mark-primary-256.png")
    primary_512.resize((128, 128), Image.Resampling.LANCZOS).save(base / "logo-mark-primary-128.png")

    micro_512 = render_mark(MICRO_SOLIDS, MICRO_CUTS, 512)
    micro_512.resize((64, 64), Image.Resampling.LANCZOS).save(base / "logo-mark-micro-64.png")
    micro_512.resize((32, 32), Image.Resampling.LANCZOS).save(base / "logo-mark-micro-32.png")

    lockup_512 = render_lockup_png(512, 128, primary_512)
    lockup_512.save(base / "logo-lockup-512.png")
    lockup_512.resize((256, 64), Image.Resampling.LANCZOS).save(base / "logo-lockup-256.png")

    favicon_base = micro_512.resize((256, 256), Image.Resampling.LANCZOS)
    favicon_base.save(
        base / "favicon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64)],
    )

    render_preview(base / "logo-preview.png", primary_512, micro_512)


if __name__ == "__main__":
    main()
