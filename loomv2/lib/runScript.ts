
/**
 * lib/runScript.ts
 * Fire-and-forget script runner that updates jobStore as output arrives.
 * Returns a promise that resolves when the process exits.
 */

import { spawn } from "child_process"
import { JobStage, appendLog, updateStage } from "./jobStore"
import { SCRIPTS_DIR } from "./jobPaths"

export function runScript(opts: {
  jobId: string
  stage: JobStage
  python: string
  script: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}): Promise<void> {
  const { jobId, stage, python, script, args } = opts

  updateStage(jobId, stage, { status: "running", progress: 0, log: [], message: "Starting…" })

  return new Promise((resolve) => {
    const proc = spawn(python, [script, ...args], {
      cwd: opts.cwd ?? SCRIPTS_DIR,
      shell: false,
      env: opts.env || { ...process.env, PYTHONUNBUFFERED: "1" },
    })

    const handleLine = (line: string) => {
      if (!line.trim()) return
      console.log(`[${stage}]`, line)
      appendLog(jobId, stage, line)

      // Parse optional PROGRESS:0.42 hints from the Python scripts
      const m = line.match(/^PROGRESS:([\d.]+)$/)
      if (m) {
        updateStage(jobId, stage, { progress: Math.round(parseFloat(m[1]) * 100) })
      }
    }

    let stdoutBuf = ""
    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8")
      const lines = stdoutBuf.split("\n")
      stdoutBuf = lines.pop() ?? ""
      lines.filter(Boolean).forEach(handleLine)
    })

    let stderrBuf = ""
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8")
      const lines = stderrBuf.split("\n")
      stderrBuf = lines.pop() ?? ""
      lines.filter(Boolean).forEach(handleLine)
    })

    proc.on("error", (err) => {
      appendLog(jobId, stage, `ERROR: ${err.message}`)
      updateStage(jobId, stage, { status: "error", message: err.message })
      resolve()
    })

    proc.on("close", (code) => {
      if (stdoutBuf.trim()) handleLine(stdoutBuf)
      if (stderrBuf.trim()) handleLine(stderrBuf)
      if (code === 0) {
        updateStage(jobId, stage, { status: "done", progress: 100, message: "Done" })
      } else {
        updateStage(jobId, stage, { status: "error", message: `Exited with code ${code}` })
      }
      resolve()
    })
  })
}
