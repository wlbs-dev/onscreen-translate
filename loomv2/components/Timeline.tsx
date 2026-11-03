// Timeline.tsx
"use client"

import { useRef, useCallback, useEffect, useState, useMemo } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OverlayEvent } from "./VideoPlayer"
import type { EventPatches } from "@/lib/editor/types"
import { findSnap, SNAP_PX } from "@/lib/editor/snap"

export type SelectMode = "replace" | "toggle"

interface TimelineProps {
  events: OverlayEvent[]
  currentTime: number
  duration: number
  selectedIds: string[]
  onSelect: (id: string | null, mode?: SelectMode) => void
  onSeek: (t: number) => void
  onAddEvent: (event: OverlayEvent) => void
  /** Transient update while dragging clips (not recorded in history) */
  onPreviewEvents: (patches: EventPatches) => void
  /** Drag finished — record it as one history entry */
  onCommitEdit: () => void
}

interface DragState {
  edge: "start" | "end" | "move"
  /** Original timing of every clip being dragged */
  orig: Record<string, { start: number; end: number }>
  startX: number
  pps: number
  /** Snap targets in seconds: playhead + edges of clips not being dragged */
  targets: number[]
  moved: boolean
  /** Plain click on a clip of a multi-selection selects just that clip on release */
  collapseTo: string | null
  /** Plain click (no drag) seeks to the clip start, as before */
  seekTo: number | null
}

const DRAG_THRESHOLD_PX = 3
const MIN_CLIP_S = 0.1

const PALETTE = [
  "#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#14b8a6",
]
function colorFor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function uid() { return Math.random().toString(36).slice(2) }

const TRACK_H  = 28
const MIN_VIS_PX = 4
const RULER_H  = 22
const LANE_GAP = 2   // seconds — events within this gap are considered "same lane eligible"

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

/**
 * Assign each event to the lowest lane index where it doesn't overlap
 * with any already-placed event (with a LANE_GAP buffer).
 */
function assignLanes(events: OverlayEvent[]): { event: OverlayEvent; lane: number }[] {
  const sorted = [...events].sort((a, b) => a.startTime - b.startTime)
  // laneEnds[i] = the endTime of the last event placed on lane i
  const laneEnds: number[] = []

  return sorted.map((ev) => {
    let lane = laneEnds.findIndex((end) => ev.startTime >= end + LANE_GAP)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(ev.endTime)
    } else {
      laneEnds[lane] = ev.endTime
    }
    return { event: ev, lane }
  })
}

export default function Timeline({
  events, currentTime, duration, selectedIds,
  onSelect, onSeek, onAddEvent, onPreviewEvents, onCommitEdit,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [viewW, setViewW] = useState(0)
  const [snapGuide, setSnapGuide] = useState<number | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const detachRef = useRef<(() => void) | null>(null)

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Track the visible width in state so px/sec can be computed during render
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const obs = new ResizeObserver(() => setViewW(el.clientWidth))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Drop window listeners if we unmount mid-drag
  useEffect(() => () => detachRef.current?.(), [])

  const assigned = useMemo(() => assignLanes(events), [events])
  const laneCount = useMemo(
    () => assigned.reduce((max, { lane }) => Math.max(max, lane + 1), 1),
    [assigned]
  )

  const pps    = viewW > 0 && duration > 0 ? (viewW / duration) * zoom : 1
  const toPx   = useCallback((t: number) => t * pps, [pps])
  const toTime = useCallback((px: number) => px / pps, [pps])

  // Auto-scroll playhead into view
  useEffect(() => {
    const el = scrollRef.current
    if (!el || duration === 0) return
    const px = toPx(currentTime)
    const { scrollLeft, clientWidth } = el
    if (px < scrollLeft + 30 || px > scrollLeft + clientWidth - 30)
      el.scrollLeft = Math.max(0, px - clientWidth / 2)
  }, [currentTime, toPx, duration])

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      setZoom((z) => Math.min(20, Math.max(0.3, z * (e.deltaY < 0 ? 1.15 : 0.87))))
    }
  }, [])

  function rulerTicks() {
    if (duration === 0) return []
    const candidates = [0.5, 1, 2, 5, 10, 30, 60, 120, 300]
    const interval = candidates.find((c) => c * pps >= 80) ?? 300
    const ticks: number[] = []
    for (let t = 0; t <= duration; t += interval) ticks.push(t)
    return ticks.map((t) => ({ t, px: toPx(t), label: fmtTime(t) }))
  }

  const totalW = Math.max(duration * pps + 80, 400)
  const totalH = RULER_H + laneCount * TRACK_H + 8

  // ── Clip dragging ───────────────────────────────────────────────────────
  // Listeners go on window so a drag keeps working outside the timeline.

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current
    if (!d) return
    const dxPx = e.clientX - d.startX
    if (!d.moved && Math.abs(dxPx) < DRAG_THRESHOLD_PX) return
    d.moved = true

    const snap      = !e.altKey
    const threshold = SNAP_PX / d.pps
    let dt          = dxPx / d.pps
    let guide: number | null = null
    const patches: EventPatches = {}
    const ids = Object.keys(d.orig)

    if (d.edge === "move") {
      const minStart = Math.min(...ids.map((id) => d.orig[id].start))
      const maxEnd   = Math.max(...ids.map((id) => d.orig[id].end))
      const clampDt  = (v: number) => Math.max(-minStart, Math.min(duration - maxEnd, v))
      dt = clampDt(dt)
      if (snap) {
        const edges = ids.flatMap((id) => [d.orig[id].start + dt, d.orig[id].end + dt])
        const hit   = findSnap(edges, d.targets, threshold)
        if (hit && clampDt(dt + hit.delta) === dt + hit.delta) { dt += hit.delta; guide = hit.target }
      }
      for (const id of ids)
        patches[id] = { startTime: d.orig[id].start + dt, endTime: d.orig[id].end + dt }
    } else {
      const id = ids[0], o = d.orig[id]
      let t = (d.edge === "start" ? o.start : o.end) + dt
      if (snap) {
        const hit = findSnap([t], d.targets, threshold)
        if (hit) { t = hit.target; guide = hit.target }
      }
      if (d.edge === "start") {
        const c = Math.max(0, Math.min(o.end - MIN_CLIP_S, t))
        if (c !== t) guide = null
        patches[id] = { startTime: c }
      } else {
        const c = Math.min(duration, Math.max(o.start + MIN_CLIP_S, t))
        if (c !== t) guide = null
        patches[id] = { endTime: c }
      }
    }
    setSnapGuide(guide)
    onPreviewEvents(patches)
  }, [duration, onPreviewEvents])

  const onDragEnd = useCallback(() => {
    const d = dragRef.current
    detachRef.current?.()
    dragRef.current = null
    setSnapGuide(null)
    if (!d) return
    if (d.moved) { onCommitEdit(); return }
    if (d.collapseTo) onSelect(d.collapseTo)
    if (d.seekTo !== null) onSeek(d.seekTo)
  }, [onCommitEdit, onSelect, onSeek])

  const onClipMouseDown = useCallback((
    e: React.MouseEvent,
    ev: OverlayEvent,
    edge: "start" | "end" | "move"
  ) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()

    const toggle = e.shiftKey || e.ctrlKey || e.metaKey
    const wasSel = selectedSet.has(ev.id)
    let group: string[]
    if (toggle) {
      onSelect(ev.id, "toggle")
      if (wasSel) return                     // just removed it — nothing to drag
      group = [...selectedIds, ev.id]
    } else if (wasSel) {
      group = selectedIds                    // keep the group so it can be dragged together
    } else {
      onSelect(ev.id)
      group = [ev.id]
    }

    // Resizing only ever affects the clip under the cursor
    const ids = edge === "move" ? group : [ev.id]
    const byId = new Map(events.map((x) => [x.id, x]))
    const orig: DragState["orig"] = {}
    for (const id of ids) {
      const x = byId.get(id)
      if (x) orig[id] = { start: x.startTime, end: x.endTime }
    }
    const targets = [currentTime]
    for (const x of events) if (!orig[x.id]) targets.push(x.startTime, x.endTime)

    dragRef.current = {
      edge, orig, startX: e.clientX, pps, targets, moved: false,
      collapseTo: !toggle && wasSel && selectedIds.length > 1 ? ev.id : null,
      seekTo: toggle ? null : ev.startTime,
    }
    detachRef.current?.()
    window.addEventListener("mousemove", onDragMove)
    window.addEventListener("mouseup", onDragEnd)
    detachRef.current = () => {
      window.removeEventListener("mousemove", onDragMove)
      window.removeEventListener("mouseup", onDragEnd)
      detachRef.current = null
    }
  }, [events, selectedIds, selectedSet, currentTime, pps, onSelect, onDragMove, onDragEnd])

  const onRulerClick = useCallback((e: React.MouseEvent<SVGElement>) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
    const px = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    onSeek(Math.max(0, Math.min(duration, toTime(px))))
  }, [toTime, duration, onSeek])

  const handleAddAtTime = useCallback(() => {
    const newEvent: OverlayEvent = {
      id: uid(), blockText: "New Box", translation: "",
      bbox: [100, 100, 400, 160], bgColor: "#000000", textColor: "#ffffff",
      startTime: Math.max(0, currentTime),
      endTime: Math.min(duration, currentTime + 3), frameIndex: 0,
    }
    onAddEvent(newEvent)
    onSelect(newEvent.id)
  }, [currentTime, duration, onAddEvent, onSelect])

  const ticks      = rulerTicks()
  const playheadPx = toPx(currentTime)

  return (
    <div className="flex flex-col w-full h-full overflow-hidden select-none bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 shrink-0 h-9 border-b bg-muted/30">
        <span className="text-xs font-semibold text-primary">Timeline</span>
        <span className="text-xs text-muted-foreground">
          {laneCount} lane{laneCount !== 1 ? "s" : ""} · {events.length} tracks
          {selectedIds.length > 1 && <> · <span className="text-primary">{selectedIds.length} selected</span></>}
        </span>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground">Zoom</span>
        <input
          type="range" min={0.3} max={20} step={0.1} value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="w-20 h-1 cursor-pointer accent-primary"
        />
        <span className="text-xs font-mono text-primary w-8">{zoom.toFixed(1)}x</span>
        <Button size="sm" variant="outline" onClick={handleAddAtTime} className="gap-1.5 h-7 text-xs border-dashed">
          <Plus size={11} /> Add box
        </Button>
      </div>

      {/* Track area */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-x-auto overflow-y-auto"
        style={{ minHeight: 0 }}
        onWheel={handleWheel}
      >
        <div style={{ width: totalW, minHeight: totalH, position: "relative" }}>

          {/* Ruler */}
          <svg
            width={totalW} height={RULER_H}
            style={{ display: "block", position: "sticky", top: 0, zIndex: 10, cursor: "pointer" }}
            className="bg-muted/50 border-b"
            onClick={onRulerClick}
          >
            {ticks.map(({ t, px, label }) => (
              <g key={t}>
                <line x1={px} y1={RULER_H - 7} x2={px} y2={RULER_H} style={{ stroke: "var(--border)" }} strokeWidth={1} />
                <text x={px + 3} y={RULER_H - 9} style={{ fill: "var(--muted-foreground)" }} fontSize={9} fontFamily="monospace">{label}</text>
              </g>
            ))}
            <line x1={playheadPx} y1={0} x2={playheadPx} y2={RULER_H} style={{ stroke: "var(--primary)" }} strokeWidth={1.5} />
            <polygon points={`${playheadPx - 5},0 ${playheadPx + 5},0 ${playheadPx},8`} style={{ fill: "var(--primary)" }} />
          </svg>

          {/* Snap guide */}
          {snapGuide !== null && (
            <div style={{
              position: "absolute", top: 0, bottom: 0,
              left: toPx(snapGuide), width: 1,
              background: "#f59e0b", pointerEvents: "none", zIndex: 20,
            }} />
          )}

          {/* Lane rows + clips — mousedown on empty space clears the selection */}
          <div style={{ position: "relative" }} onMouseDown={(e) => { if (e.button === 0) onSelect(null) }}>

            {/* Playhead line */}
            <div style={{
              position: "absolute", top: 0, bottom: 0,
              left: playheadPx, width: 1.5,
              background: "var(--primary)", opacity: 0.4,
              pointerEvents: "none", zIndex: 10,
            }} />

            {/* Lane background stripes */}
            {Array.from({ length: laneCount }).map((_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  top: i * TRACK_H,
                  left: 0,
                  right: 0,
                  height: TRACK_H,
                  background: i % 2 === 0
                    ? "color-mix(in oklch, var(--muted) 60%, transparent)"
                    : "var(--background)",
                  borderBottom: "1px solid color-mix(in oklch, var(--border) 60%, transparent)",
                }}
              />
            ))}

            {/* Empty state */}
            {events.length === 0 && (
              <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
                No text boxes — click &quot;Add box&quot; to create one
              </div>
            )}

            {/* Clips */}
            {assigned.map(({ event: ev, lane }) => {
              const color      = colorFor(ev.id)
              const clipLeft   = toPx(ev.startTime)
              const clipW      = Math.max(MIN_VIS_PX, toPx(ev.endTime) - clipLeft)
              const isSelected = selectedSet.has(ev.id)
              const EDGE_W     = Math.min(8, clipW / 4)
              const top        = lane * TRACK_H

              return (
                <div
                  key={ev.id}
                  style={{
                    position: "absolute",
                    left: clipLeft,
                    top: top + 3,
                    width: clipW,
                    height: TRACK_H - 6,
                    borderRadius: 4,
                    background: isSelected ? color : color + "66",
                    border: `${isSelected ? 2 : 1}px solid ${color}`,
                    cursor: "grab",
                    overflow: "hidden",
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.1s",
                    zIndex: isSelected ? 5 : 2,
                  }}
                  onMouseDown={(e) => onClipMouseDown(e, ev, "move")}
                >
                  {/* Left resize handle */}
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: EDGE_W, cursor: "w-resize", zIndex: 2,
                    background: isSelected ? "rgba(0,0,0,0.15)" : "transparent",
                  }} onMouseDown={(e) => onClipMouseDown(e, ev, "start")} />

                  {/* Right resize handle */}
                  <div style={{
                    position: "absolute", right: 0, top: 0, bottom: 0,
                    width: EDGE_W, cursor: "e-resize", zIndex: 2,
                    background: isSelected ? "rgba(0,0,0,0.15)" : "transparent",
                  }} onMouseDown={(e) => onClipMouseDown(e, ev, "end")} />

                  {clipW > 40 && (
                    <span style={{
                      paddingLeft: EDGE_W + 4, paddingRight: EDGE_W + 4,
                      fontSize: 10, fontWeight: 600,
                      color: isSelected ? "#fff" : "#000",
                      whiteSpace: "nowrap", overflow: "hidden",
                      textOverflow: "ellipsis", pointerEvents: "none", userSelect: "none",
                    }}>
                      {ev.translation || ev.blockText}
                    </span>
                  )}
                </div>
              )
            })}

            {/* Spacer to ensure scroll height */}
            <div style={{ height: laneCount * TRACK_H }} />
          </div>
        </div>
      </div>
    </div>
  )
}