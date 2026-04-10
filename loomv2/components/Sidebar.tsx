// Sidebar.tsx
"use client"

import { X, Trash2, Clock, Hash, Type, Minus, Plus, ChevronRight, PlusCircle, AlignLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { OverlayEvent } from "./VideoPlayer"

interface SidebarProps {
  event: OverlayEvent | null
  allEvents: OverlayEvent[]
  currentTime: number
  duration: number
  onUpdate: (patch: Partial<OverlayEvent>) => void
  onDelete: () => void
  onClose: () => void
  onSelectEvent: (id: string, seekTo: number) => void
  onAddEvent: (event: OverlayEvent) => void
}

function fmt(t: number) {
  const m = Math.floor(t / 60)
  const s = (t % 60).toFixed(1).padStart(4, "0")
  return `${m}:${s}`
}

function uid() { return Math.random().toString(36).slice(2) }

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2 items-center">
        <label className="relative shrink-0 cursor-pointer">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
          <div
            className="w-8 h-8 rounded-md border shadow-sm"
            style={{ background: value }}
          />
        </label>
        <Input
          value={value}
          maxLength={7}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono uppercase text-xs h-8"
        />
      </div>
    </div>
  )
}

function EventList({ events, currentTime, duration, onSelect, onAdd }: {
  events: OverlayEvent[]
  currentTime: number
  duration: number
  onSelect: (id: string, seekTo: number) => void
  onAdd: (event: OverlayEvent) => void
}) {
  function handleAdd() {
    const newEvent: OverlayEvent = {
      id: uid(), blockText: "New Box", translation: "",
      bbox: [100, 100, 400, 160], bgColor: "#000000", textColor: "#ffffff",
      fontSize: 20, startTime: Math.max(0, currentTime),
      endTime: Math.min(duration, currentTime + 3), frameIndex: 0,
    }
    onAdd(newEvent)
    onSelect(newEvent.id, newEvent.startTime)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b shrink-0">
        <AlignLeft size={13} className="text-primary" />
        <span className="text-xs font-semibold text-primary">All Boxes</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">{events.length}</Badge>
      </div>

      {/* Add button */}
      <div className="px-3 py-2.5 border-b shrink-0">
        <Button variant="outline" size="sm" onClick={handleAdd} className="w-full gap-1.5 border-dashed">
          <PlusCircle size={13} /> Add box at current time
        </Button>
      </div>

      {/* List */}
      {events.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted-foreground">No boxes yet</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y">
          {events.map((ev) => {
            const isActive = currentTime >= ev.startTime && currentTime < ev.endTime
            return (
              <button
                key={ev.id}
                onClick={() => onSelect(ev.id, ev.startTime)}
                className={`w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50 group
                  ${isActive ? "bg-primary/5" : ""}`}
              >
                <div
                  className="w-2.5 h-5 rounded-sm shrink-0 border"
                  style={{ background: ev.bgColor }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate text-muted-foreground">{ev.blockText}</div>
                  <div className={`text-[11px] truncate mt-0.5 ${ev.translation ? "text-primary" : "text-muted-foreground/50"}`}>
                    {ev.translation || "No translation"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-[10px] font-mono text-muted-foreground">{fmt(ev.startTime)}</span>
                  {isActive && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                </div>
                <ChevronRight size={12} className="text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EventEditor({ event, onUpdate, onDelete, onClose }: {
  event: OverlayEvent
  onUpdate: (patch: Partial<OverlayEvent>) => void
  onDelete: () => void
  onClose: () => void
}) {
  const updateBbox = (i: number, val: string) => {
    const bbox = [...event.bbox] as [number, number, number, number]
    bbox[i] = parseFloat(val) || 0
    onUpdate({ bbox })
  }

  const fontSize = event.fontSize ?? 20

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <span className="text-xs font-semibold text-primary">Edit Box</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={13} />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Source text */}
        <div className="space-y-1.5">
          <Label className="text-xs">Source text</Label>
          <div className="w-full px-3 py-2 text-xs rounded-md bg-muted/50 border text-muted-foreground font-mono leading-relaxed">
            {event.blockText}
          </div>
        </div>

        {/* Translation */}
        <div className="space-y-1.5">
          <Label className="text-xs">Translation</Label>
          <Textarea
            rows={3}
            value={event.translation}
            placeholder="Enter translation…"
            onChange={(e) => onUpdate({ translation: e.target.value })}
            className="text-xs font-mono resize-none"
          />
        </div>

        <Separator />

        {/* Colors */}
        <ColorRow label="Background color" value={event.bgColor || "#000000"} onChange={(v) => onUpdate({ bgColor: v })} />
        <ColorRow label="Text color" value={event.textColor || "#ffffff"} onChange={(v) => onUpdate({ textColor: v })} />

        {/* Preview */}
        <div
          className="px-3 py-2 rounded-md text-center truncate font-semibold text-sm border"
          style={{ background: event.bgColor || "#000000", color: event.textColor || "#ffffff" }}
        >
          {event.translation || event.blockText || "Preview"}
        </div>

        <Separator />

        {/* Font size */}
        <div className="space-y-2">
          <Label className="text-xs">Font size</Label>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0"
              onClick={() => onUpdate({ fontSize: Math.max(0, fontSize - 1) })}>
              <Minus size={12} />
            </Button>
            <Input
              type="number" min={0} max={400} value={fontSize}
              onChange={(e) => onUpdate({ fontSize: Math.max(0, Math.min(400, parseInt(e.target.value) || 0)) })}
              className="text-center text-xs h-8 font-mono"
            />
            <Button variant="outline" size="icon" className="h-8 w-8 shrink-0"
              onClick={() => onUpdate({ fontSize: Math.min(400, fontSize + 1) })}>
              <Plus size={12} />
            </Button>
            <span className="text-xs text-muted-foreground">px</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {[12, 16, 20, 24, 32, 48].map((s) => (
              <Button
                key={s} size="sm" variant={fontSize === s ? "default" : "outline"}
                className="h-6 px-2 text-[11px]"
                onClick={() => onUpdate({ fontSize: s })}
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Timing */}
        <div className="space-y-2">
          <Label className="text-xs">Timing (seconds)</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["startTime", "endTime"] as const).map((key) => (
              <div key={key} className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">{key === "startTime" ? "In" : "Out"}</Label>
                <Input
                  type="number" step="0.1" min={0}
                  value={Number(event[key]).toFixed(2)}
                  onChange={(e) => onUpdate({ [key]: parseFloat(e.target.value) })}
                  className="text-xs h-8 font-mono"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Clock size={10} />
            <span>Duration: {(event.endTime - event.startTime).toFixed(2)}s</span>
          </div>
        </div>

        {/* BBox */}
        <div className="space-y-2">
          <Label className="text-xs">Bounding box (px)</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["X1", "Y1", "X2", "Y2"] as const).map((label, i) => (
              <div key={label} className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">{label}</Label>
                <Input
                  type="number" value={Math.round(event.bbox[i])}
                  onChange={(e) => updateBbox(i, e.target.value)}
                  className="text-xs h-8 font-mono"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Hash size={10} />
            <span>{Math.round(event.bbox[2] - event.bbox[0])} × {Math.round(event.bbox[3] - event.bbox[1])} px</span>
          </div>
        </div>

        {/* Frame */}
        <div className="space-y-1.5">
          <Label className="text-xs">Frame</Label>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border text-xs text-muted-foreground font-mono">
            <Type size={10} className="shrink-0" />
            <span>#{event.frameIndex}</span>
          </div>
        </div>

        {/* Delete */}
        <Button variant="destructive" size="sm" onClick={onDelete} className="w-full gap-1.5">
          <Trash2 size={13} /> Delete box
        </Button>

      </div>
    </div>
  )
}

export default function Sidebar({
  event, allEvents, currentTime, duration,
  onUpdate, onDelete, onClose, onSelectEvent, onAddEvent,
}: SidebarProps) {
  return (
    <aside className="w-full flex flex-col overflow-hidden h-full bg-background">
      {event ? (
        <EventEditor event={event} onUpdate={onUpdate} onDelete={onDelete} onClose={onClose} />
      ) : (
        <EventList
          events={allEvents} currentTime={currentTime} duration={duration}
          onSelect={onSelectEvent} onAdd={onAddEvent}
        />
      )}
    </aside>
  )
}