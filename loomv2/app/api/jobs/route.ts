import { NextResponse, NextRequest } from "next/server"
import fs from "fs"
import { jobPaths, isValidJobId } from "../../../lib/jobPaths"
import { deleteJob, getJob, listJobs, updateJob } from "../../../lib/jobStore"
import { cancelJob } from "../../../lib/runScript"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const stageSummary = (s?: { status?: string; progress?: number; message?: string }) => ({
  status:   s?.status   ?? "pending",
  progress: s?.progress ?? 0,
  message:  s?.message  ?? "",
})

export async function GET() {
  const jobs = listJobs()
    .filter((job) => isValidJobId(job.id))
    .map((job) => ({
      id:           job.id,
      createdAt:    job.createdAt,
      label:        job.label ?? job.sourceName ?? job.id.slice(0, 4),
      sourceName:   job.sourceName ?? "",
      targetLang:   job.targetLang ?? "",
      aiMode:       job.aiMode ?? false,
      outputExists: fs.existsSync(jobPaths(job.id).output),
      ocr:          stageSummary(job.ocr),
      translate:    stageSummary(job.translate),
      render:       stageSummary(job.render),
    }))
    .sort((a, b) => b.createdAt - a.createdAt)

  return NextResponse.json(jobs)
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const id = body?.id
    if (!isValidJobId(id)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    cancelJob(id)
    deleteJob(id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const id = body?.id
    const label = body?.label
    if (!isValidJobId(id) || typeof label !== "string" || label.length > 200) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    if (!getJob(id)) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    updateJob(id, { label: label.trim() })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
