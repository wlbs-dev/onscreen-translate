"use client"

import { Languages } from "lucide-react"
import { LANGUAGES, DEFAULT_LANG, isSupportedLang } from "@/lib/languages"
import { cn } from "@/lib/utils"

const STORAGE_KEY = "ot.targetLang"

/** Last language the user picked in this browser (per-viewer convenience only). */
export function rememberedLang(): string {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY)
    if (isSupportedLang(v)) return v
  } catch {}
  return DEFAULT_LANG
}

export function rememberLang(code: string): void {
  try { window.localStorage.setItem(STORAGE_KEY, code) } catch {}
}

export default function LanguageSelect({ value, onChange, className, id }: {
  value: string
  onChange: (code: string) => void
  className?: string
  id?: string
}) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <Languages size={14} className="absolute left-2.5 text-muted-foreground pointer-events-none" />
      <select
        id={id}
        value={value}
        onChange={(e) => { onChange(e.target.value); rememberLang(e.target.value) }}
        className="h-9 w-full appearance-none rounded-md border border-input bg-background pl-8 pr-8 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>{l.name} · {l.native}</option>
        ))}
      </select>
      <span className="absolute right-2.5 text-muted-foreground pointer-events-none text-[10px]">▼</span>
    </div>
  )
}
