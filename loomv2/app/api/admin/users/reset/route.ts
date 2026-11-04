import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../../lib/access"
import { getUserById } from "../../../../../lib/users"
import { createReset } from "../../../../../lib/resets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST {id} → a single-use reset link for that user (admin only). */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const body = await req.json().catch(() => ({}))
  const user = typeof body?.id === "string" ? getUserById(body.id) : undefined
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
  const { token, expiresAt } = createReset(user.id, admin.id)
  return NextResponse.json({ path: `/reset?token=${token}`, expiresAt, email: user.email })
}
