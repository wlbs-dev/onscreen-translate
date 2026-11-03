"""
colors.py — Background / text colour rules shared by OCR and the renderer.

Mirrored in loomv2/lib/editor/colors.ts for the editor preview.
"""
import re

import numpy as np

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
BORDER_PX = 8


def border_median_rgb(img_bgr, bbox) -> tuple[int, int, int] | None:
    """Median colour of an 8px ring just outside bbox (OpenCV BGR image in, RGB out)."""
    if img_bgr is None:
        return None
    h, w = img_bgr.shape[:2]
    x1, y1, x2, y2 = (int(v) for v in bbox)
    x1, x2 = max(0, min(x1, w)), max(0, min(x2, w))
    y1, y2 = max(0, min(y1, h)), max(0, min(y2, h))
    b = BORDER_PX
    regions = []
    if y1 - b >= 0: regions.append(img_bgr[y1 - b:y1, x1:x2])
    if y2 + b <= h: regions.append(img_bgr[y2:y2 + b, x1:x2])
    if x1 - b >= 0: regions.append(img_bgr[y1:y2, x1 - b:x1])
    if x2 + b <= w: regions.append(img_bgr[y1:y2, x2:x2 + b])
    regions = [r.reshape(-1, 3) for r in regions if r.size > 0]
    if not regions:
        return None
    med = np.median(np.concatenate(regions), axis=0).astype(int)
    return int(med[2]), int(med[1]), int(med[0])


def rgb_to_hex(rgb) -> str:
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.strip().lstrip("#")
    if len(h) == 6:
        return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return 0, 0, 0


def auto_text_rgb(bg) -> tuple[int, int, int]:
    """White on dark backgrounds, black on light ones (Rec. 601 luma)."""
    r, g, b = bg
    return (255, 255, 255) if (0.299 * r + 0.587 * g + 0.114 * b) < 128 else (0, 0, 0)
