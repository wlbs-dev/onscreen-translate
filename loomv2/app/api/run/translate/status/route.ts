import { NextRequest, NextResponse } from "next/server"
import { requireJobAccess } from "../../../../../lib/access"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const access = await requireJobAccess(req, new URL(req.url).searchParams.get("jobId"))
  if (access instanceof Response) return access
  return NextResponse.json(access.job.translate)
}
