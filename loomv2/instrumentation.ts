// instrumentation.ts — runs once when the Next.js server starts
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { recoverInterruptedJobs, sweepExpiredJobs } = await import("./lib/jobStore")
  const recovered = recoverInterruptedJobs()
  if (recovered) console.log(`[startup] marked ${recovered} interrupted job(s) as failed`)
  const swept = sweepExpiredJobs()
  if (swept) console.log(`[startup] deleted ${swept} expired job(s)`)
  if (Number(process.env.JOB_RETENTION_DAYS ?? 0) > 0) {
    setInterval(() => sweepExpiredJobs(), 60 * 60 * 1000).unref()
  }
}
