// lib/usage.ts — append-only usage ledger in <WORKSPACE>/usage.json.
// One entry per upload; deleting a job does not remove its entry, so usage
// can't be refunded by deleting videos.
import path from "path"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"
import type { User } from "./users"

export interface UsageEntry {
  userId: string
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

/** Seconds of video uploaded this month, per user id. */
export function secondsUsedByUser(now = Date.now()): Map<string, number> {
  const { start, end } = monthBounds(now)
  const totals = new Map<string, number>()
  for (const e of readLedger()) {
    if (e.at >= start && e.at < end) {
      totals.set(e.userId, (totals.get(e.userId) ?? 0) + (Number(e.durationSec) || 0))
    }
  }
  return totals
}

export function secondsUsedThisMonth(userId: string, now = Date.now()): number {
  return secondsUsedByUser(now).get(userId) ?? 0
}

/** Monthly quota in minutes, or null for unlimited (admins). */
export function quotaMinutes(user: User): number | null {
  return user.role === "admin" ? null : user.monthlyMinutes
}

export const toMinutes = (sec: number) => Math.round((sec / 60) * 10) / 10
