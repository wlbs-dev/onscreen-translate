import { NextRequest, NextResponse } from "next/server"
import { requireAdmin } from "../../../../lib/access"
import { listFeedback } from "../../../../lib/feedback"
import { getJob } from "../../../../lib/jobStore"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (admin instanceof Response) return admin
  const entries = listFeedback()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((f) => {
      const job = f.jobId ? getJob(f.jobId) : undefined
      return { ...f, jobLabel: job ? job.label ?? job.sourceName ?? null : null, jobExists: !!job }
    })
  return NextResponse.json({ entries })
}
