// lib/csrf.ts — reject cross-site state-changing requests.
// Session cookies are SameSite=Lax, which already blocks most cross-site
// POSTs; this also covers same-site subdomains and older browsers.

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])

export function isStateChanging(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase())
}

/**
 * True if the request came from this site. Modern browsers send
 * Sec-Fetch-Site; otherwise compare Origin with the Host. Requests with
 * neither header aren't from a browser (curl, scripts) and can't be CSRF.
 */
export function isSameOrigin(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site")
  if (site) return site === "same-origin" || site === "none"
  const origin = headers.get("origin")
  if (!origin) return true
  if (origin === "null") return false
  const host = headers.get("x-forwarded-host") ?? headers.get("host")
  try {
    return !!host && new URL(origin).host === host
  } catch {
    return false
  }
}
