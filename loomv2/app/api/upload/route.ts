import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { createJob, deleteJob } from "../../../lib/jobStore"
import { jobPaths } from "../../../lib/jobPaths"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Upper bound on an uploaded video; override with MAX_UPLOAD_MB
const maxUploadBytes = () => Number(process.env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024

export async function POST(req: NextRequest) {
  let jobId: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("video")
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.type && !file.type.startsWith("video/")) {
      return NextResponse.json({ error: "Only video files are supported" }, { status: 415 })
    }
    if (file.size > maxUploadBytes()) {
      return NextResponse.json({
        error: `Video is larger than the ${Math.round(maxUploadBytes() / 1024 / 1024)} MB limit`,
      }, { status: 413 })
    }

    jobId = randomUUID()
    const sourceName = file.name.slice(0, 200)
    createJob(jobId, { sourceName, label: sourceName.replace(/\.[^.]+$/, "") || undefined })

    const paths = jobPaths(jobId)
    await mkdir(paths.framesDir, { recursive: true })
    await writeFile(paths.video, Buffer.from(await file.arrayBuffer()))

    console.log(`[upload] Job ${jobId} created, video saved to ${paths.video}`)
    return NextResponse.json({ jobId, status: "ok", filename: file.name })
  } catch (err: unknown) {
    console.error("[upload]", err)
    if (jobId) deleteJob(jobId)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 })
  }
}
