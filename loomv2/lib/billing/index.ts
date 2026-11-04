// lib/billing/index.ts — which payment providers are set up, for the billing page.
import { PAID_PLAN_IDS, type PaidPlanId } from "../plans"
import { razorpayEnabled, razorpayPlanIds } from "./razorpay"
import { stripeEnabled, stripePriceIds } from "./stripe"

export type ProviderPlans = Record<PaidPlanId, boolean>

export interface ProvidersSummary {
  razorpay: ProviderPlans | null  // null = not configured
  stripe: ProviderPlans | null
}

const which = (ids: Partial<Record<PaidPlanId, string>>): ProviderPlans =>
  Object.fromEntries(PAID_PLAN_IDS.map((p) => [p, !!ids[p]])) as ProviderPlans

export function providers(): ProvidersSummary {
  return {
    razorpay: razorpayEnabled() ? which(razorpayPlanIds()) : null,
    stripe: stripeEnabled() ? which(stripePriceIds()) : null,
  }
}
