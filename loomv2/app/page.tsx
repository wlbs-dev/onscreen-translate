// Public landing page. Signed-in users go straight to the app.
import Link from "next/link"
import { redirect } from "next/navigation"
import {
  ArrowRight, Check, Clapperboard, GraduationCap, Languages, Megaphone, MonitorPlay,
  ScanText, SquarePen, Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import Logo from "@/components/Logo"
import HeroDemo from "@/components/landing/HeroDemo"
import WaitlistForm from "@/components/landing/WaitlistForm"
import { currentUser } from "@/lib/access"
import { LANGUAGES } from "@/lib/languages"
import { PUBLIC_PLANS, formatInr, formatUsd } from "@/lib/plans"

export const dynamic = "force-dynamic"
export const metadata = {
  title: "TransEdit — localize the on-screen text in your videos",
  description:
    "Translate titles, labels, slides and lower-thirds burned into your videos into 10 Indian languages. Upload, review in an editor, export.",
}

const STEPS = [
  { icon: Upload,       title: "Upload",    body: "Drop in an MP4 — a lesson, an explainer, an ad cut." },
  { icon: ScanText,     title: "OCR",       body: "Every frame is scanned for on-screen English text, with positions and timing." },
  { icon: Languages,    title: "Translate", body: "Text is translated by scene, with context, into the language you pick." },
  { icon: SquarePen,    title: "Edit",      body: "Review every box on a timeline: fix wording, timing, size and colour." },
  { icon: Clapperboard, title: "Render",    body: "Get back the same video with the translations burned in, in place." },
]

const LOCALIZES = [
  "Titles and section headings",
  "Labels, callouts and chart text",
  "Slides and infographics",
  "Lower-thirds and on-screen captions",
]

const AUDIENCES = [
  {
    icon: GraduationCap,
    title: "Edtech & course teams",
    body: "Your lessons are full of slides, diagrams and worked examples. Ship them in Hindi, Tamil or Bengali without re-editing every video.",
  },
  {
    icon: MonitorPlay,
    title: "Explainer & YouTube creators",
    body: "Dubbed audio over English graphics feels half-done. Localize the visuals so a regional audience gets the whole video.",
  },
  {
    icon: Megaphone,
    title: "D2C brands & performance agencies",
    body: "Turn one hero creative into state-by-state variants — offers, supers and end cards in the language each audience reads.",
  },
]

export default async function Landing() {
  if (await currentUser()) redirect("/app")

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo href="/" />
          <nav className="ml-4 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#languages" className="hover:text-foreground">Languages</a>
            <a href="#who" className="hover:text-foreground">Who it&apos;s for</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
          </nav>
          <div className="flex-1" />
          <Button asChild variant="ghost" size="sm"><Link href="/login">Sign in</Link></Button>
          <Button asChild size="sm" className="hidden sm:inline-flex"><a href="#waitlist">Join the waitlist</a></Button>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-14 lg:pt-20">
          <div className="space-y-6">
            <span className="inline-flex items-center gap-2 rounded-full border bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Private pilot · 10 Indian languages
            </span>
            <h1 className="text-[2.1rem] font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              YouTube dubs the voice.<br />
              <span className="text-muted-foreground">We dub the visuals.</span>
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              TransEdit finds the English text burned into your videos — titles, labels, slides,
              lower-thirds — translates it, and re-renders it in place. Review everything in an
              editor before you export.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="h-10 px-5"><a href="#waitlist">Request pilot access <ArrowRight /></a></Button>
              <Button asChild variant="outline" className="h-10 px-5"><Link href="/login">I have an account</Link></Button>
            </div>
            <ul className="grid gap-2 pt-2 text-sm text-muted-foreground sm:grid-cols-2">
              {LOCALIZES.map((l) => (
                <li key={l} className="flex items-center gap-2"><Check size={14} className="shrink-0 text-emerald-600" /> {l}</li>
              ))}
            </ul>
          </div>
          <HeroDemo />
        </section>

        {/* Problem */}
        <section className="border-y bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-12 sm:px-6 md:grid-cols-3">
            <div className="md:col-span-1">
              <h2 className="text-xl font-semibold tracking-tight">Dubbing stops at the soundtrack</h2>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground md:col-span-2">
              Audio dubbing and subtitles have become easy. But the words on screen — the slide your
              teacher is pointing at, the price on the end card, the label on the chart — stay in
              English, and re-cutting every video by hand doesn&apos;t scale. TransEdit treats on-screen
              text as something you can translate, just like speech.
            </p>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Five steps, one upload. Machines do the tedious part; you stay in control of the final cut.
          </p>
          <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-xl border bg-background p-4">
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/5">
                    <s.icon size={16} />
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                </div>
                <p className="mt-3 text-sm font-semibold">{s.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* Languages */}
        <section id="languages" className="scroll-mt-16 border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Ten languages, rendered properly</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Every script is shaped correctly — conjuncts, matras and all — using open Noto fonts.
            </p>
            <ul className="font-indic mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {LANGUAGES.map((l) => (
                <li key={l.code} className="rounded-xl border bg-background px-4 py-4">
                  <p className="text-2xl leading-snug">{l.native}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{l.name}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Who it's for */}
        <section id="who" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Who it&apos;s for</h2>
          <div className="mt-8 grid gap-3 md:grid-cols-3">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="rounded-xl border bg-background p-5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/5">
                  <a.icon size={17} />
                </span>
                <p className="mt-4 text-sm font-semibold">{a.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{a.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing (from lib/plans.ts) */}
        <section id="pricing" className="scroll-mt-16 border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight">Pricing</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Pay for the minutes of video you localize. Every plan includes all ten languages and the full editor,
              and minutes are shared by your whole team.
            </p>
            <div className="mt-8 grid gap-3 md:grid-cols-3" data-testid="pricing">
              {PUBLIC_PLANS.map((p) => (
                <div key={p.id} className={`flex flex-col rounded-xl border bg-background p-5 ${p.id === "creator" ? "border-primary ring-1 ring-primary" : ""}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{p.name}</p>
                    {p.id === "creator" && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">Popular</span>}
                  </div>
                  <p className="mt-3">
                    <span className="text-3xl font-semibold tracking-tight">{formatInr(p.priceInr)}</span>
                    <span className="text-sm text-muted-foreground"> /month</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{p.priceUsd > 0 ? `or ${formatUsd(p.priceUsd)}/month outside India` : "No card needed"}</p>
                  <p className="mt-3 text-sm text-muted-foreground">{p.blurb}</p>
                  <ul className="mt-4 flex-1 space-y-2 text-sm">
                    {p.features.map((f) => (
                      <li key={f} className="flex gap-2"><Check size={14} className="mt-0.5 shrink-0 text-emerald-600" /> {f}</li>
                    ))}
                  </ul>
                  <Button asChild variant={p.id === "creator" ? "default" : "outline"} className="mt-5 h-9">
                    <a href="#waitlist">Request access</a>
                  </Button>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Prices per month, billed monthly via Razorpay (₹) or Stripe ($). Cancel any time; you keep your plan until the end of the paid month.
            </p>
          </div>
        </section>

        {/* Waitlist */}
        <section id="waitlist" className="scroll-mt-16 border-t bg-muted/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[1fr_1.2fr] lg:gap-14">
            <div className="space-y-3">
              <h2 className="text-2xl font-semibold tracking-tight">Join the pilot</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">
                We&apos;re working closely with a small group of teams while we tune translation quality
                and the editor. Tell us what you&apos;d localize and we&apos;ll send you an invite.
              </p>
              <p className="text-sm text-muted-foreground">
                Already invited? <Link href="/signup" className="text-foreground underline underline-offset-4">Create your account</Link>
                {" "}or <Link href="/login" className="text-foreground underline underline-offset-4">sign in</Link>.
              </p>
            </div>
            <WaitlistForm />
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Logo href="/" />
          <p>On-screen text localization for Indian languages. Only upload videos you have the rights to.</p>
        </div>
      </footer>
    </div>
  )
}
