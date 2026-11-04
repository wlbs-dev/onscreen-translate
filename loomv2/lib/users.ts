// lib/users.ts — accounts in <WORKSPACE>/users.json (array, atomic writes).
import path from "path"
import { randomUUID } from "crypto"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"

export type Role = "admin" | "member"

export interface User {
  id: string
  email: string          // lowercased, unique
  name: string
  passwordHash: string
  role: Role
  /** Legacy: plan and quota now live on the user's team (lib/teams.ts). Only read when migrating. */
  plan: string
  /** Legacy, see plan. */
  monthlyMinutes: number
  createdAt: number
  disabled?: boolean
  /** ms; sessions issued before this are rejected (set on password reset) */
  sessionsValidAfter?: number
  /** "Your video is ready" / "your render is ready" emails (default on) */
  emailNotifications?: boolean
}

/** A user as it may leave the server — never includes the password hash. */
export type PublicUser = Omit<User, "passwordHash">

const USERS_FILE = path.join(WORKSPACE, "users.json")

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null
  const e = email.trim().toLowerCase()
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null
}

export function defaultMonthlyMinutes(): number {
  const n = Number(process.env.DEFAULT_MONTHLY_MINUTES ?? 60)
  return Number.isFinite(n) && n >= 0 ? n : 60
}

export function defaultPlan(): string {
  return process.env.DEFAULT_PLAN || "pilot"
}

export function listUsers(): User[] {
  const users = readJsonFile<User[]>(USERS_FILE, [])
  return Array.isArray(users) ? users : []
}

function saveUsers(users: User[]): void {
  writeJsonFileAtomic(USERS_FILE, users)
}

export function countUsers(): number {
  return listUsers().length
}

export function getUserById(id: string): User | undefined {
  return listUsers().find((u) => u.id === id)
}

export function getUserByEmail(email: string): User | undefined {
  const e = email.trim().toLowerCase()
  return listUsers().find((u) => u.email === e)
}

export class DuplicateEmailError extends Error {}

/** Synchronous so the duplicate check and the write can't interleave. */
export function createUser(input: {
  email: string
  name: string
  passwordHash: string
  role: Role
  plan?: string
  monthlyMinutes?: number
}): User {
  const users = listUsers()
  const email = input.email.trim().toLowerCase()
  if (users.some((u) => u.email === email)) throw new DuplicateEmailError("Email already registered")
  const user: User = {
    id: randomUUID(),
    email,
    name: input.name.trim(),
    passwordHash: input.passwordHash,
    role: input.role,
    plan: input.plan ?? defaultPlan(),
    monthlyMinutes: input.monthlyMinutes ?? defaultMonthlyMinutes(),
    createdAt: Date.now(),
  }
  users.push(user)
  saveUsers(users)
  return user
}

export function updateUser(
  id: string,
  patch: Partial<Pick<User, "name" | "role" | "plan" | "monthlyMinutes" | "disabled" | "passwordHash" | "sessionsValidAfter" | "emailNotifications">>
): User | undefined {
  const users = listUsers()
  const user = users.find((u) => u.id === id)
  if (!user) return undefined
  Object.assign(user, patch)
  saveUsers(users)
  return user
}

export function toPublicUser(user: User): PublicUser {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { passwordHash, ...rest } = user
  return rest
}
