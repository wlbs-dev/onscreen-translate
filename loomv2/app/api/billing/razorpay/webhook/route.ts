// Razorpay → us, server to server. No session and no CSRF origin check (it's
// excluded from proxy.ts); the X-Razorpay-Signature HMAC is the auth.
import { NextRequest, NextResponse } from "next/server"
import { createHash } from "crypto"
import { handleRazorpayEvent, verifyRazorpaySignature } from "../../../../../lib/billing/razorpay"
import { isProcessed, markProcessed } from "../../../../../lib/billing/events"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_BODY = 1024 * 1024

export async function POST(req: NextRequest) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 })
  }
  // The signature covers the exact bytes Razorpay sent
  const raw = await req.text()
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 })
  if (!verifyRazorpaySignature(raw, req.headers.get("x-razorpay-signature"))) {
    console.warn("[billing] razorpay webhook with a bad signature")
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  let event: { event?: string }
  try { event = JSON.parse(raw) } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }) }

  // Razorpay retries with the same event id; fall back to the body hash
  const id = req.headers.get("x-razorpay-event-id")?.slice(0, 100) || `sha256:${createHash("sha256").update(raw).digest("hex")}`
  if (isProcessed("razorpay", id)) return NextResponse.json({ ok: true, duplicate: true })

  let result: string
  try {
    result = handleRazorpayEvent(event)
  } catch (err) {
    // 500 so Razorpay retries later; not marked processed
    console.error("[billing] razorpay webhook failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Handler failed" }, { status: 500 })
  }
  markProcessed({ provider: "razorpay", id, type: event.event ?? "", at: Date.now(), result })
  console.log(`[billing] razorpay ${event.event} ${id}: ${result}`)
  return NextResponse.json({ ok: true, result })
}
