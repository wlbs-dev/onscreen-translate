import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../../../lib/auth"
import { crossSiteBlocked } from "../../../lib/access"
import { hashPassword } from "../../../lib/password"
import { consumeReset, findReset } from "../../../lib/resets"
import { getUserById, updateUser } from "../../../lib/users"
import { clientIp, consume } from "../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST {token, password}: set a new password from a reset link, sign in. */
export async function POST(req: NextRequest) {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked
  const limit = consume(`reset:${clientIp(req)}`, 20, 15 * 60 * 1000)
  if (!limit.ok) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const token = typeof body?.token === "string" ? body.token : ""
  const password = typeof body?.password === "string" ? body.password : ""
  if (password.length < 8 || password.length > 1024) {
    return NextResponse.json({ error: "Use at least 8 characters" }, { status: 400 })
  }
  const reset = findReset(token)
  const user = reset ? getUserById(reset.userId) : undefined
  if (!reset || !user) {
    return NextResponse.json({ error: "This reset link is invalid, used or expired. Request a new one from the sign-in page." }, { status: 400 })
  }
  if (user.disabled) return NextResponse.json({ error: "This account has been disabled." }, { status: 403 })

  const passwordHash = await hashPassword(password)
  if (!consumeReset(token)) {
    return NextResponse.json({ error: "This reset link was just used. Request a new one from the sign-in page." }, { status: 400 })
  }
  // Every session issued before now (e.g. on a lost laptop) stops working
  updateUser(user.id, { passwordHash, sessionsValidAfter: Date.now() })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions(req))
  return res
}
