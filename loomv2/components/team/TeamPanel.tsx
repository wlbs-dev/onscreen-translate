"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Check, Copy, Loader2, Pencil, Trash2, UserPlus, Users } from "lucide-react"
import Header from "@/components/Header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { redirectToLogin } from "@/components/UserMenu"

interface TeamInfo {
  team: { id: string; name: string; plan: string; planName: string; createdAt: number }
  role: "owner" | "member" | null
  me: string
  members: { userId: string; name: string; email: string; role: "owner" | "member"; addedAt: number }[]
  invites: { code: string; email?: string; createdAt: number }[]
  minutesUsed: number
  minutesQuota: number | null
  resetsAt: number
  mailConfigured: boolean
}

const fmtDate = (ts: number) =>
  new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: init?.body ? { "Content-Type": "application/json" } : undefined })
  if (res.status === 401) { redirectToLogin(); throw new Error("Not signed in") }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

export function CopyButton({ text, label = "Copy link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={async () => {
      try { await navigator.clipboard.writeText(text) } catch {}
      setCopied(true); setTimeout(() => setCopied(false), 1500)
    }}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : label}
    </Button>
  )
}

const inviteLink = (code: string) => `${window.location.origin}/signup?invite=${encodeURIComponent(code)}`

export default function TeamPanel() {
  const [info, setInfo] = useState<TeamInfo | null>(null)
  const [error, setError] = useState("")
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ email: string; link: string; emailed: boolean } | null>(null)

  const reload = useCallback(async () => {
    try { setInfo(await api<TeamInfo>("/api/team")) } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load")
    }
  }, [])
  useEffect(() => { const load = async () => { await reload() }; load() }, [reload])

  const run = async (fn: () => Promise<unknown>) => {
    setError(""); setBusy(true)
    try { await fn(); await reload() } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally { setBusy(false) }
  }

  if (!info) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Header />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          {error || <><Loader2 size={14} className="animate-spin" /> Loading team…</>}
        </div>
      </div>
    )
  }

  const owner = info.role === "owner"
  const owners = info.members.filter((m) => m.role === "owner").length
  const pct = info.minutesQuota ? Math.min(100, (info.minutesUsed / info.minutesQuota) * 100) : 0

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Header onBack={() => { window.location.href = "/app" }} />
      <div className="flex-1 p-4 sm:p-6">
        <div className="max-w-3xl mx-auto space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <Users size={18} className="text-muted-foreground" />
            {editing ? (
              <form className="flex items-center gap-2" onSubmit={(e) => {
                e.preventDefault()
                run(async () => {
                  await api("/api/team", { method: "PATCH", body: JSON.stringify({ name }) })
                  setEditing(false)
                })
              }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="h-8 w-64" autoFocus aria-label="Team name" />
                <Button size="sm" type="submit" disabled={busy || !name.trim()}>Save</Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setEditing(false)}>Cancel</Button>
              </form>
            ) : (
              <>
                <h1 className="text-base font-semibold" data-testid="team-name">{info.team.name}</h1>
                {owner && (
                  <Button size="sm" variant="ghost" className="gap-1 text-muted-foreground" data-testid="rename-team"
                    onClick={() => { setName(info.team.name); setEditing(true) }}>
                    <Pencil size={12} /> Rename
                  </Button>
                )}
              </>
            )}
            <Badge variant="outline" className="ml-auto text-[10px]">{info.role === "owner" ? "You're the owner" : "Member"}</Badge>
          </div>

          {error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive" role="alert">{error}</p>}

          <div className="rounded-xl border p-4 space-y-2" data-testid="team-usage">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span><span className="font-medium">{info.team.planName}</span> plan</span>
              <span className="font-mono text-xs">
                {info.minutesQuota == null ? `${info.minutesUsed} min · unlimited` : `${info.minutesUsed} / ${info.minutesQuota} min this month`}
              </span>
            </div>
            {info.minutesQuota != null && <Progress value={pct} className="h-1.5" />}
            <p className="text-xs text-muted-foreground">
              Everyone in the team shares these minutes and sees every video uploaded to the team.{" "}
              <Link href="/app/billing" className="underline underline-offset-2 hover:text-foreground">{owner ? "Change plan" : "See plan"}</Link>
            </p>
          </div>

          {owner && (
            <div className="rounded-xl border p-4 space-y-3">
              <form className="flex flex-col gap-2 sm:flex-row sm:items-center" onSubmit={(e) => {
                e.preventDefault()
                run(async () => {
                  const r = await api<{ link: string; emailed: boolean }>("/api/team/invites", { method: "POST", body: JSON.stringify({ email }) })
                  setSent({ email, link: r.link, emailed: r.emailed }); setEmail("")
                })
              }}>
                <div className="flex items-center gap-2 text-sm font-medium shrink-0"><UserPlus size={14} /> Invite a teammate</div>
                <Input type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="h-8 sm:max-w-xs" aria-label="Teammate email" data-testid="team-invite-email" required />
                <Button size="sm" type="submit" disabled={busy || !email} data-testid="team-invite-submit">Send invite</Button>
              </form>
              {sent && (
                <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs" data-testid="team-invite-result">
                  <p>
                    {sent.emailed
                      ? <>Invite emailed to <b>{sent.email}</b>. You can also send them this link:</>
                      : <>{info.mailConfigured ? "We couldn't send the email" : "Email isn't set up on this server"}, so send <b>{sent.email}</b> this link yourself (it works once, for that address):</>}
                  </p>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="flex-1 break-all" data-testid="team-invite-link">{sent.link}</code>
                    <CopyButton text={sent.link} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Member</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {info.members.map((m) => {
                  const isMe = m.userId === info.me
                  const lastOwner = m.role === "owner" && owners <= 1
                  return (
                    <tr key={m.userId} className="border-t" data-testid={`member-${m.email}`}>
                      <td className="px-3 py-2">
                        <p className="font-medium">{m.name}{isMe && <span className="ml-1 text-xs font-normal text-muted-foreground">(you)</span>}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={m.role === "owner" ? "default" : "outline"} className="text-[10px]">{m.role}</Badge>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmtDate(m.addedAt)}</td>
                      <td className="px-3 py-2 text-right">
                        {isMe && !lastOwner && (
                          <Button size="sm" variant="outline" disabled={busy} data-testid="leave-team"
                            onClick={() => {
                              if (!confirm(`Leave ${info.team.name}? You'll lose access to its videos.`)) return
                              run(async () => {
                                await api("/api/team/members", { method: "DELETE", body: JSON.stringify({ userId: m.userId }) })
                                window.location.href = "/app"
                              })
                            }}>
                            Leave team
                          </Button>
                        )}
                        {!isMe && owner && !lastOwner && (
                          <Button size="sm" variant="ghost" disabled={busy} data-testid={`remove-${m.email}`}
                            onClick={() => {
                              if (!confirm(`Remove ${m.name} from ${info.team.name}?`)) return
                              run(() => api("/api/team/members", { method: "DELETE", body: JSON.stringify({ userId: m.userId }) }))
                            }}>
                            Remove
                          </Button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {owner && info.invites.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-sm font-medium">Pending invites</h2>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <tbody>
                    {info.invites.map((i) => (
                      <tr key={i.code} className="border-t first:border-t-0" data-testid={`pending-${i.email}`}>
                        <td className="px-3 py-2 text-xs">{i.email}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">sent {fmtDate(i.createdAt)}</td>
                        <td className="px-3 py-2 text-right whitespace-nowrap">
                          <div className="flex justify-end gap-1.5">
                            <CopyButton text={inviteLink(i.code)} />
                            <Button size="sm" variant="ghost" aria-label="Revoke invite" disabled={busy}
                              onClick={() => run(() => api("/api/team/invites", { method: "DELETE", body: JSON.stringify({ code: i.code }) }))}>
                              <Trash2 size={12} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
