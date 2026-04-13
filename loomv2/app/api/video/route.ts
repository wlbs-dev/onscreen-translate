import { NextRequest } from "next/server"
import fs from "fs"
import { jobPaths, isValidJobId } from "../../../lib/jobPaths"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const jobId = new URL(req.url).searchParams.get("jobId")
  if (!isValidJobId(jobId)) return new Response("Missing or invalid jobId", { status: 400 })

  const filePath = jobPaths(jobId).video
  if (!fs.existsSync(filePath)) return new Response("Video not found", { status: 404 })

  const stat = fs.statSync(filePath)
  const total = stat.size
  const range = req.headers.get("range")

  const start = range ? parseInt(range.replace(/bytes=/, "").split("-")[0], 10) : 0
  const end = range
    ? (range.split("-")[1] ? parseInt(range.split("-")[1], 10) : Math.min(start + 1024 * 1024, total - 1))
    : Math.min(1024 * 1024, total) - 1

  const chunkSize = end - start + 1
  const buf = Buffer.alloc(chunkSize)
  const fd = fs.openSync(filePath, "r")
  fs.readSync(fd, buf, 0, chunkSize, start)
  fs.closeSync(fd)

  return new Response(buf, {
    status: 206,
    headers: {
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize.toString(),
      "Content-Type": "video/mp4",
    },
  })
}