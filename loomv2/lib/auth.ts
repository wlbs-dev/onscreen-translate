// lib/auth.ts — optional shared-password gate (set APP_PASSWORD to enable).
// Uses Web Crypto only so it runs in proxy.ts as well as route handlers.

export const SESSION_COOKIE = "ot_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14 // 14 days

export function authEnabled(): boolean {
  return !!process.env.APP_PASSWORD
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  )
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message))
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Session token derived from the password: changing APP_PASSWORD logs everyone out. */
export async function sessionToken(): Promise<string> {
  return hmacHex(process.env.APP_PASSWORD ?? "", "onscreen-translate-session-v1")
}

export async function isValidSession(token: string | undefined): Promise<boolean> {
  if (!authEnabled()) return true
  if (!token) return false
  return timingSafeEqual(token, await sessionToken())
}

export async function checkPassword(candidate: unknown): Promise<boolean> {
  if (typeof candidate !== "string" || !authEnabled()) return false
  // Compare HMACs so the comparison length doesn't depend on the input
  const [a, b] = await Promise.all([
    hmacHex("pw", candidate),
    hmacHex("pw", process.env.APP_PASSWORD ?? ""),
  ])
  return timingSafeEqual(a, b)
}
