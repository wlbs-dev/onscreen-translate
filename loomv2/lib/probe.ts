// lib/probe.ts — video duration via ffprobe (spawned directly, no shell).
import { spawn } from "child_process"

export function probeDurationSec(file: string, timeoutMs = 30_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.env.FFPROBE ?? "ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      file,
    ], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("ffprobe timed out")) }, timeoutMs)
    proc.stdout.on("data", (d) => { out += d })
    proc.stderr.on("data", (d) => { err += d })
    proc.on("error", (e) => { clearTimeout(timer); reject(e) })
    proc.on("close", (code) => {
      clearTimeout(timer)
      const sec = parseFloat(out.trim())
      if (code === 0 && Number.isFinite(sec) && sec > 0) resolve(sec)
      else reject(new Error(err.trim() || `ffprobe exited with ${code}`))
    })
  })
}
