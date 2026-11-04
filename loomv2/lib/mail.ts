// lib/mail.ts — outgoing email.
//
// With SMTP_URL set (e.g. smtps://user:pass@smtp.resend.com:465) messages go
// out through nodemailer, so any SMTP provider works (Resend, SES, Postmark,
// Gmail …). Without it nothing fails: each message is written as JSON to
// <WORKSPACE>/outbox/<timestamp>-<id>.json, which is also how tests read mail.
//
// sendMail() never throws and never logs message bodies (they contain reset
// and invite links) or the SMTP URL (it contains the password).
import fs from "fs"
import path from "path"
import { randomBytes } from "crypto"
import nodemailer, { type Transporter } from "nodemailer"
import { WORKSPACE } from "./workspace"

export const BRAND = "TransEdit"

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export const OUTBOX_DIR = path.join(WORKSPACE, "outbox")

export function mailConfigured(): boolean {
  return !!process.env.SMTP_URL?.trim()
}

function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || `${BRAND} <no-reply@localhost>`
}

const g = globalThis as unknown as { __otMail?: { url: string; transport: Transporter } }

function transport(): Transporter {
  const url = process.env.SMTP_URL!.trim()
  if (g.__otMail?.url !== url) g.__otMail = { url, transport: nodemailer.createTransport(url) }
  return g.__otMail.transport
}

/**
 * Public base URL for links in emails: APP_URL, else the request's origin.
 * Set APP_URL in production — otherwise a forged Host header decides where
 * a reset link points.
 */
export function appUrl(req?: Request): string {
  const fromEnv = process.env.APP_URL?.trim().replace(/\/+$/, "")
  if (fromEnv) return fromEnv
  if (!req) return "http://localhost:3000"
  const url = new URL(req.url)
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(/:$/, "")
  const host = req.headers.get("x-forwarded-host")?.split(",")[0].trim() || req.headers.get("host") || url.host
  return `${proto}://${host}`
}

/** Send (or, without SMTP_URL, write to the outbox). Resolves false on failure; never rejects. */
export async function sendMail(msg: MailMessage): Promise<boolean> {
  try {
    if (!mailConfigured()) {
      fs.mkdirSync(OUTBOX_DIR, { recursive: true })
      const file = `${Date.now()}-${randomBytes(4).toString("hex")}.json`
      fs.writeFileSync(path.join(OUTBOX_DIR, file), JSON.stringify({ ...msg, from: mailFrom(), at: Date.now() }, null, 2), { mode: 0o600 })
      console.log(`[mail] SMTP_URL not set — wrote "${msg.subject}" for ${msg.to} to outbox/${file}`)
      return true
    }
    await transport().sendMail({ from: mailFrom(), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html })
    console.log(`[mail] sent "${msg.subject}" to ${msg.to}`)
    return true
  } catch (err) {
    // Error messages from nodemailer don't include the SMTP password
    console.error(`[mail] could not send "${msg.subject}" to ${msg.to}: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}

// ── Templates ────────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

interface Content {
  subject: string
  greeting: string
  paragraphs: string[]
  button?: { label: string; url: string }
  footnote?: string
}

function render(to: string, c: Content): MailMessage {
  const text = [
    c.greeting,
    "",
    ...c.paragraphs.flatMap((p) => [p, ""]),
    ...(c.button ? [`${c.button.label}: ${c.button.url}`, ""] : []),
    ...(c.footnote ? [c.footnote, ""] : []),
    `— ${BRAND}`,
  ].join("\n")

  const p = (s: string) => `<p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#334155">${esc(s)}</p>`
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:24px 28px 8px;font-size:16px;font-weight:700;color:#0f172a">${BRAND}</td></tr>
<tr><td style="padding:8px 28px 20px">
${p(c.greeting)}
${c.paragraphs.map(p).join("\n")}
${c.button ? `<p style="margin:22px 0"><a href="${esc(c.button.url)}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${esc(c.button.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#64748b">Or paste this link into your browser:<br><a href="${esc(c.button.url)}" style="color:#475569;word-break:break-all">${esc(c.button.url)}</a></p>` : ""}
${c.footnote ? `<p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#64748b">${esc(c.footnote)}</p>` : ""}
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:11px;color:#94a3b8">${BRAND} · on-screen text localization for Indian languages</p>
</td></tr></table>
</body></html>`
  return { to, subject: c.subject, text, html }
}

export function inviteEmail(to: string, opts: { inviterName: string; teamName?: string; link: string }): MailMessage {
  const what = opts.teamName ? `join the team “${opts.teamName}” on ${BRAND}` : `try ${BRAND}`
  return render(to, {
    subject: opts.teamName ? `${opts.inviterName} invited you to ${opts.teamName} on ${BRAND}` : `You're invited to ${BRAND}`,
    greeting: "Hi,",
    paragraphs: [
      `${opts.inviterName} invited you to ${what}.`,
      `${BRAND} finds the English text burned into a video (titles, slides, labels), translates it into Indian languages and puts it back in place. You review every line before you export.`,
    ],
    button: { label: opts.teamName ? "Accept the invite" : "Create your account", url: opts.link },
    footnote: "This invite works once and only for this email address. If you weren't expecting it, you can ignore this email.",
  })
}

export function resetEmail(to: string, opts: { name: string; link: string }): MailMessage {
  return render(to, {
    subject: `Reset your ${BRAND} password`,
    greeting: `Hi ${opts.name},`,
    paragraphs: ["Someone (hopefully you) asked to reset the password for your account. Use the link below to choose a new one. Setting a new password signs you out everywhere else."],
    button: { label: "Choose a new password", url: opts.link },
    footnote: "The link works once and expires in 24 hours. If you didn't ask for this, ignore this email — your password stays the same.",
  })
}

export function welcomeEmail(to: string, opts: { name: string; teamName?: string; link: string }): MailMessage {
  return render(to, {
    subject: `Welcome to ${BRAND}`,
    greeting: `Hi ${opts.name},`,
    paragraphs: [
      opts.teamName ? `Your account is ready, and you're in “${opts.teamName}”.` : "Your account is ready.",
      "Upload a video with on-screen English text, pick a language, and we'll find, translate and re-render the text for you. You can fix every line in the editor before you download.",
    ],
    button: { label: "Open TransEdit", url: opts.link },
    footnote: "Reply to this email if anything is confusing — we read everything.",
  })
}

export function jobReadyEmail(to: string, opts: { name: string; jobLabel: string; link: string; kind: "review" | "render" }): MailMessage {
  const review = opts.kind === "review"
  return render(to, {
    subject: review ? `“${opts.jobLabel}” is ready to review` : `Your render of “${opts.jobLabel}” is ready`,
    greeting: `Hi ${opts.name},`,
    paragraphs: [review
      ? `We've found and translated the on-screen text in “${opts.jobLabel}”. Open it in the editor to check each line, then render.`
      : `The rendered video for “${opts.jobLabel}” is ready to download.`],
    button: { label: review ? "Review the video" : "Open and download", url: opts.link },
    footnote: "You can turn these emails off in the account menu.",
  })
}
