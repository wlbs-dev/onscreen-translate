/**
 * lib/jobStore.ts
 * File-backed job store — survives Next.js worker-thread isolation.
 * Each job is a single JSON file at <WORKSPACE>/jobs/<jobId>.json
 */
import fs from "fs"
import path from "path"
import { WORKSPACE } from "./jobPaths"

export type JobStage = "ocr" | "translate" | "render"

export interface JobStatus {
  status: "pending" | "running" | "done" | "error"
  log: string[]
  progress: number
  message: string
}

export interface Job {
  id: string
  createdAt: number
  ocr: JobStatus
  translate: JobStatus
  render: JobStatus
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const JOBS_DIR = path.join(WORKSPACE, "jobs")
const ACTIVE_FILE = path.join(JOBS_DIR, "_active.txt")
console.log("[jobStore] JOBS_DIR =", JOBS_DIR)

function ensureDir() {
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true })
}

function jobFile(id: string) {
  return path.join(JOBS_DIR, `${id}.json`)
}

// ── Internal read / write ─────────────────────────────────────────────────────

function readJob(id: string): Job | undefined {
  const f = jobFile(id)
  if (!fs.existsSync(f)) return undefined
  try {
    return JSON.parse(fs.readFileSync(f, "utf8")) as Job
  } catch {
    return undefined
  }
}

function writeJob(job: Job): void {
  ensureDir()
  try {
    fs.writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2), "utf8")
    console.log("[jobStore] wrote", jobFile(job.id))
  } catch (err) {
    console.error("[jobStore] WRITE FAILED", err)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getActiveJobId(): string | null {
  try {
    return fs.existsSync(ACTIVE_FILE)
      ? fs.readFileSync(ACTIVE_FILE, "utf8").trim() || null
      : null
  } catch {
    return null
  }
}

export function setActiveJobId(id: string): void {
  ensureDir()
  fs.writeFileSync(ACTIVE_FILE, id, "utf8")
}

export function createJob(id: string): Job {
  const fresh = (): JobStatus => ({
    status: "pending",
    log: [],
    progress: 0,
    message: "",
  })
  const job: Job = {
    id,
    createdAt: Date.now(),
    ocr: fresh(),
    translate: fresh(),
    render: fresh(),
  }
  writeJob(job)
  setActiveJobId(id)
  return job
}

export function getJob(id: string): Job | undefined {
  return readJob(id)
}

export function updateStage(
  id: string,
  stage: JobStage,
  patch: Partial<JobStatus>
): void {
  const job = readJob(id)
  if (!job) return
  job[stage] = { ...job[stage], ...patch }
  writeJob(job)
}

export function appendLog(id: string, stage: JobStage, line: string): void {
  const job = readJob(id)
  if (!job) return
  job[stage].log.push(line)
  job[stage].message = line
  writeJob(job)
}

export function deleteJob(id: string): void {
  const f = jobFile(id)
  if (fs.existsSync(f)) fs.unlinkSync(f)
  try {
    if (getActiveJobId() === id) fs.writeFileSync(ACTIVE_FILE, "", "utf8")
  } catch {}
}

export function listJobs(): Job[] {
  ensureDir()
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), "utf8")) as Job
      } catch {
        return null
      }
    })
    .filter(Boolean) as Job[]
}