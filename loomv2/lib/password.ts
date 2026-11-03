// lib/password.ts — scrypt password hashes with a per-user random salt.
// Format: scrypt$N$r$p$<salt b64url>$<hash b64url>
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "crypto"

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P })
  return ["scrypt", N, R, P, salt.toString("base64url"), hash.toString("base64url")].join("$")
}

// Verified against when the email is unknown, so a miss takes as long as a hit
let dummyHash: Promise<string> | null = null

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const target = stored ?? (await (dummyHash ??= hashPassword("not-a-real-password")))
  const parts = target.split("$")
  if (parts.length !== 6 || parts[0] !== "scrypt") return false
  const [, n, r, p, saltB64, hashB64] = parts
  const expected = Buffer.from(hashB64, "base64url")
  try {
    const actual = await scryptAsync(password.normalize("NFKC"), Buffer.from(saltB64, "base64url"), expected.length, {
      N: Number(n), r: Number(r), p: Number(p),
    })
    return timingSafeEqual(actual, expected) && stored !== undefined
  } catch {
    return false
  }
}
