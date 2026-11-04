"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Check, CreditCard, Loader2 } from "lucide-react"
import Header from "@/components/Header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { api } from "@/components/team/TeamPanel"
import { formatInr, formatUsd, type Plan, type PaidPlanId } from "@/lib/plans"

type ProviderPlans = Record<PaidPlanId, boolean> | null

interface BillingInfo {
  team: { id: string; name: string }
  isOwner: boolean
  plan: string
  planName: string
  minutesUsed: number
  minutesQuota: number | null
  monthlyMinutes: number
  resetsAt: number
  billing: {
    provider: "razorpay" | "stripe"
    status: "pending" | "active" | "past_due" | "cancelled" | "halted" | "ended"
    plan: PaidPlanId | null
    currentPeriodEnd: number | null
    cancelAtPeriodEnd: boolean
    downgradeAt: number | null
    canManage: boolean
  } | null
  plans: Plan[]
  providers: { razorpay: ProviderPlans; stripe: ProviderPlans }
}

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })

export default function BillingPanel({ checkout }: { checkout?: "success" | "cancelled" }) {
  const [info, setInfo] = useState<BillingInfo | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try { setInfo(await api<BillingInfo>("/api/billing")) } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }, [])
  useEffect(() => { const load = async () => { await reload() }; load() }, [reload])

  // Back from checkout: the webhook usually lands within seconds
  useEffect(() => {
    if (checkout !== "success") return
    let n = 0
    const iv = setInterval(() => { if (++n > 20) clearInterval(iv); else reload() }, 3000)
    return () => clearInterval(iv)
  }, [checkout, reload])

  const go = async (key: string, url: string, body?: object) => {
    setError(""); setBusy(key)
    try {
      const r = await api<{ url?: string }>(url, { method: "POST", body: JSON.stringify(body ?? {}) })
      if (r.url) { window.location.href = r.url; return }
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    }
    setBusy(null)
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          {error || <><Loader2 size={14} className="animate-spin" /> Loading…</>}
        </div>
      </div>
    )
  }

  const b = info.billing
  const subscribed = b && (b.status === "active" || b.status === "past_due")
  const anyProvider = !!(info.providers.razorpay || info.providers.stripe)
  const pct = info.minutesQuota ? Math.min(100, (info.minutesUsed / info.minutesQuota) * 100) : 0

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header onBack={() => { window.location.href = "/app" }} />
      <div className="flex-1 p-4 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <CreditCard size={18} className="text-muted-foreground" />
            <h1 className="text-base font-semibold">Plan &amp; billing</h1>
            <span className="text-sm text-muted-foreground">· {info.team.name}</span>
          </div>

          {checkout === "success" && (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900" data-testid="checkout-success">
              Thanks! Your plan changes as soon as the payment provider confirms the payment, usually within a few seconds.
            </p>
          )}
          {checkout === "cancelled" && (
            <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">Checkout cancelled. Nothing was charged.</p>
          )}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>}

          {/* Current plan */}
          <div className="rounded-xl border p-5 space-y-3" data-testid="current-plan">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="text-xs text-muted-foreground">Current plan</p>
                <p className="text-xl font-semibold" data-testid="current-plan-name">{info.planName}</p>
              </div>
              <p className="font-mono text-sm">
                {info.minutesQuota == null ? `${info.minutesUsed} min used · unlimited` : `${info.minutesUsed} / ${info.minutesQuota} min used`}
              </p>
            </div>
            {info.minutesQuota != null && <Progress value={pct} className="h-1.5" />}
            <p className="text-xs text-muted-foreground">Minutes reset on {fmtDate(info.resetsAt)}.</p>
            {b && (
              <p className="text-xs" data-testid="billing-status">
                {b.status === "pending" && "Waiting for the payment to be confirmed. If you closed the payment page, you can start again below."}
                {b.status === "active" && !b.cancelAtPeriodEnd && <>Paid via {b.provider === "razorpay" ? "Razorpay (₹)" : "Stripe ($)"}{b.currentPeriodEnd && <> · renews on <b>{fmtDate(b.currentPeriodEnd)}</b></>}</>}
                {b.status === "active" && b.cancelAtPeriodEnd && <>Cancelled · stays on {info.planName} until {b.currentPeriodEnd ? <b>{fmtDate(b.currentPeriodEnd)}</b> : "the end of the paid period"}, then moves to Free.</>}
                {b.status === "cancelled" && b.downgradeAt && <>Cancelled · moves to Free on <b>{fmtDate(b.downgradeAt)}</b>.</>}
                {b.status === "past_due" && <span className="text-amber-700">The last payment didn&apos;t go through. Update your payment method to keep your plan.</span>}
                {(b.status === "halted" || b.status === "ended") && "Your subscription has ended."}
              </p>
            )}
            {info.isOwner && subscribed && b?.canManage && (
              <div className="flex gap-2 pt-1">
                {b.provider === "stripe" && (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => go("portal", "/api/billing/portal")} data-testid="manage-billing">
                    {busy === "portal" && <Loader2 size={12} className="mr-1 animate-spin" />} Manage billing
                  </Button>
                )}
                {b.provider === "razorpay" && !b.cancelAtPeriodEnd && (
                  <Button size="sm" variant="outline" disabled={!!busy} data-testid="cancel-subscription"
                    onClick={() => { if (confirm("Cancel your subscription? You keep your plan until the end of this billing period.")) go("cancel", "/api/billing/cancel") }}>
                    {busy === "cancel" && <Loader2 size={12} className="mr-1 animate-spin" />} Cancel subscription
                  </Button>
                )}
              </div>
            )}
          </div>

          {!info.isOwner && (
            <p className="text-xs text-muted-foreground" data-testid="billing-readonly">
              Only the team owner can change the plan. Ask them if your team needs more minutes.
            </p>
          )}

          {/* Plans */}
          <div className="grid gap-3 md:grid-cols-3">
            {info.plans.map((p) => {
              const current = info.plan === p.id
              const paid = p.id === "creator" || p.id === "pro"
              const rzp = paid && info.providers.razorpay?.[p.id as PaidPlanId]
              const stp = paid && info.providers.stripe?.[p.id as PaidPlanId]
              return (
                <div key={p.id} className={`rounded-xl border p-5 space-y-3 ${current ? "border-primary ring-1 ring-primary" : ""}`} data-testid={`plan-${p.id}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{p.name}</p>
                    {current && <Badge className="text-[10px]">Current</Badge>}
                  </div>
                  <p>
                    <span className="text-2xl font-semibold">{formatInr(p.priceInr)}</span>
                    <span className="text-xs text-muted-foreground"> /month{p.priceUsd > 0 && <> · or {formatUsd(p.priceUsd)}</>}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{p.blurb}</p>
                  <ul className="space-y-1 text-xs">
                    {p.features.map((f) => <li key={f} className="flex gap-1.5"><Check size={12} className="mt-0.5 shrink-0 text-emerald-600" /> {f}</li>)}
                  </ul>
                  {info.isOwner && paid && !current && !subscribed && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      {rzp && (
                        <Button size="sm" disabled={!!busy} data-testid={`upgrade-razorpay-${p.id}`}
                          onClick={() => go(`rzp-${p.id}`, "/api/billing/checkout", { provider: "razorpay", plan: p.id })}>
                          {busy === `rzp-${p.id}` && <Loader2 size={12} className="mr-1 animate-spin" />} Upgrade · {formatInr(p.priceInr)}/mo (Razorpay)
                        </Button>
                      )}
                      {stp && (
                        <Button size="sm" variant={rzp ? "outline" : "default"} disabled={!!busy} data-testid={`upgrade-stripe-${p.id}`}
                          onClick={() => go(`stp-${p.id}`, "/api/billing/checkout", { provider: "stripe", plan: p.id })}>
                          {busy === `stp-${p.id}` && <Loader2 size={12} className="mr-1 animate-spin" />} Upgrade · {formatUsd(p.priceUsd)}/mo (card, Stripe)
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {info.isOwner && !anyProvider && (
            <p className="rounded-xl border bg-muted/40 px-4 py-3 text-sm" data-testid="contact-upgrade">
              <b>Contact us to upgrade.</b> Online payments aren&apos;t switched on yet — use “Send feedback” in the account menu and we&apos;ll change your plan.
            </p>
          )}
          {info.isOwner && subscribed && (
            <p className="text-xs text-muted-foreground">
              {b?.provider === "stripe" ? "To switch plans, use Manage billing." : "To switch plans, cancel this subscription and pick a new plan when it ends."}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Prices include all 10 languages and the full editor. Minutes are counted per uploaded video and shared by the whole team. <Link href="/app/team" className="underline underline-offset-2">Manage team</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
