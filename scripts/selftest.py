#!/usr/bin/env python3
"""
selftest.py — Check the whole pipeline end to end with your real API keys.

    cd scripts && .venv/bin/python selftest.py                 # Hindi, standard mode
    .venv/bin/python selftest.py --lang ta-IN --ai             # Tamil, OpenAI-assisted
    .venv/bin/python selftest.py --mock                        # offline (fake Sarvam), e.g. CI

It checks the toolchain (ffmpeg, Pillow/raqm, fonts, OCR model), that Sarvam
(and OpenAI with --ai) accept your key, then makes a short demo video with
English on-screen text, runs OCR → translate → render exactly as the web app
does, and verifies each step. Output goes to <out>/ (default
../workspace/selftest): the rendered video and before/after stills.
Exit code 0 = everything passed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
os.chdir(HERE)  # scripts load fonts and cache relative to scripts/
load_dotenv(HERE.parent / ".env")
load_dotenv()

from languages import LANGUAGES  # noqa: E402

PY = sys.executable
SLIDES = [
    # (text, colour, x, y, size, start, end)
    ("Photosynthesis", "yellow", 140, 170, 76, 0, 4),
    ("Plants turn sunlight into food", "white", 140, 320, 46, 0, 4),
    ("Save water every day", "white", 200, 420, 64, 4, 8),
]
MOCK = {
    "photosynthesis": "प्रकाश संश्लेषण",
    "plants turn sunlight into food": "पौधे धूप से भोजन बनाते हैं",
    "save water every day": "हर दिन पानी बचाएं",
}

results: list[tuple[bool, str, str]] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    results.append((ok, name, detail))
    print(f"  {'✓' if ok else '✗'} {name}" + (f" — {detail}" if detail else ""), flush=True)
    return ok


def run(cmd: list[str], env: dict | None = None, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8",
                          errors="replace", env={**os.environ, **(env or {})}, timeout=timeout)


def last_error(proc: subprocess.CompletedProcess) -> str:
    lines = [l for l in (proc.stdout + proc.stderr).splitlines() if l.strip() and not l.startswith("PROGRESS")]
    errs = [l for l in lines if "ERROR" in l]
    return (errs or lines or ["(no output)"])[-1][:300]


def script_chars(lang: str) -> set[tuple[int, int]]:
    from render_translations import SCRIPT_RANGES
    font = LANGUAGES[lang][2]
    return {(lo, hi) for lo, hi, f in SCRIPT_RANGES if f == font}


def in_script(text: str, lang: str) -> bool:
    ranges = script_chars(lang)
    return any(any(lo <= ord(c) <= hi for lo, hi in ranges) for c in text)


# ── Mock Sarvam (offline mode) ────────────────────────────────────────────────

def start_mock() -> str:
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            out = MOCK.get(body["input"].strip().lower(), "अनुवाद " + body["input"])
            data = json.dumps({"translated_text": out}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *a):
            pass

    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return f"http://127.0.0.1:{srv.server_port}/translate"


# ── Steps ─────────────────────────────────────────────────────────────────────

def check_toolchain() -> bool:
    print("Toolchain")
    ok = check("ffmpeg / ffprobe on PATH", bool(shutil.which("ffmpeg") and shutil.which("ffprobe")))
    from PIL import features
    ok &= check("Pillow has raqm (Indic shaping)", bool(features.check("raqm")))
    from languages import all_font_files
    missing = [f for f in all_font_files() if not (HERE / "assets" / f).is_file()]
    ok &= check("Noto fonts bundled", not missing, ", ".join(missing))
    try:
        from rapidocr import RapidOCR
        RapidOCR(params={"Global.log_level": "warning"})
        ok &= check("OCR model loads (offline)", True)
    except Exception as e:
        ok &= check("OCR model loads (offline)", False, str(e)[:200])
    return ok


def check_providers(lang: str, use_ai: bool, mock_url: str | None) -> bool:
    print("Translation providers")
    import translate_detections as td
    td.TARGET_LANG = lang
    if mock_url:
        td.SARVAM_ENDPOINT = mock_url
        os.environ.setdefault("SARVAM_API_KEY", "mock")
        check("Sarvam", True, "mock server (offline mode)")
    elif not check("SARVAM_API_KEY is set", bool(os.environ.get("SARVAM_API_KEY")),
                   "add it to .env in the repo root"):
        return False
    else:
        try:
            t0 = time.time()
            out = td.sarvam_translate("Welcome to the course", {})
            good = out != "Welcome to the course" and in_script(out, lang)
            if not check(f"Sarvam translates to {LANGUAGES[lang][0]}", good,
                         f"'{out}' in {time.time() - t0:.1f}s" if good else f"got '{out}'"):
                return False
        except td.ProviderAuthError as e:
            return check("Sarvam accepts the key", False, str(e))
    if use_ai:
        if not check("OPENAI_API_KEY is set", bool(os.environ.get("OPENAI_API_KEY"))):
            return False
        try:
            res = td.openai_group_and_translate(["Photosynthesis", "Plants turn sunlight into food"], {})
            good = len(res) == 2 and all(in_script(v, lang) for v in res.values())
            if not check(f"OpenAI ({td.OPENAI_MODEL}) translates to {LANGUAGES[lang][0]}", good, json.dumps(res, ensure_ascii=False)):
                return False
        except td.ProviderAuthError as e:
            return check("OpenAI accepts the key", False, str(e))
    return True


def make_video(path: Path) -> None:
    font = (HERE / "assets" / "NotoSansDevanagari-Regular.ttf").as_posix()
    draws = ",".join(
        f"drawtext=fontfile={font}:expansion=none:text='{t}':fontcolor={c}:fontsize={s}:"
        f"x={x}:y={y}:enable='between(t,{a},{b - 0.04})'"
        for t, c, x, y, s, a, b in SLIDES
    )
    src = "gradients=s=1280x720:c0=0x0b3d91:c1=0xff7e5f:x0=0:y0=0:x1=1280:y1=720:speed=0.00001:r=25"
    proc = run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"{src},trim=duration=8",
                "-f", "lavfi", "-i", "sine=f=330:d=8", "-vf", draws,
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path)])
    if proc.returncode:
        raise RuntimeError(proc.stderr[-500:])


def pipeline(out: Path, lang: str, use_ai: bool, mock_url: str | None) -> bool:
    print("Pipeline")
    video, frames = out / "input_video.mp4", out / "frames"
    translated, rendered = out / "translated_detections.json", out / "output.mp4"
    make_video(video)
    check("demo video created", video.is_file(), str(video))

    t0 = time.time()
    proc = run([PY, "ocr_annotate.py", "--input", str(video), "--output-dir", str(frames)])
    dets = frames / "ocr_detections.json"
    if not check("OCR ran", proc.returncode == 0 and dets.is_file(),
                 f"{time.time() - t0:.1f}s" if proc.returncode == 0 else last_error(proc)):
        return False
    found = {b["text"].strip().lower() for f in json.loads(dets.read_text()) for b in f["blocks"]}
    expected = {t.lower() for t, *_ in SLIDES}
    check("OCR read every line", expected <= found, f"missing: {sorted(expected - found)}" if not expected <= found else "")

    env = {"SARVAM_API_URL": mock_url} if mock_url else {}
    t0 = time.time()
    proc = run([PY, "translate_detections.py", "--detections", str(dets), "--output", str(translated),
                "--target-lang", lang, *(["--ai"] if use_ai else [])], env=env)
    if not check("translation ran", proc.returncode == 0 and translated.is_file(),
                 f"{time.time() - t0:.1f}s" if proc.returncode == 0 else last_error(proc)):
        return False
    tr = {}
    for f in json.loads(translated.read_text()):
        for b in f["blocks"]:
            tr[b["text"].strip()] = b["translation"]
    bad = {k: v for k, v in tr.items() if not v or not in_script(v, lang)}
    check(f"every line translated into {LANGUAGES[lang][0]}", not bad,
          "; ".join(f"{k} → {v!r}" for k, v in bad.items()) or
          "; ".join(f"{k} → {v}" for k, v in tr.items()))

    t0 = time.time()
    proc = run([PY, "render_translations.py", "--input", str(video), "--detections", str(translated),
                "--output", str(rendered)])
    if not check("render ran", proc.returncode == 0 and rendered.is_file(),
                 f"{time.time() - t0:.1f}s" if proc.returncode == 0 else last_error(proc)):
        return False
    modes = re.findall(r"\[\d+/\d+\]\s+(erase|box|delogo|skip)\b", proc.stdout)
    check("original text erased (not boxed)", bool(modes) and all(m == "erase" for m in modes), ", ".join(modes))
    dur = float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(rendered)]).stdout or 0)
    check("output length matches input", abs(dur - 8.0) < 0.3, f"{dur:.2f}s")

    stills = out / "before_after.png"
    run(["ffmpeg", "-y", "-v", "error", "-ss", "2", "-i", str(video), "-ss", "2", "-i", str(rendered),
         "-ss", "6", "-i", str(video), "-ss", "6", "-i", str(rendered),
         "-filter_complex", "[0:v][1:v]hstack[a];[2:v][3:v]hstack[b];[a][b]vstack,scale=1280:-1",
         "-frames:v", "1", str(stills)])
    check("before/after stills saved", stills.is_file(), str(stills))
    return True


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--lang", default="hi-IN", choices=sorted(LANGUAGES))
    p.add_argument("--ai", action="store_true", help="also test OpenAI-assisted translation")
    p.add_argument("--mock", action="store_true", help="use a built-in fake Sarvam (no key or network)")
    p.add_argument("--out", default=str(HERE.parent / "workspace" / "selftest"))
    args = p.parse_args()
    if args.mock and args.ai:
        p.error("--mock covers Sarvam only; drop --ai")
    if args.mock and args.lang != "hi-IN":
        print("(--mock only knows Hindi; testing hi-IN)")
        args.lang = "hi-IN"

    out = Path(args.out).resolve()
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    mock_url = start_mock() if args.mock else None
    if args.mock:
        # Fake translations must never land in the real translation cache
        os.environ["SARVAM_API_URL"] = mock_url
        os.environ["TRANSLATION_CACHE"] = str(out / "mock_cache.json")

    print(f"onscreen-translate self-test — {LANGUAGES[args.lang][0]}"
          f"{' + AI' if args.ai else ''}{' (mock)' if args.mock else ''}\n")
    ok = check_toolchain() and check_providers(args.lang, args.ai, mock_url) and pipeline(out, args.lang, args.ai, mock_url)
    failed = [r for r in results if not r[0]]
    print()
    if ok and not failed:
        print(f"PASSED — watch {out / 'output.mp4'} and look at {out / 'before_after.png'}")
        sys.exit(0)
    print(f"FAILED ({len(failed)}): " + "; ".join(f"{n}: {d}" if d else n for _, n, d in failed))
    sys.exit(1)


if __name__ == "__main__":
    main()
