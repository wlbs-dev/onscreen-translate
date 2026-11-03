// lib/auth.ts — signed session cookies.
//
// Cookie value: base64url(JSON {uid, exp}) + "." + base64url(HMAC-SHA256).
// Signing uses Web Crypto so the same code runs in proxy.ts and in route
// handlers. The proxy only checks the signature and expiry; route handlers
// (lib/access.ts) also load the user and reject disabled accounts.
import { getSessionSecret } from "./sessionSecret"

export const SESSION_COOKIE = "ot_session"
export const SESSION_MAX_AGE = 60 * 60 * 24 * 14 // 14 days, in seconds

export interface SessionPayload {
  uid: string
  exp: number // unix seconds
}

const enc = new TextEncoder()

function b64urlEncode(bytes: Uint8Array): string {
  let bin = ""
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)
  const bin = atob(b64)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

let keyPromise: { secret: string; key: Promise<CryptoKey> } | null = null

function hmacKey(): Promise<CryptoKey> {
  const secret = getSessionSecret()
  if (keyPromise?.secret !== secret) {
    keyPromise = {
      secret,
      key: crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
      ),
    }
  }
  return keyPromise.key
}

export async function signSession(uid: string, maxAgeSec = SESSION_MAX_AGE): Promise<string> {
  const payload: SessionPayload = { uid, exp: Math.floor(Date.now() / 1000) + maxAgeSec }
  const body = b64urlEncode(enc.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body)))
  return `${body}.${b64urlEncode(sig)}`
}

/** Returns the payload if the token is well-formed, validly signed and unexpired. */
export async function verifySession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token || token.length > 1024) return null
  const dot = token.indexOf(".")
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return null
  const body = token.slice(0, dot)
  const sigPart = token.slice(dot + 1)
  try {
    // crypto.subtle.verify compares in constant time
    const sig = b64urlDecode(sigPart)
    const ok = await crypto.subtle.verify(
      "HMAC", await hmacKey(), sig as Uint8Array<ArrayBuffer>, enc.encode(body)
    )
    if (!ok) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as SessionPayload
    if (typeof payload?.uid !== "string" || typeof payload?.exp !== "number") return null
    if (payload.exp * 1000 <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** Cookie attributes shared by login, signup and logout. */
export function sessionCookieOptions(req: Request) {
  const url = new URL(req.url)
  const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  }
}
