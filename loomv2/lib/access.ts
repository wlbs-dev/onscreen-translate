// lib/access.ts — per-request auth for route handlers and server components.
//
// proxy.ts only checks that the session cookie is validly signed and
// unexpired. Every route handler must still call one of these, which load the
// user from users.json (so disabled accounts are rejected immediately) and,
// for state-changing methods, reject cross-site requests.
//
// Jobs belong to teams: admins see every job; anyone else must be a member of
// the job's team. The active team (uploads, dashboard, quota) comes from the
// ot_team cookie, re-validated against membership on every request.
//
//   const access = await requireJobAccess(req, jobId)
//   if (access instanceof Response) return access
//   const { user, job } = access
import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"
import { SESSION_COOKIE, verifySession, type SessionPayload } from "./auth"
import { isSameOrigin, isStateChanging } from "./csrf"
import { getUserById, type User } from "./users"
import { getJob, updateJob, type Job } from "./jobStore"
import { isValidJobId } from "./jobPaths"
import { ensureUserTeam, getTeam, isMember, isOwner, legacyTeamOf, type Team } from "./teams"

export const TEAM_COOKIE = "ot_team"

type Req = NextRequest | Request

function readCookie(req: Req, name: string): string | undefined {
  if ("cookies" in req) return req.cookies.get(name)?.value
  const header = (req as Request).headers.get("cookie") ?? ""
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=")
    if (k === name) return decodeURIComponent(v.join("="))
  }
  return undefined
}

const sessionToken = (req: Req) => readCookie(req, SESSION_COOKIE)

/** The signed-in user for a token, or null (missing, invalid, expired, deleted or disabled). */
export async function userFromToken(token: string | undefined): Promise<User | null> {
  const session = await verifySession(token)
  if (!session) return null
  const user = getUserById(session.uid)
  if (!user || user.disabled || revoked(session, user)) return null
  // Pre-teams users get their personal team the first time they're loaded
  ensureUserTeam(user)
  return user
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

/** The active team: the ot_team cookie if the user is a member of it, else their first team. */
export function pickActiveTeam(user: User, cookieTeamId: string | undefined): Team {
  const teams = ensureUserTeam(user)
  return teams.find((t) => t.id === cookieTeamId) ?? teams[0]
}

export function activeTeam(req: Req, user: User): Team {
  return pickActiveTeam(user, readCookie(req, TEAM_COOKIE))
}

/** For server components / pages. */
export async function currentTeam(user: User): Promise<Team> {
  const store = await cookies()
  return pickActiveTeam(user, store.get(TEAM_COOKIE)?.value)
}

export function teamCookieOptions(req: Req) {
  const url = new URL(req.url)
  const secure = url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https"
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: 60 * 60 * 24 * 365 }
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
  ensureUserTeam(user)
  return user
}

/** Admin-only routes answer 404 to everyone else, so they don't advertise themselves. */
export async function requireAdmin(req: Req): Promise<User | Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  if (user.role !== "admin") return NextResponse.json({ error: "Not found" }, { status: 404 })
  return user
}

/** Signed-in user + their active team; `owner: true` also requires them to own it (403 otherwise). */
export async function requireTeam(
  req: Req,
  opts: { owner?: boolean } = {}
): Promise<{ user: User; team: Team } | Response> {
  const user = await requireUser(req)
  if (user instanceof Response) return user
  const team = activeTeam(req, user)
  if (opts.owner && !isOwner(team, user.id)) {
    return NextResponse.json({ error: "Only the team owner can do that" }, { status: 403 })
  }
  return { user, team }
}

/**
 * The job's team id. Jobs from before teams have only ownerId: they move to
 * the owner's migrated personal team (saved, so this happens once). Jobs with
 * neither, or whose owner no longer exists, have no team (admin-only).
 */
export function jobTeamId(job: Job): string | undefined {
  if (job.teamId) return job.teamId
  if (!job.ownerId) return undefined
  const owner = getUserById(job.ownerId)
  if (!owner) return undefined
  const teams = ensureUserTeam(owner)
  const team = legacyTeamOf(owner.id) ?? teams.find((t) => t.personal) ?? teams[0]
  updateJob(job.id, { teamId: team.id })
  job.teamId = team.id
  return team.id
}

/** Admins see every job; everyone else the jobs of the teams they're a member of. */
export function canAccessJob(user: User, job: Job): boolean {
  if (user.role === "admin") return true
  const teamId = jobTeamId(job)
  const team = teamId ? getTeam(teamId) : undefined
  return !!team && isMember(team, user.id)
}

/**
 * Signed-in user + a job they may access. A job outside their teams is a
 * 404, the same as a job that doesn't exist.
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
