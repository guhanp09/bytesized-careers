#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple, Union

from PIL import Image, ImageDraw, ImageOps


CANVAS = 1024


class RoundedRect:
    def __init__(self, x1: float, y1: float, x2: float, y2: float, radius: float):
        self.x1 = x1
        self.y1 = y1
        self.x2 = x2
        self.y2 = y2
        self.radius = radius


class Polygon:
    def __init__(self, points: Iterable[Tuple[float, float]]):
        self.points = tuple(points)


Shape = Union[RoundedRect, Polygon]


def scale(v: float) -> float:
    return v * (CANVAS / 512.0)


LEFT_SOLIDS = (
    RoundedRect(scale(62), scale(86), scale(286), scale(366), scale(70)),
    Polygon(((scale(95), scale(328)), (scale(190), scale(286)), (scale(122), scale(378)))),
)

RIGHT_SOLIDS = (
    RoundedRect(scale(220), scale(130), scale(450), scale(352), scale(84)),
    Polygon(((scale(314), scale(352)), (scale(362), scale(352)), (scale(314), scale(390)))),
)

COMMON_CUTS = (
    RoundedRect(scale(128), scale(166), scale(224), scale(288), scale(34)),
    RoundedRect(scale(278), scale(190), scale(394), scale(296), scale(42)),
    Polygon(
        ((scale(222), scale(254)), (scale(304), scale(212)), (scale(332), scale(228)), (scale(250), scale(278)))
    ),
    Polygon(
        ((scale(224), scale(186)), (scale(280), scale(160)), (scale(304), scale(178)), (scale(250), scale(206)))
    ),
    Polygon(
        ((scale(224), scale(302)), (scale(280), scale(274)), (scale(282), scale(306)), (scale(236), scale(334)))
    ),
)

LEFT_SHADOW_FOLD = Polygon(((scale(96), scale(328)), (scale(188), scale(286)), (scale(124), scale(376))))
LEFT_HILITE_FOLD = Polygon(((scale(122), scale(378)), (scale(156), scale(332)), (scale(108), scale(346))))


def _draw_shape(draw: ImageDraw.ImageDraw, shape: Shape, fill: int) -> None:
    if isinstance(shape, RoundedRect):
        draw.rounded_rectangle((shape.x1, shape.y1, shape.x2, shape.y2), radius=shape.radius, fill=fill)
    else:
        draw.polygon(shape.points, fill=fill)


def make_mask(solids: Iterable[Shape], cuts: Iterable[Shape]) -> Image.Image:
    mask = Image.new("L", (CANVAS, CANVAS), 0)
    draw = ImageDraw.Draw(mask)
    for s in solids:
        _draw_shape(draw, s, 255)
    for c in cuts:
        _draw_shape(draw, c, 0)
    return mask


def vertical_gradient(top: Tuple[int, int, int], bottom: Tuple[int, int, int]) -> Image.Image:
    grad = Image.new("RGB", (1, CANVAS), 0)
    px = grad.load()
    for y in range(CANVAS):
        t = y / float(CANVAS - 1)
        r = int(top[0] * (1 - t) + bottom[0] * t)
        g = int(top[1] * (1 - t) + bottom[1] * t)
        b = int(top[2] * (1 - t) + bottom[2] * t)
        px[0, y] = (r, g, b)
    return grad.resize((CANVAS, CANVAS), Image.Resampling.BICUBIC)


def render_logo() -> Image.Image:
    left_mask = make_mask(LEFT_SOLIDS, COMMON_CUTS)
    right_mask = make_mask(RIGHT_SOLIDS, COMMON_CUTS)

    # Slightly different gradients for each loop to mimic the beveled reference.
    left_fill = vertical_gradient((244, 244, 244), (215, 215, 215))
    right_fill = vertical_gradient((248, 248, 248), (224, 224, 224))

    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.paste(Image.merge("RGBA", (*left_fill.split(), left_mask)), (0, 0), left_mask)
    out.paste(Image.merge("RGBA", (*right_fill.split(), right_mask)), (0, 0), right_mask)

    # Subtle lower-left shadow fold like the supplied mark.
    fold_shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    fold_draw = ImageDraw.Draw(fold_shadow)
    _draw_shape(fold_draw, LEFT_SHADOW_FOLD, 255)
    shadow_tint = Image.new("RGBA", (CANVAS, CANVAS), (180, 180, 180, 80))
    out.alpha_composite(Image.composite(shadow_tint, Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0)), fold_shadow.split()[-1]))

    # Small inner highlight facet.
    fold_hilite = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    hilite_draw = ImageDraw.Draw(fold_hilite)
    _draw_shape(hilite_draw, LEFT_HILITE_FOLD, 255)
    hilite_tint = Image.new("RGBA", (CANVAS, CANVAS), (245, 245, 245, 120))
    out.alpha_composite(Image.composite(hilite_tint, Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0)), fold_hilite.split()[-1]))

    # Anti-aliased cleanup
    out = out.resize((CANVAS // 2, CANVAS // 2), Image.Resampling.LANCZOS).resize(
        (CANVAS, CANVAS), Image.Resampling.LANCZOS
    )
    return out


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    brand_dir = root / "public" / "brand"
    brand_dir.mkdir(parents=True, exist_ok=True)

    logo = render_logo()
    logo.save(brand_dir / "logo-mark.png", optimize=True)
    logo.resize((32, 32), Image.Resampling.LANCZOS).save(brand_dir / "logo-mark@1x.png", optimize=True)
    logo.resize((64, 64), Image.Resampling.LANCZOS).save(brand_dir / "logo-mark@2x.png", optimize=True)
    logo.resize((96, 96), Image.Resampling.LANCZOS).save(brand_dir / "logo-mark@3x.png", optimize=True)

    # Simple strip preview for 16..32 px checks.
    strip = Image.new("RGBA", (460, 120), (11, 11, 12, 255))
    draw = ImageDraw.Draw(strip)
    x = 16
    for s in (16, 20, 24, 28, 32):
        mark = logo.resize((s, s), Image.Resampling.LANCZOS)
        strip.alpha_composite(mark, (x, 30))
        draw.text((x - 2, 74), f"{s}px", fill=(190, 190, 194, 255))
        x += 82
    strip.save(brand_dir / "logo-mark-size-preview.png", optimize=True)


if __name__ == "__main__":
    main()
