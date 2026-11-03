/**
 * lib/jobStore.ts
 * File-backed job store — survives Next.js worker-thread isolation.
 * Each job is a single JSON file at <WORKSPACE>/jobs/<jobId>.json
 */
import fs from "fs"
import path from "path"
import { WORKSPACE, isValidJobId, jobPaths } from "./jobPaths"

export type JobStage = "ocr" | "translate" | "render"
export const STAGES: JobStage[] = ["ocr", "translate", "render"]

export interface JobStatus {
  status: "pending" | "queued" | "running" | "done" | "error"
  log: string[]
  progress: number
  message: string
}

export interface Job {
  id: string
  createdAt: number
  label?: string
  sourceName?: string   // original upload filename
  targetLang?: string   // Sarvam code of the last translation, e.g. "mr-IN"
  aiMode?: boolean      // last translation used --ai
  ownerId?: string      // user id of the uploader; legacy jobs without one are admin-only
  durationSec?: number  // input video length (ffprobe), counted against the owner's quota
  ocr: JobStatus
  translate: JobStatus
  render: JobStatus
}

// Keep job files small: the UI only shows the tail of the log
const MAX_LOG_LINES = 500

// ── Paths ─────────────────────────────────────────────────────────────────────

const JOBS_DIR = path.join(WORKSPACE, "jobs")
const ACTIVE_FILE = path.join(JOBS_DIR, "_active.txt")

function ensureDir() {
  if (!fs.existsSync(JOBS_DIR)) fs.mkdirSync(JOBS_DIR, { recursive: true })
}

function jobFile(id: string) {
  return path.join(JOBS_DIR, `${id}.json`)
}

// ── Internal read / write ─────────────────────────────────────────────────────

function readJob(id: string): Job | undefined {
  if (!isValidJobId(id)) return undefined
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
  // Write to a temp file and rename so a concurrent reader (status polling)
  // never sees a half-written file
  const target = jobFile(job.id)
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(job, null, 2), "utf8")
    fs.renameSync(tmp, target)
  } catch (err) {
    console.error("[jobStore] WRITE FAILED", err)
    try { fs.unlinkSync(tmp) } catch {}
  }
}

const freshStatus = (): JobStatus => ({ status: "pending", log: [], progress: 0, message: "" })

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

export function createJob(
  id: string,
  meta: Partial<Pick<Job, "label" | "sourceName" | "ownerId">> = {}
): Job {
  const job: Job = {
    id,
    createdAt: Date.now(),
    ...meta,
    ocr: freshStatus(),
    translate: freshStatus(),
    render: freshStatus(),
  }
  writeJob(job)
  setActiveJobId(id)
  return job
}

export function getJob(id: string): Job | undefined {
  return readJob(id)
}

export function updateJob(
  id: string,
  patch: Partial<Pick<Job, "label" | "targetLang" | "aiMode" | "durationSec">>
): Job | undefined {
  const job = readJob(id)
  if (!job) return undefined
  Object.assign(job, patch)
  writeJob(job)
  return job
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

/** Append several log lines (and optionally a progress value) in one write. */
export function appendLogs(
  id: string,
  stage: JobStage,
  lines: string[],
  progress?: number
): void {
  if (!lines.length && progress == null) return
  const job = readJob(id)
  if (!job) return
  const s = job[stage]
  if (lines.length) {
    s.log = [...s.log, ...lines].slice(-MAX_LOG_LINES)
    s.message = lines[lines.length - 1]
  }
  if (progress != null) s.progress = progress
  writeJob(job)
}

export function appendLog(id: string, stage: JobStage, line: string): void {
  appendLogs(id, stage, [line])
}

/** Delete the job record and everything under its uploads directory. */
export function deleteJob(id: string): void {
  if (!isValidJobId(id)) return
  const f = jobFile(id)
  if (fs.existsSync(f)) fs.unlinkSync(f)
  const { jobDir } = jobPaths(id)
  if (fs.existsSync(jobDir)) fs.rmSync(jobDir, { recursive: true, force: true })
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

/**
 * After a restart no script is running any more, but job files may still say
 * "running"/"queued" — the UI would poll them forever. Mark them as errors.
 * Called once at server start (instrumentation.ts).
 */
export function recoverInterruptedJobs(): number {
  let n = 0
  for (const job of listJobs()) {
    let changed = false
    for (const stage of STAGES) {
      const s = job[stage]
      if (s && (s.status === "running" || s.status === "queued")) {
        s.status = "error"
        s.message = "Interrupted by a server restart — run this step again"
        changed = true
      }
    }
    if (changed) { writeJob(job); n++ }
  }
  return n
}

/**
 * Delete jobs older than JOB_RETENTION_DAYS (unset or 0 = keep forever).
 * Skips jobs with a stage in flight.
 */
export function sweepExpiredJobs(now = Date.now()): number {
  const days = Number(process.env.JOB_RETENTION_DAYS ?? 0)
  if (!(days > 0)) return 0
  const cutoff = now - days * 24 * 60 * 60 * 1000
  let n = 0
  for (const job of listJobs()) {
    const busy = STAGES.some((s) => job[s]?.status === "running" || job[s]?.status === "queued")
    if (job.createdAt < cutoff && !busy) { deleteJob(job.id); n++ }
  }
  return n
}
