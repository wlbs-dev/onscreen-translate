"use client"

import { useState } from "react"
import { Loader2, MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ForgotForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [done, setDone]   = useState("")
  const [busy, setBusy]   = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) { setDone(data.message ?? "Check your inbox."); setBusy(false); return }
      setError(data.error ?? "Something went wrong")
    } catch {
      setError("Couldn't reach the server")
    }
    setBusy(false)
  }

  if (done) {
    return (
      <div className="flex gap-3 rounded-md border bg-muted/50 px-3 py-3 text-xs leading-relaxed" data-testid="forgot-done" role="status">
        <MailCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" />
        <p>{done}</p>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" autoFocus autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full h-9" disabled={busy || !email}>
        {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Email me a reset link
      </Button>
    </form>
  )
}
