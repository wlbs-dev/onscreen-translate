import type { ReactNode } from "react"
import Logo from "@/components/Logo"

export default function AuthCard({ title, subtitle, children, footer }: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-muted/40 text-foreground px-4 py-10">
      <div className="w-full max-w-sm space-y-4">
        <Logo href="/" className="justify-center" />
        <div className="rounded-xl border bg-background p-6 shadow-sm space-y-4">
          <div className="space-y-1">
            <h1 className="text-base font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-muted-foreground leading-relaxed">{subtitle}</p>}
          </div>
          {children}
        </div>
        {footer && <p className="text-center text-xs text-muted-foreground">{footer}</p>}
      </div>
    </main>
  )
}

/** Only follow same-site relative paths after sign-in. */
export function safeNext(next: string | null | undefined, fallback = "/app"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback
}
