/**
 * lib/runScript.ts
 * Queued, fire-and-forget Python script runner that updates jobStore as
 * output arrives.
 *
 * OCR and render are CPU-heavy (OCR uses every core, render runs a full
 * ffmpeg encode), so stages go through one in-process queue capped at
 * MAX_CONCURRENT_JOBS (default 1). Queue state lives on globalThis so every
 * route bundle in the same server process shares it.
 */

import { spawn, ChildProcess } from "child_process"
import { JobStage, appendLogs, getJob, updateStage } from "./jobStore"
import { SCRIPTS_DIR } from "./jobPaths"
import { notifyStageDone, type StageNotify } from "./notify"

export interface RunScriptOpts {
  jobId: string
  stage: JobStage
  python: string
  script: string
  args: string[]
  cwd?: string
  // Extra progress parser (0–100) for scripts that don't emit PROGRESS: lines
  parseProgress?: (line: string) => number | null
  // Email this user when the stage finishes successfully (translate/render only)
  notify?: StageNotify
}

interface QueueState {
  running: Map<string, ChildProcess | null>  // key -> process (null while spawning)
  pending: RunScriptOpts[]
}

const g = globalThis as unknown as { __otQueue?: QueueState }
const queue: QueueState = (g.__otQueue ??= { running: new Map(), pending: [] })

const key = (jobId: string, stage: JobStage) => `${jobId}:${stage}`

function maxConcurrent(): number {
  const n = Number(process.env.MAX_CONCURRENT_JOBS ?? 1)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/** True if this job's stage is already queued or running in this process. */
export function isBusy(jobId: string, stage: JobStage): boolean {
  const k = key(jobId, stage)
  return queue.running.has(k) || queue.pending.some((o) => key(o.jobId, o.stage) === k)
}

/**
 * Queue a script run. Returns false (and does nothing) if the same job stage
 * is already queued or running.
 */
export function runScript(opts: RunScriptOpts): boolean {
  if (isBusy(opts.jobId, opts.stage)) return false
  queue.pending.push(opts)
  const ahead = queue.running.size + queue.pending.length - 1
  updateStage(opts.jobId, opts.stage, {
    status: "queued",
    progress: 0,
    log: [],
    message: ahead > 0 ? `Queued — waiting for ${ahead} other job(s)` : "Starting…",
  })
  pump()
  return true
}

/** Drop queued runs and kill running processes for a job (used on delete). */
export function cancelJob(jobId: string): void {
  queue.pending = queue.pending.filter((o) => o.jobId !== jobId)
  for (const [k, proc] of queue.running) {
    if (k.startsWith(`${jobId}:`)) proc?.kill("SIGTERM")
  }
}

function pump(): void {
  while (queue.running.size < maxConcurrent() && queue.pending.length) {
    const opts = queue.pending.shift()!
    const k = key(opts.jobId, opts.stage)
    // Job may have been deleted while it waited
    if (!getJob(opts.jobId)) continue
    queue.running.set(k, null)
    execute(opts, (proc) => queue.running.set(k, proc)).finally(() => {
      queue.running.delete(k)
      pump()
    })
  }
  // Tell waiting jobs where they are in line
  queue.pending.forEach((o, i) => {
    updateStage(o.jobId, o.stage, {
      message: `Queued — waiting for ${queue.running.size + i} other job(s)`,
    })
  })
}

// Log lines are flushed to the job file at most this often: rewriting the
// whole JSON per line is slow for chatty scripts and races with readers.
const FLUSH_MS = 400

function execute(opts: RunScriptOpts, onSpawn: (p: ChildProcess) => void): Promise<void> {
  const { jobId, stage, python, script, args } = opts

  updateStage(jobId, stage, { status: "running", progress: 0, log: [], message: "Starting…" })

  return new Promise((resolve) => {
    const proc = spawn(python, [script, ...args], {
      cwd: opts.cwd ?? SCRIPTS_DIR,
      shell: false,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    })
    onSpawn(proc)

    let pendingLines: string[] = []
    let pendingProgress: number | undefined
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      if (timer) { clearTimeout(timer); timer = null }
      appendLogs(jobId, stage, pendingLines, pendingProgress)
      pendingLines = []
      pendingProgress = undefined
    }
    const scheduleFlush = () => { timer ??= setTimeout(flush, FLUSH_MS) }

    let lastLine = ""
    const handleLine = (line: string) => {
      if (!line.trim()) return
      // Parse optional PROGRESS:0.42 hints from the Python scripts; these are
      // progress signals, not log output
      const m = line.match(/^PROGRESS:([\d.]+)$/)
      if (m) {
        pendingProgress = Math.min(99, Math.round(parseFloat(m[1]) * 100))
      } else {
        console.log(`[${stage}]`, line)
        pendingLines.push(line)
        const p = opts.parseProgress?.(line)
        if (p != null) pendingProgress = p
        lastLine = line
      }
      scheduleFlush()
    }

    const lineReader = () => {
      let buf = ""
      return {
        push(chunk: Buffer) {
          buf += chunk.toString("utf8")
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          lines.forEach(handleLine)
        },
        end() { if (buf.trim()) handleLine(buf); buf = "" },
      }
    }
    const out = lineReader()
    const err = lineReader()
    proc.stdout.on("data", (c: Buffer) => out.push(c))
    proc.stderr.on("data", (c: Buffer) => err.push(c))

    // A failed spawn can emit both "error" and "close"; report only the first
    let settled = false

    proc.on("error", (e) => {
      if (settled) return
      settled = true
      pendingLines.push(`ERROR: ${e.message}`)
      flush()
      updateStage(jobId, stage, { status: "error", message: e.message })
      resolve()
    })

    proc.on("close", (code, signal) => {
      if (settled) return
      settled = true
      out.end(); err.end()
      flush()
      if (code === 0) {
        updateStage(jobId, stage, { status: "done", progress: 100, message: "Done" })
        notifyStageDone(jobId, stage, opts.notify)
      } else {
        const why = signal ? `Stopped (${signal})` : `Exited with code ${code}`
        updateStage(jobId, stage, {
          status: "error",
          message: lastLine ? `${why}: ${lastLine}` : why,
        })
      }
      resolve()
    })
  })
}
