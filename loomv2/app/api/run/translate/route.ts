import { NextRequest, NextResponse } from "next/server"
import { existsSync } from "fs"
import { getJob, updateJob } from "../../../../lib/jobStore"
import { DEFAULT_LANG, isSupportedLang } from "../../../../lib/languages"
import { jobPaths, getPython, SCRIPTS_DIR } from "../../../../lib/jobPaths"
import { runScript } from "../../../../lib/runScript"
import path from "path"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get("jobId")
  const useAi = searchParams.get("ai") === "true"
  const lang = searchParams.get("lang") ?? DEFAULT_LANG
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })
  if (!isSupportedLang(lang)) return NextResponse.json({ error: `Unsupported language: ${lang}` }, { status: 400 })

  const job = getJob(jobId)
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })

  const paths = jobPaths(jobId)
  const scriptPath = path.join(SCRIPTS_DIR, "translate_detections.py")

  if (!existsSync(scriptPath)) {
    return NextResponse.json({ error: `translate_detections.py not found at ${scriptPath}` }, { status: 404 })
  }
  if (!existsSync(paths.detections)) {
    return NextResponse.json({
      error: `ocr_detections.json not found at ${paths.detections} — did OCR complete successfully?`,
    }, { status: 400 })
  }

  // Queued fire-and-forget — client will poll /api/run/translate/status
  const started = runScript({
    jobId,
    stage: "translate",
    python: getPython(),
    script: scriptPath,
    args: [
      "--detections", paths.detections,
      "--output",     paths.translated,
      "--target-lang", lang,
      "--verbose",
      ...(useAi ? ["--ai"] : []),
    ],
    cwd: SCRIPTS_DIR,
  })

  if (!started) return NextResponse.json({ error: "Translation is already running for this job" }, { status: 409 })
  updateJob(jobId, { targetLang: lang, aiMode: useAi })
  return NextResponse.json({ jobId, status: "started", lang })
}