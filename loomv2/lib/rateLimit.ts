// lib/rateLimit.ts — naive fixed-window, in-memory rate limiting.
// Per server process only (fine for a single-instance pilot); state lives on
// globalThis so every route bundle shares it.

interface Bucket { count: number; resetAt: number }

const g = globalThis as unknown as { __otRateLimit?: Map<string, Bucket> }
const buckets: Map<string, Bucket> = (g.__otRateLimit ??= new Map())

function sweep(now: number) {
  if (buckets.size < 5000) return
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k)
}

/**
 * Count one attempt against `key`. Returns ok=false once more than `limit`
 * attempts happened inside the current window.
 */
export function consume(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now()
  sweep(now)
  let b = buckets.get(key)
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs }
    buckets.set(key, b)
  }
  b.count++
  return { ok: b.count <= limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) }
}

export function reset(key: string): void {
  buckets.delete(key)
}

/** Best-effort client IP. X-Forwarded-For is only trustworthy behind a proxy that sets it. */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "local"
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
