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

**Done:** 10 target languages with a picker · duplicate-frame skipping in OCR · undo/redo · keyboard shortcuts · clip snapping · multi-select · auto font size · render queue · restart recovery · job retention (`JOB_RETENTION_DAYS`) · RapidOCR + single-pass ffmpeg render (no browser, ~5x faster renders) · real text erasing with original text colour · per-block standard translation · automatic conversion of MOV/MKV/WebM/HEVC uploads · bold text matched automatically · password reset links (admin-issued or emailed) · `selftest.py`

**OCR + Translation**
- Erasing on busy textures and moving backgrounds is the weakest case (inpainting smears, delogo blurs) — a learned inpainting model (e.g. LaMa via ONNX) would fix most of it
- Cache invalidation UI — right now you have to manually delete the cache file
- Translate into several languages from one OCR pass

**Accounts + pilot (done):** invite-only accounts, teams with shared videos, per-team monthly minute quotas, admin page (users, teams, invites, waitlist, feedback), landing page with waitlist and pricing, in-app feedback, email (invites, password reset, "your video is ready"), payments (Razorpay for INR, Stripe for USD)

**Before opening sign-ups**
- Plan changes without cancelling first (Razorpay plan switch; Stripe already allows it in its portal), proration, invoices/GST details on the billing page
- Team roles beyond owner/member, transferring ownership, deleting a team
- Email verification for open sign-ups (`SIGNUP_MODE=open`)

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
│   │   ├── users.ts, invites.ts    # Accounts and single-use (team) invites (JSON in WORKSPACE)
│   │   ├── teams.ts                # Teams, members, plan + billing state, lazy migration
│   │   ├── usage.ts                # Append-only minutes ledger + per-team monthly quota
│   │   ├── mail.ts, notify.ts      # SMTP email (outbox fallback), templates, "video ready" emails
│   │   ├── plans.ts                # Plans and prices (free / creator / pro / pilot)
│   │   ├── billing/                # Razorpay + Stripe REST clients, webhooks, idempotency
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
- **Invites.** On `/admin` the admin creates single-use invite codes (optionally locked to one email, in which case it's also emailed) and copies the `/signup?invite=CODE` link. `SIGNUP_MODE=open` lets anyone sign up instead.
- **Teams.** Every user is in at least one team; videos, minutes and the plan belong to the team. Signing up with an admin invite creates a personal team ("Asha's team") with you as owner. On **`/app/team`** the owner renames the team, invites people by email (single-use, locked to that address; emailed when SMTP is set up, otherwise shown as a link to copy), revokes invites and removes members; members can leave (but not their only team, and a team always keeps one owner). Signing up with a team invite joins that team instead of creating one; someone who already has an account opens the link while signed in and clicks **Accept invite**. With more than one team, the account menu has a team switcher (the active team is the `ot_team` cookie, re-checked against membership on every request).
- **Who sees what.** Members of a team see and edit all of its videos (the card says who uploaded it). Anyone outside the team gets a 404. Removing a member takes their access away immediately. Admins see every video. Jobs created before accounts existed (no owner) are visible to admins only.
- **Quotas.** Each upload is measured with ffprobe and counts against the active team's monthly minutes (calendar month, UTC). New teams get `DEFAULT_PLAN` (default `pilot`) with `DEFAULT_MONTHLY_MINUTES` (default 60); paid plans set their own (see [Payments](#payments)). Teams owned by an admin are unlimited. An upload that would go over is refused with a 402 and a link to `/app/billing`. Usage is an append-only ledger, so deleting a video doesn't give minutes back. The admin changes a team's plan and quota on `/admin` → Teams, and disables accounts on `/admin` → Users.
- **Forgot password.** "Forgot password?" on `/login` emails a single-use reset link (24 hours; same answer whether or not the account exists; rate-limited per IP and per address). Admins can still create a link by hand: `/admin` → Users → **Reset link**. Resetting signs the user out everywhere else.
- **Notifications.** The person who started it gets "your video is ready to review" when OCR + translation finish and "your render is ready" when a render finishes. "Email me when videos are ready" in the account menu turns these off.
- **Feedback.** "Send feedback" in the account menu and "Report a problem with this video" on a video card land on `/admin` → Feedback.

Everything is stored as JSON next to the jobs: `<WORKSPACE>/users.json`, `teams.json`, `invites.json`, `usage.json`, `password_resets.json`, `billing_events.json`, `waitlist.json`, `feedback.json`, plus `outbox/` when email isn't configured.

**Upgrading from before teams** needs nothing: the first time an existing user is loaded they get a personal team with their old plan and monthly minutes, their jobs move to it the first time they're opened or listed, and this month's usage keeps counting.

## Email

Set `SMTP_URL` and `MAIL_FROM` and the app sends mail through any SMTP provider (`smtps://user:pass@smtp.resend.com:465`, Amazon SES, Postmark, Gmail with an app password …). Also set **`APP_URL`** to the public address (`https://transedit.yourdomain.com`): links in emails use it, and without it they're built from the request's `Host` header, which a client can forge.

Without `SMTP_URL` nothing breaks: every message (invites, password resets, welcome, "your video is ready") is written to `<WORKSPACE>/outbox/<timestamp>-<id>.json` (`to`, `subject`, `text`, `html`) and one line is logged, so you can open the file and forward the link by hand. Tests read mail the same way. Sending never fails a request, and message bodies (which contain links) and the SMTP URL are never logged.

## Payments

Plans live in `loomv2/lib/plans.ts`: **Free** (₹0, 10 minutes a month), **Creator** (₹999 / $15 a month, 30 minutes), **Pro** (₹3,499 / $49 a month, 150 minutes). **Pilot** is only set by an admin, with any number of minutes. The landing page's pricing section and `/app/billing` read from that file.

Two providers, each switched on only when its variables are set (both can be on: customers in India pay in ₹ through Razorpay, others in $ through Stripe). No SDKs: plain `fetch` to their REST APIs.

- **Razorpay** (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_CREATOR`, `RAZORPAY_PLAN_PRO`). Create two monthly plans in the Razorpay dashboard and put their ids in the plan variables. Add a webhook to `https://<your domain>/api/billing/razorpay/webhook` with the events `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, and the same secret as `RAZORPAY_WEBHOOK_SECRET`.
- **Stripe** (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_CREATOR`, `STRIPE_PRICE_PRO`). Create two recurring monthly prices and put their ids in the price variables. Add a webhook endpoint to `https://<your domain>/api/billing/stripe/webhook` for `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted` and `invoice.paid`, and put its signing secret in `STRIPE_WEBHOOK_SECRET`. Turn on the customer portal in the Stripe dashboard for **Manage billing**.

How it works: on `/app/billing` the team owner picks a plan (members see it read-only). Upgrading creates a Razorpay subscription or a Stripe Checkout session and sends the browser to the provider's page. **Only webhooks change a team's plan**: coming back to the success URL proves nothing. Webhooks are verified with HMAC-SHA256 over the raw body (Stripe's signature must also be under 5 minutes old), processed once each (`billing_events.json`), and are the only routes outside the session/CSRF checks. A paid event sets the team's plan and minutes; cancelling (Razorpay: **Cancel subscription**, at the end of the cycle; Stripe: **Manage billing**) keeps the plan until the paid period ends, then drops the team to Free; a halted Razorpay subscription or a deleted Stripe one drops it at once. To switch plans, Stripe customers use the portal; Razorpay customers cancel and subscribe again when the period ends.

With no provider configured, the billing page says "Contact us to upgrade" and admins change plans by hand on `/admin` → Teams. `RAZORPAY_API_BASE` / `STRIPE_API_BASE` point the clients at a mock server for testing.

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

Every page except the landing, sign-in, sign-up, forgot-password and reset pages, and every API route except `health`, `login`, `logout`, `signup`, `forgot`, `reset`, `waitlist`, `fonts` and the two billing webhooks (which check the provider's signature instead), needs a signed-in account.

- **Sessions** are an `ot_session` cookie (`HttpOnly`, `SameSite=Lax`, 14 days): `{uid, exp}` signed with HMAC-SHA256 using `SESSION_SECRET`. Without one (local dev), a random secret is generated once into `<WORKSPACE>/.session_secret`. Changing the secret signs everyone out.
- **Two layers.** `loomv2/proxy.ts` rejects requests without a valid, unexpired cookie. Each route handler then calls `lib/access.ts` (`requireUser` / `requireAdmin` / `requireJobAccess`), which loads the user, rejects disabled accounts and checks that the job belongs to one of the user's teams. Another team's job is a 404, not a 403. `/api/upload` and `/api/detections` skip the proxy, because Next truncates proxied request bodies at 10 MB, so those two routes rely on their own checks.
- **Passwords** are scrypt hashes with a per-user salt, compared in constant time; hashes never leave the server.
- **CSRF.** State-changing requests whose `Sec-Fetch-Site` / `Origin` isn't this site get a 403, both in the proxy and in the route helpers.
- **Rate limits** (in memory, per process): sign-in per IP + email, per IP and per email; forgot-password per IP and per email; sign-up and waitlist per IP; feedback, team invites and checkout per user. Behind a reverse proxy, make sure it sets `X-Forwarded-For`.

`npm run dev` / `npm start` still bind to `127.0.0.1`; use `start:public` to listen on a network.

---

## License

[MIT](LICENSE). The bundled Noto fonts are under the [SIL Open Font License](scripts/assets/OFL.txt).
