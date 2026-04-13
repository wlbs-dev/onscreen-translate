import { NextRequest, NextResponse } from "next/server"
import { existsSync } from "fs"
import { getJob } from "../../../lib/jobStore"
import { jobPaths, getPython, SCRIPTS_DIR } from "../../../lib/jobPaths"
import { runScript } from "../../../lib/runScript"
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
  const scriptPath = path.join(SCRIPTS_DIR, "render_translations.py")

  if (!existsSync(paths.translated)) {
    return NextResponse.json({
      error: `translated_detections.json not found at ${paths.translated} — did translation complete?`,
    }, { status: 400 })
  }

  // Fire and forget — client will poll /api/render/status
  runScript({
    jobId,
    stage: "render",
    python: getPython(),
    script: scriptPath,
    args: [
      "--input",      paths.video,
      "--detections", paths.translated,
      "--output",     paths.output,
      "--verbose",
    ],
    cwd: SCRIPTS_DIR,   // run from scripts/ so assets/ resolves correctly
    // render_translations.py logs "  123/4567 frames done..."
    parseProgress: (line) => {
      const m = line.match(/(\d+)\/(\d+) frames done/)
      return m ? Math.floor((parseInt(m[1]) / parseInt(m[2])) * 100) : null
    },
  })

  return NextResponse.json({ status: "started" })
}
