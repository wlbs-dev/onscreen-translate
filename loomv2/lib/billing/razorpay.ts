// lib/billing/razorpay.ts — Razorpay subscriptions (INR) over the REST API.
//
// Enabled when RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
// and at least one of RAZORPAY_PLAN_CREATOR / RAZORPAY_PLAN_PRO (plan ids
// from the Razorpay dashboard) are set. RAZORPAY_API_BASE overrides
// https://api.razorpay.com (tests).
import { createHmac, timingSafeEqual } from "crypto"
import { PAID_PLAN_IDS, type PaidPlanId } from "../plans"
import { findTeamByBilling, getTeam, type Team } from "../teams"
import { activatePlan, downgradeToFree, noteBilling } from "./plans"

const env = (k: string) => process.env[k]?.trim() || ""
const apiBase = () => (env("RAZORPAY_API_BASE") || "https://api.razorpay.com").replace(/\/+$/, "")

/** Razorpay plan id for each of our plans that has one configured. */
export function razorpayPlanIds(): Partial<Record<PaidPlanId, string>> {
  const ids: Partial<Record<PaidPlanId, string>> = {}
  if (env("RAZORPAY_PLAN_CREATOR")) ids.creator = env("RAZORPAY_PLAN_CREATOR")
  if (env("RAZORPAY_PLAN_PRO")) ids.pro = env("RAZORPAY_PLAN_PRO")
  return ids
}

export function razorpayEnabled(): boolean {
  return !!(env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET") && env("RAZORPAY_WEBHOOK_SECRET")
    && Object.keys(razorpayPlanIds()).length)
}

function planForRazorpayId(planId: unknown): PaidPlanId | undefined {
  const ids = razorpayPlanIds()
  return PAID_PLAN_IDS.find((p) => ids[p] && ids[p] === planId)
}

interface RazorpaySubscription {
  id: string
  plan_id?: string
  status?: string
  customer_id?: string | null
  current_end?: number | null
  short_url?: string
  notes?: Record<string, string> | unknown[]
}

async function call<T>(path: string, body: unknown): Promise<T> {
  const auth = Buffer.from(`${env("RAZORPAY_KEY_ID")}:${env("RAZORPAY_KEY_SECRET")}`).toString("base64")
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const why = (data as { error?: { description?: string } })?.error?.description ?? `HTTP ${res.status}`
    throw new Error(`Razorpay ${path.split("/").slice(0, 3).join("/")}: ${why}`)
  }
  return data as T
}

/** Start a monthly subscription; the customer pays on its short_url. */
export async function createRazorpaySubscription(team: Team, plan: PaidPlanId): Promise<{ url: string; subscriptionId: string }> {
  const planId = razorpayPlanIds()[plan]
  if (!planId) throw new Error(`No Razorpay plan configured for ${plan}`)
  const sub = await call<RazorpaySubscription>("/v1/subscriptions", {
    plan_id: planId,
    total_count: 120,       // monthly, for up to 10 years; cancel any time
    quantity: 1,
    customer_notify: 1,
    notes: { teamId: team.id, plan },
  })
  if (!sub.id || !sub.short_url) throw new Error("Razorpay didn't return a subscription link")
  noteBilling(team.id, "razorpay", { status: "pending", subscriptionId: sub.id, plan })
  return { url: sub.short_url, subscriptionId: sub.id }
}

/** Cancel at the end of the paid cycle (the plan stays until the webhook says it ended). */
export async function cancelRazorpaySubscription(team: Team): Promise<void> {
  const id = team.billing?.subscriptionId
  if (!id || !/^[A-Za-z0-9_]{1,64}$/.test(id)) throw new Error("No Razorpay subscription to cancel")
  await call<RazorpaySubscription>(`/v1/subscriptions/${id}/cancel`, { cancel_at_cycle_end: 1 })
  noteBilling(team.id, "razorpay", { cancelAtPeriodEnd: true })
}

/** X-Razorpay-Signature = hex HMAC-SHA256(raw body, webhook secret). */
export function verifyRazorpaySignature(rawBody: string, signature: string | null): boolean {
  const secret = env("RAZORPAY_WEBHOOK_SECRET")
  if (!secret || !signature || !/^[0-9a-f]{64}$/i.test(signature)) return false
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest()
  return timingSafeEqual(expected, Buffer.from(signature, "hex"))
}

interface RazorpayEvent {
  event?: string
  payload?: { subscription?: { entity?: RazorpaySubscription } }
}

/** Apply a verified webhook event. Returns what happened, for the event log. */
export function handleRazorpayEvent(event: RazorpayEvent): string {
  const type = event.event ?? ""
  const sub = event.payload?.subscription?.entity
  if (!type.startsWith("subscription.") || !sub?.id) return "ignored"

  const notes = sub.notes && !Array.isArray(sub.notes) ? sub.notes : {}
  const team = getTeam(notes.teamId) ?? findTeamByBilling("razorpay", { subscriptionId: sub.id })
  if (!team) return "ignored: no team for this subscription"
  const isCurrent = !team.billing?.subscriptionId || team.billing.provider !== "razorpay" || team.billing.subscriptionId === sub.id
  const periodEnd = sub.current_end ? sub.current_end * 1000 : undefined
  const ids = { subscriptionId: sub.id, ...(sub.customer_id ? { customerId: sub.customer_id } : {}) }

  switch (type) {
    case "subscription.activated":
    case "subscription.charged":
    case "subscription.resumed": {
      const plan = planForRazorpayId(sub.plan_id)
      if (!plan) return `ignored: unknown plan ${sub.plan_id}`
      activatePlan(team.id, "razorpay", plan, { ...ids, ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) })
      return `team ${team.id} → ${plan}`
    }
    case "subscription.pending":
      if (!isCurrent) return "ignored: not the team's current subscription"
      noteBilling(team.id, "razorpay", { ...ids, status: "past_due" })
      return `team ${team.id} past due`
    case "subscription.cancelled":
    case "subscription.completed":
      if (!isCurrent) return "ignored: not the team's current subscription"
      downgradeToFree(team.id, "razorpay", type === "subscription.completed" ? "ended" : "cancelled", periodEnd, ids)
      return `team ${team.id} → free${periodEnd && periodEnd > Date.now() ? " at period end" : ""}`
    case "subscription.halted":
      if (!isCurrent) return "ignored: not the team's current subscription"
      downgradeToFree(team.id, "razorpay", "halted", undefined, ids)
      return `team ${team.id} → free (halted)`
    default:
      return "ignored"
  }
}
