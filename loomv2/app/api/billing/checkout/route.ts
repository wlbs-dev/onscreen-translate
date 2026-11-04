import { NextRequest, NextResponse } from "next/server"
import { requireTeam } from "../../../../lib/access"
import { isPaidPlanId } from "../../../../lib/plans"
import { providers } from "../../../../lib/billing"
import { createRazorpaySubscription } from "../../../../lib/billing/razorpay"
import { createStripeCheckout } from "../../../../lib/billing/stripe"
import { appUrl } from "../../../../lib/mail"
import { consume } from "../../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * POST {provider: "razorpay"|"stripe", plan: "creator"|"pro"} → {url} to
 * send the browser to. Team owners only. The plan changes later, when the
 * provider's webhook confirms payment — never on the redirect back.
 */
export async function POST(req: NextRequest) {
  const access = await requireTeam(req, { owner: true })
  if (access instanceof Response) return access
  const { user, team } = access

  const limit = consume(`checkout:${user.id}`, 10, 10 * 60 * 1000)
  if (!limit.ok) return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 })

  const body = await req.json().catch(() => ({}))
  const plan = body?.plan
  const provider: unknown = body?.provider
  if (!isPaidPlanId(plan)) return NextResponse.json({ error: "Pick the Creator or Pro plan" }, { status: 400 })
  if (provider !== "razorpay" && provider !== "stripe") return NextResponse.json({ error: "Unknown payment provider" }, { status: 400 })
  const available = providers()[provider]
  if (!available?.[plan]) return NextResponse.json({ error: "That plan isn't available with this payment method" }, { status: 400 })

  if (team.billing?.status === "active" || team.billing?.status === "past_due") {
    return NextResponse.json({
      error: team.billing.provider === "stripe"
        ? "Your team already has a subscription. Use “Manage billing” to change plans."
        : "Your team already has a subscription. Cancel it first; you can pick a new plan when it ends.",
    }, { status: 409 })
  }

  try {
    const { url } = provider === "razorpay"
      ? await createRazorpaySubscription(team, plan)
      : await createStripeCheckout(team, plan, { email: user.email, baseUrl: appUrl(req) })
    console.log(`[billing] ${user.email} started ${provider} checkout for ${plan} (team ${team.id})`)
    return NextResponse.json({ url })
  } catch (err) {
    console.error("[billing] checkout failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't start the checkout. Try again, or contact us." }, { status: 502 })
  }
}
