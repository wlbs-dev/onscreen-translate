import { NextRequest, NextResponse } from "next/server"
import { SESSION_COOKIE } from "../../../lib/auth"
import { crossSiteBlocked } from "../../../lib/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(SESSION_COOKIE)
  return res
}
