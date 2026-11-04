// proxy.ts — first line of defence (Next 16's renamed middleware; Node runtime).
//  1. Cross-site state-changing requests are rejected (CSRF).
//  2. Everything except the public pages/endpoints needs a validly signed,
//     unexpired session cookie: pages redirect to /login, API calls get 401.
// It doesn't load the user: route handlers and pages do that (lib/access.ts),
// which is where disabled accounts and job ownership are enforced.
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE, verifySession } from "./lib/auth"
import { isSameOrigin, isStateChanging } from "./lib/csrf"

const PUBLIC_PATHS = new Set([
  "/", "/login", "/signup", "/reset", "/forgot",
  "/api/login", "/api/logout", "/api/signup", "/api/reset", "/api/forgot", "/api/waitlist", "/api/health",
  "/api/fonts", // the bundled OFL fonts; the landing page uses them for native script names
])

// Payment provider webhooks: server-to-server, so no session cookie and no
// browser Origin. They verify their own HMAC signatures. (Also left out of
// the matcher below; listed here too in case the matcher changes.)
const WEBHOOK_PATHS = new Set(["/api/billing/razorpay/webhook", "/api/billing/stripe/webhook"])

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (WEBHOOK_PATHS.has(pathname)) return NextResponse.next()

  if (isStateChanging(request.method) && !isSameOrigin(request.headers)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 })
  }

  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next()

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 })
  }
  const url = new URL("/login", request.url)
  url.search = ""
  url.searchParams.set("next", pathname + search)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except Next's static assets and public files — and the two
  // routes with large request bodies: when proxy runs, Next buffers the body
  // and truncates it at 10 MB (proxyClientMaxBodySize). /api/upload and
  // /api/detections do the full session + CSRF + ownership checks themselves.
  // Billing webhooks are skipped too: they read the raw body for signatures.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/upload|api/detections|api/billing/razorpay/webhook|api/billing/stripe/webhook|.*\\.(?:svg|png|jpg|ico)$).*)"],
}
