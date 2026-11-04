// lib/teams.ts — teams in <WORKSPACE>/teams.json (array, atomic writes).
//
// Every user belongs to at least one team. Jobs, the monthly minutes quota and
// the plan/billing belong to a team; members of a team see and edit all of
// its videos. Users from before teams existed get a personal team the first
// time they're loaded (ensureUserTeam), carrying over their plan and quota.
import path from "path"
import { randomUUID } from "crypto"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"
import { PLANS, type PaidPlanId } from "./plans"
import { defaultMonthlyMinutes, defaultPlan, type User } from "./users"

export type TeamRole = "owner" | "member"

export interface TeamMember {
  userId: string
  role: TeamRole
  addedAt: number
}

export type BillingProvider = "razorpay" | "stripe"

export interface TeamBilling {
  provider: BillingProvider
  /** pending: checkout started, no webhook yet. Only webhooks set the others. */
  status: "pending" | "active" | "past_due" | "cancelled" | "halted" | "ended"
  plan?: PaidPlanId
  subscriptionId?: string
  customerId?: string
  /** ms — end of the paid period */
  currentPeriodEnd?: number
  /** Cancelled but paid until currentPeriodEnd */
  cancelAtPeriodEnd?: boolean
  /** ms — drop to the free plan at this time */
  downgradeAt?: number
  updatedAt: number
}

export interface Team {
  id: string
  name: string
  createdAt: number
  plan: string            // lib/plans.ts id, or a custom label set by an admin
  monthlyMinutes: number  // video minutes per calendar month (UTC)
  members: TeamMember[]
  billing?: TeamBilling
  /** Created automatically for one user (signup or migration) */
  personal?: boolean
  /** Created by migrating this pre-teams user: their old usage entries count here */
  migratedFromUser?: string
}

const TEAMS_FILE = path.join(WORKSPACE, "teams.json")
const TEAM_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const isValidTeamId = (id: unknown): id is string => typeof id === "string" && TEAM_ID_RE.test(id)

export const personalTeamName = (name: string) => `${name.trim() || "My"}'s team`.slice(0, 80)

function load(): Team[] {
  const teams = readJsonFile<Team[]>(TEAMS_FILE, [])
  return Array.isArray(teams) ? teams : []
}

function save(teams: Team[]): void {
  writeJsonFileAtomic(TEAMS_FILE, teams)
}

/** Drop to free once a cancelled subscription's paid period is over. Mutates; true if changed. */
function applyDueDowngrade(team: Team, now: number): boolean {
  const b = team.billing
  if (!b?.downgradeAt || b.downgradeAt > now) return false
  team.plan = "free"
  team.monthlyMinutes = PLANS.free.monthlyMinutes
  team.billing = { ...b, status: "ended", downgradeAt: undefined, cancelAtPeriodEnd: false, updatedAt: now }
  console.log(`[billing] team ${team.id} moved to the free plan (paid period ended)`)
  return true
}

export function listTeams(now = Date.now()): Team[] {
  const teams = load()
  let changed = false
  for (const t of teams) changed = applyDueDowngrade(t, now) || changed
  if (changed) save(teams)
  return teams
}

export function getTeam(id: unknown): Team | undefined {
  if (!isValidTeamId(id)) return undefined
  return listTeams().find((t) => t.id === id)
}

export function memberRole(team: Team, userId: string): TeamRole | null {
  return team.members.find((m) => m.userId === userId)?.role ?? null
}

export const isMember = (team: Team, userId: string) => memberRole(team, userId) !== null
export const isOwner = (team: Team, userId: string) => memberRole(team, userId) === "owner"

/** The user's teams, in the order they joined them. */
export function teamsForUser(userId: string, teams = listTeams()): Team[] {
  const addedAt = (t: Team) => t.members.find((m) => m.userId === userId)?.addedAt ?? 0
  return teams.filter((t) => isMember(t, userId)).sort((a, b) => addedAt(a) - addedAt(b) || a.createdAt - b.createdAt)
}

export function createTeam(input: {
  name: string
  ownerId: string
  plan?: string
  monthlyMinutes?: number
  personal?: boolean
  migratedFromUser?: string
}): Team {
  const teams = listTeams()
  const now = Date.now()
  const team: Team = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 80) || "Team",
    createdAt: now,
    plan: input.plan ?? defaultPlan(),
    monthlyMinutes: input.monthlyMinutes ?? defaultMonthlyMinutes(),
    members: [{ userId: input.ownerId, role: "owner", addedAt: now }],
    ...(input.personal ? { personal: true } : {}),
    ...(input.migratedFromUser ? { migratedFromUser: input.migratedFromUser } : {}),
  }
  teams.push(team)
  save(teams)
  return team
}

export function createPersonalTeam(user: Pick<User, "id" | "name">): Team {
  return createTeam({ name: personalTeamName(user.name), ownerId: user.id, personal: true })
}

/**
 * The user's teams, creating a personal one if they have none: users from
 * before teams existed (their plan and quota move to it) and users removed
 * from their only team. Synchronous, so two requests can't both create one.
 */
export function ensureUserTeam(user: User): Team[] {
  const teams = listTeams()
  const mine = teamsForUser(user.id, teams)
  if (mine.length) return mine
  const migrating = !teams.some((t) => t.migratedFromUser === user.id)
  const team = createTeam({
    name: personalTeamName(user.name),
    ownerId: user.id,
    personal: true,
    plan: user.plan || defaultPlan(),
    monthlyMinutes: Number.isFinite(user.monthlyMinutes) ? user.monthlyMinutes : defaultMonthlyMinutes(),
    ...(migrating ? { migratedFromUser: user.id } : {}),
  })
  console.log(`[teams] created ${migrating ? "migrated " : ""}personal team ${team.id} for ${user.email}`)
  return [team]
}

/** The team a pre-teams user was migrated to (where their legacy jobs and usage belong). */
export function legacyTeamOf(userId: string, teams = listTeams()): Team | undefined {
  return teams.find((t) => t.migratedFromUser === userId)
}

export function updateTeam(
  id: string,
  patch: Partial<Pick<Team, "name" | "plan" | "monthlyMinutes" | "billing">>
): Team | undefined {
  const teams = listTeams()
  const team = teams.find((t) => t.id === id)
  if (!team) return undefined
  Object.assign(team, patch)
  save(teams)
  return team
}

/** Add a member (no-op if they already are one). */
export function addMember(teamId: string, userId: string, role: TeamRole = "member"): Team | undefined {
  const teams = listTeams()
  const team = teams.find((t) => t.id === teamId)
  if (!team) return undefined
  if (!isMember(team, userId)) {
    team.members.push({ userId, role, addedAt: Date.now() })
    save(teams)
  }
  return team
}

export type RemoveResult = "ok" | "not_found" | "last_owner"

/** Remove a member. A team always keeps at least one owner. */
export function removeMember(teamId: string, userId: string): RemoveResult {
  const teams = listTeams()
  const team = teams.find((t) => t.id === teamId)
  const idx = team ? team.members.findIndex((m) => m.userId === userId) : -1
  if (!team || idx < 0) return "not_found"
  const owners = team.members.filter((m) => m.role === "owner")
  if (team.members[idx].role === "owner" && owners.length <= 1) return "last_owner"
  team.members.splice(idx, 1)
  save(teams)
  return "ok"
}

/** Find the team a provider's subscription/customer belongs to. */
export function findTeamByBilling(provider: BillingProvider, ids: { subscriptionId?: string; customerId?: string }): Team | undefined {
  const teams = listTeams()
  return (ids.subscriptionId && teams.find((t) => t.billing?.provider === provider && t.billing.subscriptionId === ids.subscriptionId))
    || (ids.customerId && teams.find((t) => t.billing?.provider === provider && t.billing.customerId === ids.customerId))
    || undefined
}
