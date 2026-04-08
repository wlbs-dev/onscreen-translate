// Header.tsx
"use client"

import { ReactNode } from "react"
import { ArrowLeft, Film } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

interface HeaderProps {
  onBack?: () => void
  rightContent?: ReactNode
}

export default function Header({ onBack, rightContent }: HeaderProps) {
  return (
    <header className="flex items-center gap-3 px-4 h-12 bg-background border-b shrink-0">
      {onBack && (
        <>
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground">
            <ArrowLeft size={13} /> Back
          </Button>
          <Separator orientation="vertical" className="h-4" />
        </>
      )}
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
          <Film size={13} className="text-primary-foreground" />
        </div>
        <span className="text-xs font-bold tracking-widest text-primary">TRANSEDIT</span>
      </div>
      <div className="flex-1" />
      {rightContent && <div className="flex items-center gap-2">{rightContent}</div>}
    </header>
  )
}