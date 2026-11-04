import { NextRequest, NextResponse } from "next/server"
import { crossSiteBlocked } from "../../../lib/access"
import { createReset } from "../../../lib/resets"
import { getUserByEmail, normalizeEmail } from "../../../lib/users"
import { appUrl, resetEmail, sendMail } from "../../../lib/mail"
import { clientIp, consume } from "../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Same body whether or not the account exists, so this can't be used to
// find out who has an account
const DONE = {
  ok: true,
  message: "If an account exists for that email, we've sent it a link to reset the password. Check your inbox (and spam folder).",
}

/** POST {email}: email a single-use reset link to an existing, enabled account. */
export async function POST(req: NextRequest) {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked

  const ip = consume(`forgot-ip:${clientIp(req)}`, 10, 15 * 60 * 1000)
  if (!ip.ok) {
    return NextResponse.json(
      { error: "Too many requests. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(ip.retryAfterSec) } }
    )
  }

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })

  // Per-address limit: at most 3 emails an hour. Over it we still answer the
  // same way (the limit applies whether or not the account exists).
  const perEmail = consume(`forgot-email:${email}`, 3, 60 * 60 * 1000)
  const user = getUserByEmail(email)
  if (perEmail.ok && user && !user.disabled) {
    const { token } = createReset(user.id, "self")
    const link = `${appUrl(req)}/reset?token=${token}`
    // Not awaited: the response time mustn't depend on whether we sent mail
    void sendMail(resetEmail(user.email, { name: user.name, link }))
  }
  return NextResponse.json(DONE)
}
