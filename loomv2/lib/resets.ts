// lib/resets.ts — single-use password reset links in <WORKSPACE>/password_resets.json.
//
// Created by an admin (Admin → Users → Reset link, sent however they like) or
// by the user via "Forgot password?" (/api/forgot emails it, createdBy =
// "self"). Only a SHA-256 of the token is stored, links expire
// after RESET_TTL_MS, and creating a new link revokes the user's older ones.
import path from "path"
import { createHash, randomBytes } from "crypto"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"

export const RESET_TTL_MS = 24 * 60 * 60 * 1000

export interface PasswordReset {
  tokenHash: string
  userId: string
  createdBy: string
  createdAt: number
  expiresAt: number
  usedAt?: number
}

const RESETS_FILE = path.join(WORKSPACE, "password_resets.json")
const TOKEN_RE = /^[A-Za-z0-9_-]{20,128}$/

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex")

function load(): PasswordReset[] {
  const all = readJsonFile<PasswordReset[]>(RESETS_FILE, [])
  return Array.isArray(all) ? all : []
}

/** Create a reset link token for a user (revoking their older unused ones). */
export function createReset(userId: string, createdBy: string, now = Date.now()): { token: string; expiresAt: number } {
  const token = randomBytes(24).toString("base64url")
  const keep = load().filter((r) => r.userId !== userId && !r.usedAt && r.expiresAt > now)
  const reset: PasswordReset = {
    tokenHash: hashToken(token), userId, createdBy, createdAt: now, expiresAt: now + RESET_TTL_MS,
  }
  writeJsonFileAtomic(RESETS_FILE, [...keep, reset])
  return { token, expiresAt: reset.expiresAt }
}

/** The pending reset for a token, or null if unknown, used or expired. */
export function findReset(token: unknown, now = Date.now()): PasswordReset | null {
  if (typeof token !== "string" || !TOKEN_RE.test(token)) return null
  const h = hashToken(token)
  const r = load().find((x) => x.tokenHash === h)
  return r && !r.usedAt && r.expiresAt > now ? r : null
}

/** Mark a token used. Returns false if it was already used/expired (race-safe re-check). */
export function consumeReset(token: string, now = Date.now()): boolean {
  const all = load()
  const h = hashToken(token)
  const r = all.find((x) => x.tokenHash === h)
  if (!r || r.usedAt || r.expiresAt <= now) return false
  r.usedAt = now
  writeJsonFileAtomic(RESETS_FILE, all)
  return true
}
