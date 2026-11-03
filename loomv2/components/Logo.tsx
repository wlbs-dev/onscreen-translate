import Link from "next/link"
import { Film } from "lucide-react"
import { cn } from "@/lib/utils"

/** Brand mark. Without href it isn't a link (e.g. inside the editor, where leaving loses edits). */
export default function Logo({ href, className }: { href?: string; className?: string }) {
  const inner = (
    <>
      <span className="w-6 h-6 rounded-md bg-primary flex items-center justify-center">
        <Film size={13} className="text-primary-foreground" />
      </span>
      <span className="text-xs font-bold tracking-widest text-primary">TRANSEDIT</span>
    </>
  )
  const cls = cn("flex items-center gap-2", className)
  return href ? <Link href={href} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>
}
