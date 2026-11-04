# translate-video

A full-stack tool that takes a video, detects on-screen English text via OCR, translates it into one of 10 Indian languages, and renders the translated text back onto the video as overlays — with a web UI to review, edit, and fine-tune every text box.

**Languages:** Hindi, Marathi, Bengali, Gujarati, Punjabi, Kannada, Malayalam, Odia, Tamil, Telugu (Sarvam `mayura:v1` codes, listed in `scripts/languages.py` and `loomv2/lib/languages.ts`).

---

## How it works

```
Video → OCR → Translation → Render → Output video
```

1. **OCR** — converts the upload to browser-playable H.264 MP4 if needed (MOV, MKV, WebM, HEVC, ProRes, 10-bit…), then extracts text blocks with bounding boxes, confidence and the original text colour (frames identical to the previous one are skipped)
2. **Translation** — translates each on-screen block into the chosen language via Sarvam AI (or OpenAI-assisted, which translates whole sentences split across boxes)
3. **Render** — **erases the original text** and rebuilds the background behind it, then draws the translation in the original colour at the same position and time. Static backgrounds get an inpainted clean plate; moving ones are erased frame by frame. A flat colour box is available per text as an alternative
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

Open [http://localhost:3000](http://localhost:3000) and click **Sign in → Create your account**: the first account needs no invite and becomes the admin (see [Accounts](#accounts)). The server binds to `127.0.0.1` only (see [Security](#security)).

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
- Uses the last frame of each scene bucket (when all text is visible)
- Translates each on-screen block (line) on its own with Sarvam AI
- Earlier frames where text is still typing on borrow the full block's translation
- Best when each box holds a complete phrase: titles, labels, captions, lower-thirds

### AI-assisted (`--ai`)
- Uses the last frame of each bucket (when all text is visible) for translation
- Sends blocks to OpenAI with instructions to translate the full meaning naturally, then split the translation proportionally across the original block count
- Each block gets its own translated chunk rendered at its original screen position
- Works much better for infographic/keyword-style videos where words are spread across visual elements
- Falls back to Sarvam for any block OpenAI misses

**Translation cache** is stored at `scripts/cache/translation_cache.json` (created on first run, gitignored) to avoid redundant API calls. Keys are scoped by target language. Delete it to force a fresh translation.

---

## Roadmap

**Done:** 10 target languages with a picker · duplicate-frame skipping in OCR · undo/redo · keyboard shortcuts · clip snapping · multi-select · auto font size · render queue · restart recovery · job retention (`JOB_RETENTION_DAYS`) · RapidOCR + single-pass ffmpeg render (no browser, ~5x faster renders) · real text erasing with original text colour · per-block standard translation · automatic conversion of MOV/MKV/WebM/HEVC uploads · bold text matched automatically · admin-issued password reset links · `selftest.py`

**OCR + Translation**
- Erasing on busy textures and moving backgrounds is the weakest case (inpainting smears, delogo blurs) — a learned inpainting model (e.g. LaMa via ONNX) would fix most of it
- Cache invalidation UI — right now you have to manually delete the cache file
- Translate into several languages from one OCR pass

**Accounts + pilot (done):** invite-only accounts, per-user job isolation, monthly minute quotas, admin page (users, invites, waitlist, feedback), landing page with waitlist, in-app feedback

**Before opening sign-ups**
- Password reset and email (invites are links you copy; resets mean editing `users.json`)
- Teams / shared workspaces (today each job belongs to one user)
- Payments (Razorpay for INR, Stripe for USD) wired to the plan/quota fields that already exist

**Infrastructure (when one server isn't enough)**
- Postgres instead of JSON files for jobs/users; object storage for videos
- A worker process (separate from the web server) consuming a durable queue, with GPU OCR; rate limits shared across processes

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
│   │   ├── auth.ts                 # Signed session cookies (Web Crypto)
│   │   ├── access.ts               # requireUser / requireAdmin / requireJobAccess for routes
│   │   ├── users.ts, invites.ts    # Accounts and single-use invites (JSON in WORKSPACE)
│   │   ├── usage.ts                # Append-only minutes ledger + monthly quota
│   │   └── editor/                 # Undo history, font sizing, preview fonts
│   ├── proxy.ts                    # Session + CSRF gate (Next 16's renamed middleware)
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
- Standard mode translates box by box, so it suits titles, labels and one-line captions. When one sentence is split across several boxes, use `--ai` so it is translated as a whole
- The editor preview approximates erasing (a translucent patch in the sampled background colour); the render does the real erase
- No sample videos are included — bring your own, and only process content you have the rights to

---

## Accounts

The app is invite-only by default. Signed-out visitors see the landing page at `/` (with a waitlist form); the app itself lives at `/app`.

- **First account = admin.** While there are no users, `/signup` needs no invite and the account it creates is the admin.
- **Invites.** On `/admin` the admin creates single-use invite codes (optionally locked to one email) and copies the `/signup?invite=CODE` link. `SIGNUP_MODE=open` lets anyone sign up instead.
- **Quotas.** Each upload is measured with ffprobe and counts against the uploader's monthly minutes (calendar month, UTC; `DEFAULT_MONTHLY_MINUTES`, default 60; admins are unlimited). An upload that would go over is refused with a 402. Usage is an append-only ledger, so deleting a video doesn't give minutes back. The admin can change a user's quota or disable the account on `/admin`.
- **Ownership.** Members see only their own videos; admins see everyone's. Jobs created before accounts existed (no owner) are visible to admins only.
- **Feedback.** "Send feedback" in the account menu and "Report a problem with this video" on a video card land on `/admin` → Feedback.

Everything is stored as JSON next to the jobs: `<WORKSPACE>/users.json`, `invites.json`, `usage.json`, `waitlist.json`, `feedback.json`. To reset a forgotten admin password, delete that user from `users.json` (or the whole file to start over with a new first admin).

## Running it for other people

**Running a pilot?** [docs/PILOT.md](docs/PILOT.md) has the launch checklist (server, HTTPS, systemd, backups), an invite message, a guide for testers and what to track each week.

On any Linux box or VM with ffmpeg, Node and Python:

```bash
./setup.sh                      # also writes a random SESSION_SECRET into .env
cd loomv2 && npm run build
WORKSPACE_DIR=/var/lib/onscreen-translate npm run start:public
```

`start:public` listens on all interfaces, so it **refuses to start without a `SESSION_SECRET`** of at least 32 characters (in the environment or the repo-root `.env`, which the app also reads). Then open the site and create the admin account straight away — until someone does, anyone who reaches `/signup` can claim it. Put HTTPS in front of it (Caddy, nginx, or a tunnel like Cloudflare Tunnel); session cookies get the `Secure` flag when the request arrives over HTTPS or with `X-Forwarded-Proto: https`. `GET /api/health` is an unauthenticated liveness check. All settings are listed in `.env.example`.

It's a single-process app: the job queue, rate limits and JSON stores assume one server instance.

## Tests

**Check a real setup end to end** (your keys, the real providers, a generated demo video, OCR → translate → erase render):

```bash
cd scripts && .venv/bin/python selftest.py            # add --lang ta-IN, --ai to test OpenAI mode
.venv/bin/python selftest.py --mock                    # offline: built-in fake Sarvam, no key needed
```

It prints a pass/fail line per step and leaves `workspace/selftest/output.mp4` and `before_after.png` to look at. If Sarvam rejects the key or can't be reached, translation jobs now fail with that reason instead of finishing with English text.

**Unit tests and type checks:**

```bash
cd scripts && .venv/bin/python -m unittest test_pipeline -v   # script splitting, shaping, dedupe, cache keys
cd loomv2 && npx tsc --noEmit && npm run lint
```

## Security

Every page except the landing, sign-in and sign-up pages, and every API route except `health`, `login`, `logout`, `signup`, `waitlist` and `fonts`, needs a signed-in account.

- **Sessions** are an `ot_session` cookie (`HttpOnly`, `SameSite=Lax`, 14 days): `{uid, exp}` signed with HMAC-SHA256 using `SESSION_SECRET`. Without one (local dev), a random secret is generated once into `<WORKSPACE>/.session_secret`. Changing the secret signs everyone out.
- **Two layers.** `loomv2/proxy.ts` rejects requests without a valid, unexpired cookie. Each route handler then calls `lib/access.ts` (`requireUser` / `requireAdmin` / `requireJobAccess`), which loads the user, rejects disabled accounts and checks job ownership. Someone else's job is a 404, not a 403. `/api/upload` and `/api/detections` skip the proxy, because Next truncates proxied request bodies at 10 MB, so those two routes rely on their own checks.
- **Passwords** are scrypt hashes with a per-user salt, compared in constant time; hashes never leave the server.
- **CSRF.** State-changing requests whose `Sec-Fetch-Site` / `Origin` isn't this site get a 403, both in the proxy and in the route helpers.
- **Rate limits** (in memory, per process): sign-in per IP + email, per IP and per email; sign-up and waitlist per IP; feedback per user. Behind a reverse proxy, make sure it sets `X-Forwarded-For`.

`npm run dev` / `npm start` still bind to `127.0.0.1`; use `start:public` to listen on a network.

---

## License

[MIT](LICENSE). The bundled Noto fonts are under the [SIL Open Font License](scripts/assets/OFL.txt).
