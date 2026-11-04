"use client"

import { useCallback, useEffect, useState } from "react"
import { Check, Copy, Loader2, Ticket, Trash2 } from "lucide-react"
import Header from "@/components/Header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { redirectToLogin } from "@/components/UserMenu"

interface AdminUser {
  id: string
  email: string
  name: string
  role: "admin" | "member"
  createdAt: number
  disabled?: boolean
  minutesUsed: number
  teams: { id: string; name: string; role: "owner" | "member" | null }[]
}

interface AdminTeam {
  id: string
  name: string
  createdAt: number
  plan: string
  planName: string
  monthlyMinutes: number
  minutesUsed: number
  minutesQuota: number | null
  billing: { provider: string; status: string; currentPeriodEnd?: number; cancelAtPeriodEnd?: boolean } | null
  members: { userId: string; role: "owner" | "member"; email: string; name: string }[]
}

interface PlanOption { id: string; name: string; monthlyMinutes: number }

interface Invite {
  code: string
  email?: string
  createdAt: number
  usedAt?: number
  createdByEmail: string | null
  usedByEmail: string | null
  usedBy?: string
  teamName: string | null
}

interface WaitlistEntry {
  email: string
  name: string
  organisation: string
  useCase: string
  createdAt: number
}

interface FeedbackEntry {
  id: string
  email: string
  jobId?: string
  jobLabel: string | null
  jobExists: boolean
  message: string
  rating?: number
  createdAt: number
  userAgent: string
}

const fmtDateTime = (ts: number) =>
  new Date(ts).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  })
  if (res.status === 401) { redirectToLogin(); throw new Error("Not signed in") }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

const inviteLink = (code: string) => `${window.location.origin}/signup?invite=${encodeURIComponent(code)}`

function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm" variant="outline" className="gap-1.5"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text) } catch {}
        setCopied(true); setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : label}
    </Button>
  )
}

function QuotaCell({ team, onSave }: { team: AdminTeam; onSave: (minutes: number) => Promise<void> }) {
  const [draft, setDraft] = useState(String(team.monthlyMinutes))
  const [busy, setBusy] = useState(false)
  if (team.minutesQuota == null) return <span className="text-muted-foreground" title="Owned by an admin">unlimited</span>
  const dirty = draft !== String(team.monthlyMinutes)
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        try { await onSave(Number(draft)) } finally { setBusy(false) }
      }}
    >
      <Input
        aria-label={`Monthly minutes for ${team.name}`}
        type="number" min={0} step="any" value={draft}
        onChange={(e) => setDraft(e.target.value)}
        className="h-7 w-20 text-xs"
      />
      <Button type="submit" size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || busy || draft === ""}>
        {busy ? <Loader2 size={12} className="animate-spin" /> : "Save"}
      </Button>
    </form>
  )
}

export default function AdminPanel() {
  const [tab, setTab] = useState("users")
  const [users, setUsers] = useState<AdminUser[]>([])
  const [teams, setTeams] = useState<AdminTeam[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [me, setMe] = useState("")
  const [invites, setInvites] = useState<Invite[]>([])
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [feedback, setFeedback] = useState<FeedbackEntry[]>([])
  const [resetLink, setResetLink] = useState<{ email: string; url: string } | null>(null)

  async function createResetLink(id: string) {
    const res = await fetch("/api/admin/users/reset", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok) setResetLink({ email: data.email, url: `${window.location.origin}${data.path}` })
  }
  const [error, setError] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [newInvite, setNewInvite] = useState<Invite | null>(null)
  const [inviteEmailed, setInviteEmailed] = useState(false)
  const [creating, setCreating] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [u, t, i, w, f] = await Promise.all([
        api<{ users: AdminUser[]; me: string }>("/api/admin/users"),
        api<{ teams: AdminTeam[]; plans: PlanOption[] }>("/api/admin/teams"),
        api<{ invites: Invite[] }>("/api/admin/invites"),
        api<{ entries: WaitlistEntry[] }>("/api/admin/waitlist"),
        api<{ entries: FeedbackEntry[] }>("/api/admin/feedback"),
      ])
      setUsers(u.users); setMe(u.me); setTeams(t.teams); setPlans(t.plans); setInvites(i.invites); setWaitlist(w.entries); setFeedback(f.entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }, [])

  useEffect(() => {
    const load = async () => { await reload() }
    load()
  }, [reload])

  const patchUser = async (id: string, patch: Partial<AdminUser>) => {
    setError("")
    try {
      await api("/api/admin/users", { method: "PATCH", body: JSON.stringify({ id, ...patch }) })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

  const patchTeam = async (id: string, patch: { plan?: string; monthlyMinutes?: number }) => {
    setError("")
    try {
      await api("/api/admin/teams", { method: "PATCH", body: JSON.stringify({ id, ...patch }) })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    }
  }

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true); setError("")
    try {
      const { invite, emailed } = await api<{ invite: Invite; emailed: boolean }>("/api/admin/invites", {
        method: "POST", body: JSON.stringify({ email: inviteEmail }),
      })
      setNewInvite(invite); setInviteEmailed(emailed); setInviteEmail("")
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create invite")
    } finally {
      setCreating(false)
    }
  }

  const revokeInvite = async (code: string) => {
    setError("")
    try {
      await api("/api/admin/invites", { method: "DELETE", body: JSON.stringify({ code }) })
      if (newInvite?.code === code) setNewInvite(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't revoke invite")
    }
  }

  const unused = invites.filter((i) => !i.usedBy).length

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header />
      <div className="flex-1 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-base font-semibold">Admin</h1>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList>
                <TabsTrigger value="users">Users ({users.length})</TabsTrigger>
                <TabsTrigger value="teams">Teams ({teams.length})</TabsTrigger>
                <TabsTrigger value="invites">Invites ({unused} unused)</TabsTrigger>
                <TabsTrigger value="waitlist">Waitlist ({waitlist.length})</TabsTrigger>
                <TabsTrigger value="feedback">Feedback ({feedback.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>}

          {/* Invite creation is always visible: it's the most common admin task */}
          <div className="rounded-xl border p-4 space-y-3">
            <form onSubmit={createInvite} className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-medium shrink-0">
                <Ticket size={14} /> New invite
              </div>
              <Input
                type="email" placeholder="Lock to an email (optional)" value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)} className="h-8 sm:max-w-xs"
                aria-label="Invite email"
              />
              <Button type="submit" size="sm" disabled={creating} data-testid="create-invite">
                {creating && <Loader2 size={12} className="mr-1 animate-spin" />} Create invite
              </Button>
            </form>
            {newInvite && (
              <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3 sm:flex-row sm:items-center" data-testid="new-invite">
                {inviteEmailed && newInvite.email && (
                  <span className="text-xs text-emerald-700" data-testid="invite-emailed">Emailed to {newInvite.email}.</span>
                )}
                <code className="flex-1 break-all text-xs" data-testid="invite-link">{inviteLink(newInvite.code)}</code>
                <CopyButton text={inviteLink(newInvite.code)} />
              </div>
            )}
          </div>

          {tab === "users" && resetLink && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm" data-testid="reset-link-box">
              <span className="text-amber-900">Reset link for <b>{resetLink.email}</b> (single use, expires in 24 h):</span>
              <code className="max-w-full truncate rounded bg-white px-2 py-1 text-xs" data-testid="reset-link">{resetLink.url}</code>
              <CopyButton text={resetLink.url} />
              <button type="button" className="ml-auto text-xs text-amber-900 underline" onClick={() => setResetLink(null)}>Dismiss</button>
            </div>
          )}

          {tab === "users" && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium">Role</th>
                    <th className="px-3 py-2 font-medium">Teams</th>
                    <th className="px-3 py-2 font-medium">Uploaded this month (min)</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-t align-middle" data-testid={`user-row-${u.email}`}>
                      <td className="px-3 py-2">
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={u.role === "admin" ? "default" : "outline"} className="text-[10px]">{u.role}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {u.teams.map((t) => (
                          <span key={t.id} className="block truncate max-w-48" title={t.name}>
                            {t.name}{t.role === "owner" && <span className="text-muted-foreground"> · owner</span>}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{u.minutesUsed}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(u.createdAt)}</td>
                      <td className="px-3 py-2">
                        {u.id === me ? (
                          <span className="text-xs text-muted-foreground">you</span>
                        ) : (
                          <Button
                            size="sm" variant={u.disabled ? "default" : "outline"}
                            onClick={() => patchUser(u.id, { disabled: !u.disabled })}
                            data-testid={`toggle-${u.email}`}
                          >
                            {u.disabled ? "Enable" : "Disable"}
                          </Button>
                        )}
                        {u.disabled && <Badge variant="destructive" className="ml-2 text-[10px]">disabled</Badge>}
                        {!u.disabled && (
                          <Button size="sm" variant="ghost" className="ml-1" onClick={() => createResetLink(u.id)}
                            title="Create a single-use link that lets this user set a new password"
                            data-testid={`reset-${u.email}`}>
                            Reset link
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "teams" && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Team</th>
                    <th className="px-3 py-2 font-medium">Members</th>
                    <th className="px-3 py-2 font-medium">Plan</th>
                    <th className="px-3 py-2 font-medium">Used this month</th>
                    <th className="px-3 py-2 font-medium">Monthly quota (min)</th>
                    <th className="px-3 py-2 font-medium">Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((t) => (
                    <tr key={t.id} className="border-t align-middle" data-testid={`team-row-${t.name}`}>
                      <td className="px-3 py-2">
                        <p className="font-medium">{t.name}</p>
                        <p className="text-xs text-muted-foreground">created {fmtDate(t.createdAt)}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {t.members.map((m) => (
                          <span key={m.userId} className="block truncate max-w-56" title={m.email}>
                            {m.email}{m.role === "owner" && <span className="text-muted-foreground"> · owner</span>}
                          </span>
                        ))}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Plan for ${t.name}`} value={t.plan}
                          onChange={(e) => patchTeam(t.id, { plan: e.target.value })}
                          className="h-7 rounded-md border bg-background px-1.5 text-xs"
                          data-testid={`plan-${t.name}`}
                        >
                          {!plans.some((p) => p.id === t.plan) && <option value={t.plan}>{t.planName}</option>}
                          {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                        {t.minutesUsed} {t.minutesQuota != null && <span className="text-muted-foreground">/ {t.minutesQuota}</span>}
                      </td>
                      <td className="px-3 py-2">
                        <QuotaCell key={t.monthlyMinutes} team={t} onSave={(m) => patchTeam(t.id, { monthlyMinutes: m })} />
                      </td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap">
                        {t.billing
                          ? <>{t.billing.provider} · {t.billing.status}{t.billing.cancelAtPeriodEnd ? " (cancels)" : ""}
                              {t.billing.currentPeriodEnd && <span className="block text-muted-foreground">until {fmtDate(t.billing.currentPeriodEnd)}</span>}</>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "invites" && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Code</th>
                    <th className="px-3 py-2 font-medium">For</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {invites.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground">No invites yet</td></tr>
                  )}
                  {invites.map((i) => (
                    <tr key={i.code} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">{i.code}</td>
                      <td className="px-3 py-2 text-xs">
                        {i.email ?? <span className="text-muted-foreground">anyone</span>}
                        {i.teamName && <span className="block text-muted-foreground">to team {i.teamName}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(i.createdAt)}</td>
                      <td className="px-3 py-2 text-xs">
                        {i.usedBy
                          ? <Badge variant="secondary" className="text-[10px]">used by {i.usedByEmail ?? "deleted user"}</Badge>
                          : <Badge variant="outline" className="text-[10px]">unused</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {!i.usedBy && (
                          <div className="flex justify-end gap-1.5">
                            <CopyButton text={inviteLink(i.code)} />
                            <Button size="sm" variant="ghost" aria-label="Revoke invite" onClick={() => revokeInvite(i.code)}>
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "waitlist" && (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Person</th>
                    <th className="px-3 py-2 font-medium">Organisation</th>
                    <th className="px-3 py-2 font-medium">Use case</th>
                    <th className="px-3 py-2 font-medium">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {waitlist.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">Nobody on the waitlist yet</td></tr>
                  )}
                  {waitlist.map((w) => (
                    <tr key={w.email} className="border-t align-top">
                      <td className="px-3 py-2">
                        <p className="font-medium">{w.name}</p>
                        <p className="text-xs text-muted-foreground">{w.email}</p>
                      </td>
                      <td className="px-3 py-2 text-xs">{w.organisation || "—"}</td>
                      <td className="px-3 py-2 text-xs max-w-md whitespace-pre-wrap">{w.useCase || "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(w.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "feedback" && (
            <div className="space-y-2" data-testid="feedback-list">
              {feedback.length === 0 && (
                <p className="rounded-xl border px-3 py-6 text-center text-xs text-muted-foreground">No feedback yet</p>
              )}
              {feedback.map((f) => (
                <div key={f.id} className="rounded-xl border p-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{f.email}</span>
                    <span>{fmtDateTime(f.createdAt)}</span>
                    {f.rating && (
                      <span className="text-amber-500" aria-label={`${f.rating} of 5`}>
                        {"★".repeat(f.rating)}<span className="text-muted-foreground/40">{"★".repeat(5 - f.rating)}</span>
                      </span>
                    )}
                    {f.jobId && (
                      f.jobExists
                        ? <a href={`/app?job=${f.jobId}`} className="underline underline-offset-2 hover:text-foreground">
                            Video: {f.jobLabel ?? f.jobId.slice(0, 8)}
                          </a>
                        : <span>Video {f.jobId.slice(0, 8)} (deleted)</span>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap break-words">{f.message}</p>
                  <p className="text-[10px] text-muted-foreground truncate" title={f.userAgent}>{f.userAgent}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
