// lib/plans.ts — what each plan includes. Pure data: safe to import from
// client components and the landing page.
//
// free/creator/pro are self-service (billing page); "pilot" is assigned by an
// admin, with whatever monthly minutes the admin sets.

export type PlanId = "free" | "creator" | "pro" | "pilot"
export type PaidPlanId = "creator" | "pro"

export interface Plan {
  id: PlanId
  name: string
  /** Video minutes per calendar month (UTC) */
  monthlyMinutes: number
  priceInr: number   // per month
  priceUsd: number   // per month
  blurb: string
  features: string[]
  /** Shown on the pricing section / billing page */
  public: boolean
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", name: "Free", monthlyMinutes: 10, priceInr: 0, priceUsd: 0, public: true,
    blurb: "Try it on a few short videos.",
    features: ["10 video minutes a month", "All 10 languages", "Full editor and HD export"],
  },
  creator: {
    id: "creator", name: "Creator", monthlyMinutes: 30, priceInr: 999, priceUsd: 15, public: true,
    blurb: "For a creator or a small team shipping every week.",
    features: ["30 video minutes a month", "All 10 languages", "AI sentence-level translation", "Shared team workspace"],
  },
  pro: {
    id: "pro", name: "Pro", monthlyMinutes: 150, priceInr: 3499, priceUsd: 49, public: true,
    blurb: "For course teams and agencies localizing at volume.",
    features: ["150 video minutes a month", "Everything in Creator", "Priority processing and support"],
  },
  pilot: {
    id: "pilot", name: "Pilot", monthlyMinutes: 60, priceInr: 0, priceUsd: 0, public: false,
    blurb: "Pilot access, set up by us.",
    features: ["Minutes set by the TransEdit team"],
  },
}

export const PUBLIC_PLANS: Plan[] = [PLANS.free, PLANS.creator, PLANS.pro]
export const PAID_PLAN_IDS: PaidPlanId[] = ["creator", "pro"]

export function isPlanId(id: unknown): id is PlanId {
  return typeof id === "string" && Object.prototype.hasOwnProperty.call(PLANS, id)
}

export function isPaidPlanId(id: unknown): id is PaidPlanId {
  return id === "creator" || id === "pro"
}

/** Display name for any stored plan string (admins may have set custom ones). */
export function planName(id: string): string {
  return isPlanId(id) ? PLANS[id].name : id.charAt(0).toUpperCase() + id.slice(1)
}

export const formatInr = (n: number) => `₹${n.toLocaleString("en-IN")}`
export const formatUsd = (n: number) => `$${n.toLocaleString("en-US")}`
