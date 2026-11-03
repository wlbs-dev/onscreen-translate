import { NextRequest, NextResponse } from "next/server"
import { requireUser } from "../../../lib/access"
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
  })
}
