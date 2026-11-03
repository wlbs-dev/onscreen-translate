import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../lib/access"
import { listWaitlist } from "../../../../lib/waitlist"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const entries = listWaitlist().sort((a, b) => b.createdAt - a.createdAt)
  return NextResponse.json({ entries })
}
