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
    fs.writeFileSync(filePath, JSON.stringify(detections, null, 2), "utf-8")
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return new Response(err.message, { status: 500 })
  }
}