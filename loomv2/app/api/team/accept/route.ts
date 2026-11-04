import { NextRequest, NextResponse } from "next/server"
import { TEAM_COOKIE, requireUser, teamCookieOptions } from "../../../../lib/access"
import { getInvite, inviteProblem, markInviteUsed } from "../../../../lib/invites"
import { addMember, getTeam, isMember } from "../../../../lib/teams"
import { consume } from "../../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST {invite} — a signed-in user accepts a team invite sent to their email. */
export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  const limit = consume(`team-accept:${user.id}`, 20, 15 * 60 * 1000)
  if (!limit.ok) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const invite = getInvite(body?.invite)
  const team = invite?.teamId ? getTeam(invite.teamId) : undefined
  if (!invite || !team) return NextResponse.json({ error: "That invite isn't valid." }, { status: 404 })
  if (isMember(team, user.id)) {
    const res = NextResponse.json({ ok: true, teamId: team.id, already: true })
    res.cookies.set(TEAM_COOKIE, team.id, teamCookieOptions(req))
    return res
  }
  const problem = inviteProblem(invite, user.email)
  if (problem) return NextResponse.json({ error: problem }, { status: 403 })

  addMember(team.id, user.id, invite.role ?? "member")
  markInviteUsed(invite.code, user.id)
  const res = NextResponse.json({ ok: true, teamId: team.id })
  res.cookies.set(TEAM_COOKIE, team.id, teamCookieOptions(req))
  return res
}
