#!/usr/bin/env python3
from __future__ import annotations

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

INPUT_PATH = Path("public/brand/logo-reference-raw.png")
OUTPUT_MAIN = Path("public/brand/logo-mark.png")
OUTPUT_HEIGHTS = [32, 64, 96]
PAD = 24


def binary_dilate(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    out = mask.copy()
    for _ in range(iterations):
        padded = np.pad(out, 1, mode="constant", constant_values=False)
        neighbors = []
        for dy in range(3):
            for dx in range(3):
                neighbors.append(padded[dy : dy + out.shape[0], dx : dx + out.shape[1]])
        out = np.logical_or.reduce(neighbors)
    return out


def binary_erode(mask: np.ndarray, iterations: int = 1) -> np.ndarray:
    out = mask.copy()
    for _ in range(iterations):
        padded = np.pad(out, 1, mode="constant", constant_values=True)
        neighbors = []
        for dy in range(3):
            for dx in range(3):
                neighbors.append(padded[dy : dy + out.shape[0], dx : dx + out.shape[1]])
        out = np.logical_and.reduce(neighbors)
    return out


def largest_component_bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    h, w = mask.shape
    visited = np.zeros((h, w), dtype=bool)
    best_size = 0
    best_bbox = (0, 0, w, h)

    for y in range(h):
        for x in range(w):
            if not mask[y, x] or visited[y, x]:
                continue

            q: deque[tuple[int, int]] = deque()
            q.append((y, x))
            visited[y, x] = True

            size = 0
            min_y = max_y = y
            min_x = max_x = x

            while q:
                cy, cx = q.popleft()
                size += 1
                if cy < min_y:
                    min_y = cy
                if cy > max_y:
                    max_y = cy
                if cx < min_x:
                    min_x = cx
                if cx > max_x:
                    max_x = cx

                for ny in range(max(0, cy - 1), min(h, cy + 2)):
                    for nx in range(max(0, cx - 1), min(w, cx + 2)):
                        if not visited[ny, nx] and mask[ny, nx]:
                            visited[ny, nx] = True
                            q.append((ny, nx))

            if size > best_size:
                best_size = size
                best_bbox = (min_x, min_y, max_x + 1, max_y + 1)

    if best_size == 0:
        raise RuntimeError("No bright connected component found in logo-reference-raw.png.")
    return best_bbox


def main() -> None:
    if not INPUT_PATH.exists():
        raise FileNotFoundError(f"Missing input image: {INPUT_PATH}")

    image = Image.open(INPUT_PATH).convert("RGBA")
    rgba = np.array(image, dtype=np.uint8)
    rgb = rgba[:, :, :3].astype(np.float32)

    luma = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    bright = luma > 200.0
    # Close tiny gaps so the logo remains one connected component.
    bright = binary_erode(binary_dilate(bright, iterations=2), iterations=2)

    min_x, min_y, max_x, max_y = largest_component_bbox(bright)

    h, w = bright.shape
    min_x = max(0, min_x - PAD)
    min_y = max(0, min_y - PAD)
    max_x = min(w, max_x + PAD)
    max_y = min(h, max_y + PAD)

    crop_rgb = rgb[min_y:max_y, min_x:max_x, :].astype(np.uint8)
    crop_luma = luma[min_y:max_y, min_x:max_x]

    alpha_float = np.clip((crop_luma - 25.0) / (255.0 - 25.0), 0.0, 1.0)
    alpha = (alpha_float * 255.0).astype(np.uint8)

    out_rgba = np.dstack([crop_rgb, alpha])
    mark = Image.fromarray(out_rgba, mode="RGBA")

    OUTPUT_MAIN.parent.mkdir(parents=True, exist_ok=True)
    mark.save(OUTPUT_MAIN, format="PNG")

    for height in OUTPUT_HEIGHTS:
        width = max(1, round(mark.width * (height / mark.height)))
        resized = mark.resize((width, height), Image.Resampling.LANCZOS)
        resized.save(OUTPUT_MAIN.parent / f"logo-mark-{height}.png", format="PNG")

    print(f"Saved {OUTPUT_MAIN}")
    for height in OUTPUT_HEIGHTS:
        print(f"Saved {OUTPUT_MAIN.parent / f'logo-mark-{height}.png'}")


if __name__ == "__main__":
    main()
