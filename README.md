# translate-video

A full-stack tool that takes a video, detects on-screen English text via OCR, translates it into one of 10 Indian languages, and renders the translated text back onto the video as overlays — with a web UI to review, edit, and fine-tune every text box.

**Languages:** Hindi, Marathi, Bengali, Gujarati, Punjabi, Kannada, Malayalam, Odia, Tamil, Telugu (Sarvam `mayura:v1` codes, listed in `scripts/languages.py` and `loomv2/lib/languages.ts`).

---

## How it works

```
Video → OCR → Translation → Render → Output video
```

1. **OCR** — extracts text blocks from every frame, with bounding boxes and confidence scores (frames identical to the previous one are skipped)
2. **Translation** — translates detected text into the chosen language via Sarvam AI (or OpenAI-assisted for better quality)
3. **Render** — burns translated overlays back onto the video at the correct positions and timestamps
4. **Editor UI** — a Next.js dashboard to review jobs, edit overlay text/timing/style, and retranslate

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router), React, Tailwind, shadcn/ui |
| OCR | [RapidOCR](https://github.com/RapidAI/RapidOCR): PP-OCRv6 models on ONNX Runtime, bundled in the pip wheel (frames extracted with ffmpeg) |
| Translation | Sarvam AI (`mayura:v1`) + optional OpenAI (`gpt-4o-mini`) grouping |
| Rendering | Pillow + raqm/HarfBuzz draws each overlay (bundled Noto Sans Indic fonts); ffmpeg composites all overlays and encodes in one pass |
| Job management | Node.js file-based job store + in-process queue |

---

## Prerequisites

- Node.js 18+
- Python 3.10+
- ffmpeg on your `PATH`
- A Sarvam AI API key → [sarvam.ai](https://sarvam.ai)
- An OpenAI API key (optional, for `--ai` translation mode)

---

## Setup

```bash
git clone https://github.com/wlbs-dev/onscreen-translate
cd onscreen-translate
./setup.sh
```

`setup.sh` checks for ffmpeg, Node and Python 3.10+, creates `scripts/.venv` with the pipeline dependencies (about 400 MB, no model downloads — the OCR models ship inside the `rapidocr` wheel), runs the pipeline tests, installs the UI's npm packages and copies `.env.example` to `.env`. Then put your keys in `.env` (it's gitignored — never commit real keys).

<details>
<summary>Manual setup (e.g. on Windows)</summary>

```bash
(cd loomv2 && npm install)
cd scripts
python -m venv .venv          # the web UI prefers scripts/.venv if it exists
.venv/bin/pip install -r requirements.txt    # Windows: .venv\Scripts\pip
cd ..
cp .env.example .env
```
</details>

### 4. Run the dev server

```bash
cd loomv2
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The server binds to `127.0.0.1` only (see [Security](#security)).

---

## Usage

### Web UI

1. Click **Add Video**, pick a video and the target language
2. Choose **Start Processing** (Sarvam word-mapping) or **Use AI** (OpenAI groups and translates full sentences before splitting back to blocks). OCR and translation run back to back
3. To change language or mode later, use **Retranslate** in the video card's menu (this replaces editor changes)
4. Open the video to review overlays in the editor
5. Adjust timing, text, font size, and colors on the timeline — press **?** for keyboard shortcuts
6. Render the final output video

Stages run through a queue (`MAX_CONCURRENT_JOBS`, default 1), so a second upload waits instead of competing for CPU.

### Python scripts (direct)

Run these from the `scripts/` directory — the renderer loads its fonts from `assets/` by relative path, and the translation cache is written to `scripts/cache/`.

```bash
cd scripts
```

**OCR:**
```bash
python ocr_annotate.py --input path/to/video.mp4 --output-dir annotated/
```

**Translation — standard** (`--target-lang` defaults to `mr-IN`):
```bash
python translate_detections.py --detections annotated/ocr_detections.json --target-lang hi-IN
```

**Translation — AI-assisted (better for keyword/infographic style videos):**
```bash
python translate_detections.py --detections annotated/ocr_detections.json --ai
```

**Render:**
```bash
python render_translations.py --input path/to/video.mp4 --detections annotated/translated_detections.json --output out.mp4
```

---

## Translation modes

### Standard (Sarvam only)
- Collects all visible words from the last frame of each scene bucket
- Joins them into a sentence and sends to Sarvam AI
- Maps translated words back to blocks positionally
- Works well when full sentences appear on screen

### AI-assisted (`--ai`)
- Uses the last frame of each bucket (when all text is visible) for translation
- Sends blocks to OpenAI with instructions to translate the full meaning naturally, then split the translation proportionally across the original block count
- Each block gets its own translated chunk rendered at its original screen position
- Works much better for infographic/keyword-style videos where words are spread across visual elements
- Falls back to Sarvam for any block OpenAI misses

**Translation cache** is stored at `scripts/cache/translation_cache.json` (created on first run, gitignored) to avoid redundant API calls. Keys are scoped by target language. Delete it to force a fresh translation.

---

## Roadmap

**Done:** 10 target languages with a picker · duplicate-frame skipping in OCR · undo/redo · keyboard shortcuts · clip snapping · multi-select · auto font size · render queue · restart recovery · job retention (`JOB_RETENTION_DAYS`) · optional password gate · RapidOCR + single-pass ffmpeg render (no browser, ~5x faster renders)

**OCR + Translation**
- Standard mode maps translated words back to blocks by position, which breaks for SOV languages when a sentence spans several boxes — translate per block with sentence context instead
- Inpaint the original text (instead of a flat colour patch) for gradient / photo backgrounds
- Cache invalidation UI — right now you have to manually delete the cache file
- Translate into several languages from one OCR pass

**Infrastructure (for multi-user hosting)**
- Real accounts and per-user / per-team job isolation (today there is one shared password)
- Postgres instead of JSON job files; object storage for videos
- A worker process (separate from the web server) consuming a durable queue, with GPU OCR
- Usage metering and billing per processed minute

## Project structure

```
onscreen-translate/
├── loomv2/                         # Next.js app (App Router)
│   ├── app/
│   │   ├── api/
│   │   │   ├── upload/             # POST: upload video, create job
│   │   │   ├── run/
│   │   │   │   ├── ocr/            # POST: start OCR, GET status
│   │   │   │   └── translate/      # POST: start translation, GET status
│   │   │   ├── render/             # POST: start render, GET status
│   │   │   ├── jobs/               # List, rename, delete jobs
│   │   │   ├── detections/         # Read/save edited translated detections
│   │   │   ├── video/              # Stream input video
│   │   │   └── output/             # Serve rendered video
│   │   └── page.tsx
│   ├── components/
│   │   ├── Dashboard.tsx           # Job list with status badges + retranslate dialog
│   │   ├── Editor.tsx              # Editor page
│   │   ├── VideoPlayer.tsx         # Video + overlay preview
│   │   ├── OverlayCanvas.tsx       # Draggable/resizable text boxes
│   │   ├── Timeline.tsx            # Multi-lane NLE-style timeline editor
│   │   ├── Sidebar.tsx             # Event list + overlay editor
│   │   ├── UploadModal.tsx         # Upload → OCR → translate
│   │   └── Header.tsx
│   ├── lib/
│   │   ├── jobStore.ts             # File-based job persistence, restart recovery, retention
│   │   ├── jobPaths.ts             # Workspace path helpers, jobId validation
│   │   ├── runScript.ts            # Queued Python script runner with log streaming
│   │   ├── languages.ts            # Target languages (mirror of scripts/languages.py)
│   │   ├── auth.ts                 # Optional APP_PASSWORD session check
│   │   └── editor/                 # Undo history, font sizing, preview fonts
│   ├── proxy.ts                    # Auth gate (Next 16's renamed middleware)
│   └── instrumentation.ts          # Startup: recover interrupted jobs, sweep expired ones
├── scripts/
│   ├── ocr_annotate.py
│   ├── translate_detections.py
│   ├── render_translations.py
│   ├── languages.py                # Target languages + fonts
│   ├── requirements.txt
│   ├── assets/                     # Noto Sans Indic fonts (OFL)
│   └── cache/translation_cache.json  # Created at runtime (gitignored)
├── workspace/                      # Runtime data (gitignored)
│   ├── jobs/<jobId>.json           # Job status + logs
│   └── uploads/<jobId>/
│       ├── input_video.mp4
│       ├── frames/                 # Extracted + annotated frames, ocr_detections.json
│       ├── translated_detections.json
│       └── output.mp4
├── .env.example                    # Template — copy to .env
└── .env                            # API keys (gitignored)
```

`workspace/` defaults to `../workspace` relative to where the Next.js server runs; override with `WORKSPACE_DIR` (and `SCRIPTS_DIR` for the scripts folder).

---

## Timeline editor

The timeline uses a **multi-lane system** — events are automatically placed on the lowest lane where they don't overlap (with a 2-second gap buffer). If an event is extended and would overlap another, they split onto separate lanes on the next render.

- **Drag** clips to move them
- **Drag edges** to resize start/end times
- **Ctrl + scroll** to zoom in/out
- **Click the ruler** to seek
- **Shift/Ctrl + click** to multi-select; edges snap to the playhead and other clips (hold **Alt** to disable)
- **Ctrl+Z / Ctrl+Shift+Z** undo/redo, **Space** play/pause, **Alt+←/→** nudge, **?** for all shortcuts

---

## Notes

- `workspace/` is created automatically at runtime and is gitignored
- Sarvam AI's Marathi translation quality is inconsistent for single words — the `--ai` mode significantly improves results by translating full sentences with context
- For best results on subtitle-style videos (full sentences on screen), use standard mode. For infographic/keyword videos, use `--ai`
- No sample videos are included — bring your own, and only process content you have the rights to

---

## Running it for other people

On any Linux box or VM with ffmpeg, Node and Python:

```bash
./setup.sh
cd loomv2 && npm run build
APP_PASSWORD=choose-one WORKSPACE_DIR=/var/lib/onscreen-translate npm run start:public
```

`start:public` listens on all interfaces, so it **refuses to start without `APP_PASSWORD`** (set `ALLOW_NO_AUTH=1` only if another auth layer sits in front). Put HTTPS in front of it (Caddy, nginx, or a tunnel like Cloudflare Tunnel). `GET /api/health` is an unauthenticated liveness check. All settings are listed in `.env.example`.

## Tests

```bash
cd scripts && .venv/bin/python -m unittest test_pipeline -v   # script splitting, shaping, dedupe, cache keys
cd loomv2 && npx tsc --noEmit && npm run lint
```

## Security

By default this is a local, single-user tool with **no authentication**: anyone who can reach the server can upload files, run OCR/translation (spending your Sarvam/OpenAI credits), and read or delete jobs. That's why `npm run dev` / `npm start` bind to `127.0.0.1`.

Setting `APP_PASSWORD` puts every page and API route behind a login (`loomv2/proxy.ts`); the session cookie is an HMAC of the password, so changing it signs everyone out. It is one shared password, not per-user accounts — fine for a team or a pilot customer, not for open sign-ups.

---

## License

[MIT](LICENSE). The bundled Noto fonts are under the [SIL Open Font License](scripts/assets/OFL.txt).
