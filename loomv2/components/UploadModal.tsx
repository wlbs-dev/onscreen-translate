"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Upload, ChevronRight, AlertCircle, CheckCircle, Loader2, Film, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"
import LanguageSelect, { rememberedLang } from "@/components/LanguageSelect"
import { languageName } from "@/lib/languages"
import { USAGE_CHANGED_EVENT, redirectToLogin } from "@/components/UserMenu"

type Stage = "idle" | "uploading" | "ocr" | "translate" | "done" | "error"

interface Props {
  isOpen: boolean
  onClose: () => void
  onReady: (jobId: string) => void
}

const STAGE_LABELS: Record<Stage, string> = {
  idle:      "",
  uploading: "Uploading video…",
  ocr:       "Running OCR & annotation…",
  translate: "Translating detections…",
  done:      "Done!",
  error:     "Something went wrong",
}

const POLL_INTERVAL = 2000

/** The `error` field of a JSON error response, or the raw body. */
async function errorText(res: Response): Promise<string> {
  const text = await res.text()
  try { return JSON.parse(text).error ?? text } catch { return text || `Request failed (${res.status})` }
}
const stageOrder: Stage[] = ["uploading", "ocr", "translate", "done"]
const stageDisplay: Record<string, string> = {
  uploading: "Upload",
  ocr:       "OCR",
  translate: "Translate",
  done:      "Done",
}

export default function UploadModal({ isOpen, onClose, onReady }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const logRef   = useRef<HTMLDivElement>(null)

  const [file, setFile]         = useState<File | null>(null)
  const [stage, setStage]       = useState<Stage>("idle")
  const [logLines, setLogLines] = useState<string[]>([])
  const [progress, setProgress] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  // The parent remounts this modal on every open (key), so state starts fresh
  const [lang, setLang]         = useState(rememberedLang)
  const [quotaHit, setQuotaHit] = useState(false)

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const appendLog = (line: string) => setLogLines((p) => [...p.slice(-80), line])

  const pickFile = (f: File) => {
    if (!f.type.startsWith("video/")) { setErrorMsg("Please pick a video file."); return }
    setFile(f); setErrorMsg(""); setLogLines([]); setStage("idle")
  }

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) pickFile(e.target.files[0])
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (e.dataTransfer.files?.[0]) pickFile(e.dataTransfer.files[0])
  }, [])

  async function pollUntilDone(
    url: string,
    onLog: (l: string) => void,
    onProgress: (p: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const data = await fetch(url).then((r) => r.json())
          if (data.status === "queued" && data.message) onLog(data.message)
          else if (data.log?.length) onLog(data.log[data.log.length - 1])
          if (data.progress)    onProgress(data.progress)
          if (data.status === "done")  { clearInterval(iv); resolve() }
          if (data.status === "error") { clearInterval(iv); reject(new Error(data.message || "Script failed")) }
        } catch (err) { clearInterval(iv); reject(err) }
      }, POLL_INTERVAL)
    })
  }

  async function handleTranslate(useAI: boolean = false) {
    if (!file) return
    setLogLines([]); setProgress(0); setErrorMsg(""); setQuotaHit(false)
    try {
      setStage("uploading"); appendLog("Uploading video…")
      const form = new FormData(); form.append("video", file)
      const upRes = await fetch("/api/upload", { method: "POST", body: form })
      if (!upRes.ok) {
        const body = await upRes.json().catch(() => ({}))
        if (upRes.status === 401) { redirectToLogin(); return }
        if (upRes.status === 402) setQuotaHit(true)
        throw new Error(body.error ?? `Upload failed (${upRes.status})`)
      }
      const { jobId } = await upRes.json()
      window.dispatchEvent(new Event(USAGE_CHANGED_EVENT))
      appendLog(`Upload complete. Job: ${jobId}`); setProgress(10)

      setStage("ocr"); appendLog("Starting OCR…")
      const ocrRes = await fetch(`/api/run/ocr?jobId=${jobId}`, { method: "POST" })
      if (!ocrRes.ok) throw new Error(await errorText(ocrRes))
      await pollUntilDone(`/api/run/ocr/status?jobId=${jobId}`, appendLog, (p) => setProgress(10 + p * 0.45))
      appendLog("OCR complete."); setProgress(55)

      setStage("translate"); appendLog("Starting translation…")
      appendLog(`Target language: ${languageName(lang)}`)
      const trRes = await fetch(
        `/api/run/translate?jobId=${jobId}&ai=${useAI}&lang=${encodeURIComponent(lang)}`,
        { method: "POST" },
      )
      if (!trRes.ok) throw new Error(await errorText(trRes))
      await pollUntilDone(`/api/run/translate/status?jobId=${jobId}`, appendLog, (p) => setProgress(55 + p * 0.44))
      appendLog("Translation complete."); setProgress(100)

      setStage("done")
      setTimeout(() => onReady(jobId), 800)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      setStage("error"); setErrorMsg(msg)
      appendLog(`ERROR: ${msg}`)
    }
  }

  const currentIdx   = stageOrder.indexOf(stage)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden bg-white border border-border shadow-xl">

        {/* Header */}
        <DialogHeader className="px-6 pt-5 pb-4 border-b">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Film size={16} className="text-primary" />
            </div>
            <DialogTitle className="text-sm font-semibold text-foreground">
              Upload Video
            </DialogTitle>
            <DialogDescription className="sr-only">
              Upload a video, choose the language, and we will find and translate its on-screen text.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-4 overflow-y-auto" style={{ maxHeight: "72vh" }}>

          {/* ── Drop zone ─────────────────────────────────────────── */}
          {stage === "idle" && !file && (
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-8 py-12 text-center cursor-pointer transition-all duration-200",
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50"
              )}
            >
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                dragOver ? "bg-primary/15" : "bg-background border border-border"
              )}>
                <Upload size={20} className={dragOver ? "text-primary" : "text-muted-foreground"} />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">Drop your video here</p>
                <p className="text-xs text-muted-foreground mt-0.5">or click to select · MP4, MOV, MKV…</p>
              </div>
              <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={onInputChange} />
            </div>
          )}

          {/* ── File selected ──────────────────────────────────────── */}
          {stage === "idle" && file && (
            <div className="space-y-3">
              <div className="flex items-center gap-3 rounded-lg border bg-muted/20 px-4 py-3">
                <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Film size={15} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                </div>
                <Button
                  variant="ghost" size="icon"
                  className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={() => { setFile(null); setErrorMsg("") }}
                >
                  <X size={14} />
                </Button>
              </div>

              {errorMsg && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertCircle size={13} />
                  <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="upload-lang" className="text-xs">Translate on-screen text into</Label>
                <LanguageSelect id="upload-lang" value={lang} onChange={setLang} />
              </div>

              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => handleTranslate(false)}>
                  Start Processing
                </Button>
                <Button className="flex-1" variant="secondary" onClick={() => handleTranslate(true)}>
                  Use AI
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <span className="font-medium">Use AI</span> translates whole sentences with context and
                splits them back across the boxes — better for infographic or keyword-style videos.
              </p>
            </div>
          )}

          {/* ── Processing ────────────────────────────────────────── */}
          {stage !== "idle" && (
            <div className="space-y-4">

              {/* Stage pills */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {stageOrder.map((s, i) => {
                  const isDone    = i < currentIdx || stage === "done"
                  const isCurrent = i === currentIdx && stage !== "done"
                  return (
                    <div key={s} className="flex items-center gap-1.5">
                      <Badge
                        variant={isDone ? "default" : isCurrent ? "secondary" : "outline"}
                        className={cn(
                          "text-[10px] px-2.5 py-0.5 font-medium transition-all",
                          isDone    && "bg-emerald-500 hover:bg-emerald-500 text-white border-emerald-500",
                          isCurrent && "bg-primary/10 text-primary border-primary/20",
                          !isDone && !isCurrent && "text-muted-foreground"
                        )}
                      >
                        {isDone && <CheckCircle size={9} className="mr-1" />}
                        {isCurrent && <Loader2 size={9} className="mr-1 animate-spin" />}
                        {stageDisplay[s]}
                      </Badge>
                      {i < stageOrder.length - 1 && (
                        <ChevronRight size={11} className="text-muted-foreground/50" />
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Progress */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <p className="text-xs text-muted-foreground">{STAGE_LABELS[stage]}</p>
                  <span className="text-xs font-mono text-muted-foreground">{Math.round(progress)}%</span>
                </div>
                <Progress
                  value={progress}
                  className={cn(
                    "h-1.5",
                    stage === "done"  && "[&>div]:bg-emerald-500",
                    stage === "error" && "[&>div]:bg-destructive",
                  )}
                />
              </div>

              {/* Log */}
              {logLines.length > 0 && (
                <div className="rounded-lg border bg-muted/30 overflow-hidden">
                  <div className="px-3 py-2 border-b bg-muted/50">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Activity log</p>
                  </div>
                  <div
                    ref={logRef}
                    className="px-3 py-2 space-y-0.5 max-h-28 overflow-y-auto"
                  >
                    {logLines.map((l, i) => (
                      <p
                        key={i}
                        className={cn(
                          "text-[10px] font-mono leading-relaxed",
                          l.startsWith("ERROR") ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {l}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Over the monthly quota (402) */}
              {errorMsg && quotaHit && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3" data-testid="quota-error">
                  <p className="text-sm font-semibold text-amber-900">Monthly video limit reached</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-amber-800">{errorMsg}</p>
                  <p className="mt-1.5 text-xs text-amber-800">Need more minutes for the pilot? Use “Send feedback” in the account menu and we&apos;ll raise your quota.</p>
                </div>
              )}

              {/* Error */}
              {errorMsg && !quotaHit && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertCircle size={13} />
                  <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
                </Alert>
              )}

              {/* Done */}
              {stage === "done" && (
                <div className="flex items-center gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle size={16} className="text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Processing complete</p>
                    <p className="text-xs text-emerald-600">Opening editor…</p>
                  </div>
                </div>
              )}

              {/* Retry */}
              {stage === "error" && (
                <Button
                  variant="outline"
                  className="w-full border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                  onClick={() => { setStage("idle"); setProgress(0); setErrorMsg("") }}
                >
                  Try again
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {(stage === "idle" || stage === "done" || stage === "error") && (
          <>
            <Separator />
            <div className="px-6 py-4">
              <Button variant="outline" className="w-full" onClick={onClose}>
                {stage === "done" ? "Close" : "Cancel"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}