// components/editor/ShortcutsHelp.tsx
"use client"

import { Keyboard } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { SHORTCUTS, isMac } from "@/lib/editor/shortcuts"

interface ShortcutsHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded border bg-muted text-[10px] font-mono font-medium text-foreground border-b-2">
      {children}
    </kbd>
  )
}

export default function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const mod = isMac() ? "⌘" : "Ctrl"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="icon" variant="ghost" className="h-8 w-8" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
          <Keyboard size={13} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="text-xs">
            Shortcuts are paused while you type in a text field (except {mod}+S).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUTS.map(({ group, items }) => (
            <div key={group} className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="divide-y rounded-md border">
                {items.map(({ keys, label }) => (
                  <div key={label} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
                    <span>{label}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {keys.map((k, i) => (
                        <Kbd key={i}>{k.replace(/Mod/g, mod)}</Kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
