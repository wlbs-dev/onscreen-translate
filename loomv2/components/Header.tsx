// Header.tsx
"use client"

import { ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import Logo from "./Logo"
import UserMenu from "./UserMenu"

interface HeaderProps {
  onBack?: () => void
  rightContent?: ReactNode
  /** Signed-in pages show the account menu (default); set false elsewhere. */
  showUserMenu?: boolean
}

export default function Header({ onBack, rightContent, showUserMenu = true }: HeaderProps) {
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
      <Logo />
      <div className="flex-1" />
      {rightContent && <div className="flex items-center gap-2">{rightContent}</div>}
      {showUserMenu && <UserMenu />}
    </header>
  )
}
