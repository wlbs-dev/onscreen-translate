import { NextRequest, NextResponse } from "next/server"
import { activeTeam, requireUser } from "../../../lib/access"
import { updateUser } from "../../../lib/users"
import { memberRole, teamsForUser } from "../../../lib/teams"
import { planName } from "../../../lib/plans"
import { monthBounds, teamQuotaMinutes, teamSecondsUsedThisMonth, toMinutes } from "../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  const team = activeTeam(req, user)
  return NextResponse.json({
    id:           user.id,
    email:        user.email,
    name:         user.name,
    role:         user.role,
    // Plan and minutes are the active team's
    plan:         team.plan,
    planName:     planName(team.plan),
    minutesUsed:  toMinutes(teamSecondsUsedThisMonth(team.id)),
    minutesQuota: teamQuotaMinutes(team), // null = unlimited
    resetsAt:     monthBounds().end,
    emailNotifications: user.emailNotifications !== false,
    team:  { id: team.id, name: team.name, role: memberRole(team, user.id) },
    teams: teamsForUser(user.id).map((t) => ({ id: t.id, name: t.name, role: memberRole(t, user.id) })),
  })
}

/** PATCH {emailNotifications}: the signed-in user's own settings. */
export async function PATCH(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  const body = await req.json().catch(() => ({}))
  if (typeof body?.emailNotifications !== "boolean") {
    return NextResponse.json({ error: "emailNotifications must be true or false" }, { status: 400 })
  }
  updateUser(user.id, { emailNotifications: body.emailNotifications })
  return NextResponse.json({ ok: true, emailNotifications: body.emailNotifications })
}
