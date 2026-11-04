import { NextRequest, NextResponse } from "next/server"
import { TEAM_COOKIE, requireTeam } from "../../../../lib/access"
import { isMember, isOwner, removeMember, teamsForUser } from "../../../../lib/teams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * DELETE {userId} — owners remove a member of the active team; anyone can
 * remove themselves (leave). A team always keeps one owner. Access to the
 * team's videos ends immediately: membership is checked on every request.
 */
export async function DELETE(req: NextRequest) {
  const access = await requireTeam(req)
  if (access instanceof Response) return access
  const { user, team } = access
  const body = await req.json().catch(() => ({}))
  const userId = typeof body?.userId === "string" ? body.userId : ""
  const leaving = userId === user.id

  if (!leaving && !isOwner(team, user.id)) {
    return NextResponse.json({ error: "Only the team owner can remove people" }, { status: 403 })
  }
  if (!isMember(team, userId)) return NextResponse.json({ error: "Not a member of this team" }, { status: 404 })
  if (leaving && teamsForUser(user.id).length <= 1) {
    return NextResponse.json({ error: "This is your only team, so you can't leave it" }, { status: 400 })
  }

  const result = removeMember(team.id, userId)
  if (result === "last_owner") {
    return NextResponse.json({ error: "A team needs at least one owner" }, { status: 400 })
  }
  if (result !== "ok") return NextResponse.json({ error: "Not a member of this team" }, { status: 404 })

  const res = NextResponse.json({ ok: true })
  // Leaving: fall back to the next team
  if (leaving) res.cookies.delete(TEAM_COOKIE)
  return res
}
