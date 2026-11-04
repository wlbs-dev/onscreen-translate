import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../../../lib/auth"
import { crossSiteBlocked } from "../../../lib/access"
import { hashPassword } from "../../../lib/password"
import { DuplicateEmailError, createUser, listUsers, normalizeEmail } from "../../../lib/users"
import { getInvite, inviteProblem, markInviteUsed, signupMode } from "../../../lib/invites"
import { clientIp, consume, sleep } from "../../../lib/rateLimit"
import { appUrl, sendMail, welcomeEmail } from "../../../lib/mail"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MIN_PASSWORD = 8

export async function POST(req: NextRequest) {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked

  const limit = consume(`signup:${clientIp(req)}`, 10, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many sign-up attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    )
  }

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  const password = typeof body?.password === "string" ? body.password : ""
  const inviteCode = typeof body?.invite === "string" ? body.invite.trim() : ""

  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
  if (!name || name.length > 100) return NextResponse.json({ error: "Enter your name" }, { status: 400 })
  if (password.length < MIN_PASSWORD || password.length > 1024) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD} characters` }, { status: 400 })
  }

  // Cheap pre-check so a bad invite doesn't cost a password hash
  const firstCheck = signupProblem(email, inviteCode)
  if (firstCheck) {
    await sleep(300)
    return NextResponse.json({ error: firstCheck.error }, { status: firstCheck.status })
  }

  const passwordHash = await hashPassword(password)

  // Re-check and create with no await in between, so two signups can't both
  // become the bootstrap admin or share one invite
  const check = signupProblem(email, inviteCode)
  if (check) return NextResponse.json({ error: check.error }, { status: check.status })
  const bootstrap = listUsers().length === 0
  const invite = inviteCode ? getInvite(inviteCode) : undefined
  let user
  try {
    user = createUser({ email, name, passwordHash, role: bootstrap ? "admin" : "member" })
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 })
    }
    throw err
  }
  if (invite && !inviteProblem(invite, email)) markInviteUsed(invite.code, user.id)
  if (bootstrap) console.log(`[signup] first account ${email} created as admin`)
  void sendMail(welcomeEmail(user.email, { name: user.name, link: `${appUrl(req)}/app` }))

  const res = NextResponse.json({ ok: true, role: user.role })
  res.cookies.set(SESSION_COOKIE, await signSession(user.id), sessionCookieOptions(req))
  return res
}

function signupProblem(email: string, inviteCode: string): { error: string; status: number } | null {
  const users = listUsers()
  if (users.some((u) => u.email === email)) {
    return { error: "An account with this email already exists", status: 409 }
  }
  if (users.length === 0 || signupMode() === "open") return null
  if (!inviteCode) return { error: "Sign-up is invite-only. You need an invite code.", status: 403 }
  const problem = inviteProblem(getInvite(inviteCode), email)
  return problem ? { error: problem, status: 403 } : null
}
