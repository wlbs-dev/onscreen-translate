import { NextRequest, NextResponse } from "next/server"
import { canAccessJob, requireUser } from "../../../lib/access"
import { addFeedback } from "../../../lib/feedback"
import { getJob } from "../../../lib/jobStore"
import { isValidJobId } from "../../../lib/jobPaths"
import { consume } from "../../../lib/rateLimit"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_MESSAGE = 5000

/** POST {message, rating?, jobId?} — signed-in users only (requireUser also does the CSRF check) */
export async function POST(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  const limit = consume(`feedback:${user.id}`, 30, 60 * 60 * 1000)
  if (!limit.ok) {
    return NextResponse.json({ error: "That's a lot of feedback — try again in a bit." }, { status: 429 })
  }

  const body = await req.json().catch(() => ({}))
  const message = typeof body?.message === "string" ? body.message.trim() : ""
  if (!message) return NextResponse.json({ error: "Write a message first" }, { status: 400 })
  if (message.length > MAX_MESSAGE) {
    return NextResponse.json({ error: `Keep it under ${MAX_MESSAGE} characters` }, { status: 400 })
  }

  let rating: number | undefined
  if (body?.rating != null && body.rating !== "") {
    const r = Number(body.rating)
    if (!Number.isInteger(r) || r < 1 || r > 5) return NextResponse.json({ error: "Rating must be 1–5" }, { status: 400 })
    rating = r
  }

  let jobId: string | undefined
  if (body?.jobId != null && body.jobId !== "") {
    // Only attach jobs the user can see, so feedback can't point admins at arbitrary ids
    const job = isValidJobId(body.jobId) ? getJob(body.jobId) : undefined
    if (!job || !canAccessJob(user, job)) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    jobId = job.id
  }

  const fb = addFeedback({
    userId: user.id,
    email: user.email,
    ...(jobId ? { jobId } : {}),
    message,
    ...(rating ? { rating } : {}),
    userAgent: (req.headers.get("user-agent") ?? "").slice(0, 300),
  })
  return NextResponse.json({ ok: true, id: fb.id })
}
