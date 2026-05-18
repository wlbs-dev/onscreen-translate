import { NextRequest, NextResponse } from "next/server"
import { getJob, updateStage, appendLog } from "../../../lib/jobStore"
import { jobPaths, getPython, SCRIPTS_DIR } from "../../../lib/jobPaths"  // ← SCRIPTS_DIR not WORKSPACE
import { spawn } from "child_process"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId")
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const job = getJob(jobId)
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  if (job.render.status === "running") {
    return NextResponse.json({ error: "Render already running" }, { status: 400 })
  }

  const paths = jobPaths(jobId)
  const scriptPath = path.join(SCRIPTS_DIR, "render_translations.py")  // ← SCRIPTS_DIR
  const python = getPython()

  updateStage(jobId, "render", { status: "running", progress: 0, log: [], message: "Starting render…" })

  const proc = spawn(python, [
    scriptPath,
    "--input",      paths.video,
    "--detections", paths.translated,       // ← match the name from jobPaths
    "--output",     paths.output,
    "--verbose",
  ], {
    cwd: SCRIPTS_DIR,                       // ← run from scripts/ so assets/ resolves correctly
    shell: false,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  })

  proc.stdout.on("data", (data: Buffer) => {
    const line = data.toString().trim()
    if (!line) return
    appendLog(jobId, "render", line)
    const match = line.match(/(\d+)\/(\d+)/)
    if (match) {
      const progress = Math.floor((parseInt(match[1]) / parseInt(match[2])) * 100)
      updateStage(jobId, "render", { progress })
    }
  })

  proc.stderr.on("data", (data: Buffer) => {
    const line = data.toString().trim()
    if (line) appendLog(jobId, "render", `[stderr] ${line}`)
  })

  proc.on("close", (code) => {
    if (code === 0) {
      updateStage(jobId, "render", { status: "done", progress: 100, message: "Render complete!" })
    } else {
      const log = getJob(jobId)?.render.log ?? []
      updateStage(jobId, "render", {
        status: "error",
        message: log.length > 0 ? log[log.length - 1] : `Render failed (exit ${code})`,
      })
    }
  })

  proc.on("error", (err) => {
    updateStage(jobId, "render", { status: "error", message: err.message })
    appendLog(jobId, "render", err.message)
  })

  return NextResponse.json({ status: "started" })
}