import { NextRequest, NextResponse } from "next/server"
import { existsSync } from "fs"
import { getJob } from "../../../../lib/jobStore"
import { jobPaths, getPython, SCRIPTS_DIR } from "../../../../lib/jobPaths"
import { runScript } from "../../../../lib/runScript"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get("jobId")
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

  const job = getJob(jobId)
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const paths = jobPaths(jobId)
  const scriptPath = path.join(SCRIPTS_DIR, "ocr_annotate.py")

  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: `ocr_annotate.py not found at ${scriptPath}` }, { status: 404 })
  }
  if (!existsSync(paths.video)) {
    return NextResponse.json({ error: "input_video.mp4 not found — did upload succeed?" }, { status: 400 })
  }

  // Fire and forget — client will poll /api/run/ocr/status
  runScript({
    jobId,
    stage: "ocr",
    python: getPython(),
    script: scriptPath,
    args: [
      "--input",      paths.video,
      "--output-dir", paths.framesDir,
      "--verbose",
    ],
    cwd: SCRIPTS_DIR,
  })

  return NextResponse.json({ jobId, status: "started" })
}