// Timeline.tsx
"use client"

import { useRef, useCallback, useEffect, useState, useMemo } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { OverlayEvent } from "./VideoPlayer"

interface TimelineProps {
  events: OverlayEvent[]
  currentTime: number
  duration: number
  selectedId: string | null
  onSelectEvent: (id: string, seekTo: number) => void
  onSeek: (t: number) => void
  onAddEvent: (event: OverlayEvent) => void
  onUpdateEvent: (id: string, patch: Partial<OverlayEvent>) => void
}

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
  events, currentTime, duration, selectedId,
  onSelectEvent, onSeek, onAddEvent, onUpdateEvent,
}: TimelineProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState<{
    id: string; edge: "start" | "end" | "move"
    origStart: number; origEnd: number; startPx: number
  } | null>(null)

  const assigned = useMemo(() => assignLanes(events), [events])
  const laneCount = useMemo(
    () => assigned.reduce((max, { lane }) => Math.max(max, lane + 1), 1),
    [assigned]
  )

  const pxPerSec = useCallback(() => {
    if (!scrollRef.current || duration === 0) return 1
    return (scrollRef.current.clientWidth / duration) * zoom
  }, [zoom, duration])

  const toPx   = useCallback((t: number) => t * pxPerSec(), [pxPerSec])
  const toTime = useCallback((px: number) => px / pxPerSec(), [pxPerSec])

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
    const pps = pxPerSec()
    const candidates = [0.5, 1, 2, 5, 10, 30, 60, 120, 300]
    const interval = candidates.find((c) => c * pps >= 80) ?? 300
    const ticks: number[] = []
    for (let t = 0; t <= duration; t += interval) ticks.push(t)
    return ticks.map((t) => ({ t, px: toPx(t), label: fmtTime(t) }))
  }

  const totalW = Math.max(duration * pxPerSec() + 80, 400)
  const totalH = RULER_H + laneCount * TRACK_H + 8

  const onClipMouseDown = useCallback((
    e: React.MouseEvent,
    ev: OverlayEvent,
    edge: "start" | "end" | "move"
  ) => {
    e.stopPropagation()
    onSelectEvent(ev.id, ev.startTime)
    setDragging({
      id: ev.id, edge,
      origStart: ev.startTime, origEnd: ev.endTime,
      startPx: e.clientX,
    })
  }, [onSelectEvent])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    const dt = (e.clientX - dragging.startPx) / pxPerSec()
    if (dragging.edge === "move") {
      const len = dragging.origEnd - dragging.origStart
      const newStart = Math.max(0, Math.min(duration - len, dragging.origStart + dt))
      onUpdateEvent(dragging.id, { startTime: newStart, endTime: newStart + len })
    } else if (dragging.edge === "start") {
      onUpdateEvent(dragging.id, {
        startTime: Math.max(0, Math.min(dragging.origEnd - 0.1, dragging.origStart + dt)),
      })
    } else {
      onUpdateEvent(dragging.id, {
        endTime: Math.min(duration, Math.max(dragging.origStart + 0.1, dragging.origEnd + dt)),
      })
    }
  }, [dragging, pxPerSec, duration, onUpdateEvent])

  const onMouseUp = useCallback(() => setDragging(null), [])

  const onRulerClick = useCallback((e: React.MouseEvent<SVGElement>) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect()
    const px = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)
    onSeek(Math.max(0, Math.min(duration, toTime(px))))
  }, [toTime, duration, onSeek])

  const handleAddAtTime = useCallback(() => {
    const newEvent: OverlayEvent = {
      id: uid(), blockText: "New Box", translation: "",
      bbox: [100, 100, 400, 160], bgColor: "#000000", textColor: "#ffffff",
      fontSize: 20, startTime: Math.max(0, currentTime),
      endTime: Math.min(duration, currentTime + 3), frameIndex: 0,
    }
    onAddEvent(newEvent)
    onSelectEvent(newEvent.id, newEvent.startTime)
  }, [currentTime, duration, onAddEvent, onSelectEvent])

  const ticks      = rulerTicks()
  const playheadPx = toPx(currentTime)

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden select-none bg-background"
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 shrink-0 h-9 border-b bg-muted/30">
        <span className="text-xs font-semibold text-primary">Timeline</span>
        <span className="text-xs text-muted-foreground">
          {laneCount} lane{laneCount !== 1 ? "s" : ""} · {events.length} tracks
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
                <line x1={px} y1={RULER_H - 7} x2={px} y2={RULER_H} stroke="hsl(var(--border))" strokeWidth={1} />
                <text x={px + 3} y={RULER_H - 9} fill="hsl(var(--muted-foreground))" fontSize={9} fontFamily="monospace">{label}</text>
              </g>
            ))}
            <line x1={playheadPx} y1={0} x2={playheadPx} y2={RULER_H} stroke="hsl(var(--primary))" strokeWidth={1.5} />
            <polygon points={`${playheadPx - 5},0 ${playheadPx + 5},0 ${playheadPx},8`} fill="hsl(var(--primary))" />
          </svg>

          {/* Lane rows + clips */}
          <div style={{ position: "relative" }}>

            {/* Playhead line */}
            <div style={{
              position: "absolute", top: 0, bottom: 0,
              left: playheadPx, width: 1.5,
              background: "hsl(var(--primary))", opacity: 0.4,
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
                    ? "hsl(var(--muted) / 0.15)"
                    : "hsl(var(--background))",
                  borderBottom: "1px solid hsl(var(--border) / 0.4)",
                }}
              />
            ))}

            {/* Empty state */}
            {events.length === 0 && (
              <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
                No text boxes — click "Add box" to create one
              </div>
            )}

            {/* Clips */}
            {assigned.map(({ event: ev, lane }) => {
              const color      = colorFor(ev.id)
              const clipLeft   = toPx(ev.startTime)
              const clipW      = Math.max(MIN_VIS_PX, toPx(ev.endTime) - clipLeft)
              const isSelected = ev.id === selectedId
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