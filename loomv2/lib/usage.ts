// lib/usage.ts — append-only usage ledger in <WORKSPACE>/usage.json.
// One entry per upload; deleting a job does not remove its entry, so usage
// can't be refunded by deleting videos. Quotas are per team; entries from
// before teams existed (no teamId) count against the uploader's migrated
// personal team.
import path from "path"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"
import { getUserById } from "./users"
import { listTeams, type Team } from "./teams"

export interface UsageEntry {
  userId: string
  teamId?: string  // missing on entries recorded before teams
  jobId: string
  durationSec: number
  at: number
}

const USAGE_FILE = path.join(WORKSPACE, "usage.json")

function readLedger(): UsageEntry[] {
  const entries = readJsonFile<UsageEntry[]>(USAGE_FILE, [])
  return Array.isArray(entries) ? entries : []
}

export function recordUsage(entry: UsageEntry): void {
  const entries = readLedger()
  entries.push(entry)
  writeJsonFileAtomic(USAGE_FILE, entries)
}

/** Start of the current calendar month (UTC) and of the next one. */
export function monthBounds(now = Date.now()): { start: number; end: number } {
  const d = new Date(now)
  return {
    start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1),
    end:   Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1),
  }
}

function thisMonth(now: number): UsageEntry[] {
  const { start, end } = monthBounds(now)
  return readLedger().filter((e) => e.at >= start && e.at < end)
}

/** Seconds of video uploaded this month, per user id (any team). */
export function secondsUsedByUser(now = Date.now()): Map<string, number> {
  const totals = new Map<string, number>()
  for (const e of thisMonth(now)) totals.set(e.userId, (totals.get(e.userId) ?? 0) + (Number(e.durationSec) || 0))
  return totals
}

/** Seconds of video uploaded this month, per team id. */
export function secondsUsedByTeam(now = Date.now()): Map<string, number> {
  const legacy = new Map<string, string>()
  for (const t of listTeams(now)) if (t.migratedFromUser) legacy.set(t.migratedFromUser, t.id)
  const totals = new Map<string, number>()
  for (const e of thisMonth(now)) {
    const teamId = e.teamId ?? legacy.get(e.userId)
    if (teamId) totals.set(teamId, (totals.get(teamId) ?? 0) + (Number(e.durationSec) || 0))
  }
  return totals
}

export function teamSecondsUsedThisMonth(teamId: string, now = Date.now()): number {
  return secondsUsedByTeam(now).get(teamId) ?? 0
}

/**
 * A team's monthly quota in minutes, or null for unlimited. Admins are
 * unlimited, so teams owned by an admin are too.
 */
export function teamQuotaMinutes(team: Team): number | null {
  const adminOwned = team.members.some((m) => m.role === "owner" && getUserById(m.userId)?.role === "admin")
  return adminOwned ? null : team.monthlyMinutes
}

export const toMinutes = (sec: number) => Math.round((sec / 60) * 10) / 10
