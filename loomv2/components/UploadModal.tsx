"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Upload, ChevronRight, AlertCircle, CheckCircle, Loader2, Film, X, Settings, KeyRound } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import {
  useTranslationSettings,
  TranslationSettingsDialog,
  MODEL_INFO,
  PROVIDER_LABEL,
  getMissingTranslationKey,
  getMissingWordMappingKey,
} from "./TranslationSettings"

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

  const [file, setFile]           = useState<File | null>(null)
  const [stage, setStage]         = useState<Stage>("idle")
  const [logLines, setLogLines]   = useState<string[]>([])
  const [progress, setProgress]   = useState(0)
  const [dragOver, setDragOver]   = useState(false)
  const [errorMsg, setErrorMsg]   = useState("")
  const [keyError, setKeyError]   = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { config } = useTranslationSettings()

  // "Use AI" is disabled when:
  // 1. No word mapping model selected (AI has nothing to do), OR
  // 2. Word mapping model is selected but its key is missing
  const noWordMappingModel  = config.wordMappingModel === null
  const missingWordMappingKey = getMissingWordMappingKey(config)
  const aiButtonDisabled = noWordMappingModel || !!missingWordMappingKey

  const aiButtonTitle = noWordMappingModel
    ? "Select a word mapping model in Settings to enable AI"
    : missingWordMappingKey
      ? `${PROVIDER_LABEL[missingWordMappingKey]} API key required — add it in Settings`
      : undefined

  useEffect(() => {
    if (isOpen) {
      setFile(null); setStage("idle"); setLogLines([])
      setProgress(0); setErrorMsg(""); setDragOver(false); setKeyError(null)
    }
  }, [isOpen])

  // Clear key error when config changes (user saved a key)
  useEffect(() => { setKeyError(null) }, [config])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logLines])

  const appendLog = (line: string) => setLogLines((p) => [...p.slice(-80), line])

  const pickFile = (f: File) => {
    if (!f.type.startsWith("video/")) { setErrorMsg("Please pick a video file."); return }
    setFile(f); setErrorMsg(""); setKeyError(null); setLogLines([]); setStage("idle")
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
          if (data.log?.length) onLog(data.log[data.log.length - 1])
          if (data.progress)    onProgress(data.progress)
          if (data.status === "done")  { clearInterval(iv); resolve() }
          if (data.status === "error") { clearInterval(iv); reject(new Error(data.message || "Script failed")) }
        } catch (err) { clearInterval(iv); reject(err) }
      }, POLL_INTERVAL)
    })
  }

  async function handleTranslate(useAI: boolean = false) {
    if (!file) return

    // Gate on translation model key
    const missingBase = getMissingTranslationKey(config)
    if (missingBase) {
      setKeyError(`${PROVIDER_LABEL[missingBase]} API key is required for the selected translation model.`)
      setSettingsOpen(true)
      return
    }

    setKeyError(null)
    setLogLines([]); setProgress(0); setErrorMsg("")
    try {
      setStage("uploading"); appendLog("Uploading video…")
      const form = new FormData(); form.append("video", file)
      const upRes = await fetch("/api/upload", { method: "POST", body: form })
      if (!upRes.ok) throw new Error(await upRes.text())
      const { jobId } = await upRes.json()
      appendLog(`Upload complete. Job: ${jobId}`); setProgress(10)

      setStage("ocr"); appendLog("Starting OCR…")
      const ocrRes = await fetch(`/api/run/ocr?jobId=${jobId}`, { method: "POST" })
      if (!ocrRes.ok) throw new Error(await ocrRes.text())
      await pollUntilDone(`/api/run/ocr/status?jobId=${jobId}`, appendLog, (p) => setProgress(10 + p * 0.45))
      appendLog("OCR complete."); setProgress(55)

      setStage("translate"); appendLog("Starting translation…")
      const params = new URLSearchParams({
        jobId,
        ai: useAI.toString(),
        model: config.model,
        openaiKey: config.openaiKey,
        sarvamKey: config.sarvamKey,
      })
      const trRes = await fetch(`/api/run/translate?${params.toString()}`, { method: "POST" })
      if (!trRes.ok) throw new Error(await trRes.text())
      await pollUntilDone(`/api/run/translate/status?jobId=${jobId}`, appendLog, (p) => setProgress(55 + p * 0.44))
      appendLog("Translation complete."); setProgress(100)

      setStage("done")
      setTimeout(() => onReady(jobId), 800)
    } catch (err: any) {
      setStage("error"); setErrorMsg(err?.message ?? "Unknown error")
      appendLog(`ERROR: ${err?.message}`)
    }
  }

  const currentIdx = stageOrder.indexOf(stage)

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

              {/* File row */}
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
                  onClick={() => { setFile(null); setErrorMsg(""); setKeyError(null) }}
                >
                  <X size={14} />
                </Button>
              </div>

              {/* Generic error */}
              {errorMsg && (
                <Alert variant="destructive" className="py-2.5">
                  <AlertCircle size={13} />
                  <AlertDescription className="text-xs">{errorMsg}</AlertDescription>
                </Alert>
              )}

              {/* Key error */}
              {keyError && (
                <Alert variant="destructive" className="py-2.5">
                  <KeyRound size={13} />
                  <AlertDescription className="text-xs flex items-center justify-between gap-2">
                    <span>{keyError}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] px-2 shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => { setKeyError(null); setSettingsOpen(true) }}
                    >
                      <Settings size={10} className="mr-1" /> Open Settings
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {/* Model info */}
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Model: {MODEL_INFO[config.model].label}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {config.wordMappingModel
                        ? `Word mapping: ${MODEL_INFO[config.wordMappingModel].label}`
                        : "Word mapping: None (Use AI disabled)"}
                    </p>
                  </div>
                  <Button
                    size="icon" variant="ghost" className="h-7 w-7 shrink-0"
                    onClick={() => setSettingsOpen(true)}
                    title="Change translation settings"
                  >
                    <Settings size={13} />
                  </Button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button className="flex-1" onClick={() => handleTranslate(false)}>
                  Start Processing
                </Button>
                <Button
                  className="flex-1"
                  variant="secondary"
                  disabled={aiButtonDisabled}
                  title={aiButtonTitle}
                  onClick={() => handleTranslate(true)}
                >
                  Use AI
                </Button>
              </div>

              {/* Hint under the buttons explaining why Use AI is disabled */}
              {noWordMappingModel && (
                <p className="text-[11px] text-muted-foreground text-center">
                  <button
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Select a word mapping model
                  </button>{" "}
                  to enable Use AI.
                </p>
              )}
              {!noWordMappingModel && missingWordMappingKey && (
                <p className="text-[11px] text-muted-foreground text-center">
                  {PROVIDER_LABEL[missingWordMappingKey]} key missing.{" "}
                  <button
                    className="underline hover:text-foreground transition-colors"
                    onClick={() => setSettingsOpen(true)}
                  >
                    Add it in Settings
                  </button>{" "}
                  to enable Use AI.
                </p>
              )}
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
                  <div ref={logRef} className="px-3 py-2 space-y-0.5 max-h-28 overflow-y-auto">
                    {logLines.map((l, i) => (
                      <p key={i} className={cn(
                        "text-[10px] font-mono leading-relaxed",
                        l.startsWith("ERROR") ? "text-destructive" : "text-muted-foreground"
                      )}>
                        {l}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Error */}
              {errorMsg && (
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

      <TranslationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </Dialog>
  )
}