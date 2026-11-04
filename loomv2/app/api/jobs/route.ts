import { NextResponse, NextRequest } from "next/server"
import fs from "fs"
import { jobPaths, isValidJobId } from "../../../lib/jobPaths"
import { deleteJob, listJobs, updateJob } from "../../../lib/jobStore"
import { cancelJob } from "../../../lib/runScript"
import { activeTeam, jobTeamId, requireJobAccess, requireUser } from "../../../lib/access"
import { listUsers } from "../../../lib/users"
import { listTeams } from "../../../lib/teams"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const stageSummary = (s?: { status?: string; progress?: number; message?: string }) => ({
  status:   s?.status   ?? "pending",
  progress: s?.progress ?? 0,
  message:  s?.message  ?? "",
})

export async function GET(req: NextRequest) {
  const user = await requireUser(req)
  if (user instanceof Response) return user

  // Members see the active team's videos (uploaded by anyone in it); admins
  // see every job. Cards show the uploader when it isn't you, and for admins
  // the team when it isn't the active one.
  const isAdmin = user.role === "admin"
  const team = activeTeam(req, user)
  const emailById = new Map(listUsers().map((u) => [u.id, u.email]))
  const teamNameById = new Map(listTeams().map((t) => [t.id, t.name]))
  const ownerLabel = (ownerId?: string) => {
    if (ownerId === user.id) return undefined
    return ownerId ? emailById.get(ownerId) ?? "deleted user" : "no owner (legacy)"
  }
  const teamLabel = (teamId?: string) => {
    if (!isAdmin || teamId === team.id) return undefined
    return teamId ? teamNameById.get(teamId) ?? "deleted team" : "no team (legacy)"
  }

  const jobs = listJobs()
    .filter((job) => isValidJobId(job.id))
    .map((job) => ({ job, teamId: jobTeamId(job) }))
    .filter(({ teamId }) => isAdmin || teamId === team.id)
    .map(({ job, teamId }) => ({
      id:           job.id,
      createdAt:    job.createdAt,
      label:        job.label ?? job.sourceName ?? job.id.slice(0, 4),
      sourceName:   job.sourceName ?? "",
      targetLang:   job.targetLang ?? "",
      aiMode:       job.aiMode ?? false,
      durationSec:  job.durationSec ?? null,
      owner:        ownerLabel(job.ownerId),
      team:         teamLabel(teamId),
      outputExists: fs.existsSync(jobPaths(job.id).output),
      ocr:          stageSummary(job.ocr),
      translate:    stageSummary(job.translate),
      render:       stageSummary(job.render),
    }))
    .sort((a, b) => b.createdAt - a.createdAt)

  return NextResponse.json(jobs)
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const access = await requireJobAccess(req, body?.id)
    if (access instanceof Response) return access
    cancelJob(access.job.id)
    deleteJob(access.job.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to delete job" }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const access = await requireJobAccess(req, body?.id)
    if (access instanceof Response) return access
    const label = body?.label
    if (typeof label !== "string" || label.length > 200) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 })
    }
    updateJob(access.job.id, { label: label.trim() })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
