"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function AcceptInvite({ invite, teamName }: { invite: string; teamName: string }) {
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function accept() {
    setBusy(true); setError("")
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite }),
      })
      if (res.ok) { window.location.href = "/app"; return }
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't accept the invite")
    } catch {
      setError("Couldn't reach the server")
    }
    setBusy(false)
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
      <Button className="w-full h-9" onClick={accept} disabled={busy} data-testid="accept-invite">
        {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Accept invite and join {teamName}
      </Button>
    </div>
  )
}
