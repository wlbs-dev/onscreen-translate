---
name: onscreen-translate
description: Work on the onscreen-translate pipeline — OCR on-screen English text in a video, translate it to Marathi (Sarvam AI / OpenAI), and burn the translations back in, with a Next.js editor (loomv2/) for reviewing overlays. Use when changing the Python scripts in scripts/, the loomv2 API routes or editor components, the job store, or when running/debugging a job end to end.
---

# onscreen-translate

Video → **OCR** → **Translate** → **Render** → output.mp4, driven from a Next.js UI.

## Layout

| Path | What it is |
|---|---|
| `scripts/ocr_annotate.py` | ffmpeg frame extraction (default 2 fps) + PaddleOCR in a multiprocessing pool; groups words into line blocks; writes annotated JPGs + `ocr_detections.json` |
| `scripts/translate_detections.py` | Segments frames into scene "buckets", translates via Sarvam `mayura:v1`; `--ai` groups/translates with OpenAI first and falls back to Sarvam |
| `scripts/render_translations.py` | Builds an overlay timeline, pre-renders each overlay as HTML with Playwright (Noto Devanagari from `scripts/assets/`), composites with OpenCV/Pillow, encodes with ffmpeg |
| `scripts/cache/translation_cache.json` | md5(text) → Marathi cache. Delete it to force re-translation |
| `loomv2/` | Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui editor |
| `loomv2/lib/jobPaths.ts` | `WORKSPACE`, `SCRIPTS_DIR`, per-job file paths, `getPython()` (prefers `scripts/.venv`) |
| `loomv2/lib/jobStore.ts` | File-backed job state: `<WORKSPACE>/jobs/<id>.json`, one `JobStatus` per stage (`ocr`/`translate`/`render`) |
| `loomv2/lib/runScript.ts` | Spawns a Python script, streams stdout/stderr lines into the job log, parses `PROGRESS:0.42` lines |

Per-job files live in `<WORKSPACE>/uploads/<jobId>/`: `input_video.mp4`, `frames/ocr_detections.json`, `translated_detections.json`, `output.mp4`.

## API routes (`loomv2/app/api/`)

- `POST upload`: multipart `video` → creates job, saves input
- `POST run/ocr?jobId=`, `GET run/ocr/status?jobId=`
- `POST run/translate?jobId=&ai=true|false`, `GET run/translate/status?jobId=`
- `POST render?jobId=`, `GET render/status?jobId=`, `GET output?jobId=`
- `GET/POST detections?jobId=`: read/save the edited `translated_detections.json`
- `GET/PATCH/DELETE jobs`: list, rename (`label`), delete job + uploads
- `GET video?jobId=`: stream the input video

All long-running routes are fire-and-forget; the client polls the `status` endpoints (see `UploadModal.tsx`, `Dashboard.tsx`, `Editor.tsx`).

## UI components (`loomv2/components/`)

`Dashboard` (job cards, retranslate dialog) → `Editor` (loads detections, builds `OverlayEvent`s, saves, triggers render), which composes `VideoPlayer` + `OverlayCanvas` (drag/resize boxes), `Timeline` (multi-lane, 2 s gap buffer, ctrl+scroll zoom) and `Sidebar` (event list + text/color/font editor). `UploadModal` chains upload → OCR → translate.

## Running

```bash
# Python (from scripts/)
python -m venv .venv && source .venv/bin/activate
pip install python-dotenv paddleocr paddlepaddle opencv-python pillow numpy playwright
playwright install chromium        # ffmpeg must also be on PATH

# .env (repo root or scripts/)
SARVAM_API_KEY=...
OPENAI_API_KEY=...                 # only for --ai

# Web UI
cd loomv2 && npm install && npm run dev   # http://localhost:3000
```

Scripts can be run directly:

```bash
python scripts/ocr_annotate.py --input video.mp4 --output-dir out/frames --verbose
python scripts/translate_detections.py --detections out/frames/ocr_detections.json --output out/translated_detections.json [--ai]
python scripts/render_translations.py --input video.mp4 --detections out/translated_detections.json --output out/output.mp4
```

## Gotchas

- `WORKSPACE` defaults to `process.cwd()/../workspace` (i.e. the server must run from `loomv2/`). Override with `WORKSPACE_DIR` / `SCRIPTS_DIR`.
- **Scripts must run with `cwd = scripts/`.** The renderer loads `assets/NotoSansDevanagari-Regular.ttf` by relative path.
- Long-running stages go through `runScript`; scripts report progress with `PROGRESS:0.42` lines or a `parseProgress` hook (render matches `N/M frames done`).
- Job ids are UUIDs. Anything that builds a path from a request id must go through `isValidJobId` / `jobPaths()` (which throws on bad ids).
- `loomv2/AGENTS.md`: this Next.js version has breaking changes. Check `node_modules/next/dist/docs/` before using Next APIs.
