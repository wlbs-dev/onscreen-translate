---
name: onscreen-translate
description: Work on the onscreen-translate pipeline — OCR on-screen English text in a video, translate it into one of 10 Indian languages (Sarvam AI / OpenAI), and burn the translations back in, with a Next.js editor (loomv2/) for reviewing overlays. Use when changing the Python scripts in scripts/, the loomv2 API routes or editor components, the job store, or when running/debugging a job end to end.
---

# onscreen-translate

Video → **OCR** → **Translate** → **Render** → output.mp4, driven from a Next.js UI.

## Layout

| Path | What it is |
|---|---|
| `scripts/ocr_annotate.py` | ffmpeg frame extraction (default 2 fps) to `_frames/`, skips frames identical to the last OCR'd keyframe (`--no-dedupe` to disable), PaddleOCR in a multiprocessing pool; groups words into line blocks; writes annotated JPGs to `annotated_frames/` + `ocr_detections.json` |
| `scripts/translate_detections.py` | Segments frames into scene "buckets", translates via Sarvam `mayura:v1` into `--target-lang` (default `mr-IN`); `--ai` groups/translates with OpenAI (`OPENAI_MODEL`) first and falls back to Sarvam |
| `scripts/render_translations.py` | Builds an overlay timeline, pre-renders each overlay as HTML with Playwright (all Noto Sans Indic fonts from `scripts/assets/` in one fallback stack), composites with OpenCV/Pillow, encodes with ffmpeg |
| `scripts/languages.py` | Supported target languages → name + font. Mirror: `loomv2/lib/languages.ts` (picker) and `loomv2/lib/editor/indicFonts.ts` (preview fonts) |
| `scripts/cache/translation_cache.json` | `<lang>:md5(text)` → translation cache (legacy unprefixed keys = Marathi), created at runtime and gitignored. Delete it to force re-translation |
| `loomv2/` | Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui editor |
| `loomv2/lib/jobPaths.ts` | `WORKSPACE`, `SCRIPTS_DIR`, per-job file paths, `getPython()` (prefers `scripts/.venv`) |
| `loomv2/lib/jobStore.ts` | File-backed job state: `<WORKSPACE>/jobs/<id>.json`, one `JobStatus` per stage (`ocr`/`translate`/`render`) |
| `loomv2/lib/runScript.ts` | Queue (`MAX_CONCURRENT_JOBS`, default 1, state on `globalThis`) + spawner: streams stdout/stderr into the job log (batched every 400 ms, capped at 500 lines), parses `PROGRESS:0.42` lines, `cancelJob()` kills a job's runs |
| `loomv2/lib/auth.ts`, `loomv2/proxy.ts` | Optional `APP_PASSWORD` gate. Next 16 renamed `middleware.ts` to `proxy.ts` |
| `loomv2/instrumentation.ts` | Startup: marks stages left `running`/`queued` as failed, sweeps jobs past `JOB_RETENTION_DAYS` |

Per-job files live in `<WORKSPACE>/uploads/<jobId>/`: `input_video.mp4`, `frames/ocr_detections.json`, `translated_detections.json`, `output.mp4`.

## API routes (`loomv2/app/api/`)

- `POST upload`: multipart `video` → creates job, saves input
- `POST run/ocr?jobId=`, `GET run/ocr/status?jobId=`
- `POST run/translate?jobId=&ai=true|false&lang=hi-IN`, `GET run/translate/status?jobId=` (stores `targetLang`/`aiMode` on the job)
- `POST render?jobId=`, `GET render/status?jobId=`, `GET output?jobId=`
- `GET/POST detections?jobId=`: read/save the edited `translated_detections.json`
- `GET/PATCH/DELETE jobs`: list, rename (`label`), delete job + uploads
- `GET video?jobId=`: stream the input video

- `GET health` (no auth), `POST/DELETE login`, `GET fonts?file=` (bundled Noto fonts for the editor preview)

All long-running routes queue the script and return immediately (409 if that stage is already queued/running); the client polls the `status` endpoints (see `UploadModal.tsx`, `Dashboard.tsx`, `Editor.tsx`). Stage status is `pending | queued | running | done | error`.

## UI components (`loomv2/components/`)

`Dashboard` (job cards, retranslate dialog) → `Editor` (loads detections, builds `OverlayEvent`s, saves, triggers render), which composes `VideoPlayer` + `OverlayCanvas` (drag/resize boxes), `Timeline` (multi-lane, 2 s gap buffer, ctrl+scroll zoom) and `Sidebar` (event list + text/color/font editor). `UploadModal` chains upload → OCR → translate.

## Running

```bash
# Python (from scripts/)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt     # paddleocr pinned <3 (2.x API)
playwright install chromium        # ffmpeg must also be on PATH

# .env in repo root (cp .env.example .env)
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

## Testing without API keys or model downloads

- Sarvam: run a tiny local HTTP server that answers `{"translated_text": ...}` and set `SARVAM_API_URL=http://127.0.0.1:<port>` and any `SARVAM_API_KEY`.
- PaddleOCR downloads models from `paddleocr.bj.bcebos.com` on first use; in a sandbox without that host OCR fails fast with `Could not load PaddleOCR`. Write a stub `frames/ocr_detections.json` (+ `_frames/NNNNNN.jpg` from ffmpeg) to test translate/render.
- Render with a preinstalled browser: `CHROMIUM_PATH=/path/to/chrome`.

## Gotchas

- `WORKSPACE` defaults to `process.cwd()/../workspace` (i.e. the server must run from `loomv2/`). Override with `WORKSPACE_DIR` / `SCRIPTS_DIR`.
- **Scripts must run with `cwd = scripts/`.** The renderer loads `assets/NotoSansDevanagari-Regular.ttf` by relative path.
- Long-running stages go through `runScript`; scripts report progress with `PROGRESS:0.42` lines or a `parseProgress` hook (render matches `N/M frames done`).
- Job ids are UUIDs. Anything that builds a path from a request id must go through `isValidJobId` / `jobPaths()` (which throws on bad ids).
- Without `APP_PASSWORD` the API has no auth, so `dev`/`start` bind to `127.0.0.1`. `start:public` (and the Docker image) bind `0.0.0.0` and refuse to start without `APP_PASSWORD` unless `ALLOW_NO_AUTH=1`.
- The renderer samples cover-patch colours from the raw frame `_frames/{frame_index+1:06d}.jpg`, not the annotated `frame_path` (which has boxes drawn on it).
- Never start PaddleOCR only inside a `Pool` initializer: if it fails there the pool respawns workers forever. `ocr_annotate.py` loads it once in the parent first.
- Adding a language: update `scripts/languages.py`, `loomv2/lib/languages.ts`, and (for a new script) add the font to `scripts/assets/` and `loomv2/lib/editor/indicFonts.ts`.
- `render_translations.py` builds HTML for Playwright: always `html.escape` text and validate colors (`HEX_COLOR_RE`) before interpolating.
- Never commit videos, `.env`, or `scripts/cache/` (all gitignored). The repo is public.
- `loomv2/AGENTS.md`: this Next.js version has breaking changes. Check `node_modules/next/dist/docs/` before using Next APIs.
