"use client"

import { useRef, useEffect, useCallback } from "react"

export interface OverlayEvent {
  id: string; blockText: string; translation: string
  bbox: [number, number, number, number]
  bgColor: string; textColor: string; fontSize: number
  startTime: number; endTime: number; frameIndex: number
}

interface Props {
  events: OverlayEvent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdateEvent: (id: string, patch: Partial<OverlayEvent>) => void
  videoRect: { x: number; y: number; w: number; h: number }
  videoSize: { w: number; h: number }
}

type DragMode =
  | "move"
  | "resize-t" | "resize-b" | "resize-l" | "resize-r"
  | "resize-tl" | "resize-tr" | "resize-bl" | "resize-br"
  | null

const HANDLE_SIZE = 9
const EDGE_HIT    = 7

export default function OverlayCanvas({
  events, selectedId, onSelect, onUpdateEvent, videoRect, videoSize,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragState = useRef<{
    id: string; mode: DragMode
    startX: number; startY: number
    origBbox: [number, number, number, number]
  } | null>(null)

  const scale = videoRect.w / (videoSize.w || 1)

  // ── Draw ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !videoRect.w) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const s = scale
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    events.forEach((event) => {
      const [x1, y1, x2, y2] = event.bbox
      const sx = x1 * s, sy = y1 * s
      const sw = (x2 - x1) * s, sh = (y2 - y1) * s
      const isSelected = event.id === selectedId

      ctx.globalAlpha = 0.85
      ctx.fillStyle = event.bgColor || "#000000"
      ctx.fillRect(sx, sy, sw, sh)
      ctx.globalAlpha = 1

      ctx.strokeStyle = isSelected ? "#60a5fa" : "rgba(255,255,255,0.18)"
      ctx.lineWidth = isSelected ? 2 : 1
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1)

      if (event.translation) {
        const fs = Math.max(8, (event.fontSize ?? 20) * s)
        ctx.font = `600 ${fs}px "Inter", system-ui, sans-serif`
        ctx.fillStyle = event.textColor || "#ffffff"
        ctx.textBaseline = "middle"
        ctx.save()
        ctx.beginPath()
        ctx.rect(sx + 4, sy, sw - 8, sh)
        ctx.clip()
        ctx.fillText(event.translation, sx + 6, sy + sh / 2)
        ctx.restore()
      }

      if (isSelected) {
        const corners: [number, number][] = [
          [sx, sy], [sx + sw, sy], [sx, sy + sh], [sx + sw, sy + sh],
        ]
        corners.forEach(([hx, hy]) => {
          ctx.fillStyle = "#60a5fa"; ctx.strokeStyle = "#1e3a5f"; ctx.lineWidth = 1.5
          ctx.fillRect(hx - HANDLE_SIZE/2, hy - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE)
          ctx.strokeRect(hx - HANDLE_SIZE/2, hy - HANDLE_SIZE/2, HANDLE_SIZE, HANDLE_SIZE)
        })
        const mid = HANDLE_SIZE - 2
        const edges: [number, number][] = [
          [sx + sw/2, sy], [sx + sw/2, sy + sh],
          [sx, sy + sh/2], [sx + sw, sy + sh/2],
        ]
        edges.forEach(([hx, hy]) => {
          ctx.fillStyle = "#93c5fd"; ctx.strokeStyle = "#1e3a5f"; ctx.lineWidth = 1
          ctx.fillRect(hx - mid/2, hy - mid/2, mid, mid)
          ctx.strokeRect(hx - mid/2, hy - mid/2, mid, mid)
        })
      }
    })
  }, [events, selectedId, videoRect, scale])

  // ── Canvas mouse → video-pixel coords ─────────────────────────────────────
  // Canvas is positioned at videoRect.x/y, so clientX - canvasBCR.left
  // is already canvas-local. Divide by scale → video pixels.

  const toVideo = useCallback((ev: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return {
      cx: (ev.clientX - r.left)  / scale,
      cy: (ev.clientY - r.top)   / scale,
    }
  }, [scale])

  // ── Hit detection (in video-pixel space) ──────────────────────────────────

  const getHit = useCallback((cx: number, cy: number) => {
    const hp = HANDLE_SIZE / scale
    const ep = EDGE_HIT   / scale

    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      const [x1, y1, x2, y2] = e.bbox

      if (e.id === selectedId) {
        const corners: [DragMode, number, number][] = [
          ["resize-tl", x1, y1], ["resize-tr", x2, y1],
          ["resize-bl", x1, y2], ["resize-br", x2, y2],
        ]
        for (const [mode, hx, hy] of corners)
          if (Math.abs(cx - hx) <= hp && Math.abs(cy - hy) <= hp)
            return { id: e.id, mode }

        const inX = cx >= x1 && cx <= x2
        const inY = cy >= y1 && cy <= y2
        if (inX && Math.abs(cy - y1) <= ep) return { id: e.id, mode: "resize-t" as DragMode }
        if (inX && Math.abs(cy - y2) <= ep) return { id: e.id, mode: "resize-b" as DragMode }
        if (inY && Math.abs(cx - x1) <= ep) return { id: e.id, mode: "resize-l" as DragMode }
        if (inY && Math.abs(cx - x2) <= ep) return { id: e.id, mode: "resize-r" as DragMode }
      }

      if (cx >= x1 && cx <= x2 && cy >= y1 && cy <= y2)
        return { id: e.id, mode: "move" as DragMode }
    }
    return null
  }, [events, selectedId, scale])

  const getCursor = (mode: DragMode | null): string => {
    const cursorMap: Record<string, string> = {
      move: "move", "resize-tl": "nw-resize", "resize-br": "se-resize",
      "resize-tr": "ne-resize", "resize-bl": "sw-resize",
      "resize-t": "n-resize",  "resize-b": "s-resize",
      "resize-l": "w-resize",  "resize-r": "e-resize",
      "": "default",
    }
    return cursorMap[mode ?? ""]
  }

  // ── Mouse handlers ────────────────────────────────────────────────────────

  const onMouseDown = useCallback((ev: React.MouseEvent) => {
    const { cx, cy } = toVideo(ev)
    const hit = getHit(cx, cy)
    if (!hit) { onSelect(null); return }
    ev.preventDefault()
    const event = events.find((e) => e.id === hit.id)
    if (!event) return
    onSelect(hit.id)
    dragState.current = {
      id: hit.id, mode: hit.mode,
      startX: cx, startY: cy,
      origBbox: [...event.bbox] as [number, number, number, number],
    }
  }, [toVideo, getHit, events, onSelect])

  const onMouseMove = useCallback((ev: React.MouseEvent) => {
    const canvas = canvasRef.current; if (!canvas) return
    const { cx, cy } = toVideo(ev)
    canvas.style.cursor = getCursor(dragState.current?.mode ?? getHit(cx, cy)?.mode ?? null)
    if (!dragState.current) return
    ev.preventDefault()
    const ds = dragState.current
    const dx = cx - ds.startX, dy = cy - ds.startY
    const [ox1, oy1, ox2, oy2] = ds.origBbox
    let bbox: [number, number, number, number] = [ox1, oy1, ox2, oy2]
    switch (ds.mode) {
      case "move":      bbox = [ox1+dx, oy1+dy, ox2+dx, oy2+dy]; break
      case "resize-tl": bbox = [ox1+dx, oy1+dy, ox2,    oy2   ]; break
      case "resize-tr": bbox = [ox1,    oy1+dy, ox2+dx, oy2   ]; break
      case "resize-bl": bbox = [ox1+dx, oy1,    ox2,    oy2+dy]; break
      case "resize-br": bbox = [ox1,    oy1,    ox2+dx, oy2+dy]; break
      case "resize-t":  bbox = [ox1,    oy1+dy, ox2,    oy2   ]; break
      case "resize-b":  bbox = [ox1,    oy1,    ox2,    oy2+dy]; break
      case "resize-l":  bbox = [ox1+dx, oy1,    ox2,    oy2   ]; break
      case "resize-r":  bbox = [ox1,    oy1,    ox2+dx, oy2   ]; break
    }
    onUpdateEvent(ds.id, { bbox })
  }, [toVideo, getHit, onUpdateEvent])

  const onMouseUp = useCallback(() => { dragState.current = null }, [])

  // ── Render ────────────────────────────────────────────────────────────────
  // Canvas sits exactly over the video content area (no letterbox offset needed
  // because videoRect.x/y positions it correctly via absolute left/top).

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(videoRect.w)}
      height={Math.round(videoRect.h)}
      style={{
        position: "absolute",
        left: videoRect.x,
        top:  videoRect.y,
        width:  videoRect.w,
        height: videoRect.h,
        pointerEvents: "auto",   // always on — hit detection is cheap
        cursor: "default",
      }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    />
  )
}