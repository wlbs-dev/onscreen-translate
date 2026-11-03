#!/usr/bin/env python3
"""
render_translations.py — Render output video from translated_detections.json

Each overlay (cover patch + translated text) is drawn once as a PNG with
Pillow + raqm (HarfBuzz shaping, so Indic conjuncts and matras are correct),
then ffmpeg composites all of them onto the video in a single encode pass
with timed `overlay` filters — no browser, no per-frame Python loop.
"""

import argparse
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from languages import all_font_files
from colors import HEX_COLOR_RE, auto_text_rgb, border_median_rgb, hex_to_rgb

def setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%H:%M:%S")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(fmt)
    logging.basicConfig(level=level, handlers=[h])

logger = logging.getLogger(__name__)

FONT_DIR        = "assets"
# Padding around overlay text, matching the editor preview (OverlayCanvas.tsx):
# 4px each side inside the patch, plus 10px slack when the patch grows
TEXT_PAD_X      = 4
PATCH_SLACK     = 10
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
                active[key]["translated_text"] = (
                    block.get("translation") or block.get("marathi_text") or ""
                )
                active[key]["bg_color"]   = block.get("bgColor", "")
                active[key]["text_color"] = block.get("textColor", "")
                active[key]["auto_bg"]    = block.get("autoBgColor", "")
                active[key]["font_size"]  = block.get("fontSize", 0)
            else:
                active[key] = {
                    "start_time":    max(0.0, ts - 0.5),
                    "end_time":      next_ts,
                    "bbox_px":       bbox_px,
                    "original_text": block["text"],
                    "translated_text": (
                        block.get("translation") or block.get("marathi_text") or ""
                    ),
                    "frame_path":    raw_frame_path(frame.get("frame_path", ""),
                                                    frame.get("frame_index")),
                    # Empty = automatic (sampled background, contrasting text)
                    "bg_color":      block.get("bgColor", ""),
                    "text_color":    block.get("textColor", ""),
                    "auto_bg":       block.get("autoBgColor", ""),
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
            f"  [{idx}] '{ev['translated_text'][:30]}' "
            f"bbox={ev['bbox_px']} "
            f"{ev['start_time']:.2f}s → {ev['end_time']:.2f}s"
        )
    return events


# ── Fonts and text shaping ────────────────────────────────────────────────────
#
# Pillow has no per-glyph font fallback, so text is split into runs by Unicode
# script and each run is drawn with that script's Noto font. Latin letters,
# digits, punctuation and spaces use the Devanagari font (it includes Latin),
# mirroring the editor preview's font stack. Combining marks, ZWJ/ZWNJ and
# the danda stay in whatever run they appear in so shaping isn't broken.

SCRIPT_RANGES: list[tuple[int, int, str]] = [
    (0x0900, 0x097F, "NotoSansDevanagari-Regular.ttf"),
    (0xA8E0, 0xA8FF, "NotoSansDevanagari-Regular.ttf"),
    (0x1CD0, 0x1CFF, "NotoSansDevanagari-Regular.ttf"),
    (0x0980, 0x09FF, "NotoSansBengali-Regular.ttf"),
    (0x0A00, 0x0A7F, "NotoSansGurmukhi-Regular.ttf"),
    (0x0A80, 0x0AFF, "NotoSansGujarati-Regular.ttf"),
    (0x0B00, 0x0B7F, "NotoSansOriya-Regular.ttf"),
    (0x0B80, 0x0BFF, "NotoSansTamil-Regular.ttf"),
    (0x0C00, 0x0C7F, "NotoSansTelugu-Regular.ttf"),
    (0x0C80, 0x0CFF, "NotoSansKannada-Regular.ttf"),
    (0x0D00, 0x0D7F, "NotoSansMalayalam-Regular.ttf"),
]
BASE_FONT = "NotoSansDevanagari-Regular.ttf"
# Characters that join whichever run they follow
STICKY = {0x200C, 0x200D, 0x0964, 0x0965}


def font_file_for(ch: str) -> str | None:
    """Font for an Indic character, or None for script-neutral characters."""
    cp = ord(ch)
    if cp in STICKY:
        return None
    for lo, hi, font in SCRIPT_RANGES:
        if lo <= cp <= hi:
            return font
    return None


def script_runs(text: str) -> list[tuple[str, str]]:
    """Split text into (font_file, run_text) pieces."""
    runs: list[list] = []
    for ch in text:
        font = font_file_for(ch)
        if font is None:
            # Spaces/marks/joiners stay with the current run; other neutral
            # characters (Latin, digits, punctuation) go to the base font
            if runs and (ch.isspace() or ord(ch) in STICKY or not ch.isprintable()):
                runs[-1][1] += ch
                continue
            font = BASE_FONT
        if runs and runs[-1][0] == font:
            runs[-1][1] += ch
        else:
            runs.append([font, ch])
    return [(f, t) for f, t in runs]


_font_cache: dict[tuple[str, int], "ImageFont.FreeTypeFont"] = {}


def load_font(font_file: str, size: int):
    from PIL import ImageFont
    key = (font_file, size)
    if key not in _font_cache:
        _font_cache[key] = ImageFont.truetype(
            str(Path(FONT_DIR, font_file)), size, layout_engine=ImageFont.Layout.RAQM
        )
    return _font_cache[key]


def check_text_shaping() -> None:
    """Indic scripts render as broken glyph soup without raqm; fail loudly."""
    from PIL import features
    if not features.check("raqm"):
        sys.exit(
            "[ERROR] Pillow was built without raqm (HarfBuzz/FriBiDi), so Indic text "
            "would be shaped incorrectly. Install Pillow from the PyPI wheel "
            "(pip install --force-reinstall pillow), which includes it."
        )
    missing = [f for f in all_font_files() if not Path(FONT_DIR, f).is_file()]
    if missing:
        sys.exit(f"[ERROR] Missing fonts in {FONT_DIR}/: {', '.join(missing)}")


def measure_text(text: str, size: int) -> tuple[float, int, int]:
    """(advance width, max ascent, max descent) across the text's runs."""
    width, asc, desc = 0.0, 0, 0
    for font_file, run in script_runs(text):
        font = load_font(font_file, size)
        width += font.getlength(run)
        a, d = font.getmetrics()
        asc, desc = max(asc, a), max(desc, d)
    return width, asc, desc


def draw_overlay(text: str, width: int, height: int, font_size: int,
                 bg_rgb: tuple[int, int, int], text_color: tuple[int, int, int]):
    """Opaque cover patch with the text left-aligned and vertically centred."""
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (width, height), bg_rgb)
    if not text.strip():
        return img
    draw = ImageDraw.Draw(img)
    _, asc, desc = measure_text(text, font_size)
    baseline = (height - (asc + desc)) / 2 + asc
    x = float(TEXT_PAD_X)
    for font_file, run in script_runs(text):
        font = load_font(font_file, font_size)
        draw.text((x, baseline), run, font=font, fill=text_color, anchor="ls")
        x += font.getlength(run)
    return img


# ── Background color sampling ─────────────────────────────────────────────────

def raw_frame_path(frame_path: str, frame_index) -> str:
    """
    OCR writes annotated frames (red boxes + labels drawn on) to
    annotated_frames/ and the untouched ffmpeg frames to _frames/NNNNNN.jpg
    (1-based). Sampling the background from the annotated frame picks up the
    drawn boxes, so prefer the raw frame when it exists.
    """
    if frame_path and frame_index is not None:
        raw = Path(frame_path).parent.parent / "_frames" / f"{int(frame_index) + 1:06d}.jpg"
        if raw.is_file():
            return str(raw)
    return frame_path


def sample_bg_color(frame_path: str, bbox: list[int], saved_hex: str = "",
                    auto_hex: str = "") -> tuple[int, int, int]:
    """
    Cover-patch colour: the user's bgColor, else sampled around the (possibly
    moved) box on the raw frame, else OCR's autoBgColor, else black.
    """
    if saved_hex and HEX_COLOR_RE.match(saved_hex):
        return hex_to_rgb(saved_hex)
    if frame_path and os.path.isfile(frame_path):
        import cv2
        rgb = border_median_rgb(cv2.imread(frame_path), bbox)
        if rgb:
            return rgb
    if auto_hex and HEX_COLOR_RE.match(auto_hex):
        return hex_to_rgb(auto_hex)
    return 0, 0, 0


# ── Video render ──────────────────────────────────────────────────────────────

def probe_video(path: str) -> dict:
    """Width, height, fps and duration of the first video stream via ffprobe."""
    out = subprocess.run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,nb_frames:format=duration",
        "-of", "json", path,
    ], capture_output=True, text=True, check=True)
    info = json.loads(out.stdout)
    stream = info["streams"][0]
    num, _, den = stream.get("avg_frame_rate", "25/1").partition("/")
    fps = float(num) / float(den or 1) if float(den or 1) else 25.0
    duration = float(info.get("format", {}).get("duration") or 0)
    frames = int(stream.get("nb_frames") or 0) or int(round(duration * fps))
    return {"w": int(stream["width"]), "h": int(stream["height"]),
            "fps": fps, "duration": duration, "frames": frames}


def ffmpeg_major_version() -> int:
    try:
        out = subprocess.run(["ffmpeg", "-version"], capture_output=True, text=True).stdout
        m = re.search(r"ffmpeg version n?(\d+)", out)
        return int(m.group(1)) if m else 6
    except Exception:
        return 6


def build_overlays(events: list[dict], vid_w: int, vid_h: int, out_dir: str) -> list[dict]:
    """Draw one PNG per event; return [{png, x, y, start, end}]."""
    overlays = []
    for i, event in enumerate(events):
        x1, y1, x2, y2 = event["bbox_px"]
        # Clamp to video bounds (safety net — should already be clean)
        x1 = max(0, min(x1, vid_w - 1))
        y1 = max(0, min(y1, vid_h - 1))
        x2 = max(x1 + 1, min(x2, vid_w))
        y2 = max(y1 + 1, min(y2, vid_h))
        bw, bh = x2 - x1, y2 - y1

        r, g, b = sample_bg_color(event.get("frame_path", ""), [x1, y1, x2, y2],
                                  event.get("bg_color", ""), event.get("auto_bg", ""))

        saved_text_color = event.get("text_color", "")
        if saved_text_color and HEX_COLOR_RE.match(saved_text_color):
            text_rgb = hex_to_rgb(saved_text_color)
        else:
            text_rgb = auto_text_rgb((r, g, b))

        saved_fs = event.get("font_size", 0)
        if saved_fs and saved_fs > 0:
            font_size = max(FONT_SIZE_MIN, min(FONT_SIZE_MAX, int(saved_fs)))
        else:
            font_size = max(FONT_SIZE_MIN, min(FONT_SIZE_MAX, int(bh * FONT_SIZE_RATIO)))

        text = event["translated_text"]
        width = bw
        if text.strip():
            natural_w = int(measure_text(text, font_size)[0]) + 2 * TEXT_PAD_X + PATCH_SLACK
            width = min(max(bw, natural_w), vid_w - x1)

        png = os.path.join(out_dir, f"overlay_{i:04d}.png")
        draw_overlay(text, width, bh, font_size, (r, g, b), text_rgb).save(png)
        overlays.append({"png": png, "x": x1, "y": y1,
                         "start": event["start_time"], "end": event["end_time"]})
        label = f"'{text[:30]}'" if text.strip() else "(blank cover)"
        logger.info(f"  [{i+1}/{len(events)}] {label} at ({x1},{y1}) {width}x{bh} "
                    f"{event['start_time']:.2f}s → {event['end_time']:.2f}s")
    return overlays


def render_video(input_path: str, output_path: str, events: list[dict], meta: dict) -> None:
    if not events:
        logger.warning("No overlay events — copying input unchanged.")
        subprocess.run(["ffmpeg", "-v", "error", "-i", input_path, "-c", "copy", output_path, "-y"],
                       check=True)
        return

    check_text_shaping()
    vid_w, vid_h, total = meta["w"], meta["h"], max(1, meta["frames"])
    logger.info(f"Video: {vid_w}x{vid_h}, {total} frames @ {meta['fps']:.2f}fps")

    with tempfile.TemporaryDirectory(prefix="overlays_") as tmp:
        logger.info(f"Drawing {len(events)} overlays...")
        overlays = build_overlays(events, vid_w, vid_h, tmp)

        # One timed overlay filter per event, chained. Still images repeat
        # their single frame (eof_action=repeat), so enable= alone decides
        # when each is visible: [start, end) like the editor timeline.
        # Composite in 4:4:4: overlaying RGB patches onto 4:2:0 video at odd
        # x/width leaves a discoloured chroma column at the patch edge.
        # Convert down to yuv420p once at the end.
        chain, prev = ["[0:v]format=yuv444p[v0]"], "v0"
        for n, ov in enumerate(overlays, start=1):
            out = f"v{n}"
            chain.append(
                f"[{prev}][{n}:v]overlay=x={ov['x']}:y={ov['y']}:format=yuv444:"
                f"enable='gte(t,{ov['start']:.3f})*lt(t,{ov['end']:.3f})'[{out}]"
            )
            prev = out
        chain.append(f"[{prev}]format=yuv420p[vout]")
        graph_path = os.path.join(tmp, "filter_graph.txt")
        Path(graph_path).write_text(";\n".join(chain), encoding="utf-8")

        graph_flag = ["-/filter_complex", graph_path] if ffmpeg_major_version() >= 7 \
            else ["-filter_complex_script", graph_path]
        cmd = ["ffmpeg", "-y", "-v", "error", "-nostats", "-progress", "pipe:1",
               "-i", input_path]
        for ov in overlays:
            cmd += ["-i", ov["png"]]
        cmd += graph_flag + [
            "-map", "[vout]", "-map", "0:a?",
            "-c:v", "libx264", "-crf", "18", "-preset", "fast",
            "-c:a", "copy", "-movflags", "+faststart",
            output_path,
        ]

        logger.info("Compositing and encoding with ffmpeg...")
        with tempfile.TemporaryFile(mode="w+", encoding="utf-8", errors="replace") as err:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=err,
                                    text=True, encoding="utf-8", errors="replace")
            last_reported = -1
            for line in proc.stdout:
                if line.startswith("frame="):
                    try:
                        done = int(line.split("=", 1)[1])
                    except ValueError:
                        continue
                    # The UI's render route parses "N/M frames done"
                    if done - last_reported >= max(1, total // 50):
                        logger.info(f"  {min(done, total)}/{total} frames done...")
                        last_reported = done
            proc.wait()
            if proc.returncode != 0:
                err.seek(0)
                logger.error(f"ffmpeg failed:\n{err.read()[-2000:]}")
                raise RuntimeError("ffmpeg encode failed")

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    logger.info(f"  {total}/{total} frames done...")
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

    meta = probe_video(input_path)
    duration = meta["duration"] or (detections[-1]["timestamp"] + 2.0 if detections else 0.0)
    logger.info(f"Video duration: {duration:.1f}s")

    timeline = build_timeline(detections, duration, vid_w=meta["w"], vid_h=meta["h"])
    render_video(input_path, output_path, timeline, meta)


if __name__ == "__main__":
    main()
