import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Liveness probe for load balancers / container platforms (no auth)
export function GET() {
  return NextResponse.json({ ok: true })
}
