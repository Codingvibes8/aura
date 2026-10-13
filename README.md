# Aura

**Accessible, ultra-low-latency real-time communication** bridging the Deaf/Hard-of-Hearing (DHH) community and hearing individuals — inspired by Aira.io.

Every feature runs **100% client-side** using Web APIs (Web Speech, Web Audio, Vibration, speech synthesis). No backend, no accounts, no audio leaves the device.

## Quick start

```bash
npm install
npm run dev        # Next.js + signaling server (concurrently)
```

- Web app → http://localhost:3000 (falls back to 3001/3002 if occupied)
- Signaling server → ws://localhost:3100 (`SIGNALING_PORT` to override)

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run test:server` (signaling E2E).

**Live rooms**: open the **Live session** button in the header (wifi icon), pick a room code, and join. Open the page in a second tab/window with the same code — both sides sync instantly. See `BACKEND_ROADMAP.md` for the phased plan to swap demo simulations for real services.

## The three modes

| Mode | Route | Who it's for |
|---|---|---|
| **DHH View** | `/dhh` | Transcript-first screen: giant live captions, quick-phrase macros, sound-intensity meter, screen-flash + vibration cues |
| **Hearing View** | `/hearing` | Clean audio/video side: voice-to-text, TTS composer with speed control, speaker diarization map |
| **Face-to-Face** | `/face-to-face` | Table mode: top half rotated 180° so two people sharing one screen read from opposite sides |

## Feature checklist

- **Live captions** — Web Speech API (`SpeechRecognition`) with continuous + interim results, auto-restart on silence cutoff, speaker diarization badges (Speaker A / B), `role="log"` + `aria-live="polite"` transcript.
- **Demo chat** — simulated two-way conversation engine so the whole caption pipeline is testable without a microphone.
- **AI Co-Pilot ambient sounds** — simulated classifier fires `[Siren approaching]`, `[Door knock]`, `[Fire alarm]`… every detection pairs **visual chip + screen flash + haptics** (never audio-only). Critical alerts are also spoken.
- **Sound intensity meter** — Web Audio `AnalyserNode` RMS level on 24 bars (`role="meter"` with `aria-valuenow`), opt-in mic button, synthetic demo fallback.
- **Quick phrases** — categorized one-tap macros (Medical / Transit / Ordering / Work + custom), each tap speaks via TTS **and** posts to the transcript. Predictive suggestions inferred from the latest peer caption. Roving-tabindex grid with full arrow-key/Home/End navigation.
- **Interpreter SOS** — Aira-style on-demand VRS flow: queue progression with progress bar, client-side simulation of the full relay states.
- **Accessibility center** — font scaling (87.5%–150%, rem-based so *everything* scales), high-contrast AAA theme, dark mode, haptics toggle, reduced-motion toggle. Persisted to `localStorage`.
- **WCAG 2.2 AAA** — skip link, visible focus rings, ARIA live regions (`polite` for captions, `assertive` for critical alerts via screen flash + announcer), `prefers-reduced-motion` support, 44px+ touch targets.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui primitives (Radix) · Lucide icons

## Project structure

```
app/
  page.tsx                      # Landing — mode picker
  (dashboard)/
    layout.tsx                  # AuraProvider + header + skip link
    dhh/page.tsx                # DHH view
    hearing/page.tsx            # Hearing view
    face-to-face/page.tsx       # Split-screen table mode
components/
  aura-provider.tsx             # Global state: captions, alerts, settings, TTS, haptics
  live-captions.tsx             # Web Speech API STT + demo engine + transcript log
  ambient-sound-detector.tsx    # AI Co-Pilot simulated classifier
  sound-visualizer.tsx          # Web Audio intensity meter
  quick-phrases.tsx             # Keyboard-navigable phrase macros + predictions
  sos-interpreter.tsx           # Interpreter queue dialog
  settings-panel.tsx            # Accessibility sheet
  mode-header.tsx               # App header with SOS + settings
  ui/                           # shadcn/ui primitives (button, card, dialog, sheet, tabs…)
lib/
  utils.ts                      # cn() class merger
  mock-data.ts                  # Phrases, ambient sounds, demo conversation, queue steps
```

## Accessibility notes

- **Every audio cue has a visual twin** — peer speech pulses a border ring, ambient detections flash + vibrate + caption, critical alerts announce via `role="alert"`.
- Haptics are gated behind first user interaction (Chrome's Vibration API policy).
- High-contrast mode swaps the entire semantic color system via CSS variables — no component changes needed.
- Font scaling works by setting the root `font-size`; all Tailwind `rem`-based utilities scale proportionally.
