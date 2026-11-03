"""
media.py — Make uploads playable in every browser before processing.

The editor streams the job's input video into a <video> element, and OCR
timestamps must match what the browser shows. Anything that isn't H.264 +
yuv420p (+ AAC audio) in an MP4 — HEVC phone clips, ProRes MOVs, MKV/WebM,
10-bit — is converted once, in place, before OCR.
"""
from __future__ import annotations

import json
import logging
import os
import subprocess

logger = logging.getLogger(__name__)


def probe(path: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=format_name:stream=codec_type,codec_name,pix_fmt",
         "-of", "json", path],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"Not a readable video: {out.stderr.strip()[-300:]}")
    return json.loads(out.stdout)


def needs_conversion(info: dict) -> tuple[bool, str]:
    streams = info.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    if video is None:
        raise RuntimeError("The file has no video stream")
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    fmt = info.get("format", {}).get("format_name", "")
    reasons = []
    if "mp4" not in fmt:
        reasons.append(f"container {fmt.split(',')[0]}")
    if video.get("codec_name") != "h264":
        reasons.append(f"video codec {video.get('codec_name')}")
    if video.get("pix_fmt") not in ("yuv420p", "yuvj420p"):
        reasons.append(f"pixel format {video.get('pix_fmt')}")
    if any(a.get("codec_name") not in ("aac", "mp3") for a in audio):
        reasons.append("audio codec " + ",".join(a.get("codec_name", "?") for a in audio))
    return bool(reasons), ", ".join(reasons)


def ensure_browser_playable(path: str) -> bool:
    """Convert `path` in place to H.264/AAC MP4 if needed. Returns True if converted."""
    info = probe(path)
    convert, why = needs_conversion(info)
    if not convert:
        return False
    logger.info(f"Converting upload to H.264 MP4 for the browser ({why})...")
    tmp = path + ".converting.mp4"
    cmd = [
        "ffmpeg", "-y", "-v", "error", "-i", path,
        "-map", "0:v:0", "-map", "0:a:0?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
        # Odd dimensions are not allowed in yuv420p H.264
        "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        tmp,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise RuntimeError(f"Could not convert the video: {res.stderr.strip()[-500:]}")
    os.replace(tmp, path)
    logger.info("Conversion done")
    return True
