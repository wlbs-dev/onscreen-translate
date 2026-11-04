// lib/notify.ts — "your video is ready" emails when a stage finishes.
// Called from lib/runScript.ts; never throws.
import { getJob, type JobStage } from "./jobStore"
import { getUserById } from "./users"
import { jobReadyEmail, sendMail } from "./mail"

export interface StageNotify {
  /** Who started the stage (and gets the email) */
  userId: string
  /** Public base URL for the link (lib/mail.ts appUrl, captured when queued) */
  baseUrl: string
}

/** Translate done → "ready to review"; render done → "render is ready". Other stages send nothing. */
export function notifyStageDone(jobId: string, stage: JobStage, notify: StageNotify | undefined): void {
  if (!notify || (stage !== "translate" && stage !== "render")) return
  try {
    const user = getUserById(notify.userId)
    const job = getJob(jobId)
    if (!user || !job || user.disabled || user.emailNotifications === false) return
    const jobLabel = job.label || job.sourceName || "your video"
    const link = `${notify.baseUrl}/app?job=${job.id}`
    void sendMail(jobReadyEmail(user.email, {
      name: user.name, jobLabel, link, kind: stage === "translate" ? "review" : "render",
    }))
  } catch (err) {
    console.error(`[notify] ${jobId} ${stage}:`, err instanceof Error ? err.message : err)
  }
}
