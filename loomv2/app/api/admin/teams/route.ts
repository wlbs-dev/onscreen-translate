import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../lib/access"
import { listUsers } from "../../../../lib/users"
import { ensureUserTeam, listTeams, updateTeam, type Team } from "../../../../lib/teams"
import { PLANS, isPlanId, planName } from "../../../../lib/plans"
import { secondsUsedByTeam, teamQuotaMinutes, toMinutes } from "../../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const users = listUsers()
  // Make sure pre-teams users show up with their (migrated) team
  for (const u of users) ensureUserTeam(u)
  const byId = new Map(users.map((u) => [u.id, u]))
  const used = secondsUsedByTeam()
  const teams = listTeams()
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.createdAt,
      plan: t.plan,
      planName: planName(t.plan),
      monthlyMinutes: t.monthlyMinutes,
      minutesUsed: toMinutes(used.get(t.id) ?? 0),
      minutesQuota: teamQuotaMinutes(t),
      billing: t.billing ?? null,
      members: t.members.map((m) => ({
        userId: m.userId, role: m.role,
        email: byId.get(m.userId)?.email ?? "deleted user",
        name: byId.get(m.userId)?.name ?? "",
      })),
    }))
  return NextResponse.json({ teams, plans: Object.values(PLANS).map((p) => ({ id: p.id, name: p.name, monthlyMinutes: p.monthlyMinutes })) })
}

/**
 * PATCH {id, plan?, monthlyMinutes?} — manual plan changes (pilot deals,
 * comps, no payment provider). Picking free/creator/pro without minutes
 * applies that plan's minutes.
 */
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const body = await req.json().catch(() => ({}))
  const patch: Partial<Pick<Team, "plan" | "monthlyMinutes">> = {}
  if ("plan" in body) {
    if (typeof body.plan !== "string" || !/^[a-z0-9_-]{1,32}$/i.test(body.plan)) return bad("Invalid plan")
    patch.plan = body.plan.toLowerCase()
    if (!("monthlyMinutes" in body) && isPlanId(patch.plan) && patch.plan !== "pilot") {
      patch.monthlyMinutes = PLANS[patch.plan].monthlyMinutes
    }
  }
  if ("monthlyMinutes" in body) {
    const n = Number(body.monthlyMinutes)
    if (!Number.isFinite(n) || n < 0 || n > 100_000) return bad("Quota must be between 0 and 100000 minutes")
    patch.monthlyMinutes = Math.round(n * 100) / 100
  }
  const team = typeof body?.id === "string" ? updateTeam(body.id, patch) : undefined
  if (!team) return NextResponse.json({ error: "Team not found" }, { status: 404 })
  console.log(`[admin] ${admin.email} set team ${team.id} to plan=${team.plan} minutes=${team.monthlyMinutes}`)
  return NextResponse.json({ team })
}

const bad = (error: string) => NextResponse.json({ error }, { status: 400 })
