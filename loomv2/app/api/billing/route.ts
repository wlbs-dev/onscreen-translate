import { NextRequest, NextResponse } from "next/server"
import { requireTeam } from "../../../lib/access"
import { isOwner } from "../../../lib/teams"
import { PUBLIC_PLANS, planName } from "../../../lib/plans"
import { providers } from "../../../lib/billing"
import { monthBounds, teamQuotaMinutes, teamSecondsUsedThisMonth, toMinutes } from "../../../lib/usage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** GET → the active team's plan, usage and billing state, and which upgrades are available. */
export async function GET(req: NextRequest) {
  const access = await requireTeam(req)
  if (access instanceof Response) return access
  const { user, team } = access
  const b = team.billing
  return NextResponse.json({
    team: { id: team.id, name: team.name },
    isOwner: isOwner(team, user.id),
    plan: team.plan,
    planName: planName(team.plan),
    minutesUsed: toMinutes(teamSecondsUsedThisMonth(team.id)),
    minutesQuota: teamQuotaMinutes(team),
    monthlyMinutes: team.monthlyMinutes,
    resetsAt: monthBounds().end,
    billing: b ? {
      provider: b.provider,
      status: b.status,
      plan: b.plan ?? null,
      currentPeriodEnd: b.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: !!b.cancelAtPeriodEnd,
      downgradeAt: b.downgradeAt ?? null,
      canManage: b.provider === "stripe" ? !!b.customerId : !!b.subscriptionId,
    } : null,
    plans: PUBLIC_PLANS,
    providers: providers(),
  })
}
