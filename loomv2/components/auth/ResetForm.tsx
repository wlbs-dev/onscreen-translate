"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm]   = useState("")
  const [error, setError]       = useState("")
  const [busy, setBusy]         = useState(false)
  const mismatch = confirm.length > 0 && confirm !== password

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (mismatch) return
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      if (res.ok) { window.location.href = "/app"; return }
      setError((await res.json().catch(() => ({}))).error ?? "Could not reset the password")
    } catch {
      setError("Couldn't reach the server")
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" type="password" autoFocus autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" type="password" autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <p className="text-[11px] text-destructive">Passwords don&apos;t match.</p>}
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full h-9" disabled={busy || password.length < 8 || confirm !== password}>
        {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Set new password
      </Button>
    </form>
  )
}
