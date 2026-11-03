import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../lib/access"
import { listUsers, toPublicUser, updateUser, type User } from "../../../../lib/users"
import { quotaMinutes, secondsUsedByUser, toMinutes } from "../../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const used = secondsUsedByUser()
  const users = listUsers()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((u) => ({
      ...toPublicUser(u),
      minutesUsed:  toMinutes(used.get(u.id) ?? 0),
      minutesQuota: quotaMinutes(u),
    }))
  return NextResponse.json({ users, me: admin.id })
}

/** PATCH {id, disabled?, monthlyMinutes?, plan?, role?} */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === "string" ? body.id : ""
  const patch: Partial<Pick<User, "disabled" | "monthlyMinutes" | "plan" | "role">> = {}

  if ("disabled" in body) {
    if (typeof body.disabled !== "boolean") return bad("disabled must be true or false")
    patch.disabled = body.disabled
  }
  if ("monthlyMinutes" in body) {
    const n = Number(body.monthlyMinutes)
    if (!Number.isFinite(n) || n < 0 || n > 100_000) return bad("Quota must be between 0 and 100000 minutes")
    patch.monthlyMinutes = Math.round(n * 100) / 100
  }
  if ("plan" in body) {
    if (typeof body.plan !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(body.plan)) return bad("Invalid plan")
    patch.plan = body.plan.toLowerCase()
  }
  if ("role" in body) {
    if (body.role !== "admin" && body.role !== "member") return bad("Invalid role")
    patch.role = body.role
  }
  if (id === admin.id && (patch.disabled === true || patch.role === "member")) {
    return bad("You can't disable or demote your own account")
  }

  const user = updateUser(id, patch)
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
  return NextResponse.json({ user: toPublicUser(user) })
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
