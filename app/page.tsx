import Link from "next/link";
import {
  Accessibility,
  Captions,
  Ear,
  Keyboard,
  Siren,
  Sparkles,
  Users,
  Vibrate,
  Video,
} from "lucide-react";

export const metadata = {
  title: "Aura — Communication Without Barriers",
  description:
    "Real-time captions, ambient sound alerts, haptics, and on-demand interpreters for Deaf/Hard-of-Hearing and hearing conversations.",
};

const MODES = [
  {
    href: "/dhh",
    icon: Ear,
    title: "DHH View",
    description:
      "High-contrast, large-type live transcript with quick-phrase macros, a sound intensity meter, and vibration + screen-flash cues for every alert.",
    accent: "text-indigo-600 dark:text-indigo-400",
  },
  {
    href: "/hearing",
    icon: Users,
    title: "Hearing View",
    description:
      "A clean audio/video side with one-tap voice input, a smart text-to-speech player with speed control, and automatic speaker diarization.",
    accent: "text-emerald-600 dark:text-emerald-400",
  },
  {
    href: "/face-to-face",
    icon: Video,
    title: "Face-to-Face",
    description:
      "Table mode: a split screen with the top half rotated 180° so two people sharing one phone can read from opposite sides.",
    accent: "text-amber-600 dark:text-amber-400",
  },
];

const FEATURES = [
  { icon: Captions, title: "Live captions", text: "Web Speech API transcription with interim results — words appear as they are spoken." },
  { icon: Sparkles, title: "AI Co-Pilot", text: "Ambient sound identification: sirens, door knocks, name calls — always shown, never only heard." },
  { icon: Vibrate, title: "Haptic cues", text: "Vibration patterns on mobile for every alert, always paired with a visual indicator." },
  { icon: Siren, title: "Interpreter SOS", text: "One tap joins a certified sign-language interpreter over video relay in seconds." },
  { icon: Keyboard, title: "Keyboard-first", text: "Full keyboard navigation with roving-tabindex quick phrases and visible focus everywhere." },
  { icon: Accessibility, title: "WCAG 2.2 AAA", text: "High-contrast theme, font scaling, ARIA live regions, and reduced-motion support built in." },
];

export default function LandingPage() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col px-4">
      {/* Top bar */}
      <header className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
              <path d="M12 3a7 7 0 0 0-7 7c0 2 .8 3.4 1.8 4.6.9 1 1.7 1.9 1.7 3.4h7c0-1.5.8-2.4 1.7-3.4C18.2 13.4 19 12 19 10a7 7 0 0 0-7-7Z" />
              <path d="M9 21h6" />
            </svg>
          </span>
          <span className="text-lg font-bold tracking-tight">Aura</span>
        </div>
        <nav aria-label="Demo modes" className="flex items-center gap-1">
          <Link
            href="/dhh"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            DHH
          </Link>
          <Link
            href="/hearing"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Hearing
          </Link>
          <Link
            href="/face-to-face"
            className="rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Face-to-Face
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section aria-labelledby="hero-heading" className="flex flex-col items-center py-16 text-center">
        <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs font-medium text-muted-foreground">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Accessible real-time communication · WCAG 2.2 AAA
        </p>
        <h1 id="hero-heading" className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Communication <span className="text-primary">without barriers</span>
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Aura bridges Deaf/Hard-of-Hearing and hearing conversations with ultra-low-latency live
          captions, ambient sound alerts, haptic cues, and on-demand certified interpreters.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dhh"
            className="inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Ear aria-hidden="true" /> Enter DHH view
          </Link>
          <Link
            href="/hearing"
            className="inline-flex h-12 items-center gap-2 rounded-xl border border-border bg-card px-6 font-semibold shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <Users aria-hidden="true" /> Enter hearing view
          </Link>
        </div>
      </section>

      {/* Mode cards */}
      <section aria-labelledby="modes-heading" className="pb-16">
        <h2 id="modes-heading" className="mb-6 text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Choose your side of the conversation
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {MODES.map((mode) => (
            <Link
              key={mode.href}
              href={mode.href}
              aria-label={`Open ${mode.title}`}
              className="group rounded-xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <mode.icon className={`size-8 ${mode.accent}`} aria-hidden="true" />
              <h3 className="mt-4 text-lg font-semibold">{mode.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{mode.description}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
                Open mode
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-heading" className="border-t border-border py-16">
        <h2 id="features-heading" className="text-center text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Built for every sense
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-card p-5">
              <f.icon className="size-6 text-primary" aria-hidden="true" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-6">
        <p className="text-center text-xs text-muted-foreground">
          Aura — demo mode. All captions, sounds, and queue progress are simulated locally in your
          browser using Web APIs.
        </p>
      </footer>
    </div>
  );
}
