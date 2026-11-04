// instrumentation.ts — runs once when the Next.js server starts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return

  // Create <WORKSPACE>/.session_secret now (if SESSION_SECRET is unset) rather
  // than racing for it on the first requests
  const { getSessionSecret } = await import("./lib/sessionSecret")
  getSessionSecret()
  if (!process.env.SESSION_SECRET) {
    console.log("[startup] SESSION_SECRET not set — using the generated secret in <workspace>/.session_secret")
  }

  if (!process.env.SMTP_URL?.trim()) {
    console.log("[startup] SMTP_URL not set — emails are written to <workspace>/outbox/ instead of sent")
  } else if (!process.env.APP_URL?.trim()) {
    console.warn("[startup] SMTP_URL is set but APP_URL isn't — links in emails will use the request's Host header. Set APP_URL to your public URL.")
  }

  const { recoverInterruptedJobs, sweepExpiredJobs } = await import("./lib/jobStore")
  const recovered = recoverInterruptedJobs()
  if (recovered) console.log(`[startup] marked ${recovered} interrupted job(s) as failed`)
  const swept = sweepExpiredJobs()
  if (swept) console.log(`[startup] deleted ${swept} expired job(s)`)
  if (Number(process.env.JOB_RETENTION_DAYS ?? 0) > 0) {
    setInterval(() => sweepExpiredJobs(), 60 * 60 * 1000).unref()
  }
}
