import { NextResponse, NextRequest } from "next/server"
import fs from "fs"
import path from "path"
import { jobPaths } from "../../../lib/jobPaths"

const JOBS_DIR    = path.join(process.cwd(), "..", "workspace", "jobs")
const UPLOADS_DIR = path.join(process.cwd(), "..", "workspace", "uploads")

export async function GET() {
  if (!fs.existsSync(JOBS_DIR)) return NextResponse.json([])

  const jobs = fs
    .readdirSync(JOBS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const job = JSON.parse(fs.readFileSync(path.join(JOBS_DIR, f), "utf-8"))

        // Check if input video exists and grab its filename
        const uploadDir = path.join(UPLOADS_DIR, job.id)
        let videoName = ""
        if (fs.existsSync(uploadDir)) {
          const files = fs.readdirSync(uploadDir)
          const vid = files.find((x) =>
            [".mp4", ".mov", ".avi", ".mkv", ".webm"].some((ext) => x.toLowerCase().endsWith(ext))
          )
          if (vid) videoName = vid
        }

        return {
          id:          job.id,
          createdAt:   job.createdAt,
          label:       job.label ?? job.id.slice(0, 4),
          outputExists: fs.existsSync(jobPaths(job.id).output),
          ocr:       { status: job.ocr?.status       ?? "pending", progress: job.ocr?.progress       ?? 0 },
          translate: { status: job.translate?.status  ?? "pending", progress: job.translate?.progress ?? 0 },
          render:    { status: job.render?.status     ?? "pending", progress: job.render?.progress    ?? 0 },
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.createdAt - a.createdAt)

  return NextResponse.json(jobs)
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const id = body?.id
    if (typeof id !== "string") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    const targetPath = path.join(JOBS_DIR, `${id}.json`)
    const uploadPath = path.join(UPLOADS_DIR, id)

    if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
    if (fs.existsSync(uploadPath)) fs.rmSync(uploadPath, { recursive: true, force: true })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const id = body?.id
    const label = body?.label
    if (typeof id !== "string" || typeof label !== "string") {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }

    const targetPath = path.join(JOBS_DIR, `${id}.json`)
    if (!fs.existsSync(targetPath)) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 })
    }

    const job = JSON.parse(fs.readFileSync(targetPath, "utf-8"))
    job.label = label
    fs.writeFileSync(targetPath, JSON.stringify(job, null, 2), "utf-8")

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
