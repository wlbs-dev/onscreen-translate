import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../lib/access"
import { createInvite, deleteInvite, listInvites } from "../../../../lib/invites"
import { listUsers, normalizeEmail } from "../../../../lib/users"
import { listTeams } from "../../../../lib/teams"
import { appUrl, inviteEmail, mailConfigured, sendMail } from "../../../../lib/mail"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const emailById = new Map(listUsers().map((u) => [u.id, u.email]))
  const teamNameById = new Map(listTeams().map((t) => [t.id, t.name]))
  const invites = listInvites()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((i) => ({
      ...i,
      createdByEmail: emailById.get(i.createdBy) ?? null,
      usedByEmail:    i.usedBy ? emailById.get(i.usedBy) ?? null : null,
      teamName:       i.teamId ? teamNameById.get(i.teamId) ?? "deleted team" : null,
    }))
  return NextResponse.json({ invites })
}

/** POST {email?} → a new single-use invite (optionally locked to one email) */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const body = await req.json().catch(() => ({}))
  let email: string | undefined
  if (typeof body?.email === "string" && body.email.trim()) {
    const e = normalizeEmail(body.email)
    if (!e) return NextResponse.json({ error: "Enter a valid email or leave it blank" }, { status: 400 })
    email = e
  }
  const invite = createInvite(admin.id, email)
  // Locked to an address: email it too (without SMTP_URL it goes to the outbox)
  let emailed = false
  if (email) {
    const link = `${appUrl(req)}/signup?invite=${encodeURIComponent(invite.code)}`
    emailed = (await sendMail(inviteEmail(email, { inviterName: admin.name, link }))) && mailConfigured()
  }
  return NextResponse.json({ invite, emailed })
}

/** DELETE {code} → revoke an unused invite */
export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const body = await req.json().catch(() => ({}))
  if (typeof body?.code !== "string" || !deleteInvite(body.code)) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 })
  }
  return NextResponse.json({ ok: true })
}
