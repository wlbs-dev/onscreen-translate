"use client"

import { useState } from "react"
import { CheckCircle, Loader2, Star } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const MAX = 5000

/**
 * "Send feedback" / "Report a problem with this video". Mount it with a
 * changing `key` per open so the form starts empty.
 */
export default function FeedbackDialog({ open, onOpenChange, jobId, jobLabel }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobId?: string
  jobLabel?: string
}) {
  const [message, setMessage] = useState("")
  const [rating, setRating]   = useState<number | null>(null)
  const [state, setState]     = useState<"idle" | "busy" | "done">("idle")
  const [error, setError]     = useState("")

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState("busy"); setError("")
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, rating, jobId }),
      })
      if (res.ok) { setState("done"); setTimeout(() => onOpenChange(false), 1200); return }
      setError((await res.json().catch(() => ({}))).error ?? "Couldn't send feedback")
    } catch {
      setError("Couldn't reach the server")
    }
    setState("idle")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-background text-foreground" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{jobId ? "Report a problem with this video" : "Send feedback"}</DialogTitle>
          <DialogDescription>
            {jobId
              ? <>About <span className="font-medium text-foreground">{jobLabel ?? jobId.slice(0, 8)}</span>. What went wrong — OCR, translation, timing, the render?</>
              : "What's working, what's broken, what's missing? It goes straight to the team."}
          </DialogDescription>
        </DialogHeader>

        {state === "done" ? (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800" data-testid="feedback-done">
            <CheckCircle size={16} className="text-emerald-600" /> Thanks — we got it.
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4" id="feedback-form">
            <div className="space-y-1.5">
              <Label htmlFor="fb-message">Message</Label>
              <Textarea
                id="fb-message" rows={5} autoFocus maxLength={MAX} required
                value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder={jobId ? "e.g. The title at 0:12 wasn't detected" : "Tell us anything"}
              />
              <p className="text-right text-[10px] text-muted-foreground">{message.length}/{MAX}</p>
            </div>
            <div className="space-y-1.5">
              <Label>How is it going? <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} of 5`}
                    onClick={() => setRating(rating === n ? null : n)}
                    className="rounded p-1 hover:bg-muted"
                  >
                    <Star size={18} className={cn(rating != null && n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground")} />
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
          </form>
        )}

        {state !== "done" && (
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" form="feedback-form" disabled={state === "busy" || !message.trim()} data-testid="feedback-submit">
              {state === "busy" && <Loader2 size={14} className="mr-1.5 animate-spin" />} Send
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
