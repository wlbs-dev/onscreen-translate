// lib/waitlist.ts — landing-page waitlist in <WORKSPACE>/waitlist.json.
import path from "path"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"

export interface WaitlistEntry {
  email: string
  name: string
  organisation: string
  useCase: string
  createdAt: number
  updatedAt?: number
}

const WAITLIST_FILE = path.join(WORKSPACE, "waitlist.json")

export function listWaitlist(): WaitlistEntry[] {
  const entries = readJsonFile<WaitlistEntry[]>(WAITLIST_FILE, [])
  return Array.isArray(entries) ? entries : []
}

/** Add an entry; a repeat signup with the same email updates the old one. */
export function addToWaitlist(entry: Omit<WaitlistEntry, "createdAt" | "updatedAt">): void {
  const entries = listWaitlist()
  const existing = entries.find((e) => e.email === entry.email)
  if (existing) {
    Object.assign(existing, entry, { updatedAt: Date.now() })
  } else {
    entries.push({ ...entry, createdAt: Date.now() })
  }
  writeJsonFileAtomic(WAITLIST_FILE, entries)
}
