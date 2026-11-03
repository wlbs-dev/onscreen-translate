"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { safeNext } from "./AuthCard"

export default function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [email, setEmail]       = useState("")
  const [password, setPassword] = useState("")
  const [error, setError]       = useState("")
  const [busy, setBusy]         = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        window.location.href = safeNext(next)
        return
      }
      setError((await res.json().catch(() => ({}))).error ?? "Sign-in failed")
    } catch {
      setError("Couldn't reach the server")
    }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {notice && <p className="rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">{notice}</p>}
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email" type="email" autoFocus autoComplete="email" required
          value={email} onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password" type="password" autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button type="submit" className="w-full h-9" disabled={busy || !email || !password}>
        {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Sign in
      </Button>
    </form>
  )
}
