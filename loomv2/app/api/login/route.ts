import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE, SESSION_MAX_AGE, authEnabled, checkPassword, sessionToken } from "../../../lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  if (!authEnabled()) return NextResponse.json({ ok: true })

  const body = await req.json().catch(() => ({}))
  if (!(await checkPassword(body?.password))) {
    // Slow down guessing
    await new Promise((r) => setTimeout(r, 750))
    return NextResponse.json({ error: "Wrong password" }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  })
  return res
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
