import { NextRequest, NextResponse } from "next/server"
import { writeFile, mkdir } from "fs/promises"
import { createJob, deleteJob, updateJob } from "../../../lib/jobStore"
import { jobPaths } from "../../../lib/jobPaths"
import { requireTeam } from "../../../lib/access"
import { probeDurationSec } from "../../../lib/probe"
import { monthBounds, recordUsage, teamQuotaMinutes, teamSecondsUsedThisMonth, toMinutes } from "../../../lib/usage"
import { isOwner } from "../../../lib/teams"
import { randomUUID } from "crypto"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Upper bound on an uploaded video; override with MAX_UPLOAD_MB
const maxUploadBytes = () => Number(process.env.MAX_UPLOAD_MB ?? 500) * 1024 * 1024

function quotaExceeded(usedSec: number, quotaMin: number, videoSec: number | null, canUpgrade: boolean) {
  const resets = new Date(monthBounds().end).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
  const left = Math.max(0, quotaMin - usedSec / 60)
  const leftText = left > 0 && left < 0.1 ? "less than 0.1" : String(toMinutes(left * 60))
  const videoText = videoSec != null && videoSec < 6 ? `${Math.round(videoSec)} s` : `${toMinutes(videoSec ?? 0)} min`
  const error = videoSec == null
    ? `Your team has used all ${quotaMin} minutes of its monthly quota. It resets on ${resets}.`
    : `This video is ${videoText}, but your team has ${leftText} of its ${quotaMin} monthly minutes left. The quota resets on ${resets}.`
  return NextResponse.json({
    error,
    code: "quota_exceeded",
    minutesUsed: toMinutes(usedSec),
    minutesQuota: quotaMin,
    videoMinutes: videoSec == null ? null : toMinutes(videoSec),
    upgradeUrl: "/app/billing",
    canUpgrade, // team owners can change the plan; members ask their owner
  }, { status: 402 })
}

// Not matched by proxy.ts (it would truncate bodies over 10 MB), so this
// route's own requireTeam() is the session + CSRF check. The video goes to
// the active team and counts against that team's monthly minutes.
export async function POST(req: NextRequest) {
  const access = await requireTeam(req)
  if (access instanceof Response) return access
  const { user, team } = access
  const canUpgrade = isOwner(team, user.id)

  const quota = teamQuotaMinutes(team)
  if (quota != null && teamSecondsUsedThisMonth(team.id) >= quota * 60) {
    return quotaExceeded(teamSecondsUsedThisMonth(team.id), quota, null, canUpgrade)
  }

  let jobId: string | null = null
  try {
    const formData = await req.formData()
    const file = formData.get("video")
    if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 })
    if (file.type && !file.type.startsWith("video/")) {
      return NextResponse.json({ error: "Only video files are supported" }, { status: 415 })
    }
    if (file.size > maxUploadBytes()) {
      return NextResponse.json({
        error: `Video is larger than the ${Math.round(maxUploadBytes() / 1024 / 1024)} MB limit`,
      }, { status: 413 })
    }

    jobId = randomUUID()
    const sourceName = file.name.slice(0, 200)
    createJob(jobId, { sourceName, label: sourceName.replace(/\.[^.]+$/, "") || undefined, ownerId: user.id, teamId: team.id })

    const paths = jobPaths(jobId)
    await mkdir(paths.framesDir, { recursive: true })
    await writeFile(paths.video, Buffer.from(await file.arrayBuffer()))

    let durationSec: number
    try {
      durationSec = await probeDurationSec(paths.video)
    } catch (err) {
      console.warn(`[upload] ffprobe failed for ${jobId}:`, err)
      deleteJob(jobId)
      return NextResponse.json({ error: "Couldn't read this video — is it a valid video file?" }, { status: 400 })
    }

    // Check and record in one synchronous step so parallel uploads can't
    // both squeeze under the quota
    const usedSec = teamSecondsUsedThisMonth(team.id)
    if (quota != null && usedSec + durationSec > quota * 60) {
      deleteJob(jobId)
      return quotaExceeded(usedSec, quota, durationSec, canUpgrade)
    }
    recordUsage({ userId: user.id, teamId: team.id, jobId, durationSec, at: Date.now() })
    updateJob(jobId, { durationSec })

    console.log(`[upload] Job ${jobId} (${durationSec.toFixed(1)} s) created by ${user.email} in team ${team.id}`)
    return NextResponse.json({ jobId, status: "ok", filename: file.name, durationSec })
  } catch (err: unknown) {
    console.error("[upload]", err)
    if (jobId) deleteJob(jobId)
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 })
  }
}
