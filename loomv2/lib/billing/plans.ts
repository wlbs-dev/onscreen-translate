// lib/billing/plans.ts — applying provider events to a team's plan. Only
// webhook handlers call these: a redirect back from checkout is never proof
// of payment.
import { PLANS, type PaidPlanId } from "../plans"
import { getTeam, updateTeam, type Team, type TeamBilling, type BillingProvider } from "../teams"

type BillingPatch = Partial<Omit<TeamBilling, "provider" | "updatedAt">>

function merged(team: Team, provider: BillingProvider, patch: BillingPatch): TeamBilling {
  // A different provider starts from scratch
  const base = team.billing?.provider === provider ? team.billing : undefined
  return { status: "pending", ...base, ...patch, provider, updatedAt: Date.now() }
}

/** Paid and current: switch the team to the plan and its minutes. */
export function activatePlan(teamId: string, provider: BillingProvider, plan: PaidPlanId, patch: BillingPatch = {}): Team | undefined {
  const team = getTeam(teamId)
  if (!team) return undefined
  const billing = merged(team, provider, { ...patch, plan, status: "active", downgradeAt: undefined })
  console.log(`[billing] team ${teamId} → ${plan} via ${provider}`)
  return updateTeam(teamId, { plan, monthlyMinutes: PLANS[plan].monthlyMinutes, billing })
}

/** Record billing state without touching the plan (pending checkout, past due, cancel requested). */
export function noteBilling(teamId: string, provider: BillingProvider, patch: BillingPatch): Team | undefined {
  const team = getTeam(teamId)
  if (!team) return undefined
  return updateTeam(teamId, { billing: merged(team, provider, patch) })
}

/**
 * Subscription over: free now, or at `at` (ms) if the team already paid
 * until then (listTeams applies due downgrades).
 */
export function downgradeToFree(
  teamId: string,
  provider: BillingProvider,
  status: TeamBilling["status"],
  at?: number,
  patch: BillingPatch = {}
): Team | undefined {
  const team = getTeam(teamId)
  if (!team) return undefined
  const now = Date.now()
  if (at && at > now) {
    console.log(`[billing] team ${teamId} drops to free on ${new Date(at).toISOString()} (${status})`)
    return updateTeam(teamId, {
      billing: merged(team, provider, { ...patch, status, cancelAtPeriodEnd: true, currentPeriodEnd: at, downgradeAt: at }),
    })
  }
  console.log(`[billing] team ${teamId} → free (${status} via ${provider})`)
  return updateTeam(teamId, {
    plan: "free",
    monthlyMinutes: PLANS.free.monthlyMinutes,
    billing: merged(team, provider, { ...patch, status, cancelAtPeriodEnd: false, downgradeAt: undefined }),
  })
}
