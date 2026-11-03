"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

// A mock explainer-video frame whose burned-in text switches language.
const FRAMES = [
  { code: "en", label: "Original", title: "How compound interest works", principal: "Principal", interest: "Interest", role: "Financial educator", year: "Year" },
  { code: "hi", label: "हिन्दी", title: "चक्रवृद्धि ब्याज कैसे काम करता है", principal: "मूलधन", interest: "ब्याज", role: "वित्तीय शिक्षिका", year: "वर्ष" },
  { code: "mr", label: "मराठी", title: "चक्रवाढ व्याज कसे काम करते", principal: "मुद्दल", interest: "व्याज", role: "आर्थिक शिक्षिका", year: "वर्ष" },
  { code: "ta", label: "தமிழ்", title: "கூட்டு வட்டி எப்படி வேலை செய்கிறது", principal: "அசல்", interest: "வட்டி", role: "நிதி கல்வியாளர்", year: "ஆண்டு" },
  { code: "bn", label: "বাংলা", title: "চক্রবৃদ্ধি সুদ কীভাবে কাজ করে", principal: "আসল", interest: "সুদ", role: "আর্থিক শিক্ষিকা", year: "বছর" },
]

const BARS = [
  { p: 38, i: 4 }, { p: 38, i: 12 }, { p: 38, i: 22 }, { p: 38, i: 35 }, { p: 38, i: 52 },
]

export default function HeroDemo() {
  const [idx, setIdx] = useState(1)
  const f = FRAMES[idx]

  return (
    <div className="font-indic w-full">
      <div className="relative aspect-video w-full overflow-hidden rounded-xl border bg-[#0f1b3d] text-white shadow-xl ring-1 ring-black/5">
        {/* REC-style badge */}
        <div className="absolute right-3 top-3 rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-mono tracking-wider text-white/70 sm:text-[10px]">
          {f.code === "en" ? "SOURCE" : "LOCALIZED"} · 00:42
        </div>

        {/* Title */}
        <div className="absolute left-[6%] right-[20%] top-[9%]">
          <p className="text-[clamp(13px,3.6vw,26px)] font-semibold leading-tight lg:text-[22px]">{f.title}</p>
        </div>

        {/* Chart */}
        <div className="absolute bottom-[30%] left-[6%] right-[6%] top-[34%] flex items-end gap-[3%]">
          {BARS.map((b, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="flex w-full flex-col justify-end" style={{ height: `${b.p + b.i}%` }}>
                <div className="w-full rounded-t-sm bg-amber-400" style={{ height: `${(b.i / (b.p + b.i)) * 100}%` }} />
                <div className="w-full bg-sky-400/80" style={{ height: `${(b.p / (b.p + b.i)) * 100}%` }} />
              </div>
              <span className="text-[clamp(7px,1.6vw,11px)] text-white/70">{f.year} {i * 2 + 1}</span>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="absolute right-[6%] top-[24%] flex gap-3 text-[clamp(8px,1.8vw,12px)] text-white/85">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-400/80" />{f.principal}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400" />{f.interest}</span>
        </div>

        {/* Lower third */}
        <div className="absolute bottom-[7%] left-[6%] flex items-stretch overflow-hidden rounded-md shadow-lg">
          <div className="w-1 bg-amber-400" />
          <div className="bg-white px-3 py-1.5 text-[#0f1b3d]">
            <p className="text-[clamp(9px,2vw,14px)] font-semibold leading-tight">Priya Sharma</p>
            <p className="text-[clamp(8px,1.7vw,12px)] leading-tight text-[#0f1b3d]/70">{f.role}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Preview language">
        {FRAMES.map((fr, i) => (
          <button
            key={fr.code}
            role="tab"
            aria-selected={i === idx}
            onClick={() => setIdx(i)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              i === idx ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground"
            )}
          >
            {fr.label}
          </button>
        ))}
        <span className="ml-1 text-[11px] text-muted-foreground">Same frame, text re-rendered in place</span>
      </div>
    </div>
  )
}
