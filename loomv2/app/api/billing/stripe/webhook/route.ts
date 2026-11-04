// Stripe → us, server to server. No session and no CSRF origin check (it's
// excluded from proxy.ts); the Stripe-Signature HMAC is the auth.
import { NextRequest, NextResponse } from "next/server"
import { handleStripeEvent, verifyStripeSignature } from "../../../../../lib/billing/stripe"
import { isProcessed, markProcessed } from "../../../../../lib/billing/events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY = 1024 * 1024

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 })
  }
  // The signature covers the exact bytes Stripe sent
  const raw = await req.text()
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 })
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"))) {
    console.warn("[billing] stripe webhook with a bad or stale signature")
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  let event: { id?: string; type?: string; data?: { object?: unknown } }
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }
  const id = typeof event.id === "string" ? event.id.slice(0, 100) : ""
  if (!id) return NextResponse.json({ error: "Missing event id" }, { status: 400 })
  if (isProcessed("stripe", id)) return NextResponse.json({ ok: true, duplicate: true })

  let result: string
  try {
    result = handleStripeEvent(event)
  } catch (err) {
    // 500 so Stripe retries later; not marked processed
    console.error("[billing] stripe webhook failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }
  markProcessed({ provider: "stripe", id, type: event.type ?? "", at: Date.now(), result })
  console.log(`[billing] stripe ${event.type} ${id}: ${result}`)
  return NextResponse.json({ ok: true, result })
}
