# Running a pilot

A checklist for putting TransEdit in front of your first testers, a guide you can send them, and what to look at each week.

---

## 1. Launch checklist (you, once)

**Server.** One Linux VM is enough for a pilot: 4 vCPU, 8 GB RAM, 40 GB disk (videos add up; see retention below). Ubuntu 22.04+ with:

```bash
sudo apt install -y ffmpeg python3-venv git
```

Then Node.js 20+ (for example from nodesource).

**Install.**

```bash
git clone https://github.com/wlbs-dev/onscreen-translate && cd onscreen-translate
./setup.sh
```

`setup.sh` creates `.env` with a random `SESSION_SECRET`. Add your keys to it:

```
SARVAM_API_KEY=...
OPENAI_API_KEY=...        # optional, enables "Use AI" mode
JOB_RETENTION_DAYS=30     # delete videos after a month
DEFAULT_MONTHLY_MINUTES=60
APP_URL=https://transedit.yourdomain.com
SMTP_URL=smtps://user:pass@smtp.resend.com:465   # optional, see below
MAIL_FROM=TransEdit <hello@yourdomain.com>
```

**Email (optional, recommended).** With `SMTP_URL` set, invites, password resets and "your video is ready" emails are sent for you; any SMTP provider works (Resend, Amazon SES, Postmark, Gmail with an app password). Without it nothing breaks: each message lands in `WORKSPACE_DIR/outbox/` as a JSON file and you forward the link yourself. Always set `APP_URL` to the public address, since links in emails are built from it.

**Payments (optional).** For a free pilot leave them off and set plans by hand in **Admin → Teams**. To charge, see the Payments section of the README (Razorpay for ₹, Stripe for $; set up the webhook before the first customer).

**Prove it works with your real keys** before anyone else sees it:

```bash
cd scripts && .venv/bin/python selftest.py --lang hi-IN
.venv/bin/python selftest.py --lang hi-IN --ai     # if you set OPENAI_API_KEY
```

Both should end in `PASSED`. Open `workspace/selftest/before_after.png` and check the result looks right to you, then try a language you read well (`--lang mr-IN`, `ta-IN`, …).

**Run it behind HTTPS.** Build once, run with a process manager, put Caddy in front for automatic certificates:

```bash
cd loomv2 && npm run build
```

`/etc/systemd/system/transedit.service`:

```ini
[Unit]
Description=TransEdit
After=network.target

[Service]
WorkingDirectory=/home/ubuntu/onscreen-translate/loomv2
Environment=PORT=3000
Environment=WORKSPACE_DIR=/var/lib/transedit
ExecStart=/usr/bin/npm run start:public
Restart=always
User=ubuntu

[Install]
WantedBy=multi-user.target
```

`/etc/caddy/Caddyfile`:

```
transedit.yourdomain.com {
    reverse_proxy 127.0.0.1:3000
}
```

```bash
sudo mkdir -p /var/lib/transedit && sudo chown ubuntu /var/lib/transedit
sudo systemctl enable --now transedit caddy
sudo ufw allow 22,80,443/tcp && sudo ufw enable     # keep port 3000 private
```

**Create your admin account immediately.** Until the first account exists, whoever opens `/signup` becomes admin. Visit `https://transedit.yourdomain.com/signup` straight after the first start.

**Back up** `WORKSPACE_DIR` (users, invites, feedback, jobs, videos), for example a nightly `rsync` or disk snapshot. `GET /api/health` is an unauthenticated liveness check for uptime monitoring.

---

## 2. Inviting testers

In **Admin → Invites**, create one invite per tester. Lock it to their email and, with email set up, it's sent for you; otherwise copy the link and send it yourself (the message below). Each link works once. Every tester gets their own team ("Asha's team"); adjust its plan or monthly minutes in **Admin → Teams** if they need more.

Testers who work with colleagues invite them from **Team** in the account menu: their colleagues join the same team, see and edit the same videos and share its minutes. You don't need to create invites for those.

If someone forgets their password, they click **Forgot password?** on the sign-in page and get a reset link by email. Without email set up (or if it doesn't arrive): **Admin → Users → Reset link**, and send them the link (single use, 24 hours). Either way it signs them out everywhere else.

### Invite message (copy and edit)

> Hi {name},
>
> I'm building TransEdit: it finds the English text burned into a video (titles, slide text, labels, lower-thirds), translates it into Hindi, Marathi, Tamil and 7 more Indian languages, and puts it back in place, erasing the original. You review every line in an editor before you download.
>
> I'd love you to try it on 2–3 of your real videos over the next two weeks and tell me what breaks:
>
> {invite link}
>
> It works best on slides, explainers and ads with clear on-screen text. There's a "Send feedback" button in the menu (top right). Every report helps.
>
> Thank you!

---

## 3. Guide for testers (send with the invite, or paste into a doc)

1. **Upload** a video (MP4, MOV, MKV, WebM; up to 500 MB) and pick the language. *Start Processing* translates each text box on its own; **Use AI** translates whole sentences that are split across several boxes. Try both if one reads oddly.
2. **Open the video** from your dashboard when it's done. Each piece of text is a clip on the timeline and a box on the video.
3. **Check every box.** Click it to fix the wording, move or resize it, change timing, size, colour or bold. *Original text: Erase it* removes the English and rebuilds the background (the default); *Cover with box* puts a flat patch behind your text instead, which can look cleaner on busy backgrounds.
4. **Render**, then **Download**. Edit and *Render again* as often as you like.
5. **Working with colleagues?** Invite them from **Team** in the menu (top right). They'll see and edit the same videos, and you'll get an email when a video is ready (turn that off in the same menu).
6. **Report anything odd** with *Report a problem with this video* in the video's menu: wrong translations, text that wasn't found, smudges where text was erased, timing that's off.

Press **?** in the editor for keyboard shortcuts (space to play, Ctrl+Z to undo, Alt+arrows to nudge timing).

**Known limitations right now:** erasing over busy photos or moving footage can leave a soft smudge; handwritten or heavily stylised text may not be detected; one shared font family (Noto Sans) is used for every language.

---

## 4. Each week

- **Admin → Feedback**: read everything, reply to testers personally, open the linked videos to see what they saw.
- **Admin → Teams** and **Admin → Users**: minutes used per team and per tester. Who is actually using it, and who invited colleagues?
- Track for each tester video: **how many minutes of editing per minute of video** (the number to drive down), how many boxes needed fixing and why (OCR miss, translation, erase quality, layout), and whether they'd pay for it.
- Re-run `selftest.py` after every deploy.
