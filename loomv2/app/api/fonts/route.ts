import { NextRequest } from "next/server"
import fs from "fs"
import path from "path"
import { SCRIPTS_DIR } from "../../../lib/jobPaths"
import { SERVABLE_FONT_FILES } from "../../../lib/editor/indicFonts"

export const runtime = "nodejs"

// Serves the renderer's bundled Noto fonts so the editor preview draws text
// with the same glyphs and metrics as the final render
export async function GET(req: NextRequest) {
  const file = new URL(req.url).searchParams.get("file") ?? ""
  if (!SERVABLE_FONT_FILES.includes(file)) return new Response("Unknown font", { status: 404 })
  const p = path.join(SCRIPTS_DIR, "assets", file)
  if (!fs.existsSync(p)) return new Response("Font missing", { status: 404 })
  return new Response(new Uint8Array(fs.readFileSync(p)), {
    headers: {
      "Content-Type": "font/ttf",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  })
}
