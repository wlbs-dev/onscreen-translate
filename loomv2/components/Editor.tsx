// Editor.tsx
"use client"

import { useEffect, useEffectEvent, useRef, useState, useCallback, useMemo } from "react"
import { Save, Play, Download, Loader2, CheckCircle, AlertCircle, Film, Undo2, Redo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import Header from "./Header"
import VideoPlayer, { OverlayEvent } from "./VideoPlayer"
import Sidebar from "./Sidebar"
import Timeline, { SelectMode } from "./Timeline"
import ShortcutsHelp from "./editor/ShortcutsHelp"
import { useHistory } from "@/lib/editor/useHistory"
import { applyPatches, EventPatches } from "@/lib/editor/types"
import { isTypingTarget } from "@/lib/editor/shortcuts"

interface Block {
  id: string; text: string; translation: string
  bbox: [number, number, number, number]; conf: number
  words: { text: string; bbox: [number, number, number, number]; conf: number }[]
  bgColor?: string; textColor?: string; autoBgColor?: string; autoTextColor?: string
  cover?: "erase" | "box"; bold?: boolean; autoBold?: boolean; fontSize?: number
}
interface Frame {
  frame_index: number; timestamp: number; frame_path: string; blocks: Block[]
}

function uid() { return Math.random().toString(36).slice(2) }

// Identity of an on-screen text across frames: letters and digits only, since
// OCR spacing varies between frames. Mirror: text_key() in render_translations.py
const textKey = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

// Older files may use `color` instead of `bgColor`
type RawBlock = Partial<Block> & Pick<Block, "text" | "translation" | "bbox" | "conf" | "words"> & { color?: string }

function addIds(frames: Frame[]): Frame[] {
  return frames.map((f) => ({
    ...f,
    blocks: (f.blocks as RawBlock[]).map((b) => ({
      ...b,
      id: b.id || uid(),
      // No defaults: unset colours mean "auto" (sampled background,
      // contrasting text). Defaulting to black/white here used to get saved
      // back and force black patches on every render.
      bgColor: b.bgColor || b.color || "",
      textColor: b.textColor || "",
      // No default: an unset fontSize means "auto" (fit to box) in preview and render
      fontSize: b.fontSize,
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
      const key = textKey(block.text)
      currentKeys.add(key)
      if (active[key]) { active[key].endTime = nextTs }
      else {
        active[key] = {
          id: block.id || uid(), blockText: block.text, translation: block.translation,
          bbox: [...block.bbox] as [number, number, number, number],
          bgColor: block.bgColor || "", textColor: block.textColor || "",
          autoBgColor: block.autoBgColor, autoTextColor: block.autoTextColor,
          cover: block.cover, bold: block.bold, autoBold: block.autoBold,
          fontSize: block.fontSize,
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
  const history                             = useHistory<OverlayEvent[]>([], 100)
  const events                              = history.value
  const [builtFrom, setBuiltFrom]           = useState<{ frames: Frame[]; duration: number } | null>(null)
  // The events value last loaded or saved. Undoing back to it clears "dirty".
  const [savedEvents, setSavedEvents]       = useState<OverlayEvent[] | null>(null)
  const [selection, setSelection]           = useState<string[]>([])
  const [currentTime, setCurrentTime]       = useState(0)
  const [duration, setDuration]             = useState(0)
  const [isLoading, setIsLoading]           = useState(true)
  const [loadError, setLoadError]           = useState("")
  const [saveStatus, setSaveStatus]         = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [renderStatus, setRenderStatus]     = useState<"idle" | "running" | "done" | "error">("idle")
  const [renderProgress, setRenderProgress] = useState(0)
  const [renderMessage, setRenderMessage]   = useState("")
  const [renderLog, setRenderLog]           = useState<string[]>([])
  const [helpOpen, setHelpOpen]             = useState(false)

  const q = `?jobId=${jobId}`

  // Promise chain (not async/await) so effects can call it without the
  // react-hooks lint treating the setState calls as synchronous
  function loadRenderStatus() {
    return fetch(`/api/render/status${q}`)
      .then((res) => res.ok ? res.json() : null)
      .then((status) => {
        if (!status) return
        setRenderStatus(status.status ?? "idle")
        setRenderProgress(status.progress ?? 0)
        setRenderMessage(status.message ?? "")
        setRenderLog(status.log ?? [])
      })
      .catch((err) => console.error("Failed to load render status", err))
  }

  // isLoading starts true; the editor is remounted per job (see app/page.tsx)
  useEffect(() => {
    fetch(`/api/detections${q}`)
      .then(async (r) => {
        if (r.status === 404) throw new Error("This video has no translations yet. Go back and run Translate from its menu (or wait for processing to finish).")
        if (!r.ok) throw new Error(`Could not load translations (${r.status})`)
        return r.json()
      })
      .then((data) => setFrames(addIds(Array.isArray(data) ? data : [])))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "Could not load translations"))
      .finally(() => setIsLoading(false))
  }, [q])

  const refreshRenderStatus = useEffectEvent(() => { loadRenderStatus() })

  useEffect(() => { refreshRenderStatus() }, [jobId])

  useEffect(() => {
    if (renderStatus !== "running") return
    const poll = setInterval(() => refreshRenderStatus(), 1000)
    return () => clearInterval(poll)
  }, [renderStatus, jobId])

  // Build events once both detections and the video duration are known.
  // Done during render (not in an effect) so the first paint already has them;
  // this replaces history, so it only happens when frames/duration change.
  if (frames.length > 0 && duration > 0
      && (builtFrom?.frames !== frames || builtFrom?.duration !== duration)) {
    const built = buildEvents(frames, duration)
    setBuiltFrom({ frames, duration })
    setSavedEvents(built)
    history.reset(built)
  }

  const isDirty = savedEvents !== null && events !== savedEvents

  // Warn before closing/reloading the tab with unsaved edits
  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isDirty])

  function handleBack() {
    if (isDirty && !window.confirm("You have unsaved changes. Leave the editor and discard them?")) return
    onBack()
  }

  const { set: setEvents, preview: previewEvents, commit: commitEdit, undo, redo } = history

  // Committed edit (sidebar fields etc). Same event + same fields within 1s
  // coalesce into a single undo step, so typing a word is one entry.
  const handleUpdateEvent = useCallback((id: string, patch: Partial<OverlayEvent>) =>
    setEvents((prev) => applyPatches(prev, { [id]: patch }),
      { coalesceKey: `edit:${id}:${Object.keys(patch).sort().join(",")}` }), [setEvents])

  // Transient edits while dragging; commitEdit() on pointer-up records one entry
  const handlePreviewEvents = useCallback((patches: EventPatches) =>
    previewEvents((prev) => applyPatches(prev, patches)), [previewEvents])
  const handlePreviewEvent = useCallback((id: string, patch: Partial<OverlayEvent>) =>
    handlePreviewEvents({ [id]: patch }), [handlePreviewEvents])

  const handleAddEvent = useCallback((event: OverlayEvent) =>
    setEvents((prev) => [...prev, event]), [setEvents])

  // ── Selection ──────────────────────────────────────────────────────────
  // Ids that no longer exist (e.g. after undoing an add) drop out here.
  // The last id is the primary one shown in the sidebar.
  const selectedIds = useMemo(() => {
    const live = new Set(events.map((e) => e.id))
    return selection.filter((id) => live.has(id))
  }, [selection, events])
  const selectedId    = selectedIds[selectedIds.length - 1] ?? null
  const selectedEvent = events.find((e) => e.id === selectedId) ?? null

  const handleSelect = useCallback((id: string | null, mode: SelectMode = "replace") => {
    if (id === null) { setSelection([]); return }
    setSelection((prev) => mode === "toggle"
      ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
      : [id])
  }, [])

  function deleteSelected() {
    if (selectedIds.length === 0) return
    const ids = new Set(selectedIds)
    setEvents((prev) => prev.filter((e) => !ids.has(e.id)))
    setSelection([])
  }

  // Shift all selected clips in time, keeping them inside the video
  function nudgeSelected(dt: number) {
    if (selectedIds.length === 0) return
    const ids = new Set(selectedIds)
    const round = (t: number) => Math.round(t * 1000) / 1000
    setEvents((prev) => {
      const sel = prev.filter((e) => ids.has(e.id))
      if (sel.length === 0) return prev
      const minStart = Math.min(...sel.map((e) => e.startTime))
      const maxEnd   = Math.max(...sel.map((e) => e.endTime))
      const d = Math.max(-minStart, Math.min(duration - maxEnd, dt))
      const patches: EventPatches = {}
      for (const e of sel) patches[e.id] = { startTime: round(e.startTime + d), endTime: round(e.endTime + d) }
      return applyPatches(prev, patches)
    }, { coalesceKey: `nudge:${selectedIds.join(",")}` })
  }

  function seekBy(dt: number) {
    const v = videoRef.current; if (!v) return
    v.currentTime = Math.max(0, Math.min(v.duration || duration, v.currentTime + dt))
  }

  function togglePlay() {
    const v = videoRef.current; if (!v) return
    if (v.paused) v.play().catch(() => {}); else v.pause()
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  // useEffectEvent: one window listener that always sees the latest state.
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    const mod = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()

    // Save works even while typing, and must beat the browser's "Save page"
    if (mod && !e.altKey && !e.shiftKey && key === "s") {
      e.preventDefault()
      if (saveStatus !== "saving") handleSave()
      return
    }
    if (isTypingTarget(e.target) || helpOpen) return

    if (mod && !e.altKey && (key === "z" || key === "y")) {
      e.preventDefault()
      if (key === "y" || e.shiftKey) redo(); else undo()
      return
    }
    if (mod) return

    switch (e.key) {
      case " ":
        e.preventDefault()
        togglePlay()
        break
      case "ArrowLeft":
      case "ArrowRight": {
        // preventDefault also stops Alt+Left from navigating back
        e.preventDefault()
        const dt = (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 0.1)
        if (e.altKey) nudgeSelected(dt); else seekBy(dt)
        break
      }
      case "Delete":
      case "Backspace":
        if (selectedIds.length > 0) { e.preventDefault(); deleteSelected() }
        break
      case "Escape":
        setSelection([])
        break
      case "?":
        e.preventDefault()
        setHelpOpen(true)
        break
    }
  })

  // A focused button would also "click" on Space keyup; we already handled it
  const onKeyUp = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === " " && !isTypingTarget(e.target) && !helpOpen) e.preventDefault()
  })

  useEffect(() => {
    const down = (e: KeyboardEvent) => onKeyDown(e)
    const up   = (e: KeyboardEvent) => onKeyUp(e)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
    }
  }, [])

  const handleVideoReady = useCallback((el: HTMLVideoElement) => { videoRef.current = el }, [])

  const handleSelectFromList = useCallback((id: string, seekTo: number) => {
    setSelection([id])
    if (videoRef.current) videoRef.current.currentTime = seekTo
  }, [])

  function eventsToFrames(events: OverlayEvent[], originalFrames: Frame[]): Frame[] {
    return originalFrames.map((origFrame) => {
      const t = origFrame.timestamp
      const activeBlocks = events
        .filter((ev) => t >= ev.startTime && t < ev.endTime)
        .map((ev) => {
          const origBlock = origFrame.blocks.find(
            (b) => textKey(b.text) === textKey(ev.blockText)
          )
          return {
            id: ev.id, text: ev.blockText, translation: ev.translation,
            bbox: ev.bbox, conf: origBlock?.conf ?? 1.0,
            words: origBlock?.words ?? [],
            // undefined is dropped by JSON.stringify, so auto stays unset on disk
            bgColor: ev.bgColor || undefined, textColor: ev.textColor || undefined,
            autoBgColor: origBlock?.autoBgColor ?? ev.autoBgColor,
            autoTextColor: origBlock?.autoTextColor ?? ev.autoTextColor,
            cover: ev.cover, bold: ev.bold,
            autoBold: origBlock?.autoBold ?? ev.autoBold,
            fontSize: ev.fontSize,
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
    const snapshot = events
    try {
      const r = await fetch(`/api/detections${q}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ detections: eventsToFrames(snapshot, frames) }),
      })
      if (!r.ok) throw new Error("Failed to save")
      // Edits made while the request was in flight stay dirty
      setSavedEvents(snapshot)
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
        onBack={handleBack}
        rightContent={
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <Separator orientation="vertical" className="h-4" />

            <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />

            {/* Undo / Redo */}
            <Button
              size="icon" variant="ghost" className="h-8 w-8"
              onClick={undo} disabled={!history.canUndo}
              title="Undo (Ctrl+Z)" aria-label="Undo"
            >
              <Undo2 size={13} />
            </Button>
            <Button
              size="icon" variant="ghost" className="h-8 w-8"
              onClick={redo} disabled={!history.canRedo}
              title="Redo (Ctrl+Shift+Z)" aria-label="Redo"
            >
              <Redo2 size={13} />
            </Button>
            <Separator orientation="vertical" className="h-4" />

            {/* Unsaved changes */}
            {isDirty && saveStatus !== "saving" && (
              <span className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400" title="You have unsaved changes">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                Unsaved
              </span>
            )}

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
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleRender}
                  title="Render again with your latest edits">
                  <Play size={12} /> Render again
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
            ) : loadError ? (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
                <AlertCircle size={20} className="text-amber-400" />
                <p className="text-sm text-white/80 max-w-sm">{loadError}</p>
                <Button size="sm" variant="secondary" onClick={onBack}>Back to videos</Button>
              </div>
            ) : (
              <VideoPlayer
                src={`/api/video${q}`}
                events={events}
                selectedIds={selectedIds}
                onSelect={handleSelect}
                onPreviewEvent={handlePreviewEvent}
                onCommitEdit={commitEdit}
                onTimeUpdate={setCurrentTime}
                onDurationChange={setDuration}
                onVideoReady={handleVideoReady}
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
              selectedIds={selectedIds}
              onSelect={handleSelect}
              onSeek={handleSeek}
              onAddEvent={handleAddEvent}
              onPreviewEvents={handlePreviewEvents}
              onCommitEdit={commitEdit}
            />
          </div>
        </div>

        {/* Right: Sidebar */}
        <div className="shrink-0 border-l overflow-hidden flex flex-col bg-background" style={{ width: "35%" }}>
          {selectedEvent ? (
            <Sidebar
              event={selectedEvent}
              selectionCount={selectedIds.length}
              allEvents={events}
              currentTime={currentTime}
              duration={duration}
              onUpdate={(patch) => selectedId && handleUpdateEvent(selectedId, patch)}
              onDelete={deleteSelected}
              onClose={() => setSelection([])}
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