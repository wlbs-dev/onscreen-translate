// lib/jsonFile.ts — small JSON files under WORKSPACE (users, invites, usage,
// waitlist). Sync I/O on purpose: a read-modify-write with no await in between
// can't interleave with another request in the same server process.
import fs from "fs"
import path from "path"

export function readJsonFile<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[jsonFile] could not read ${file}`, err)
    }
    return fallback
  }
}

/** Write to a temp file and rename, so readers never see a half-written file. */
export function writeJsonFileAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
    fs.renameSync(tmp, file)
  } catch (err) {
    try { fs.unlinkSync(tmp) } catch {}
    throw err
  }
}
