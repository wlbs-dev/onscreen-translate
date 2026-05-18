// lib/jobPaths.ts
import path from "path"
import { execSync } from "child_process"

export const WORKSPACE = process.env.WORKSPACE_DIR
  ?? path.resolve(__dirname, "../../../workspace")

export const SCRIPTS_DIR = process.env.SCRIPTS_DIR
  ?? path.resolve(WORKSPACE, "../scripts")

export function jobPaths(jobId: string) {
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