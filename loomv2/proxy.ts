// proxy.ts — when APP_PASSWORD is set, every page and API route requires a
// session cookie from /login. Unset (the default for local use), it's a no-op.
import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { SESSION_COOKIE, authEnabled, isValidSession } from "./lib/auth"

const PUBLIC_PATHS = ["/login", "/api/login", "/api/health"]

export async function proxy(request: NextRequest) {
  if (!authEnabled()) return NextResponse.next()

  const { pathname, search } = request.nextUrl
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()

  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next()
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const url = new URL("/login", request.url)
  url.searchParams.set("next", pathname + search)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except Next's static assets and public files
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
}
