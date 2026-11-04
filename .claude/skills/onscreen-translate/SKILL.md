---
name: onscreen-translate
description: Work on the onscreen-translate pipeline — OCR on-screen English text in a video, translate it into one of 10 Indian languages (Sarvam AI / OpenAI), and burn the translations back in, with a Next.js editor (loomv2/) for reviewing overlays. Use when changing the Python scripts in scripts/, the loomv2 API routes or editor components, the job store, or when running/debugging a job end to end.
---

# onscreen-translate

Video → **OCR** → **Translate** → **Render** → output.mp4, driven from a Next.js UI.

## Layout

| Path | What it is |
|---|---|
| `scripts/ocr_annotate.py` | Converts the upload in place to H.264/AAC MP4 if the browser can't play it (`media.py`), ffmpeg frame extraction (default 2 fps) to `_frames/`, skips frames identical to the last OCR'd keyframe (`--no-dedupe` to disable), RapidOCR (PP-OCRv6 ONNX models bundled in the `rapidocr` wheel, no downloads) in a multiprocessing pool; groups words into line blocks; records `autoBgColor` / `autoTextColor` per block; drops lines without Latin letters; writes annotated JPGs to `annotated_frames/` + `ocr_detections.json` |
| `scripts/translate_detections.py` | Segments frames into scene "buckets", translates each block via Sarvam `mayura:v1` into `--target-lang` (default `mr-IN`); `--ai` groups/translates with OpenAI (`OPENAI_MODEL`) first and falls back to Sarvam |
| `scripts/render_translations.py` | Builds an overlay timeline, per event either erases the original text (`erase.py`: median-blur text mask unioned over the span — or a colour mask from the text's fill on busy textures; static → real background copied from neighbouring frames where the text is absent (`find_clean_background`), else `cv2.inpaint` clean plate; moving → `_inpaint_clip` decodes the region, inpaints the stable stroke mask per frame, writes an FFV1 clip overlaid with `-itsoffset`; ffmpeg `delogo` is the last fallback) or draws a flat box (`cover: "box"`, or any explicit `bgColor`); text is drawn with Pillow + raqm in per-script runs with Noto fonts; one ffmpeg pass composites everything with timed `overlay` filters (in yuv444) and encodes |
| `scripts/erase.py`, `scripts/colors.py`, `scripts/media.py` | Text erasing, shared colour rules (mirror: `loomv2/lib/editor/colors.ts`), upload conversion |
| `scripts/languages.py` | Supported target languages → name + font. Mirror: `loomv2/lib/languages.ts` (picker) and `loomv2/lib/editor/indicFonts.ts` (preview fonts) |
| `scripts/cache/translation_cache.json` | `<lang>:md5(text)` → translation cache (legacy unprefixed keys = Marathi), created at runtime and gitignored. Delete it to force re-translation |
| `loomv2/` | Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui editor |
| `loomv2/lib/jobPaths.ts` | `WORKSPACE`, `SCRIPTS_DIR`, per-job file paths, `getPython()` (prefers `scripts/.venv`) |
| `loomv2/lib/jobStore.ts` | File-backed job state: `<WORKSPACE>/jobs/<id>.json`, one `JobStatus` per stage (`ocr`/`translate`/`render`) |
| `loomv2/lib/runScript.ts` | Queue (`MAX_CONCURRENT_JOBS`, default 1, state on `globalThis`) + spawner: streams stdout/stderr into the job log (batched every 400 ms, capped at 500 lines), parses `PROGRESS:0.42` lines, `cancelJob()` kills a job's runs |
| `loomv2/lib/auth.ts`, `loomv2/proxy.ts` | Signed `ot_session` cookie (`{uid, exp}` + HMAC, `SESSION_SECRET` or generated `<WORKSPACE>/.session_secret`). `proxy.ts` (Next 16's renamed `middleware.ts`, Node runtime) checks signature/expiry + CSRF only |
| `loomv2/lib/access.ts` | `requireUser` / `requireAdmin` / `requireTeam(req, {owner?})` / `requireJobAccess(req, jobId)` — every route handler must call one: loads the user (and lazily gives pre-teams users a personal team), rejects disabled accounts, CSRF-checks mutations, 404s jobs outside the user's teams (admins see all; jobs with neither `teamId` nor `ownerId` are admin-only). `activeTeam()` = `ot_team` cookie if still a member, else the first team |
| `loomv2/lib/teams.ts` | `teams.json`: `Team {id, name, plan, monthlyMinutes, members[{userId, role: owner\|member}], billing?}`. Every user has ≥1 team; a team keeps ≥1 owner. `ensureUserTeam` migrates pre-teams users (`migratedFromUser`); `jobTeamId()` in access.ts migrates jobs (owner's team) |
| `loomv2/lib/users.ts`, `invites.ts`, `usage.ts`, `resets.ts`, `waitlist.ts`, `feedback.ts` | JSON stores in `WORKSPACE` (atomic writes via `jsonFile.ts`). Invites with `teamId` are team invites (email-locked; join that team instead of a personal one). `usage.json` is an append-only minutes ledger (`teamId`; legacy entries count for the user's migrated team) checked against the active team's `monthlyMinutes` on upload (402 when over; admin-owned teams unlimited) |
| `loomv2/lib/mail.ts`, `notify.ts` | nodemailer over `SMTP_URL`/`MAIL_FROM`; unset → JSON files in `<WORKSPACE>/outbox/` (tests read these). `appUrl(req)` = `APP_URL` or the request origin. `sendMail` never throws. `runScript` calls `notifyStageDone` on translate/render success (respects `User.emailNotifications`) |
| `loomv2/lib/plans.ts`, `lib/billing/` | Plans (free/creator/pro/pilot) and prices. Razorpay + Stripe via `fetch` (`*_API_BASE` overridable), enabled by env vars; only webhooks (`/api/billing/{razorpay,stripe}/webhook`: HMAC over the raw body, idempotent via `billing_events.json`, outside proxy + CSRF) change a team's plan |
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

- `GET health`, `POST login|logout|signup|forgot|reset|waitlist`, `GET fonts?file=` (bundled Noto fonts), billing webhooks — the only routes without a session
- `GET/PATCH me` (active team, teams, team `minutesUsed`/`minutesQuota` — null = unlimited; PATCH `emailNotifications`), `POST feedback`
- `GET/PATCH team`, `POST/DELETE team/invites`, `DELETE team/members` (remove or leave), `POST team/switch`, `POST team/accept` — owner-only actions 403 for members
- `GET billing`, `POST billing/checkout|cancel|portal` (owners), `POST billing/razorpay/webhook`, `POST billing/stripe/webhook`
- `GET/PATCH admin/users`, `GET/PATCH admin/teams`, `GET/POST/DELETE admin/invites`, `POST admin/users/reset`, `GET admin/waitlist`, `GET admin/feedback` — 404 for non-admins
- `upload` and `detections` are excluded from the proxy matcher (proxy truncates bodies > 10 MB); they rely on `requireUser`/`requireJobAccess`

Pages: `/` landing with pricing (signed-in → `/app`), `/app` (Dashboard ↔ Editor, `?job=<id>` opens the editor), `/app/team`, `/app/billing`, `/admin`, `/login`, `/forgot`, `/reset?token=`, `/signup?invite=` (signed in + team invite → Accept invite).

All long-running routes queue the script and return immediately (409 if that stage is already queued/running); the client polls the `status` endpoints (see `UploadModal.tsx`, `Dashboard.tsx`, `Editor.tsx`). Stage status is `pending | queued | running | done | error`.

## UI components (`loomv2/components/`)

`Dashboard` (job cards, retranslate dialog) → `Editor` (loads detections, builds `OverlayEvent`s, saves, triggers render), which composes `VideoPlayer` + `OverlayCanvas` (drag/resize boxes), `Timeline` (multi-lane, 2 s gap buffer, ctrl+scroll zoom) and `Sidebar` (event list + text/color/font editor). `UploadModal` chains upload → OCR → translate.

## Running

```bash
# Everything at once (venv, npm, .env, tests)
./setup.sh

# Or by hand — Python (from scripts/)
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt     # rapidocr + onnxruntime, Pillow (with raqm); ffmpeg must be on PATH

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
- Email: leave `SMTP_URL` unset and read `<WORKSPACE>/outbox/*.json`. Payments: set the provider env vars with `RAZORPAY_API_BASE` / `STRIPE_API_BASE` pointing at a tiny local mock, and sign webhook bodies yourself (Razorpay: hex HMAC-SHA256(body, `RAZORPAY_WEBHOOK_SECRET`) in `X-Razorpay-Signature`; Stripe: `t=<unix>,v1=<hex HMAC-SHA256("t.body", STRIPE_WEBHOOK_SECRET)>` in `Stripe-Signature`).
- OCR works offline (models are in the wheel). A test video with text: `ffmpeg -f lavfi -i color=c=0x1e3a8a:s=1280x720:r=25:d=8 -vf "drawtext=fontfile=scripts/assets/NotoSansDevanagari-Regular.ttf:text='Welcome':fontsize=64:fontcolor=white:x=120:y=200" -pix_fmt yuv420p in.mp4`
- Unit tests: `cd scripts && .venv/bin/python -m unittest test_pipeline -v`

## Gotchas

- `WORKSPACE` defaults to `process.cwd()/../workspace` (i.e. the server must run from `loomv2/`). Override with `WORKSPACE_DIR` / `SCRIPTS_DIR`.
- **Scripts must run with `cwd = scripts/`.** The renderer loads `assets/NotoSansDevanagari-Regular.ttf` by relative path.
- Long-running stages go through `runScript`; scripts report progress with `PROGRESS:0.42` lines or a `parseProgress` hook (render matches `N/M frames done`).
- Job ids are UUIDs. Anything that builds a path from a request id must go through `isValidJobId` / `jobPaths()` (which throws on bad ids).
- New API routes must call `requireUser`/`requireAdmin`/`requireTeam`/`requireJobAccess` from `lib/access.ts` — the proxy only proves the cookie is signed, not that the user still exists, is enabled, or is in the job's team. Return 404 (not 403) for other teams' jobs. Never send `passwordHash` (use `toPublicUser`). Plan/quota live on the team, not the user (`User.plan`/`monthlyMinutes` are legacy, read only by the migration).
- Mail: never `await` a send where timing could leak whether an account exists (`/api/forgot`), never log bodies (they hold reset/invite links). Payments: never change a plan outside a verified webhook handler; new webhook routes must be added to `WEBHOOK_PATHS` and the matcher exclusion in `proxy.ts`.
- `dev`/`start` bind to `127.0.0.1`; `start:public` binds `0.0.0.0` and refuses to start without a 32+ char `SESSION_SECRET`. `next.config.ts` also loads the repo-root `.env`. The first `/signup` with zero users becomes admin.
- The renderer samples cover-patch colours from the raw frame `_frames/{frame_index+1:06d}.jpg`, not the annotated `frame_path` (which has boxes drawn on it).
- Never load the OCR model only inside a `Pool` initializer: if it fails there the pool respawns workers forever. `ocr_annotate.py` loads it once in the parent first.
- Adding a language: update `scripts/languages.py`, `loomv2/lib/languages.ts`, and (for a new script) add the font to `scripts/assets/` and `loomv2/lib/editor/indicFonts.ts`.
- Overlay identity across frames is `text_key()` (letters/digits only) in the renderer and translator, mirrored by `textKey()` in `Editor.tsx`. Change them together.
- Detections JSON block fields the editor may write: `bgColor`, `textColor`, `fontSize`, `cover` (`erase`|`box`), `bold` — all optional, empty = auto. `autoBgColor`/`autoTextColor`/`autoBold` come from OCR and must be passed through (`PASSTHROUGH_FIELDS` in translate, `eventsToFrames` in the editor).
- Bold: `erase.is_bold()` compares stroke width (distance transform) to the ink height. Indic bold fonts live in `scripts/assets/bold/` and have no Latin, so bold Latin runs use `bold/NotoSans-Bold.ttf` (`script_runs(text, bold=True)`); the editor mirrors this with an `OTLatin` 700-weight face in `lib/editor/indicFonts.ts`.
- `scripts/selftest.py` (`--mock` offline) is the end-to-end check; run it after pipeline changes.
- `render_translations.py`: validate colors from the editable JSON with `HEX_COLOR_RE`. Pillow has no font fallback — new scripts need a range in `SCRIPT_RANGES`. Keep text padding (`TEXT_PAD_X`, `PATCH_SLACK`) in sync with `OverlayCanvas.tsx`.
- Never commit videos, `.env`, or `scripts/cache/` (all gitignored). The repo is public.
- `loomv2/AGENTS.md`: this Next.js version has breaking changes. Check `node_modules/next/dist/docs/` before using Next APIs.
