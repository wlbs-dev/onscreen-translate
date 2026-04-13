// lib/jobPaths.ts
import path from "path"
import { execSync } from "child_process"

// Resolve from the cwd (loomv2/) — __dirname points into .next/ once bundled
export const WORKSPACE = process.env.WORKSPACE_DIR
  ?? path.resolve(process.cwd(), "..", "workspace")

export const SCRIPTS_DIR = process.env.SCRIPTS_DIR
  ?? path.resolve(WORKSPACE, "../scripts")

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Job ids are UUIDs from /api/upload; anything else must never reach path.join
export function isValidJobId(id: unknown): id is string {
  return typeof id === "string" && JOB_ID_RE.test(id)
}

export function jobPaths(jobId: string) {
  if (!isValidJobId(jobId)) throw new Error(`Invalid jobId: ${jobId}`)
  const jobDir = path.join(WORKSPACE, "uploads", jobId)
  return {
    jobDir,
    video:     path.join(jobDir, "input_video.mp4"),
    framesDir: path.join(jobDir, "frames"),
    detections: path.join(jobDir, "frames", "ocr_detections.json"),
    translated: path.join(jobDir, "translated_detections.json"),
    output:    path.join(jobDir, "output.mp4"),
  }
}

export function getPython(): string {
  // Prefer venv inside scripts folder, fall back to system python
  const venvWin  = path.join(SCRIPTS_DIR, ".venv", "Scripts", "python.exe")
  const venvUnix = path.join(SCRIPTS_DIR, ".venv", "bin", "python")
  const fs = require("fs")
  if (fs.existsSync(venvWin))  return venvWin
  if (fs.existsSync(venvUnix)) return venvUnix
  try {
    execSync("python --version", { stdio: "ignore" })
    return "python"
  } catch {
    return "python3"
  }
}