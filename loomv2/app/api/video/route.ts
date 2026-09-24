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

  const CHUNK = 1024 * 1024
  const m = range?.match(/^bytes=(\d*)-(\d*)$/)
  const start = m?.[1] ? parseInt(m[1], 10) : 0
  // Clamp to the file and to one chunk so a huge Range can't allocate a huge buffer
  const end = Math.min(m?.[2] ? parseInt(m[2], 10) : start + CHUNK - 1, start + CHUNK - 1, total - 1)
  if (start >= total || end < start) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${total}` } })
  }

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