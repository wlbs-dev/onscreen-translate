import { NextRequest, NextResponse } from "next/server"
import { requireTeam } from "../../../../lib/access"
import { createStripePortal, stripeEnabled } from "../../../../lib/billing/stripe"
import { appUrl } from "../../../../lib/mail"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** POST → {url} of Stripe's billing portal for the team's customer (owners only). */
export async function POST(req: NextRequest) {
  const access = await requireTeam(req, { owner: true })
  if (access instanceof Response) return access
  const { team } = access
  if (!stripeEnabled() || team.billing?.provider !== "stripe" || !team.billing.customerId) {
    return NextResponse.json({ error: "There's no Stripe subscription to manage" }, { status: 400 })
  }
  try {
    return NextResponse.json(await createStripePortal(team, appUrl(req)))
  } catch (err) {
    console.error("[billing] portal failed:", err instanceof Error ? err.message : err)
    return NextResponse.json({ error: "Couldn't open billing. Try again, or contact us." }, { status: 502 })
  }
}
