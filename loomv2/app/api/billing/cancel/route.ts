import { NextRequest, NextResponse } from "next/server"
import { requireTeam } from "../../../../lib/access"
import { cancelRazorpaySubscription, razorpayEnabled } from "../../../../lib/billing/razorpay"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST — cancel the team's Razorpay subscription at the end of the paid
 * cycle (owners only). The plan stays until Razorpay's webhook says the
 * subscription ended. Stripe subscriptions are cancelled in Stripe's portal.
 */
export async function POST(req: NextRequest) {
  const access = await requireTeam(req, { owner: true })
  if (access instanceof Response) return access
  const { user, team } = access
  const b = team.billing
  if (!razorpayEnabled() || b?.provider !== "razorpay" || !b.subscriptionId || (b.status !== "active" && b.status !== "past_due")) {
    return NextResponse.json({ error: "There's no active Razorpay subscription to cancel" }, { status: 400 })
  }
  try {
    await cancelRazorpaySubscription(team)
    console.log(`[billing] ${user.email} cancelled Razorpay subscription for team ${team.id} (at cycle end)`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[billing] cancel failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't cancel the subscription. Try again, or contact us." }, { status: 502 })
  }
}
