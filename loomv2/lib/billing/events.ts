// lib/billing/events.ts — webhook idempotency: event ids already processed,
// in <WORKSPACE>/billing_events.json. Providers retry deliveries, so the same
// event can arrive more than once; it must only be applied once.
import path from "path"
import { WORKSPACE } from "../workspace"
import { readJsonFile, writeJsonFileAtomic } from "../jsonFile"

export interface ProcessedEvent {
  provider: "razorpay" | "stripe"
  id: string
  type: string
  at: number
  result: string
}

const EVENTS_FILE = path.join(WORKSPACE, "billing_events.json")
const KEEP = 10_000

function load(): ProcessedEvent[] {
  const all = readJsonFile<ProcessedEvent[]>(EVENTS_FILE, [])
  return Array.isArray(all) ? all : []
}

export function isProcessed(provider: ProcessedEvent["provider"], id: string): boolean {
  return load().some((e) => e.provider === provider && e.id === id)
}

export function markProcessed(e: ProcessedEvent): void {
  const all = load()
  all.push(e)
  writeJsonFileAtomic(EVENTS_FILE, all.slice(-KEEP))
}
