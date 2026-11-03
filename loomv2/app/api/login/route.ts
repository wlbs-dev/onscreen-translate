import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../../../lib/auth"
import { crossSiteBlocked } from "../../../lib/access"
import { verifyPassword } from "../../../lib/password"
import { getUserByEmail, normalizeEmail } from "../../../lib/users"
import { clientIp, consume, reset, sleep } from "../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const WINDOW_MS = 15 * 60 * 1000

export async function POST(req: NextRequest) {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(body?.email) ?? ""
  const password = typeof body?.password === "string" ? body.password : ""
  if (!email || !password || password.length > 1024) {
    return NextResponse.json({ error: "Enter your email and password" }, { status: 400 })
  }

  const ip = clientIp(req)
  const pairKey = `login:${ip}:${email}`
  const limits = [
    consume(pairKey, 10, WINDOW_MS),
    consume(`login-ip:${ip}`, 50, WINDOW_MS),
    consume(`login-email:${email}`, 30, WINDOW_MS),
  ]
  const limited = limits.find((l) => !l.ok)
  if (limited) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    )
  }

  const user = getUserByEmail(email)
  const ok = await verifyPassword(password, user?.passwordHash)
  if (!ok || !user) {
    await sleep(500) // slow down guessing
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 })
  }
  if (user.disabled) {
    return NextResponse.json({ error: "This account has been disabled. Contact the admin." }, { status: 403 })
  }

  reset(pairKey)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions(req))
  return res
}
