// Dashboard.tsx
"use client"

import { useEffect, useState } from "react"
import { Film, Loader2, Plus, ChevronRight, MoreHorizontal, Check, X, Upload, RefreshCw, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog"
import Header from "./Header"
import { useTranslationSettings, TranslationSettingsDialog, MODEL_INFO } from "./TranslationSettings"

interface Job {
  id: string
  createdAt: number
  label: string
  outputExists: boolean
  ocr:       { status: string; progress: number }
  translate: { status: string; progress: number }
  render:    { status: string; progress: number }
}

function timeAgo(ts: number) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1)  return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "done")    return "default"
  if (status === "running") return "secondary"
  if (status === "error")   return "destructive"
  return "outline"
}

function JobCard({ job, onOpen, onRename, onDelete, onRetranslate }: {
  job: Job
  onOpen: () => void
  onRename: (id: string, label: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onRetranslate: (id: string, useAi: boolean) => Promise<void>
}) {
  const [editing, setEditing]                     = useState(false)
  const [draft, setDraft]                         = useState(job.label)
  const [saving, setSaving]                       = useState(false)
  const [error, setError]                         = useState<string | null>(null)
  const [translating, setTranslating]             = useState(false)
  const [translatePct, setTranslatePct]           = useState(0)
  const [showTranslateDialog, setShowTranslateDialog] = useState(false)
  const { config } = useTranslationSettings() 

  useEffect(() => { setDraft(job.label) }, [job.label])

  useEffect(() => {
    if (job.translate.status === "running") {
      setTranslating(true)
      setTranslatePct(job.translate.progress ?? 0)
    } else {
      setTranslating(false)
    }
  }, [job.translate.status, job.translate.progress])

  const saveLabel = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (saving || !draft.trim()) return
    setSaving(true); setError(null)
    try {
      await onRename(job.id, draft.trim())
      setEditing(false)
    } catch {
      setError("Unable to save name")
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${job.label}"? This cannot be undone.`)) return
    await onDelete(job.id)
  }

  const handleRetranslate = async (useAi: boolean = false) => {
    setTranslating(true)
    setTranslatePct(0)
    setError(null)
    try {
      await onRetranslate(job.id, useAi)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Translation failed")
    } finally {
      setTranslating(false)
    }
  }

  return (
    <Card
      onClick={onOpen}
      className="cursor-pointer hover:shadow-md transition-shadow border-border"
    >
      <CardContent className="p-4 flex flex-col gap-3">

        {/* Name row */}
        <div className="flex items-start justify-between gap-2">
          {editing ? (
            <div className="flex gap-2 flex-1" onClick={(e) => e.stopPropagation()}>
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-7 text-sm"
                autoFocus
              />
              <Button size="icon" variant="default" className="h-7 w-7 shrink-0" onClick={saveLabel} disabled={saving || !draft.trim()}>
                <Check size={12} />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={(e) => { e.stopPropagation(); setEditing(false); setDraft(job.label); setError(null) }}>
                <X size={12} />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-semibold truncate">{job.label}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0">
                    <MoreHorizontal size={13} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => setEditing(true)}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => setShowTranslateDialog(true)}
                    disabled={translating}
                    className="gap-2"
                  >
                    <RefreshCw size={12} className={translating ? "animate-spin" : ""} />
                    {translating ? `Translating ${translatePct}%…` : "Retranslate"}
                  </DropdownMenuItem>
                  {job.outputExists && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => window.open(`/api/output?jobId=${job.id}`, "_blank")}>
                        View output
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleDelete} className="text-destructive focus:text-destructive">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
          <ChevronRight size={14} className="text-muted-foreground shrink-0 mt-0.5" />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {/* Translate progress bar */}
        {translating && (
          <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Loader2 size={9} className="animate-spin" /> Translating…
              </span>
              <span className="font-mono">{translatePct}%</span>
            </div>
            <Progress value={translatePct} className="h-1" />
          </div>
        )}

        {/* Video preview */}
        {job.outputExists && (
          <div onClick={(e) => e.stopPropagation()}>
            <video
              src={`/api/output?jobId=${job.id}`}
              controls muted loop playsInline
              className="w-full rounded-lg border max-h-44 bg-black"
            />
          </div>
        )}

        {/* Meta */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{timeAgo(job.createdAt)}</span>
          <span>·</span>
          <span className="font-mono">{job.id.slice(0, 8)}</span>
        </div>

        {/* Status badges */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "OCR",       val: job.ocr.status },
            { label: "Translate", val: job.translate.status },
            { label: "Render",    val: job.render.status },
          ].map(({ label, val }) => (
            <Badge key={label} variant={statusVariant(val)} className="text-[10px] px-2 py-0">
              {label}: {val}
            </Badge>
          ))}
        </div>

      </CardContent>

      {/* Translate mode dialog */}
      <AlertDialog open={showTranslateDialog} onOpenChange={setShowTranslateDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()} className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Translation Settings</AlertDialogTitle>
            <AlertDialogDescription>
              Configure how to translate this video
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 my-4">
            <div>
              <p className="text-sm font-medium mb-2">Model: {MODEL_INFO[config.model].label}</p>
              <p className="text-xs text-muted-foreground">{MODEL_INFO[config.model].description}</p>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground">
                <strong>Estimated tokens:</strong> ~{config.estimatedTokens} tokens
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <strong>Estimated cost:</strong> ${(config.estimatedTokens * MODEL_INFO[config.model].costPer1kTokens / 1000 / 100).toFixed(4)}
              </p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setShowTranslateDialog(false)
                handleRetranslate(false)
              }}
            >
              Without AI
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowTranslateDialog(false)
                handleRetranslate(true)
              }}
            >
              Use AI
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

export default function Dashboard({ onOpenJob, onNewJob }: {
  onOpenJob: (jobId: string) => void
  onNewJob: () => void
}) {
  const [jobs, setJobs]       = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState("all")
  const [settingsOpen, setSettingsOpen] = useState(false)
  const { config } = useTranslationSettings()

  const renameJob = async (id: string, label: string) => {
    const res = await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, label }),
    })
    if (!res.ok) throw new Error("Failed to rename")
    setJobs((prev) => prev.map((j) => j.id === id ? { ...j, label } : j))
  }

  const deleteJob = async (id: string) => {
    const res = await fetch("/api/jobs", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) throw new Error("Failed to delete")
    setJobs((prev) => prev.filter((j) => j.id !== id))
  }

  const retranslateJob = async (id: string, useAi: boolean = false) => {
    const params = new URLSearchParams({
      jobId: id,
      ai: useAi.toString(),
      model: config.model,
      openaiKey: config.openaiKey,
      sarvamKey: config.sarvamKey,
    })
    const res = await fetch(`/api/run/translate?${params.toString()}`, { method: "POST" })
    if (!res.ok) throw new Error("Failed to start translation")

    return new Promise<void>((resolve, reject) => {
      const iv = setInterval(async () => {
        try {
          const data = await fetch(`/api/run/translate/status?jobId=${id}`).then((r) => r.json())
          setJobs((prev) => prev.map((j) =>
            j.id === id
              ? { ...j, translate: { status: data.status, progress: data.progress ?? 0 } }
              : j
          ))
          if (data.status === "done")  { clearInterval(iv); resolve() }
          if (data.status === "error") { clearInterval(iv); reject(new Error(data.message)) }
        } catch (err) { clearInterval(iv); reject(err) }
      }, 1500)
    })
  }

  useEffect(() => {
    let alive = true
    const load = async () => {
      try {
        const data = await fetch("/api/jobs").then((r) => r.json())
        if (alive) { setJobs(data); setLoading(false) }
      } catch { if (alive) setLoading(false) }
    }
    load()
    const iv = setInterval(load, 5000)
    return () => { alive = false; clearInterval(iv) }
  }, [])

  const ready    = jobs.filter((j) => j.ocr.status === "done" && j.translate.status === "done")
  const rendered = jobs.filter((j) => j.render.status === "done")
  const filtered = filter === "ready" ? ready : filter === "rendered" ? rendered : jobs

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <Header
        rightContent={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setSettingsOpen(true)} className="gap-1.5">
              <Settings size={13} /> Settings
            </Button>
            <Button size="sm" onClick={onNewJob} className="gap-1.5">
              <Plus size={13} /> Add Video
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto">

          {/* Toolbar */}
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-base font-semibold">Videos</h1>
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList>
                <TabsTrigger value="all">All ({jobs.length})</TabsTrigger>
                <TabsTrigger value="ready">Ready ({ready.length})</TabsTrigger>
                <TabsTrigger value="rendered">Rendered ({rendered.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Content */}
          {loading ? (
            <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading videos…</span>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                <Film size={22} className="text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No videos yet</p>
              <Button variant="link" onClick={onNewJob} className="gap-1.5">
                <Upload size={13} /> Upload a video to get started
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
              {filtered.map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  onOpen={() => onOpenJob(job.id)}
                  onRename={renameJob}
                  onDelete={deleteJob}
                  onRetranslate={retranslateJob}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Translation Settings Dialog */}
      <TranslationSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}