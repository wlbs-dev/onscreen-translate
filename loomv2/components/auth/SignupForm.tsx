"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function SignupForm({ invite: initialInvite, needsInvite }: {
  invite?: string
  needsInvite: boolean
}) {
  const [name, setName]         = useState("")
  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState("")
  const [invite, setInvite]     = useState(initialInvite ?? "")
  const [error, setError]       = useState("")
  const [busy, setBusy]         = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, invite }),
      })
      if (res.ok) {
        window.location.href = "/app"
        return
      }
      setError((await res.json().catch(() => ({}))).error ?? "Sign-up failed")
    } catch {
      setError("Couldn't reach the server")
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="name">Name</Label>
        <Input id="name" autoFocus autoComplete="name" required maxLength={100}
          value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" type="email" autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-[11px] text-muted-foreground">At least 8 characters.</p>
      </div>
      {needsInvite && (
        <div className="space-y-1.5">
          <Label htmlFor="invite">Invite code</Label>
          <Input id="invite" autoComplete="off" required spellCheck={false} className="font-mono"
            value={invite} onChange={(e) => setInvite(e.target.value.trim())} />
        </div>
      )}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full h-9" disabled={busy || !name || !email || password.length < 8 || (needsInvite && !invite)}>
        {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Create account
      </Button>
    </form>
  )
}
