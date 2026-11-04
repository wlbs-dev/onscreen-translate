import { NextRequest, NextResponse } from "next/server"
import { requireTeam } from "../../../../lib/access"
import { createInvite, deleteInvite, getInvite } from "../../../../lib/invites"
import { getUserByEmail, normalizeEmail } from "../../../../lib/users"
import { isMember } from "../../../../lib/teams"
import { appUrl, inviteEmail, mailConfigured, sendMail } from "../../../../lib/mail"
import { consume } from "../../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST {email} — team owners invite someone to the active team. The invite
 * is single-use and locked to that address. It's emailed when SMTP is set
 * up; the link is returned either way so the owner can copy it.
 */
export async function POST(req: NextRequest) {
  const access = await requireTeam(req, { owner: true })
  if (access instanceof Response) return access
  const { user, team } = access

  const limit = consume(`team-invite:${user.id}`, 30, 60 * 60 * 1000)
  if (!limit.ok) return NextResponse.json({ error: "Too many invites. Try again later." }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  if (!email) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 })
  const existing = getUserByEmail(email)
  if (existing && isMember(team, existing.id)) {
    return NextResponse.json({ error: "They're already in this team" }, { status: 409 })
  }

  const invite = createInvite(user.id, email, { teamId: team.id, role: "member" })
  const link = `${appUrl(req)}/signup?invite=${encodeURIComponent(invite.code)}`
  const sent = await sendMail(inviteEmail(email, { inviterName: user.name, teamName: team.name, link }))
  return NextResponse.json({
    invite: { code: invite.code, email, createdAt: invite.createdAt },
    link,
    emailed: sent && mailConfigured(),
  })
}

/** DELETE {code} — revoke one of the active team's unused invites. */
export async function DELETE(req: NextRequest) {
  const access = await requireTeam(req, { owner: true })
  if (access instanceof Response) return access
  const body = await req.json().catch(() => ({}))
  const invite = getInvite(body?.code)
  if (!invite || invite.teamId !== access.team.id || !deleteInvite(invite.code)) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
