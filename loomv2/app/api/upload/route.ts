import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { createJob } from "../../../lib/jobStore"
import { jobPaths } from "../../../lib/jobPaths"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get("video") as File | null
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })

    // Create a new job
    const jobId = randomUUID()
    createJob(jobId)

    const paths = jobPaths(jobId)
    await mkdir(paths.framesDir, { recursive: true })

    const bytes = await file.arrayBuffer()
    await writeFile(paths.video, Buffer.from(bytes))

    console.log(`[upload] Job ${jobId} created, video saved to ${paths.video}`)
    return NextResponse.json({ jobId, status: "ok", filename: file.name })
  } catch (err: any) {
    console.error("[upload]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
