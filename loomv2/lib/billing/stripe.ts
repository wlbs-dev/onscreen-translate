// lib/billing/stripe.ts — Stripe Checkout subscriptions (USD) over the REST API.
//
// Enabled when STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET and at least one of
// STRIPE_PRICE_CREATOR / STRIPE_PRICE_PRO (recurring monthly price ids) are
// set. STRIPE_API_BASE overrides https://api.stripe.com (tests).
//
// Webhook payloads are read defensively: field locations moved between
// Stripe API versions (e.g. current_period_end moved onto subscription items,
// invoice.subscription moved under invoice.parent).
import { createHmac, timingSafeEqual } from "crypto"
import { PAID_PLAN_IDS, isPaidPlanId, type PaidPlanId } from "../plans"
import { findTeamByBilling, getTeam, type Team } from "../teams"
import { activatePlan, downgradeToFree, noteBilling } from "./plans"

const env = (k: string) => process.env[k]?.trim() || ""
const apiBase = () => (env("STRIPE_API_BASE") || "https://api.stripe.com").replace(/\/+$/, "")

export const SIGNATURE_TOLERANCE_SEC = 300

export function stripePriceIds(): Partial<Record<PaidPlanId, string>> {
  const ids: Partial<Record<PaidPlanId, string>> = {}
  if (env("STRIPE_PRICE_CREATOR")) ids.creator = env("STRIPE_PRICE_CREATOR")
  if (env("STRIPE_PRICE_PRO")) ids.pro = env("STRIPE_PRICE_PRO")
  return ids
}

export function stripeEnabled(): boolean {
  return !!(env("STRIPE_SECRET_KEY") && env("STRIPE_WEBHOOK_SECRET") && Object.keys(stripePriceIds()).length)
}

function planForPrice(priceId: unknown): PaidPlanId | undefined {
  const ids = stripePriceIds()
  return PAID_PLAN_IDS.find((p) => ids[p] && ids[p] === priceId)
}

async function call<T>(path: string, params: Record<string, string>): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const why = (data as { error?: { message?: string } })?.error?.message ?? `HTTP ${res.status}`
    throw new Error(`Stripe ${path}: ${why}`)
  }
  return data as T
}

/** A Checkout session for a monthly subscription; the customer pays on its url. */
export async function createStripeCheckout(
  team: Team, plan: PaidPlanId, opts: { email: string; baseUrl: string }
): Promise<{ url: string }> {
  const price = stripePriceIds()[plan]
  if (!price) throw new Error(`No Stripe price configured for ${plan}`)
  const customer = team.billing?.provider === "stripe" ? team.billing.customerId : undefined
  const session = await call<{ id: string; url?: string }>("/v1/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    client_reference_id: team.id,
    "metadata[teamId]": team.id,
    "metadata[plan]": plan,
    "subscription_data[metadata][teamId]": team.id,
    "subscription_data[metadata][plan]": plan,
    success_url: `${opts.baseUrl}/app/billing?checkout=success`,
    cancel_url: `${opts.baseUrl}/app/billing?checkout=cancelled`,
    ...(customer ? { customer } : { customer_email: opts.email }),
  })
  if (!session.url) throw new Error("Stripe didn't return a checkout link")
  // Nothing changes until the webhook confirms payment
  noteBilling(team.id, "stripe", { status: "pending", plan })
  return { url: session.url }
}

/** Stripe's customer portal: change plan, update card, cancel. */
export async function createStripePortal(team: Team, baseUrl: string): Promise<{ url: string }> {
  const customer = team.billing?.provider === "stripe" ? team.billing.customerId : undefined
  if (!customer) throw new Error("No Stripe customer for this team yet")
  const session = await call<{ url?: string }>("/v1/billing_portal/sessions", {
    customer,
    return_url: `${baseUrl}/app/billing`,
  })
  if (!session.url) throw new Error("Stripe didn't return a portal link")
  return { url: session.url }
}

/**
 * Stripe-Signature: "t=<unix>,v1=<hex>[,v1=…]". v1 is hex HMAC-SHA256 of
 * "<t>.<raw body>" with the endpoint secret. Rejects timestamps more than
 * five minutes off (replays).
 */
export function verifyStripeSignature(rawBody: string, header: string | null, nowSec = Date.now() / 1000): boolean {
  const secret = env("STRIPE_WEBHOOK_SECRET")
  if (!secret || !header || header.length > 2048) return false
  let t = ""
  const v1: string[] = []
  for (const part of header.split(",")) {
    const i = part.indexOf("=")
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k === "t") t = v
    else if (k === "v1") v1.push(v)
  }
  const ts = Number(t)
  if (!/^\d+$/.test(t) || !v1.length || Math.abs(nowSec - ts) > SIGNATURE_TOLERANCE_SEC) return false
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest()
  return v1.some((sig) => /^[0-9a-f]{64}$/i.test(sig) && timingSafeEqual(expected, Buffer.from(sig, "hex")))
}

/* eslint-disable @typescript-eslint/no-explicit-any -- webhook payloads vary by API version */
const idOf = (x: any): string | undefined => (typeof x === "string" ? x : typeof x?.id === "string" ? x.id : undefined)
const sec = (x: any): number | undefined => (typeof x === "number" && x > 0 ? x * 1000 : undefined)

function teamFor(metaTeamId: unknown, ids: { subscriptionId?: string; customerId?: string }): Team | undefined {
  return getTeam(metaTeamId) ?? findTeamByBilling("stripe", ids)
}

/** Apply a verified webhook event. Returns what happened, for the event log. */
export function handleStripeEvent(event: { type?: string; data?: { object?: any } }): string {
  const type = event.type ?? ""
  const obj = event.data?.object
  if (!obj) return "ignored"

  switch (type) {
    case "checkout.session.completed": {
      if (obj.mode !== "subscription") return "ignored: not a subscription"
      const ids = { subscriptionId: idOf(obj.subscription), customerId: idOf(obj.customer) }
      const team = teamFor(obj.client_reference_id ?? obj.metadata?.teamId, ids)
      if (!team) return "ignored: no team"
      const plan = isPaidPlanId(obj.metadata?.plan) ? obj.metadata.plan : undefined
      const paid = obj.payment_status === "paid" || obj.payment_status === "no_payment_required"
      if (!plan || !paid) {
        noteBilling(team.id, "stripe", { ...clean(ids), status: "pending" })
        return `team ${team.id}: checkout complete, payment ${obj.payment_status}`
      }
      activatePlan(team.id, "stripe", plan, clean(ids))
      return `team ${team.id} → ${plan}`
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const ids = { subscriptionId: idOf(obj), customerId: idOf(obj.customer) }
      const team = teamFor(obj.metadata?.teamId, ids)
      if (!team) return "ignored: no team"
      const item = obj.items?.data?.[0]
      const plan = planForPrice(item?.price?.id) ?? (isPaidPlanId(obj.metadata?.plan) ? obj.metadata.plan : undefined)
      const periodEnd = sec(obj.current_period_end) ?? sec(item?.current_period_end)
      const isCurrent = !team.billing?.subscriptionId || team.billing.provider !== "stripe" || team.billing.subscriptionId === ids.subscriptionId
      const extra = { ...clean(ids), ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}), cancelAtPeriodEnd: !!obj.cancel_at_period_end }
      switch (obj.status) {
        case "active":
        case "trialing":
          if (!plan) return `ignored: unknown price ${item?.price?.id}`
          activatePlan(team.id, "stripe", plan, extra)
          return `team ${team.id} → ${plan}${obj.cancel_at_period_end ? " (cancels at period end)" : ""}`
        case "past_due":
          if (!isCurrent) return "ignored: not the team's current subscription"
          noteBilling(team.id, "stripe", { ...extra, status: "past_due" })
          return `team ${team.id} past due`
        case "canceled":
        case "unpaid":
        case "incomplete_expired":
          if (!isCurrent) return "ignored: not the team's current subscription"
          downgradeToFree(team.id, "stripe", obj.status === "unpaid" ? "halted" : "ended", undefined, clean(ids))
          return `team ${team.id} → free (${obj.status})`
        default:
          return `ignored: status ${obj.status}`
      }
    }

    case "customer.subscription.deleted": {
      const ids = { subscriptionId: idOf(obj), customerId: idOf(obj.customer) }
      const team = teamFor(obj.metadata?.teamId, ids)
      if (!team) return "ignored: no team"
      if (team.billing?.provider === "stripe" && team.billing.subscriptionId && team.billing.subscriptionId !== ids.subscriptionId) {
        return "ignored: not the team's current subscription"
      }
      downgradeToFree(team.id, "stripe", "ended", undefined, clean(ids))
      return `team ${team.id} → free (subscription ended)`
    }

    case "invoice.paid": {
      const details = obj.parent?.subscription_details ?? obj.subscription_details
      const ids = { subscriptionId: idOf(obj.subscription) ?? idOf(details?.subscription), customerId: idOf(obj.customer) }
      if (!ids.subscriptionId) return "ignored: not a subscription invoice"
      const team = teamFor(details?.metadata?.teamId, ids)
      if (!team) return "ignored: no team"
      const line = obj.lines?.data?.[0]
      const plan = planForPrice(line?.price?.id ?? line?.pricing?.price_details?.price)
        ?? (isPaidPlanId(details?.metadata?.plan) ? details.metadata.plan : undefined)
        ?? (team.billing?.provider === "stripe" ? team.billing.plan : undefined)
      if (!plan) return "ignored: unknown plan"
      const periodEnd = sec(line?.period?.end)
      activatePlan(team.id, "stripe", plan, { ...clean(ids), ...(periodEnd ? { currentPeriodEnd: periodEnd } : {}) })
      return `team ${team.id} → ${plan} (invoice paid)`
    }

    default:
      return "ignored"
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function clean(ids: { subscriptionId?: string; customerId?: string }) {
  return {
    ...(ids.subscriptionId ? { subscriptionId: ids.subscriptionId } : {}),
    ...(ids.customerId ? { customerId: ids.customerId } : {}),
  }
}
