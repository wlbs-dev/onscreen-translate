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
    Before inpainting, look for a *clean background* in frames just before
    or after the text is on screen (titles that animate in/out): if the same
    scene is visible there without the text, its real pixels are copied in,
    which beats any inpainting on textures and photos.
  * Moving background → a frozen plate would stop the motion, so the region
    is inpainted frame by frame using only the text strokes (pixels that are
    text in most sampled frames), and composited back as a short clip
    (render_translations.py). ffmpeg delogo is the last-resort fallback.
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
    # Quantise; the fill is the most common bin among strong text pixels
    # that is NOT common in the crop's border rows/columns (background).
    # On a busy texture the texture's own colours win the raw count.
    keyf = lambda a: (a // 32).astype(np.int32) @ np.array([64, 8, 1])
    keys = keyf(px)
    border = np.concatenate([crop_bgr[:2].reshape(-1, 3), crop_bgr[-2:].reshape(-1, 3),
                             crop_bgr[:, :2].reshape(-1, 3), crop_bgr[:, -2:].reshape(-1, 3)])
    bg_counts = np.bincount(keyf(border), minlength=512) / max(1, len(border))
    counts = np.bincount(keys, minlength=512).astype(float)
    counts[bg_counts > 0.02] *= 0.05
    top = int(counts.argmax())
    sel = px[keys == top].mean(axis=0)
    return int(sel[2]), int(sel[1]), int(sel[0])


def colour_mask(crop_bgr: np.ndarray, fill_rgb, box_h: int) -> np.ndarray:
    """Pixels near the text's fill colour, grown to cover outlines/shadows."""
    near = np.abs(crop_bgr.astype(np.int16) - np.array(fill_rgb[::-1], np.int16)).max(axis=2) < 60
    grow = max(3, round(box_h * 0.1))
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * grow + 1, 2 * grow + 1))
    return cv2.dilate(near.astype(np.uint8) * 255, k)


# Above this fraction of the crop, the shape mask is useless (busy texture)
MASK_SATURATED = 0.6


def crop(img: np.ndarray, rect: tuple[int, int, int, int]) -> np.ndarray:
    x1, y1, x2, y2 = rect
    return img[y1:y2, x1:x2]


def analyse_span(frames: list[np.ndarray], rect, box_h: int, core=None, fill=None):
    """
    Union text mask over sampled frames and whether the background moves.
    `core` is the OCR text box within the crop (x1, y1, x2, y2); defaults to
    the whole crop. `fill` (RGB) is the text colour if known: on busy
    textures, where the shape mask covers everything, the mask comes from
    the colour instead. Returns (mask, moving, base_frame_index).
    """
    crops = [crop(f, rect) for f in frames]
    masks = [text_mask(c, box_h) for c in crops]
    if fill is not None and np.mean([(m > 0).mean() for m in masks]) > MASK_SATURATED:
        masks = [colour_mask(c, fill, box_h) for c in crops]
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
    if keep.mean() < 0.15 and len(masks) > 1:
        # Busy texture: nearly everything looks text-like in a single frame.
        # Compare outside the pixels that are text in most frames instead,
        # and if even that is empty, over the whole region.
        votes = np.sum([m > 0 for m in masks], axis=0)
        keep = votes * 2 < len(masks)
        if keep.mean() < 0.05:
            keep = np.ones_like(keep)
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


# Stroke width / estimated em size above which the original counts as bold.
# Calibrated on Noto Sans and DejaVu at 24–96px: regular ≈ 0.07–0.11,
# bold ≈ 0.12–0.19 (see test_pipeline.Bold).
BOLD_RATIO = 0.12


def stroke_ratio(crop_bgr: np.ndarray, box_h: int, text: str = "") -> float | None:
    """
    Typical stroke thickness of the text in a crop, relative to the font's
    em size. The em is estimated from the ink height and which letters the
    OCR read: a line with descenders spans ~1 em, caps/ascenders only ~0.78.
    """
    import re
    k = _odd(max(15, min(box_h * 1.2, 101)))
    k = min(k, _odd(min(crop_bgr.shape[:2]) - 1)) if min(crop_bgr.shape[:2]) > 3 else 3
    bg = cv2.medianBlur(crop_bgr, max(3, k))
    core = (cv2.absdiff(crop_bgr, bg).max(axis=2) > TEXT_DIFF * 2).astype(np.uint8)
    if core.sum() < 30:
        return None
    # Only the glyph fill: an outline or shadow in another colour would
    # otherwise make outlined captions look bold
    fill = text_color(crop_bgr, box_h)
    if fill is not None:
        near = np.abs(crop_bgr.astype(np.int16) - np.array(fill[::-1], np.int16)).max(axis=2) < 70
        fill_px = int((core & near).sum())
        # Outlined/shadowed text: many strong pixels far from the fill colour
        if fill_px >= 30 and fill_px < 0.7 * int(core.sum()):
            core = (core & near).astype(np.uint8)
    dt = cv2.distanceTransform(core, cv2.DIST_L2, 3)
    # Measure against the ink's height, not the OCR box: detector boxes carry
    # padding that varies by model (~40% taller than the ink for RapidOCR)
    rows = np.where(core.any(axis=1))[0]
    ink_h = max(1, int(rows.max() - rows.min() + 1)) + 6
    if re.search(r"[gjpqy]", text):
        em = ink_h / 1.05
    elif re.search(r"[A-Zbdfhklt0-9]", text):
        em = ink_h / 0.78
    else:
        em = ink_h / 0.6
    return 2 * float(np.percentile(dt[core > 0], 90)) / em


def is_bold(crop_bgr: np.ndarray, box_h: int, text: str = "") -> bool:
    r = stroke_ratio(crop_bgr, box_h, text)
    return r is not None and r > BOLD_RATIO


def is_busy(plate_bgr: np.ndarray) -> bool:
    """Textured/high-contrast background where plain text would be hard to read."""
    grey = cv2.cvtColor(plate_bgr, cv2.COLOR_BGR2GRAY)
    return float(grey.std()) > BUSY_STD


def stable_text_mask(frames: list[np.ndarray], rect, box_h: int, fill=None) -> np.ndarray:
    """
    Pixels that are text in at least half of the sampled frames. Over a moving
    background the static caption survives the vote, while moving objects
    (which also look text-like in single frames) do not. On saturated busy
    textures the colour mask is used instead (see analyse_span).
    """
    masks = [(text_mask(crop(f, rect), box_h) > 0) for f in frames]
    if fill is not None and np.mean([m.mean() for m in masks]) > MASK_SATURATED:
        masks = [(colour_mask(crop(f, rect), fill, box_h) > 0) for f in frames]
    votes = np.sum(masks, axis=0)
    return ((votes * 2 >= len(masks)).astype(np.uint8)) * 255


def _region_changed(a: np.ndarray, b: np.ndarray, where: np.ndarray) -> float:
    """Fraction of `where` pixels that differ noticeably between two crops."""
    if not where.any():
        return 0.0
    diff = np.abs(a.astype(np.int16) - b.astype(np.int16)).max(axis=2) > MOTION_PIXEL
    return float(diff[where].mean())


def find_clean_background(base_crop: np.ndarray, mask: np.ndarray,
                          sides: list[list[np.ndarray]]) -> np.ndarray | None:
    """
    Search frames from before/after the text's span (each side nearest
    first) for the same scene with the text area empty. A candidate counts
    when: its non-text pixels match the base (same static scene), the text
    area differs from the base (the text is gone), and the next frame out
    shows the same text area (stable background, not a half-typed title).
    Returns the clean crop or None.
    """
    m = mask > 0
    keep = ~m
    if m.sum() < 20:
        return None
    for frames in sides:
        crops = [c for c in frames if c is not None and c.shape == base_crop.shape]
        for i in range(len(crops) - 1):
            c, further = crops[i], crops[i + 1]
            if _region_changed(c, base_crop, keep) > MOTION_FRACTION * 3:
                break  # scene differs this far out; stop searching this side
            if _region_changed(c, base_crop, m) < 0.15:
                continue  # text (or something like it) still there
            if _region_changed(c, further, m) > 0.05:
                continue  # text area still changing (animating in/out)
            return c
    return None


def blend_clean(base_crop: np.ndarray, clean_crop: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Copy the clean pixels into the masked area with a soft edge."""
    soft = cv2.GaussianBlur(mask.astype(np.float32) / 255.0, (7, 7), 0)
    soft = np.maximum(soft, (mask > 0).astype(np.float32))[..., None]
    return (base_crop * (1 - soft) + clean_crop * soft).astype(np.uint8)


def sample_indices(n: int, k: int = MAX_SAMPLES) -> list[int]:
    if n <= k:
        return list(range(n))
    return sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
