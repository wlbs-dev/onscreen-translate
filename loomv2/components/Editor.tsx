// Editor.tsx
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Save, Play, Download, Loader2, CheckCircle, AlertCircle, Film } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import Header from "./Header"
import VideoPlayer, { OverlayEvent } from "./VideoPlayer"
import Sidebar from "./Sidebar"
import Timeline from "./Timeline"

interface Block {
  id: string; text: string; translation: string
  bbox: [number, number, number, number]; conf: number
  words: { text: string; bbox: [number, number, number, number]; conf: number }[]
  bgColor: string; textColor: string; fontSize?: number
}
interface Frame {
  frame_index: number; timestamp: number; frame_path: string; blocks: Block[]
}

function uid() { return Math.random().toString(36).slice(2) }

function addIds(frames: Frame[]): Frame[] {
  return frames.map((f) => ({
    ...f,
    blocks: f.blocks.map((b) => ({
      ...b,
      id: b.id || uid(),
      bgColor: (b as any).bgColor || (b as any).color || "#000000",
      textColor: (b as any).textColor || "#ffffff",
      fontSize: b.fontSize ?? 20,
    })),
  }))
}

function buildEvents(frames: Frame[], videoDuration: number): OverlayEvent[] {
  const timestamps = frames.map((f) => f.timestamp).sort((a, b) => a - b)
  const byTs: Record<number, Frame> = {}
  frames.forEach((f) => { byTs[f.timestamp] = f })
  const active: Record<string, OverlayEvent> = {}
  const events: OverlayEvent[] = []

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i]
    const nextTs = i + 1 < timestamps.length ? timestamps[i + 1] : videoDuration
    const frame = byTs[ts]
    const currentKeys = new Set<string>()
    for (const block of frame.blocks) {
      const key = block.text.toLowerCase().trim()
      currentKeys.add(key)
      if (active[key]) { active[key].endTime = nextTs }
      else {
        active[key] = {
          id: block.id || uid(), blockText: block.text, translation: block.translation,
          bbox: [...block.bbox] as [number, number, number, number],
          bgColor: block.bgColor || "#000000", textColor: block.textColor || "#ffffff",
          fontSize: block.fontSize ?? 20,
          startTime: Math.max(0, ts - 0.5), endTime: nextTs, frameIndex: frame.frame_index,
        }
      }
    }
    for (const key of Object.keys(active)) {
      if (!currentKeys.has(key)) { events.push(active[key]); delete active[key] }
    }
  }
  for (const ev of Object.values(active)) events.push(ev)
  return events.sort((a, b) => a.startTime - b.startTime)
}

function fmt(t: number) {
  const m = Math.floor(t / 60)
  const s = (t % 60).toFixed(1).padStart(4, "0")
  return `${m}:${s}`
}

interface EditorProps {
  jobId: string
  onBack: () => void
}

export default function Editor({ jobId, onBack }: EditorProps) {
  const videoRef                            = useRef<HTMLVideoElement | null>(null)
  const [frames, setFrames]                 = useState<Frame[]>([])
  const [events, setEvents]                 = useState<OverlayEvent[]>([])
  const [selectedId, setSelectedId]         = useState<string | null>(null)
  const [currentTime, setCurrentTime]       = useState(0)
  const [duration, setDuration]             = useState(0)
  const [isLoading, setIsLoading]           = useState(true)
  const [saveStatus, setSaveStatus]         = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [renderStatus, setRenderStatus]     = useState<"idle" | "running" | "done" | "error">("idle")
  const [renderProgress, setRenderProgress] = useState(0)
  const [renderMessage, setRenderMessage]   = useState("")
  const [renderLog, setRenderLog]           = useState<string[]>([])

  const q = `?jobId=${jobId}`

  async function loadRenderStatus() {
    try {
      const res = await fetch(`/api/render/status${q}`)
      if (!res.ok) return
      const status = await res.json()
      setRenderStatus(status.status ?? "idle")
      setRenderProgress(status.progress ?? 0)
      setRenderMessage(status.message ?? "")
      setRenderLog(status.log ?? [])
    } catch (err) {
      console.error("Failed to load render status", err)
    }
  }

  useEffect(() => {
    setIsLoading(true)
    fetch(`/api/detections${q}`)
      .then((r) => r.json())
      .then((data) => setFrames(addIds(data)))
      .catch(console.error)
      .finally(() => setIsLoading(false))
  }, [jobId])

  useEffect(() => { loadRenderStatus() }, [jobId])

  useEffect(() => {
    if (renderStatus !== "running") return
    const poll = setInterval(loadRenderStatus, 1000)
    return () => clearInterval(poll)
  }, [renderStatus, jobId])

  useEffect(() => {
    if (frames.length > 0 && duration > 0) setEvents(buildEvents(frames, duration))
  }, [frames, duration])

  const handleUpdateEvent = (id: string, patch: Partial<OverlayEvent>) =>
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, ...patch } : ev))

  const handleAddEvent = (event: OverlayEvent) =>
    setEvents((prev) => [...prev, event])

  const selectedEvent = events.find((e) => e.id === selectedId) ?? null

  function deleteSelected() {
    setEvents((prev) => prev.filter((e) => e.id !== selectedId))
    setSelectedId(null)
  }

  const handleSelectFromList = useCallback((id: string, seekTo: number) => {
    setSelectedId(id)
    if (videoRef.current) videoRef.current.currentTime = seekTo
  }, [])

  function eventsToFrames(events: OverlayEvent[], originalFrames: Frame[]): Frame[] {
    return originalFrames.map((origFrame) => {
      const t = origFrame.timestamp
      const activeBlocks = events
        .filter((ev) => t >= ev.startTime && t < ev.endTime)
        .map((ev) => {
          const origBlock = origFrame.blocks.find(
            (b) => b.text.toLowerCase().trim() === ev.blockText.toLowerCase().trim()
          )
          return {
            id: ev.id, text: ev.blockText, translation: ev.translation,
            bbox: ev.bbox, conf: origBlock?.conf ?? 1.0,
            words: origBlock?.words ?? [],
            bgColor: ev.bgColor, textColor: ev.textColor, fontSize: ev.fontSize,
          }
        })
      return {
        frame_index: origFrame.frame_index,
        timestamp: origFrame.timestamp,
        frame_path: origFrame.frame_path,
        blocks: activeBlocks,
      }
    })
  }

  const handleSeek = useCallback((t: number) => {
    if (videoRef.current) videoRef.current.currentTime = t
  }, [])

  async function handleSave() {
    setSaveStatus("saving")
    try {
      const r = await fetch(`/api/detections${q}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detections: eventsToFrames(events, frames) }),
      })
      if (!r.ok) throw new Error("Failed to save")
      setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2000)
    } catch {
      setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 3000)
    }
  }

  async function handleRender() {
    await handleSave()
    setRenderStatus("running"); setRenderProgress(0); setRenderMessage("Starting render…")
    await fetch(`/api/render${q}`, { method: "POST" })
    await loadRenderStatus()
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <Header
        onBack={onBack}
        rightContent={
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <Separator orientation="vertical" className="h-4" />

            {/* Save */}
            <Button
              size="sm"
              variant={saveStatus === "saved" ? "default" : saveStatus === "error" ? "destructive" : "outline"}
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className="gap-1.5"
            >
              {saveStatus === "saving"  ? <Loader2 size={12} className="animate-spin" /> :
               saveStatus === "saved"   ? <CheckCircle size={12} /> :
               saveStatus === "error"   ? <AlertCircle size={12} /> :
               <Save size={12} />}
              {saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Error" : "Save"}
            </Button>

            {/* Render / Download */}
            {renderStatus === "done" ? (
              <>
                <Button size="sm" variant="default" className="gap-1.5" asChild>
                  <a href={`/api/output${q}`} download="translated.mp4">
                    <Download size={12} /> Download
                  </a>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setRenderStatus("idle")}>
                  <Play size={12} />
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={handleRender}
                disabled={renderStatus === "running"}
                className="gap-1.5"
              >
                {renderStatus === "running"
                  ? <><Loader2 size={12} className="animate-spin" /> Rendering {renderProgress}%</>
                  : <><Play size={12} /> Render</>}
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-1 min-h-0">

        {/* Left: Video + render bar + Timeline */}
        <div className="flex flex-col min-h-0" style={{ width: "65%" }}>

          {/* Video */}
          <div className="video-area flex-1 min-h-0 bg-black overflow-hidden">
            {isLoading ? (
              <div className="w-full h-full flex items-center justify-center gap-2 text-muted-foreground">
                <Loader2 size={18} className="animate-spin" />
                <span className="text-xs">Loading detections…</span>
              </div>
            ) : (
              <VideoPlayer
                src={`/api/video${q}`}
                events={events}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onUpdateEvent={handleUpdateEvent}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onVideoReady={(el) => { videoRef.current = el }}
              />
            )}
          </div>

          {/* Render progress */}
          {(renderStatus === "running" || renderStatus === "error") && (
            <div className="px-4 py-2 shrink-0 border-t bg-muted/30">
              <div className="flex justify-between items-center text-xs mb-1.5">
                <span className={renderStatus === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {renderStatus === "error" ? "⚠ " : ""}{renderMessage || "Render failed"}
                </span>
                {renderStatus === "running" && (
                  <span className="font-mono text-muted-foreground">{renderProgress}%</span>
                )}
                {renderStatus === "error" && (
                  <Button size="sm" variant="ghost" onClick={() => setRenderStatus("idle")} className="h-6 text-xs">
                    Dismiss
                  </Button>
                )}
              </div>
              <Progress
                value={renderStatus === "error" ? 100 : renderProgress}
                className={`h-1.5 ${renderStatus === "error" ? "[&>div]:bg-destructive" : ""}`}
              />
              {renderStatus === "error" && renderLog.length > 0 && (
                <div className="mt-2 p-2 rounded font-mono text-[10px] overflow-y-auto bg-destructive/5 text-destructive max-h-20 border border-destructive/20">
                  {renderLog.map((line, i) => <div key={i}>{line}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Timeline */}
          <div className="shrink-0 border-t" style={{ height: "38%" }}>
            <Timeline
              events={events}
              currentTime={currentTime}
              duration={duration}
              selectedId={selectedId}
              onSelectEvent={handleSelectFromList}
              onSeek={handleSeek}
              onAddEvent={handleAddEvent}
              onUpdateEvent={handleUpdateEvent}
            />
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="shrink-0 border-l overflow-hidden flex flex-col bg-background" style={{ width: "35%" }}>
          {selectedEvent ? (
            <Sidebar
              event={selectedEvent}
              allEvents={events}
              currentTime={currentTime}
              duration={duration}
              onUpdate={(patch) => selectedId && handleUpdateEvent(selectedId, patch)}
              onDelete={deleteSelected}
              onClose={() => setSelectedId(null)}
              onSelectEvent={handleSelectFromList}
              onAddEvent={handleAddEvent}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Film size={18} className="text-muted-foreground" />
              </div>
              <p className="text-xs text-center leading-relaxed text-muted-foreground px-4">
                Select a text box on the video or a clip in the timeline to edit
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}