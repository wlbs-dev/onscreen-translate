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
  const useAi = searchParams.get("ai") === "true"
  const model = searchParams.get("model") || "openai-gpt4o-mini"
  const openaiKey = searchParams.get("openaiKey") || process.env.OPENAI_API_KEY || ""
  const sarvamKey = searchParams.get("sarvamKey") || process.env.SARVAM_API_KEY || ""

  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 })

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

  // Build environment with API keys and model selection
  const env = {
    ...process.env,
    SARVAM_API_KEY: sarvamKey,
    OPENAI_API_KEY: openaiKey,
    TRANSLATION_MODEL: model,
  }

  // Fire and forget — client will poll /api/run/translate/status
  runScript({
    jobId,
    stage: "translate",
    python: getPython(),
    script: scriptPath,
    args: [
      "--detections", paths.detections,
      "--output",     paths.translated,
      "--verbose",
      ...(useAi ? ["--ai"] : []),
      "--model", model,
    ],
    cwd: SCRIPTS_DIR,
    env,
  })

  return NextResponse.json({ jobId, status: "started" })
}