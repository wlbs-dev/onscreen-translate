import { NextRequest, NextResponse } from "next/server"
import { requireTeam } from "../../../lib/access"
import { listUsers } from "../../../lib/users"
import { listInvites } from "../../../lib/invites"
import { memberRole, updateTeam } from "../../../lib/teams"
import { planName } from "../../../lib/plans"
import { mailConfigured } from "../../../lib/mail"
import { monthBounds, teamQuotaMinutes, teamSecondsUsedThisMonth, toMinutes } from "../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET → the active team: members, pending invites (owners only), minutes. */
export async function GET(req: NextRequest) {
  const access = await requireTeam(req)
  if (access instanceof Response) return access
  const { user, team } = access
  const role = memberRole(team, user.id)
  const byId = new Map(listUsers().map((u) => [u.id, u]))
  return NextResponse.json({
    team: { id: team.id, name: team.name, plan: team.plan, planName: planName(team.plan), createdAt: team.createdAt },
    role,
    me: user.id,
    members: team.members.map((m) => ({
      userId: m.userId,
      role: m.role,
      addedAt: m.addedAt,
      name: byId.get(m.userId)?.name ?? "Deleted user",
      email: byId.get(m.userId)?.email ?? "",
    })),
    invites: role === "owner"
      ? listInvites()
          .filter((i) => i.teamId === team.id && !i.usedBy)
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((i) => ({ code: i.code, email: i.email, createdAt: i.createdAt }))
      : [],
    minutesUsed: toMinutes(teamSecondsUsedThisMonth(team.id)),
    minutesQuota: teamQuotaMinutes(team),
    resetsAt: monthBounds().end,
    mailConfigured: mailConfigured(),
  })
}

/** PATCH {name} — owners rename the team. */
export async function PATCH(req: NextRequest) {
  const access = await requireTeam(req, { owner: true })
  if (access instanceof Response) return access
  const body = await req.json().catch(() => ({}))
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name || name.length > 80) return NextResponse.json({ error: "Team names are 1–80 characters" }, { status: 400 })
  const team = updateTeam(access.team.id, { name })
  return NextResponse.json({ ok: true, name: team?.name })
}
