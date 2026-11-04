"use client"

import { useEffect, useState } from "react"
import { LogOut, Shield, LayoutGrid, MessageSquare, Mail } from "lucide-react"
import FeedbackDialog from "./FeedbackDialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface Me {
  id: string
  email: string
  name: string
  role: "admin" | "member"
  plan: string
  minutesUsed: number
  minutesQuota: number | null // null = unlimited
  resetsAt: number
  emailNotifications: boolean
}

/** Fire after anything that changes usage (an upload) so the menu refreshes. */
export const USAGE_CHANGED_EVENT = "ot:usage-changed"

export async function logout() {
  await fetch("/api/logout", { method: "POST" }).catch(() => {})
  window.location.href = "/"
}

/** Send the browser to /login when the session is gone or the account was disabled. */
export function redirectToLogin(reason?: string) {
  const next = window.location.pathname + window.location.search
  const q = new URLSearchParams({ next })
  if (reason) q.set("reason", reason)
  window.location.href = `/login?${q}`
}

export default function UserMenu() {
  const [me, setMe] = useState<Me | null>(null)
  const [fbOpen, setFbOpen] = useState(false)
  const [fbKey, setFbKey] = useState(0)

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const res = await fetch("/api/me")
        if (res.status === 401) {
          const { error } = await res.json().catch(() => ({ error: "" }))
          redirectToLogin(/disabled/i.test(error ?? "") ? "disabled" : undefined)
          return
        }
        if (res.ok && alive) setMe(await res.json())
      } catch {}
    }
    load()
    window.addEventListener(USAGE_CHANGED_EVENT, load)
    // Picks up quota changes and disabled accounts while the app sits open
    const iv = setInterval(load, 60_000)
    return () => { alive = false; window.removeEventListener(USAGE_CHANGED_EVENT, load); clearInterval(iv) }
  }, [])

  const toggleEmails = async (on: boolean) => {
    setMe((m) => (m ? { ...m, emailNotifications: on } : m))
    const res = await fetch("/api/me", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ emailNotifications: on }),
    }).catch(() => null)
    if (!res?.ok) setMe((m) => (m ? { ...m, emailNotifications: !on } : m))
  }

  if (!me) return <div className="h-7 w-7 rounded-full bg-muted animate-pulse" aria-hidden />

  const initial = (me.name || me.email).trim().charAt(0).toUpperCase()
  const pct = me.minutesQuota ? Math.min(100, (me.minutesUsed / me.minutesQuota) * 100) : 0
  const resets = new Date(me.resetsAt).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" })

  return (
    <>
    <FeedbackDialog key={fbKey} open={fbOpen} onOpenChange={setFbOpen} />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-1.5" aria-label="Account menu" data-testid="user-menu">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
            {initial}
          </span>
          <span className="hidden sm:inline max-w-40 truncate text-xs text-muted-foreground">{me.email}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="text-sm font-medium truncate">{me.name}</p>
          <p className="text-xs text-muted-foreground truncate">{me.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-2 space-y-1.5" data-testid="usage">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Video minutes this month</span>
            <span className="font-mono">
              {me.minutesQuota == null ? `${me.minutesUsed} · unlimited` : `${me.minutesUsed} / ${me.minutesQuota}`}
            </span>
          </div>
          {me.minutesQuota != null && <Progress value={pct} className="h-1" />}
          <p className="text-[10px] text-muted-foreground">
            {me.role === "admin" ? "Admin" : `${me.plan} plan`} · resets {resets}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { window.location.href = "/app" }} className="gap-2">
          <LayoutGrid size={13} /> Videos
        </DropdownMenuItem>
        {me.role === "admin" && (
          <DropdownMenuItem onSelect={() => { window.location.href = "/admin" }} className="gap-2">
            <Shield size={13} /> Admin
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => { setFbKey((k) => k + 1); setFbOpen(true) }} className="gap-2" data-testid="send-feedback">
          <MessageSquare size={13} /> Send feedback
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={me.emailNotifications}
          onSelect={(e) => e.preventDefault()}
          onCheckedChange={toggleEmails}
          className="gap-2"
          data-testid="email-notifications"
        >
          <Mail size={13} /> Email me when videos are ready
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={logout} className="gap-2" data-testid="logout">
          <LogOut size={13} /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  )
}
