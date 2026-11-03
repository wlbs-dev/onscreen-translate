import { NextRequest, NextResponse } from "next/server"
import { crossSiteBlocked } from "../../../lib/access"
import { addToWaitlist } from "../../../lib/waitlist"
import { normalizeEmail } from "../../../lib/users"
import { clientIp, consume } from "../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "")

export async function POST(req: NextRequest) {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked

  const limit = consume(`waitlist:${clientIp(req)}`, 5, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many submissions from this network. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } }
    )
  }

  const body = await req.json().catch(() => ({}))
  // Honeypot: real visitors never see or fill this field
  if (str(body?.website, 200)) return NextResponse.json({ ok: true })

  const email = normalizeEmail(body?.email)
  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
  const name = str(body?.name, 100)
  if (!name) return NextResponse.json({ error: "Tell us your name" }, { status: 400 })

  addToWaitlist({
    email,
    name,
    organisation: str(body?.organisation, 200),
    useCase: str(body?.useCase, 2000),
  })
  return NextResponse.json({ ok: true })
}
