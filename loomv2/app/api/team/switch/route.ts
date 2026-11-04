import { NextRequest, NextResponse } from "next/server"
import { TEAM_COOKIE, requireUser, teamCookieOptions } from "../../../../lib/access"
import { getTeam, isMember } from "../../../../lib/teams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST {teamId} — make one of your teams the active one (ot_team cookie). */
export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  const body = await req.json().catch(() => ({}))
  const team = getTeam(body?.teamId)
  if (!team || !isMember(team, user.id)) return NextResponse.json({ error: "Team not found" }, { status: 404 })
  const res = NextResponse.json({ ok: true, teamId: team.id })
  res.cookies.set(TEAM_COOKIE, team.id, teamCookieOptions(req))
  return res
}
