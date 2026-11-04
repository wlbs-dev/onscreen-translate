import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "../../../lib/access"
import { updateUser } from "../../../lib/users"
import { monthBounds, quotaMinutes, secondsUsedThisMonth, toMinutes } from "../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  return NextResponse.json({
    id:           user.id,
    email:        user.email,
    name:         user.name,
    role:         user.role,
    plan:         user.plan,
    minutesUsed:  toMinutes(secondsUsedThisMonth(user.id)),
    minutesQuota: quotaMinutes(user), // null = unlimited
    resetsAt:     monthBounds().end,
    emailNotifications: user.emailNotifications !== false,
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
