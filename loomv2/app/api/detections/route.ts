import { NextRequest, NextResponse } from "next/server"
import fs from "fs"
import { jobPaths } from "../../../lib/jobPaths"
import { requireJobAccess } from "../../../lib/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Not matched by proxy.ts (it would truncate bodies over 10 MB), so
// requireJobAccess() here is the session + CSRF + ownership check

async function access(req: NextRequest) {
  return requireJobAccess(req, new URL(req.url).searchParams.get("jobId"))
}

export async function GET(req: NextRequest) {
  const a = await access(req)
  if (a instanceof Response) return a
  const filePath = jobPaths(a.job.id).translated
  if (!fs.existsSync(filePath)) return new Response("Detections not found", { status: 404 })

  const data = JSON.parse(fs.readFileSync(filePath, "utf-8"))
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  try {
    const a = await access(req)
    if (a instanceof Response) return a
    const filePath = jobPaths(a.job.id).translated

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
