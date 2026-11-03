"use client"

import { useState } from "react"
import { CheckCircle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export default function WaitlistForm() {
  const [form, setForm] = useState({ email: "", name: "", organisation: "", useCase: "", website: "" })
  const [state, setState] = useState<"idle" | "busy" | "done">("idle")
  const [error, setError] = useState("")

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState("busy"); setError("")
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      if (res.ok) { setState("done"); return }
      setError((await res.json().catch(() => ({}))).error ?? "Something went wrong")
    } catch {
      setError("Couldn't reach the server — try again")
    }
    setState("idle")
  }

  if (state === "done") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-5" data-testid="waitlist-done">
        <CheckCircle size={18} className="mt-0.5 shrink-0 text-emerald-600" />
        <div>
          <p className="text-sm font-semibold text-emerald-900">You&apos;re on the list</p>
          <p className="mt-0.5 text-sm text-emerald-800">
            We&apos;re onboarding pilot teams in small batches and will email {form.email} with an invite.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="relative space-y-4 rounded-xl border bg-background p-5 shadow-sm sm:p-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="wl-name">Name</Label>
          <Input id="wl-name" required maxLength={100} autoComplete="name" value={form.name} onChange={set("name")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="wl-email">Work email</Label>
          <Input id="wl-email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wl-org">Organisation</Label>
        <Input id="wl-org" maxLength={200} autoComplete="organization" placeholder="Company, channel or agency"
          value={form.organisation} onChange={set("organisation")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="wl-use">What would you localize?</Label>
        <Textarea id="wl-use" maxLength={2000} rows={3}
          placeholder="e.g. 200 course videos into Hindi and Tamil, or weekly ad creatives for 5 states"
          value={form.useCase} onChange={set("useCase")} />
      </div>
      {/* Honeypot — hidden from people, filled by naive bots */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="wl-website">Website</label>
        <input id="wl-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set("website")} />
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="h-10 w-full sm:w-auto sm:px-6" disabled={state === "busy"}>
        {state === "busy" && <Loader2 size={14} className="mr-1.5 animate-spin" />} Request pilot access
      </Button>
      <p className="text-[11px] text-muted-foreground">We only use this to contact you about the pilot.</p>
    </form>
  )
}
