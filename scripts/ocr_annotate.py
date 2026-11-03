#!/usr/bin/env python3
"""
ocr_annotate.py — Local OCR annotation tool (PaddleOCR edition)

Extracts frames at 2fps, skips frames that are visually identical to the
last OCR'd frame (static slides), runs PaddleOCR in parallel across CPU cores,
groups words into line-aware blocks, draws red outlines around blocks +
blue outlines around words, saves annotated JPGs and ocr_detections.json.

Usage:
    python ocr_annotate.py --input video.mp4 --output-dir annotated/
    python ocr_annotate.py --input video.mp4 --output-dir annotated/ --lang japan
    python ocr_annotate.py --input video.mp4 --output-dir annotated/ --workers 4

Supported --lang values (common):
    en, japan, ch, korean, french, german, arabic, latin, cyrillic ...
    Full list: https://paddlepaddle.github.io/PaddleOCR/latest/en/ppocr/blog/multi_languages.html
"""

import argparse
import json
import logging
import os
import re
import subprocess
import sys
from multiprocessing import Pool, cpu_count
from pathlib import Path

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


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("--input",      required=True)
    p.add_argument("--output-dir", required=True)
    p.add_argument("--fps",        type=float, default=2.0)
    p.add_argument("--lang",       type=str,   default="en",
                   help="PaddleOCR language code (default: en)")
    p.add_argument("--workers",    type=int,   default=None,
                   help="Parallel OCR workers (default: cpu_count - 1)")
    p.add_argument("--no-dedupe",  action="store_true",
                   help="OCR every frame, even ones identical to the previous OCR'd frame")
    p.add_argument("--verbose",    action="store_true")
    return p.parse_args()


# ── Frame extraction ──────────────────────────────────────────────────────────

def extract_frames(input_path: str, frames_dir: str, fps: float) -> list[tuple[float, str]]:
    Path(frames_dir).mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-i", input_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(frames_dir, "%06d.jpg"),
        "-y",
    ]
    logger.info(f"Extracting frames at {fps}fps...")
    subprocess.run(cmd, capture_output=True, text=True)

    frame_files = sorted(Path(frames_dir).glob("*.jpg"))

    frame_duration = 1.0 / fps
    timestamps = [
        round((i / fps) + (frame_duration / 2), 3)
        for i in range(len(frame_files))
    ]

    frames = [(ts, str(p)) for ts, p in zip(timestamps, frame_files)]
    logger.info(f"Extracted {len(frames)} frames")
    return frames


# ── Duplicate-frame detection ─────────────────────────────────────────────────

# Frames are compared at this size; a changed pixel differs by more than
# PIXEL_DIFF (0–255 grey). A frame counts as "changed" once more than
# CHANGED_FRACTION of pixels changed — small enough that a single new word
# appearing on a static slide still triggers OCR.
DEDUPE_SIZE      = (160, 90)
PIXEL_DIFF       = 30
CHANGED_FRACTION = 0.0005


def frame_signature(path: str):
    import cv2
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        return None
    return cv2.resize(img, DEDUPE_SIZE, interpolation=cv2.INTER_AREA)


def plan_ocr(frames: list[tuple[float, str]], dedupe: bool) -> list[int]:
    """
    For each frame return the index of the frame whose OCR result it should
    use: itself if it needs OCR, otherwise the last OCR'd keyframe it matches.
    """
    import numpy as np
    source = list(range(len(frames)))
    if not dedupe:
        return source
    key_idx, key_sig = None, None
    for i, (_, path) in enumerate(frames):
        sig = frame_signature(path)
        if key_sig is not None and sig is not None and sig.shape == key_sig.shape:
            diff = np.abs(sig.astype(np.int16) - key_sig.astype(np.int16))
            if (diff > PIXEL_DIFF).mean() <= CHANGED_FRACTION:
                source[i] = key_idx
                continue
        key_idx, key_sig = i, sig
    return source


# ── OCR (worker) ──────────────────────────────────────────────────────────────

_reader = None

def _init_worker(lang: str) -> None:
    global _reader
    from paddleocr import PaddleOCR
    _reader = PaddleOCR(
        use_angle_cls=False,
        lang=lang,
        use_gpu=False,
        show_log=False,
    )

def _ocr_frame_worker(args):
    frame_index, ts, frame_path = args
    raw = _reader.ocr(frame_path, cls=False)
    words = []
    for line in (raw[0] or []):
        quad, (text, conf) = line
        text = text.strip()
        if not text:
            continue
        if re.fullmatch(r"[\d\s,.\-+%$€£¥:/]+", text):
            continue
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        x1, y1, x2, y2 = int(min(xs)), int(min(ys)), int(max(xs)), int(max(ys))
        if (y2 - y1) <= 5:
            continue
        words.append({"text": text, "bbox": [x1, y1, x2, y2], "conf": round(conf, 3)})
    return frame_index, ts, frame_path, words


# ── Line grouping ─────────────────────────────────────────────────────────────

def group_into_lines(words: list[dict]) -> list[dict]:
    if not words:
        return []

    words_sorted = sorted(words, key=lambda w: (w["bbox"][1], w["bbox"][0]))
    used = [False] * len(words_sorted)
    lines = []

    for i, word in enumerate(words_sorted):
        if used[i]:
            continue
        line = [word]
        used[i] = True
        w_cy = (word["bbox"][1] + word["bbox"][3]) / 2
        w_h  = max(word["bbox"][3] - word["bbox"][1], 1)

        for j, other in enumerate(words_sorted):
            if used[j]:
                continue
            o_cy = (other["bbox"][1] + other["bbox"][3]) / 2
            o_h  = max(other["bbox"][3] - other["bbox"][1], 1)
            avg_h = (w_h + o_h) / 2
            if abs(w_cy - o_cy) <= 0.6 * avg_h:
                line.append(other)
                used[j] = True

        line.sort(key=lambda w: w["bbox"][0])
        lines.append(line)

    blocks = []
    for line in lines:
        x1 = min(w["bbox"][0] for w in line)
        y1 = min(w["bbox"][1] for w in line)
        x2 = max(w["bbox"][2] for w in line)
        y2 = max(w["bbox"][3] for w in line)
        if (y2 - y1) <= 5:
            continue
        avg_conf = sum(w["conf"] for w in line) / len(line)
        blocks.append({
            "text":  " ".join(w["text"] for w in line),
            "bbox":  [x1, y1, x2, y2],
            "conf":  round(avg_conf, 3),
            "words": line,
        })
    return blocks


# ── Annotate ──────────────────────────────────────────────────────────────────

def annotate_frame(image_path: str, output_path: str, blocks: list[dict], timestamp: float) -> None:
    import cv2
    img = cv2.imread(image_path)
    if img is None:
        return

    RED   = (0, 0, 255)
    BLUE  = (255, 100, 0)
    WHITE = (255, 255, 255)
    BLACK = (0, 0, 0)

    for block in blocks:
        x1, y1, x2, y2 = block["bbox"]
        cv2.rectangle(img, (x1, y1), (x2, y2), RED, 2)

        label = f"{block['text'][:40]}  [{block['conf']:.0%}]"
        font = cv2.FONT_HERSHEY_SIMPLEX
        (lw, lh), baseline = cv2.getTextSize(label, font, 0.45, 1)
        label_y = max(y1 - 4, lh + 4)
        cv2.rectangle(img, (x1, label_y - lh - baseline - 2), (x1 + lw + 4, label_y + 2), BLACK, -1)
        cv2.putText(img, label, (x1 + 2, label_y - baseline), font, 0.45, WHITE, 1, cv2.LINE_AA)

        for word in block["words"]:
            wx1, wy1, wx2, wy2 = word["bbox"]
            cv2.rectangle(img, (wx1, wy1), (wx2, wy2), BLUE, 1)

    cv2.putText(img, f"t={timestamp:.2f}s  |  {len(blocks)} blocks",
                (10, img.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, WHITE, 1, cv2.LINE_AA)
    cv2.imwrite(output_path, img)


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    args = parse_args()
    setup_logging(args.verbose)

    input_path = str(Path(args.input).resolve())
    if not os.path.isfile(input_path):
        sys.exit(f"[ERROR] Input not found: {input_path}")

    output_dir = str(Path(args.output_dir).resolve())
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    frames_dir = os.path.join(output_dir, "_frames")
    annotated_frames_dir = os.path.join(output_dir, "annotated_frames")
    Path(annotated_frames_dir).mkdir(parents=True, exist_ok=True)

    frames = extract_frames(input_path, frames_dir, args.fps)
    if not frames:
        sys.exit("[ERROR] No frames extracted.")

    n_workers = args.workers or max(1, cpu_count() - 1)
    logger.info(f"Running PaddleOCR on {len(frames)} frames with {n_workers} workers "
                f"(lang={args.lang})...")

    source = plan_ocr(frames, dedupe=not args.no_dedupe)
    key_frames = sorted(set(source))
    skipped = len(frames) - len(key_frames)
    if skipped:
        logger.info(f"Skipping {skipped}/{len(frames)} frames identical to an earlier frame")
    tasks = [(i, frames[i][0], frames[i][1]) for i in key_frames]

    # Load the model once in this process first: it downloads weights on first
    # use, and if that (or the import) fails inside a Pool initializer the pool
    # respawns workers forever instead of raising, so the job never finishes.
    try:
        _init_worker(args.lang)
    except Exception as e:
        sys.exit(f"[ERROR] Could not load PaddleOCR (lang={args.lang}): {e}")

    words_by_frame: dict[int, list[dict]] = {}
    with Pool(
        processes=n_workers,
        initializer=_init_worker,
        initargs=(args.lang,),
    ) as pool:
        for n, (frame_index, _, _, words) in enumerate(
            pool.imap_unordered(_ocr_frame_worker, tasks), start=1
        ):
            words_by_frame[frame_index] = words
            print(f"PROGRESS:{0.95 * n / len(tasks):.3f}", flush=True)

    ocr_results = [
        (i, ts, path, words_by_frame[source[i]])
        for i, (ts, path) in enumerate(frames)
    ]

    logger.info("OCR done — annotating frames and writing JSON...")

    all_results = []
    for frame_index, ts, frame_path, words in ocr_results:
        blocks = group_into_lines(words)

        out_path = os.path.join(annotated_frames_dir, f"frame_{frame_index:05d}_t{ts:.3f}.jpg")
        annotate_frame(frame_path, out_path, blocks, timestamp=ts)

        saved_blocks = []
        for block in blocks:
            saved_words = [w for w in block["words"] if w["conf"] > 0.1]
            if not saved_words:
                continue
            saved_blocks.append({
                "text":  " ".join(w["text"] for w in saved_words),
                "bbox":  block["bbox"],
                "conf":  block["conf"],
                "words": [{"text": w["text"], "bbox": w["bbox"], "conf": w["conf"]} for w in saved_words],
            })

        all_results.append({
            "frame_index": frame_index,
            "timestamp":   ts,
            "frame_path":  out_path,
            "blocks":      saved_blocks,
        })

    json_path = os.path.join(output_dir, "ocr_detections.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, ensure_ascii=False, indent=2)

    logger.info(f"Detections saved to {json_path}")
    logger.info(f"Done. {len(frames)} frames annotated.")


if __name__ == "__main__":
    main()