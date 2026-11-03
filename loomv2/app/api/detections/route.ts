import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import { jobPaths, isValidJobId } from "../../../lib/jobPaths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function getPath(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId")
  if (!isValidJobId(jobId)) return null
  return jobPaths(jobId).translated
}

export async function GET(req: NextRequest) {
  const filePath = getPath(req)
  if (!filePath) return new Response("Missing or invalid jobId", { status: 400 })
  if (!fs.existsSync(filePath)) return new Response("Detections not found", { status: 404 })

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  try {
    const filePath = getPath(req)
    if (!filePath) return new Response("Missing or invalid jobId", { status: 400 })

    const { detections } = await req.json()
    // The renderer expects a list of frames; refuse anything else rather
    // than overwrite the job's translations with something unrenderable
    if (!Array.isArray(detections)) return new Response("detections must be an array", { status: 400 })
    fs.writeFileSync(filePath, JSON.stringify(detections, null, 2), "utf-8")
    return NextResponse.json({ success: true })
  } catch (err: unknown) {
    return new Response(err instanceof Error ? err.message : "Save failed", { status: 500 })
  }
}