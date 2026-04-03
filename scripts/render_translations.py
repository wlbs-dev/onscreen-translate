#!/usr/bin/env python3
"""
render_translations.py — Render output video from translated_detections.json
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
from pathlib import Path
import numpy as np

from dotenv import load_dotenv
load_dotenv()

def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(fmt)
    logging.basicConfig(level=level, handlers=[h])

logger = logging.getLogger(__name__)

FONT_PATH       = "assets/NotoSansDevanagari-Regular.ttf"
FONT_SIZE_MIN   = 14
FONT_SIZE_MAX   = 72
FONT_SIZE_RATIO = 0.55


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Render translated video from detections JSON")
    p.add_argument("--input",      required=True, help="Original input MP4")
    p.add_argument("--detections", required=True, help="Path to translated_detections.json")
    p.add_argument("--output",     required=True, help="Output MP4 path")
    p.add_argument("--verbose",    action="store_true")
    return p.parse_args()


# ── Letterbox correction ──────────────────────────────────────────────────────

def extract_y_correction(block: dict) -> float:
    """
    Return the Y pixel correction to subtract from bbox values.

    New VideoPlayer.tsx stamps videoMeta on every edit:
      { letterboxY, scale, videoW, videoH, ... }

    Bboxes are stored in video-pixel space AFTER dividing display-space coords
    by scale. The old OverlayCanvas.tsx used getBoundingClientRect() on the
    canvas element itself (which was already offset by videoRect.y inside the
    container), so mouse Y was never adjusted — meaning:

        stored_y = true_video_y + (letterboxY / scale)   ← old, broken
        stored_y = true_video_y                           ← new, correct

    When videoMeta is present we return the correction. When it's absent
    (old saves) we return 0 and the caller should warn the user.
    """
    meta = block.get("videoMeta")
    if not meta:
        return 0.0
    letterbox_y: float = meta.get("letterboxY", 0.0)
    scale: float       = meta.get("scale", 1.0)
    if scale == 0:
        return 0.0
    return letterbox_y / scale


def correct_bbox(raw_bbox: list, y_correction: float, vid_w: int, vid_h: int) -> list[int]:
    """
    Strip letterbox Y offset and clamp to video bounds.
    x values are unaffected (letterbox is symmetric but X is already correct).
    """
    x1, y1, x2, y2 = raw_bbox
    y1 = y1 - y_correction
    y2 = y2 - y_correction
    # Clamp to video frame
    x1 = max(0.0, min(x1, vid_w))
    y1 = max(0.0, min(y1, vid_h))
    x2 = max(0.0, min(x2, vid_w))
    y2 = max(0.0, min(y2, vid_h))
    return [int(round(x1)), int(round(y1)), int(round(x2)), int(round(y2))]


# ── Timeline builder ──────────────────────────────────────────────────────────

def build_timeline(detections: list[dict], video_duration: float,
                   vid_w: int = 0, vid_h: int = 0) -> list[dict]:
    """
    Build overlay timeline from per-frame detections.

    Bboxes are corrected for the letterbox Y offset that the old OverlayCanvas
    component baked in. New VideoPlayer.tsx saves a videoMeta field on each
    block so we know exactly how much to subtract. Old saves without videoMeta
    get a warning — re-edit those events in the UI to fix them permanently.
    """
    timestamps      = [f["timestamp"] for f in detections]
    results_by_ts   = {f["timestamp"]: f for f in detections}
    warned_no_meta  = False

    active: dict[tuple, dict] = {}
    events: list[dict] = []

    for i, ts in enumerate(timestamps):
        next_ts = timestamps[i + 1] if i + 1 < len(timestamps) else video_duration
        frame   = results_by_ts[ts]
        current_keys: set[tuple] = set()

        for block in frame["blocks"]:
            key = (block["text"].lower().strip(),)
            current_keys.add(key)

            y_correction = extract_y_correction(block)
            if y_correction == 0.0 and not block.get("videoMeta") and not warned_no_meta:
                logger.warning(
                    "Some blocks are missing 'videoMeta' — they were saved by the old "
                    "OverlayCanvas editor which baked the letterbox Y offset into bboxes. "
                    "If boxes appear shifted down in the render, re-edit those events in "
                    "the UI (VideoPlayer.tsx) and re-export to fix permanently."
                )
                warned_no_meta = True

            raw_bbox = block["bbox"]
            bbox_px  = correct_bbox(raw_bbox, y_correction, vid_w, vid_h)

            if key in active:
                active[key]["end_time"]    = next_ts
                active[key]["bbox_px"]     = bbox_px
                active[key]["marathi_text"] = (
                    block.get("translation") or block.get("marathi_text") or ""
                )
                active[key]["bg_color"]   = block.get("bgColor", "")
                active[key]["text_color"] = block.get("textColor", "#ffffff")
                active[key]["font_size"]  = block.get("fontSize", 0)
            else:
                active[key] = {
                    "start_time":    max(0.0, ts - 0.5),
                    "end_time":      next_ts,
                    "bbox_px":       bbox_px,
                    "original_text": block["text"],
                    "marathi_text":  (
                        block.get("translation") or block.get("marathi_text") or ""
                    ),
                    "frame_path":    frame.get("frame_path", ""),
                    "bg_color":      block.get("bgColor", ""),
                    "text_color":    block.get("textColor", "#ffffff"),
                    "font_size":     block.get("fontSize", 0),
                }

        for key in list(active):
            if key not in current_keys:
                events.append(active.pop(key))

    for ev in active.values():
        events.append(ev)

    events.sort(key=lambda e: e["start_time"])

    before = len(events)
    events = [e for e in events if e["end_time"] - e["start_time"] >= 0.3]
    if before - len(events):
        logger.info(f"Dropped {before - len(events)} very-short events (<0.3s)")

    logger.info(f"Timeline: {len(events)} overlay events")
    for idx, ev in enumerate(events):
        logger.debug(
            f"  [{idx}] '{ev['marathi_text'][:30]}' "
            f"bbox={ev['bbox_px']} "
            f"{ev['start_time']:.2f}s → {ev['end_time']:.2f}s"
        )
    return events


# ── Background color sampling ─────────────────────────────────────────────────

def hex_to_rgb(hex_color: str) -> list[int]:
    hex_color = hex_color.strip().lstrip("#")
    if len(hex_color) == 6:
        return [int(hex_color[i:i+2], 16) for i in (0, 2, 4)]
    return [0, 0, 0]


def sample_bg_color(frame_path: str, bbox: list[int], saved_hex: str = "") -> list[int]:
    if saved_hex and saved_hex.startswith("#"):
        return hex_to_rgb(saved_hex)

    if not frame_path or not os.path.isfile(frame_path):
        return [0, 0, 0]

    try:
        import cv2

        img = cv2.imread(frame_path)
        if img is None:
            return [0, 0, 0]

        x1, y1, x2, y2 = bbox
        h, w = img.shape[:2]
        border = 8
        regions = []

        if y1 - border >= 0:
            regions.append(img[max(0, y1 - border):y1, x1:x2])
        if y2 + border <= h:
            regions.append(img[y2:min(h, y2 + border), x1:x2])
        if x1 - border >= 0:
            regions.append(img[y1:y2, max(0, x1 - border):x1])
        if x2 + border <= w:
            regions.append(img[y1:y2, x2:min(w, x2 + border)])

        if not regions:
            return [0, 0, 0]

        sample = np.concatenate([r.reshape(-1, 3) for r in regions if r.size > 0])
        median = np.median(sample, axis=0).astype(int)
        return [int(median[2]), int(median[1]), int(median[0])]  # BGR → RGB
    except Exception:
        return [0, 0, 0]


# ── Video render ──────────────────────────────────────────────────────────────

def render_video(input_path: str, output_path: str, events: list[dict]) -> None:

    if not events:
        logger.warning("No overlay events — copying input unchanged.")
        subprocess.run(["ffmpeg", "-i", input_path, "-c", "copy", output_path, "-y"], check=True)
        return

    import cv2
    from PIL import Image

    cap          = cv2.VideoCapture(input_path)
    fps          = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    vid_w        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h        = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    logger.info(f"Video: {vid_w}x{vid_h}, {total_frames} frames @ {fps}fps")
    for ev in events[:3]:
        logger.info(f"bbox_px={ev['bbox_px']} start={ev['start_time']:.2f}")

    overlay_dir   = tempfile.mkdtemp(prefix="overlays_")
    overlay_cache = {}

    logger.info(f"Pre-rendering {len(events)} overlays with Playwright...")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()

        for i, event in enumerate(events):
            x1, y1, x2, y2 = event["bbox_px"]

            # Clamp to video bounds (safety net — should already be clean)
            x1 = max(0, min(x1, vid_w - 1))
            y1 = max(0, min(y1, vid_h - 1))
            x2 = max(x1 + 1, min(x2, vid_w))
            y2 = max(y1 + 1, min(y2, vid_h))

            bw = x2 - x1
            bh = y2 - y1

            bg = sample_bg_color(
                event.get("frame_path", ""),
                [x1, y1, x2, y2],
                event.get("bg_color", ""),
            )
            r, g, b = bg
            bg_hex  = f"#{r:02x}{g:02x}{b:02x}"

            saved_text_color = event.get("text_color", "")
            if saved_text_color and saved_text_color.startswith("#"):
                text_color = saved_text_color
            else:
                text_color = "white" if (0.299*r + 0.587*g + 0.114*b) < 128 else "black"

            saved_fs = event.get("font_size", 0)
            if saved_fs and saved_fs > 0:
                font_size = max(FONT_SIZE_MIN, min(FONT_SIZE_MAX, saved_fs))
            else:
                font_size = max(FONT_SIZE_MIN, min(FONT_SIZE_MAX, int(bh * FONT_SIZE_RATIO)))

            png_path = os.path.join(overlay_dir, f"overlay_{i:04d}.png")

            if not event["marathi_text"].strip():
                from PIL import Image as PILImage
                blank = PILImage.new("RGB", (bw, bh), (r, g, b))
                blank.save(png_path)
                overlay_cache[i] = (blank, x1, y1)
                logger.info(f"  [{i+1}/{len(events)}] (blank cover) {bw}x{bh} at ({x1},{y1})")
            else:
                font_src = f"file:///{Path(FONT_PATH).resolve().as_posix()}"
                measure_html = f"""<html><head><style>
                    @font-face {{ font-family: 'NotoDevanagari'; src: url('{font_src}'); }}
                    * {{ margin: 0; padding: 0; }}
                    body {{ background: {bg_hex}; }}
                    span {{ font-family: 'NotoDevanagari', sans-serif;
                            font-size: {font_size}px; color: {text_color};
                            white-space: nowrap; display: inline-block; padding: 2px 4px; }}
                </style></head><body><span id="t">{event["marathi_text"]}</span></body></html>"""

                page = browser.new_page(viewport={"width": 2000, "height": bh + 20})
                page.set_content(measure_html)
                page.wait_for_load_state("networkidle")
                natural_w = int(
                    page.evaluate("document.getElementById('t').getBoundingClientRect().width")
                ) + 10
                page.close()

                final_w = max(bw, natural_w)
                final_w = min(final_w, vid_w - x1)

                render_html = f"""<html><head><style>
                    @font-face {{ font-family: 'NotoDevanagari'; src: url('{font_src}'); }}
                    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                    body {{ width: {final_w}px; height: {bh}px; background: {bg_hex};
                            display: flex; align-items: center;
                            justify-content: flex-start; overflow: hidden; }}
                    span {{ font-family: 'NotoDevanagari', sans-serif;
                            font-size: {font_size}px; color: {text_color};
                            text-align: left; padding: 2px 4px; white-space: nowrap; }}
                </style></head><body><span>{event["marathi_text"]}</span></body></html>"""

                page = browser.new_page(viewport={"width": final_w, "height": bh})
                page.set_content(render_html)
                page.wait_for_load_state("networkidle")
                page.screenshot(path=png_path)
                page.close()

                overlay_cache[i] = (Image.open(png_path).convert("RGB"), x1, y1)
                logger.info(
                    f"  [{i+1}/{len(events)}] '{event['marathi_text'][:30]}' "
                    f"bbox=({x1},{y1})→({x2},{y2}) box={bw}x{bh} → {final_w}x{bh}"
                )

        browser.close()

    frames_dir = tempfile.mkdtemp(prefix="render_frames_")
    logger.info(f"Compositing overlays onto {total_frames} frames...")

    cap       = cv2.VideoCapture(input_path)
    frame_idx = 0

    while True:
        ret, frame_bgr = cap.read()
        if not ret:
            break

        timestamp = frame_idx / fps
        active = [
            (i, e) for i, e in enumerate(events)
            if e["start_time"] <= timestamp < e["end_time"]
        ]

        if active:
            frame_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
            pil_frame = Image.fromarray(frame_rgb)

            for i, event in active:
                overlay_img, ox, oy = overlay_cache[i]
                pil_frame.paste(overlay_img, (ox, oy))

            frame_bgr = cv2.cvtColor(np.array(pil_frame), cv2.COLOR_RGB2BGR)

        out_frame = os.path.join(frames_dir, f"frame_{frame_idx:06d}.jpg")
        cv2.imwrite(out_frame, frame_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])
        frame_idx += 1

        if frame_idx % 100 == 0:
            logger.info(f"  {frame_idx}/{total_frames} frames done...")

    cap.release()
    logger.info("Encoding final video...")

    cmd = [
        "ffmpeg",
        "-framerate", str(fps),
        "-i", os.path.join(frames_dir, "frame_%06d.jpg"),
        "-i", input_path,
        "-map", "0:v", "-map", "1:a",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast",
        "-c:a", "copy", "-shortest",
        output_path, "-y",
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, encoding="utf-8", errors="replace"
    )
    if result.returncode != 0:
        logger.error(f"ffmpeg failed:\n{result.stderr[-2000:]}")
        raise RuntimeError("ffmpeg encode failed")

    for f in Path(frames_dir).glob("*.jpg"):
        f.unlink()
    os.rmdir(frames_dir)
    for f in Path(overlay_dir).glob("*.png"):
        f.unlink()
    os.rmdir(overlay_dir)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    logger.info(f"Done: {output_path} ({size_mb:.1f} MB)")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    setup_logging(args.verbose)

    input_path      = str(Path(args.input).resolve())
    detections_path = str(Path(args.detections).resolve())
    output_path     = str(Path(args.output).resolve())

    if not os.path.isfile(input_path):
        sys.exit(f"[ERROR] Input not found: {input_path}")
    if not os.path.isfile(detections_path):
        sys.exit(f"[ERROR] Detections not found: {detections_path}")

    with open(detections_path, "r", encoding="utf-8") as f:
        detections = json.load(f)

    result = subprocess.run([
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        input_path,
    ], capture_output=True, text=True)
    try:
        duration = float(result.stdout.strip())
    except ValueError:
        duration = detections[-1]["timestamp"] + 2.0

    logger.info(f"Video duration: {duration:.1f}s")

    # Get video dimensions up front so build_timeline can clamp bboxes
    import cv2
    cap   = cv2.VideoCapture(input_path)
    vid_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    vid_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()

    timeline = build_timeline(detections, duration, vid_w=vid_w, vid_h=vid_h)
    render_video(input_path, output_path, timeline)


if __name__ == "__main__":
    main()