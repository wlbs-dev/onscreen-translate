"use client"

import { useState } from "react"
import { Film, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export default function LoginPage() {
  const [password, setPassword] = useState("")
  const [error, setError]       = useState("")
  const [busy, setBusy]         = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError("")
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      const next = new URLSearchParams(window.location.search).get("next")
      // Only follow same-site relative paths
      window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/"
    } else {
      setBusy(false)
      setError((await res.json().catch(() => ({}))).error ?? "Login failed")
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-muted/30 px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-primary flex items-center justify-center">
            <Film size={14} className="text-primary-foreground" />
          </div>
          <span className="text-xs font-bold tracking-widest text-primary">TRANSEDIT</span>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password" type="password" autoFocus autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Sign in
        </Button>
      </form>
    </main>
  )
}
