# translate-video

A full-stack tool that takes a video, detects on-screen English text via OCR, translates it to Marathi, and renders the translated text back onto the video as overlays — with a web UI to review, edit, and fine-tune every text box.

---

## How it works

```
Video → OCR → Translation → Render → Output video
```

1. **OCR** — extracts text blocks from every frame, with bounding boxes and confidence scores
2. **Translation** — translates detected text to Marathi via Sarvam AI (or OpenAI-assisted for better quality)
3. **Render** — burns translated overlays back onto the video at the correct positions and timestamps
4. **Editor UI** — a Next.js dashboard to review jobs, edit overlay text/timing/style, and retranslate

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router), React, Tailwind, shadcn/ui |
| OCR | Python script using PaddleOCR (frames extracted with ffmpeg) |
| Translation | Sarvam AI (`mayura:v1`) + optional OpenAI (`gpt-4o-mini`) grouping |
| Rendering | Python + Playwright (text), OpenCV / Pillow (compositing), ffmpeg (encode) |
| Job management | Node.js file-based job store |

---

## Prerequisites

- Node.js 18+
- Python 3.10+
- ffmpeg on your `PATH`
- A Sarvam AI API key → [sarvam.ai](https://sarvam.ai)
- An OpenAI API key (optional, for `--ai` translation mode)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/wlbs-dev/onscreen-translate
cd onscreen-translate
(cd loomv2 && npm install)
```

### 2. Python dependencies

```bash
cd scripts
python -m venv .venv && source .venv/bin/activate   # the web UI prefers scripts/.venv if it exists
pip install -r requirements.txt
playwright install chromium
cd ..
```

### 3. Environment variables

Copy the template to `.env` in the repo root and fill in your keys:

```bash
cp .env.example .env
```

`.env` is gitignored — never commit real keys.

### 4. Run the dev server

```bash
cd loomv2
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The server binds to `127.0.0.1` only (see [Security](#security)).

---

## Usage

### Web UI

1. Click **Add Video** and upload a video
2. OCR runs automatically on upload
3. Once OCR completes, click **Retranslate** on the video card
4. Choose **Without AI** (faster, word-mapping via Sarvam) or **Use AI** (better quality, uses OpenAI to group and translate full sentences before splitting back to blocks)
5. Once translation completes, open the video to review overlays in the editor
6. Adjust timing, text, font size, and colors on the timeline
7. Render the final output video

### Python scripts (direct)

Run these from the `scripts/` directory — the renderer loads its fonts from `assets/` by relative path, and the translation cache is written to `scripts/cache/`.

```bash
cd scripts
```

**OCR:**
```bash
python ocr_annotate.py --input path/to/video.mp4 --output-dir annotated/
```

**Translation — standard:**
```bash
python translate_detections.py --detections annotated/ocr_detections.json
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
- Maps Marathi words back to blocks positionally
- Works well when full sentences appear on screen

### AI-assisted (`--ai`)
- Uses the last frame of each bucket (when all text is visible) for translation
- Sends blocks to OpenAI with instructions to translate the full meaning naturally, then split the Marathi output proportionally across the original block count
- Each block gets its own Marathi chunk rendered at its original screen position
- Works much better for infographic/keyword-style videos where words are spread across visual elements
- Falls back to Sarvam for any block OpenAI misses

**Translation cache** is stored at `scripts/cache/translation_cache.json` (created on first run, gitignored) to avoid redundant API calls. Delete it to force a fresh translation.

---

## Features to add / improve 

**OCR + Translation**
- Support more target languages beyond Marathi, with a language picker in the UI
- Cache invalidation UI — right now you have to manually delete the cache file
- Skip duplicate frames before OCR instead of processing every frame — most frames in a bucket are identical

**Timeline + Editor + UI**
- Undo/redo support
- Keyboard shortcuts (space to play/pause, arrow keys to nudge timing)
- Snap to grid when dragging clips
- Bulk select and move multiple clips at once
- Auto font size based on bounding box size instead of fixed size

**Infrastructure**
- Jobs are lost on server restart since the store is file-based with no DB — add SQLite or similar
- No queue — multiple concurrent translation/render jobs will compete for resources
- No cleanup — workspace fills up indefinitely, needs a job expiry/delete policy

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
│   └── lib/
│       ├── jobStore.ts             # File-based job persistence
│       ├── jobPaths.ts             # Workspace path helpers, jobId validation
│       └── runScript.ts            # Python script runner with log streaming
├── scripts/
│   ├── ocr_annotate.py
│   ├── translate_detections.py
│   ├── render_translations.py
│   ├── requirements.txt
│   ├── assets/                     # Noto Devanagari fonts (OFL)
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

---

## Notes

- `workspace/` is created automatically at runtime and is gitignored
- Sarvam AI's Marathi translation quality is inconsistent for single words — the `--ai` mode significantly improves results by translating full sentences with context
- For best results on subtitle-style videos (full sentences on screen), use standard mode. For infographic/keyword videos, use `--ai`
- No sample videos are included — bring your own, and only process content you have the rights to

---

## Security

This is a local, single-user tool. The API has **no authentication**: anyone who can reach the server can upload files, run OCR/translation (spending your Sarvam/OpenAI credits), and read or delete jobs. That's why `npm run dev` / `npm start` bind to `127.0.0.1`. Don't expose it on a network or deploy it publicly without putting auth in front of it.

---

## License

[MIT](LICENSE). The bundled Noto Devanagari fonts are under the [SIL Open Font License](scripts/assets/OFL.txt).
