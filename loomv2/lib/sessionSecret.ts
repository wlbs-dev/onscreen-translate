// lib/sessionSecret.ts — the HMAC key for session cookies.
//
// SESSION_SECRET wins. Without it (local `npm run dev`), a random secret is
// generated once and kept in <WORKSPACE>/.session_secret, so sessions survive
// restarts. proxy.ts runs on the Node.js runtime in Next 16, so it reads the
// same file as the route handlers and both always agree on the key.
// `npm run start:public` refuses to start without SESSION_SECRET.
import fs from "fs"
import path from "path"
import { randomBytes } from "crypto"
import { WORKSPACE } from "./workspace"

const SECRET_FILE = path.join(WORKSPACE, ".session_secret")

let cached: string | null = null

export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim()
  if (fromEnv) return fromEnv
  if (cached) return cached
  try {
    cached = fs.readFileSync(SECRET_FILE, "utf8").trim()
    if (cached) return cached
  } catch {}
  const secret = randomBytes(32).toString("base64url")
  try {
    fs.mkdirSync(WORKSPACE, { recursive: true })
    // "wx": if another module instance wrote it first, use theirs
    fs.writeFileSync(SECRET_FILE, secret, { flag: "wx", mode: 0o600 })
    cached = secret
  } catch {
    cached = fs.readFileSync(SECRET_FILE, "utf8").trim()
  }
  return cached
}
