import fs from "fs"
import path from "path"

const DETECTIONS_PATH =
  process.env.DETECTIONS_PATH || "annotated/translated_detections.json"

export async function POST(req: Request) {
  try {
    const data = await req.json()

    const filePath = path.resolve(DETECTIONS_PATH)

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")

    return Response.json({ success: true })
  } catch (err: any) {
    return new Response(err.message, { status: 500 })
  }
}