"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import { Play, Pause, Volume2, VolumeX } from "lucide-react"
import OverlayCanvas from "./OverlayCanvas"

export interface VideoMeta {
  containerW: number; containerH: number
  videoW: number; videoH: number
  letterboxX: number; letterboxY: number; scale: number
}

export interface OverlayEvent {
  id: string; blockText: string; translation: string
  bbox: [number, number, number, number]
  bgColor: string; textColor: string; fontSize: number
  startTime: number; endTime: number; frameIndex: number
  videoMeta?: VideoMeta
}

interface VideoPlayerProps {
  src: string
  events: OverlayEvent[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  onUpdateEvent: (id: string, patch: Partial<OverlayEvent>) => void
  onTimeUpdate?: (time: number) => void
  onDurationChange?: (duration: number) => void
  onVideoReady?: (el: HTMLVideoElement) => void
}

const CONTROLS_H = 36 // height reserved for custom controls bar

export default function VideoPlayer({
  src, events, selectedId, onSelect, onUpdateEvent,
  onTimeUpdate, onDurationChange, onVideoReady,
}: VideoPlayerProps) {
  const videoRef     = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration]       = useState(0)
  const [playing, setPlaying]         = useState(false)
  const [muted, setMuted]             = useState(false)
  const [videoSize, setVideoSize]     = useState({ w: 0, h: 0 })
  const [videoRect, setVideoRect]     = useState({ x: 0, y: 0, w: 0, h: 0 })

  const isReady = videoSize.w > 0 && videoSize.h > 0 && videoRect.w > 0

  // ── Compute letterboxed video rect ───────────────────────────────────────
  // We use only the portion of the container ABOVE the custom controls bar.
  // This must match what the browser renders for objectFit:contain.

  // In VideoPlayer
const videoAreaRef = useRef<HTMLDivElement>(null)

const computeVideoRect = useCallback(() => {
  requestAnimationFrame(() => {
    const video = videoRef.current
    const area  = videoAreaRef.current
    if (!video || !area || videoSize.w === 0 || videoSize.h === 0) return

    const areaBCR  = area.getBoundingClientRect()
    const videoBCR = video.getBoundingClientRect()

    // True rendered content size via objectFit:contain math
    const s  = Math.min(videoBCR.width / videoSize.w, videoBCR.height / videoSize.h)
    const rw = videoSize.w * s
    const rh = videoSize.h * s

    // Offset of video content within the area div
    // (video element origin relative to area, plus internal letterbox)
    const rx = (videoBCR.left - areaBCR.left) + (videoBCR.width  - rw) / 2
    const ry = (videoBCR.top  - areaBCR.top)  + (videoBCR.height - rh) / 2

    setVideoRect({ x: rx, y: ry, w: rw, h: rh })
  })
}, [videoSize])

// Observe the video area, not the outer container
useEffect(() => {
  const obs = new ResizeObserver(computeVideoRect)
  if (videoAreaRef.current) obs.observe(videoAreaRef.current)
  return () => obs.disconnect()
}, [computeVideoRect])

  // ── Video metadata ────────────────────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onLoaded = () => {
      setVideoSize({ w: video.videoWidth, h: video.videoHeight })
      setDuration(video.duration)
      onDurationChange?.(video.duration)
      onVideoReady?.(video)
    }
    const onTime = () => {
      setCurrentTime(video.currentTime)
      onTimeUpdate?.(video.currentTime)
    }
    const onPlay  = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    video.addEventListener("loadedmetadata", onLoaded)
    video.addEventListener("timeupdate", onTime)
    video.addEventListener("play", onPlay)
    video.addEventListener("pause", onPause)
    if (video.readyState >= 1) onLoaded()

    return () => {
      video.removeEventListener("loadedmetadata", onLoaded)
      video.removeEventListener("timeupdate", onTime)
      video.removeEventListener("play", onPlay)
      video.removeEventListener("pause", onPause)
    }
  }, [onDurationChange, onTimeUpdate, onVideoReady])

  useEffect(() => { computeVideoRect() }, [computeVideoRect])

  useEffect(() => {
    const obs = new ResizeObserver(computeVideoRect)
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [computeVideoRect])

  // ── Active events ─────────────────────────────────────────────────────────

  const activeEvents = events.filter(
    (e) => currentTime >= e.startTime && currentTime < e.endTime
  )

  // ── Controls ──────────────────────────────────────────────────────────────

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return
    playing ? v.pause() : v.play()
  }
  const toggleMute = () => {
    const v = videoRef.current; if (!v) return
    v.muted = !v.muted; setMuted(!muted)
  }
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = videoRef.current; if (!v) return
    v.currentTime = Number(e.target.value)
  }

  const fmt = (t: number) => {
    const m = Math.floor(t / 60)
    const s = Math.floor(t % 60).toString().padStart(2, "0")
    return `${m}:${s}`
  }

  // ── Render ────────────────────────────────────────────────────────────────

//   
return (
  <div
    className="video-area relative w-full h-full flex flex-col"
    style={{ background: "#000" }}
  >
    {/* Video content area */}
    <div
      ref={videoAreaRef}   
      className="relative flex-1 overflow-hidden video-area"
      style={{ minHeight: 0 }}
    >
      <video
        ref={videoRef}
        src={src}
        className="w-full h-full"
        style={{ display: "block", objectFit: "contain" }}
      />
      {isReady && (
        <OverlayCanvas
          events={activeEvents}
          selectedId={selectedId}
          onSelect={onSelect}
          onUpdateEvent={onUpdateEvent}
          videoRect={videoRect}        // ← add this
          videoSize={videoSize}        // ← add this
        />
      )}
    </div>

    {/* Controls */}
    <div
  className="shrink-0 flex items-center gap-2 px-3 border-t bg-background"
  style={{ height: CONTROLS_H }}
>
  <button onClick={togglePlay} className="text-foreground hover:text-primary transition-colors p-1">
    {playing ? <Pause size={14} /> : <Play size={14} />}
  </button>
  <button onClick={toggleMute} className="text-foreground hover:text-primary transition-colors p-1">
    {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
  </button>
  <input
    type="range" min={0} max={duration || 1} step={0.05}
    value={currentTime} onChange={handleScrub}
    style={{ flex: 1, height: 3, cursor: "pointer" }}
    className="accent-primary"
  />
  <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
    {fmt(currentTime)} / {fmt(duration)}
  </span>
</div>
  </div>
)
}