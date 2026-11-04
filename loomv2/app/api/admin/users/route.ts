import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../lib/access"
import { listUsers, toPublicUser, updateUser, type User } from "../../../../lib/users"
import { ensureUserTeam, memberRole } from "../../../../lib/teams"
import { secondsUsedByUser, toMinutes } from "../../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const used = secondsUsedByUser()
  const users = listUsers()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((u) => {
      // Plan and quota live on teams now (Teams tab); legacy users are migrated here
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { plan, monthlyMinutes, ...pub } = toPublicUser(u)
      return {
        ...pub,
        minutesUsed: toMinutes(used.get(u.id) ?? 0),
        teams: ensureUserTeam(u).map((t) => ({ id: t.id, name: t.name, role: memberRole(t, u.id) })),
      }
    })
  return NextResponse.json({ users, me: admin.id })
}

/** PATCH {id, disabled?, role?} — plan and minutes are per team: PATCH /api/admin/teams */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin

  const body = await req.json().catch(() => ({}))
  const id = typeof body?.id === "string" ? body.id : ""
  const patch: Partial<Pick<User, "disabled" | "role">> = {}

  if ("disabled" in body) {
    if (typeof body.disabled !== "boolean") return bad("disabled must be true or false")
    patch.disabled = body.disabled
  }
  if ("role" in body) {
    if (body.role !== "admin" && body.role !== "member") return bad("Invalid role")
    patch.role = body.role
  }
  if ("monthlyMinutes" in body || "plan" in body) {
    return bad("Plans and quotas are per team now — change them on the Teams tab")
  }
  if (id === admin.id && (patch.disabled === true || patch.role === "member")) {
    return bad("You can't disable or demote your own account")
  }

  const user = updateUser(id, patch)
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 })
  return NextResponse.json({ user: toPublicUser(user) })
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
