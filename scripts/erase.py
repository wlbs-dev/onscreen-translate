"""
erase.py — Remove burned-in text from video frames.

The text mask comes from comparing a crop with a large median blur of itself
(a local-background estimate that tolerates gradients): pixels far from the
local background are text (plus outline/shadow). The mask is the union over
several frames of the overlay's time span, so text that types on letter by
letter is still fully covered.

  * Static background → cv2.inpaint rebuilds only the masked pixels of one
    frame into a "clean plate"; the translated text is drawn on top and the
    whole patch is overlaid by ffmpeg. Unmasked pixels are the original
    frame, so patch edges are invisible.
  * Moving background → a frozen plate would stop the motion, so the caller
    falls back to ffmpeg's per-frame delogo erase plus a transparent text
    layer (see render_translations.py).
"""
from __future__ import annotations

import cv2
import numpy as np

# A pixel is "text" if it differs from the local background estimate by more
# than this (max over BGR channels, 0–255)
TEXT_DIFF = 38
# The background counts as moving when more than MOTION_FRACTION of the
# non-text pixels change by more than MOTION_PIXEL (0–255) between sampled
# frames. A fraction (not a mean) catches a thin moving line crossing a
# mostly static patch, which a frozen plate would visibly stop.
MOTION_PIXEL = 25
MOTION_FRACTION = 0.004
# Plates busier than this (grey std-dev) get an outline on the new text
BUSY_STD = 28.0
MAX_SAMPLES = 6


def _odd(n: float) -> int:
    n = int(n)
    return n if n % 2 else n + 1


def text_mask(crop_bgr: np.ndarray, box_h: int) -> np.ndarray:
    """uint8 mask (255 = text) for a crop around a text box."""
    k = _odd(max(15, min(box_h * 1.2, 101)))
    k = min(k, _odd(min(crop_bgr.shape[:2]) - 1)) if min(crop_bgr.shape[:2]) > 3 else 3
    bg = cv2.medianBlur(crop_bgr, max(3, k))
    diff = cv2.absdiff(crop_bgr, bg).max(axis=2)
    mask = (diff > TEXT_DIFF).astype(np.uint8) * 255
    # Grow over anti-aliased edges and thin outlines/shadows
    grow = max(2, round(box_h * 0.06))
    return cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1)))


def text_color(crop_bgr: np.ndarray, box_h: int) -> tuple[int, int, int] | None:
    """
    Fill colour of the original text (RGB): the dominant colour among strong
    text pixels, so an outline or shadow doesn't win over the glyph fill.
    """
    k = _odd(max(15, min(box_h * 1.2, 101)))
    k = min(k, _odd(min(crop_bgr.shape[:2]) - 1)) if min(crop_bgr.shape[:2]) > 3 else 3
    bg = cv2.medianBlur(crop_bgr, max(3, k))
    diff = cv2.absdiff(crop_bgr, bg).max(axis=2)
    core = diff > TEXT_DIFF * 2
    # Erode so stroke edges (blended with the background) don't count
    core = cv2.erode(core.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool)
    px = crop_bgr[core]
    if len(px) < 30:
        return None
    # Quantise and take the most common bin, then the mean within it
    q = (px // 32).astype(np.int32)
    keys = q[:, 0] * 64 + q[:, 1] * 8 + q[:, 2]
    top = np.bincount(keys).argmax()
    sel = px[keys == top].mean(axis=0)
    return int(sel[2]), int(sel[1]), int(sel[0])


def crop(img: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x1, y1, x2, y2 = rect
    return img[y1:y2, x1:x2]


def analyse_span(frames: list[np.ndarray], rect, box_h: int, core=None):
    """
    Union text mask over sampled frames and whether the background moves.
    `core` is the OCR text box within the crop (x1, y1, x2, y2); defaults to
    the whole crop. Returns (mask, moving, base_frame_index).
    """
    crops = [crop(f, rect) for f in frames]
    masks = [text_mask(c, box_h) for c in crops]
    union = np.maximum.reduce(masks)
    cx1, cy1, cx2, cy2 = core or (0, 0, crops[0].shape[1], crops[0].shape[0])
    # The plate comes from the frame with the most text visible inside the
    # text box (typically the last one, after any type-on animation).
    # Counting only the box keeps a passing object from choosing the base.
    base = int(np.argmax([int((m[cy1:cy2, cx1:cx2] > 0).sum()) for m in masks]))
    # Compare every frame with the base, ignoring only the base frame's text:
    # text that types on ends up in that mask, while anything passing through
    # (a moving line, a person) shows up as change. Excluding the union mask
    # instead would hide moving objects, since they look text-like too.
    keep = masks[base] == 0
    moving = False
    if keep.sum() > 50 and len(crops) > 1:
        ref = crops[base].astype(np.int16)
        for i, c in enumerate(crops):
            if i == base:
                continue
            changed = np.abs(c.astype(np.int16) - ref).max(axis=2) > MOTION_PIXEL
            if changed[keep].mean() > MOTION_FRACTION:
                moving = True
                break
    return union, moving, base


def clean_plate(frame: np.ndarray, rect, mask: np.ndarray) -> np.ndarray:
    """Inpaint the masked text pixels of a crop; returns the BGR crop."""
    x1, y1, x2, y2 = rect
    h, w = frame.shape[:2]
    # Inpaint with some context around the rect so edges have real neighbours
    pad = 12
    cx1, cy1 = max(0, x1 - pad), max(0, y1 - pad)
    cx2, cy2 = min(w, x2 + pad), min(h, y2 + pad)
    ctx = frame[cy1:cy2, cx1:cx2].copy()
    ctx_mask = np.zeros(ctx.shape[:2], np.uint8)
    ctx_mask[y1 - cy1:y2 - cy1, x1 - cx1:x2 - cx1] = mask
    radius = max(3, min(12, mask.shape[0] // 10))
    out = cv2.inpaint(ctx, ctx_mask, radius, cv2.INPAINT_TELEA)
    return out[y1 - cy1:y2 - cy1, x1 - cx1:x2 - cx1]


def is_busy(plate_bgr: np.ndarray) -> bool:
    """Textured/high-contrast background where plain text would be hard to read."""
    grey = cv2.cvtColor(plate_bgr, cv2.COLOR_BGR2GRAY)
    return float(grey.std()) > BUSY_STD


def sample_indices(n: int, k: int = MAX_SAMPLES) -> list[int]:
    if n <= k:
        return list(range(n))
    return sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
