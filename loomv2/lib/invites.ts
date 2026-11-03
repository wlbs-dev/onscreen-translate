// lib/invites.ts — single-use signup invites in <WORKSPACE>/invites.json.
import path from "path"
import { randomBytes } from "crypto"
import { WORKSPACE } from "./workspace"
import { readJsonFile, writeJsonFileAtomic } from "./jsonFile"

export interface Invite {
  code: string
  createdBy: string   // admin user id
  createdAt: number
  email?: string      // if set, only this email may use the invite
  usedBy?: string     // user id
  usedAt?: number
}

const INVITES_FILE = path.join(WORKSPACE, "invites.json")
const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/

export type SignupMode = "invite" | "open"

export function signupMode(): SignupMode {
  return process.env.SIGNUP_MODE === "open" ? "open" : "invite"
}

export function listInvites(): Invite[] {
  const invites = readJsonFile<Invite[]>(INVITES_FILE, [])
  return Array.isArray(invites) ? invites : []
}

export function createInvite(createdBy: string, email?: string): Invite {
  const invites = listInvites()
  const invite: Invite = {
    code: randomBytes(12).toString("base64url"),
    createdBy,
    createdAt: Date.now(),
    ...(email ? { email } : {}),
  }
  invites.push(invite)
  writeJsonFileAtomic(INVITES_FILE, invites)
  return invite
}

export function getInvite(code: unknown): Invite | undefined {
  if (typeof code !== "string" || !CODE_RE.test(code)) return undefined
  return listInvites().find((i) => i.code === code)
}

/** Why an invite can't be used by this email, or null if it can. */
export function inviteProblem(invite: Invite | undefined, email: string): string | null {
  if (!invite) return "That invite code isn't valid."
  if (invite.usedBy) return "That invite has already been used."
  if (invite.email && invite.email !== email) return "That invite is for a different email address."
  return null
}

export function markInviteUsed(code: string, userId: string): void {
  const invites = listInvites()
  const invite = invites.find((i) => i.code === code)
  if (!invite) return
  invite.usedBy = userId
  invite.usedAt = Date.now()
  writeJsonFileAtomic(INVITES_FILE, invites)
}

/** Revoke an unused invite. Returns false if it doesn't exist or was used. */
export function deleteInvite(code: string): boolean {
  const invites = listInvites()
  const idx = invites.findIndex((i) => i.code === code && !i.usedBy)
  if (idx < 0) return false
  invites.splice(idx, 1)
  writeJsonFileAtomic(INVITES_FILE, invites)
  return true
}
