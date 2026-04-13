import { NextRequest } from "next/server"
import fs from "fs"
import { jobPaths, isValidJobId } from "../../../lib/jobPaths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId")
  if (!isValidJobId(jobId)) return new Response("Missing or invalid jobId", { status: 400 })

  const filePath = jobPaths(jobId).output
  if (!fs.existsSync(filePath)) return new Response("Output not found", { status: 404 })

  const stat = fs.statSync(filePath)
  const stream = fs.createReadStream(filePath)
  const download = new URL(req.url).searchParams.get("download")
  const disposition = download
    ? `attachment; filename="translated_${jobId.slice(0, 8)}.mp4"`
    : `inline; filename="translated_${jobId.slice(0, 8)}.mp4"`

  return new Response(stream as any, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": stat.size.toString(),
      "Content-Disposition": disposition,
    },
  })
}