// lib/access.ts — per-request auth for route handlers and server components.
//
// proxy.ts only checks that the session cookie is validly signed and
// unexpired. Every route handler must still call one of these, which load the
// user from users.json (so disabled accounts are rejected immediately) and,
// for state-changing methods, reject cross-site requests.
//
//   const access = await requireJobAccess(req, jobId)
//   if (access instanceof Response) return access
//   const { user, job } = access
import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./auth"
import { isSameOrigin, isStateChanging } from "./csrf"
import { getUserById, type User } from "./users"
import { getJob, type Job } from "./jobStore"
import { isValidJobId } from "./jobPaths"

type Req = NextRequest | Request

function sessionToken(req: Req): string | undefined {
  if ("cookies" in req) return req.cookies.get(SESSION_COOKIE)?.value
  const header = (req as Request).headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="))
  }
  return undefined
}

/** The signed-in user for a token, or null (missing, invalid, expired, deleted or disabled). */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  const session = await verifySession(token)
  if (!session) return null
  const user = getUserById(session.uid)
  return user && !user.disabled && !revoked(session, user) ? user : null
}

/** Sessions issued before the user's last password reset no longer count. */
function revoked(session: SessionPayload, user: User): boolean {
  if (!user.sessionsValidAfter) return false
  // Second-granularity iat: allow the session issued in the same second as the reset
  return (session.iat ?? 0) * 1000 < Math.floor(user.sessionsValidAfter / 1000) * 1000
}

/** For server components / pages. */
export async function currentUser(): Promise<User | null> {
  const store = await cookies()
  return userFromToken(store.get(SESSION_COOKIE)?.value)
}

export function crossSiteBlocked(req: Req): Response | null {
  if (isStateChanging(req.method) && !isSameOrigin(req.headers)) {
    return NextResponse.json({ error: "Cross-site request blocked" }, { status: 403 })
  }
  return null
}

export async function requireUser(req: Req): Promise<User | Response> {
  const blocked = crossSiteBlocked(req)
  if (blocked) return blocked
  const session = await verifySession(sessionToken(req))
  const found = session ? getUserById(session.uid) : undefined
  const user = found && session && !revoked(session, found) ? found : undefined
  if (!user || user.disabled) {
    const res = NextResponse.json(
      { error: user?.disabled ? "This account has been disabled" : "Not signed in" },
      { status: 401 }
    )
    if (session) res.cookies.delete(SESSION_COOKIE)
    return res
  }
  return user
}

/** Admin-only routes answer 404 to everyone else, so they don't advertise themselves. */
export async function requireAdmin(req: Req): Promise<User | Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  if (user.role !== "admin") return NextResponse.json({ error: "Not found" }, { status: 404 })
  return user
}

/** Admins see every job; members only jobs they uploaded. Legacy jobs (no owner) are admin-only. */
export function canAccessJob(user: User, job: Pick<Job, "ownerId">): boolean {
  return user.role === "admin" || (!!job.ownerId && job.ownerId === user.id)
}

/**
 * Signed-in user + a job they may access. Someone else's job is a 404, the
 * same as a job that doesn't exist.
 */
export async function requireJobAccess(
  req: Req,
  jobId: string | null | undefined
): Promise<{ user: User; job: Job } | Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  if (!isValidJobId(jobId)) return NextResponse.json({ error: "Missing or invalid jobId" }, { status: 400 })
  const job = getJob(jobId)
  if (!job || !canAccessJob(user, job)) return NextResponse.json({ error: "Job not found" }, { status: 404 })
  return { user, job }
}
