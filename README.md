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

## Live speech-to-text (Phase 2)

**Start live captions** prefers server STT when you're in a room: mic audio is captured via an AudioWorklet (PCM16 mono 16 kHz), streamed as binary WebSocket frames to the signaling server, transcribed, and broadcast back as captions with diarized `Speaker A/B/C…` labels. Without a room (or if the server has no engine), it falls back to the browser Web Speech API.

Configure via `.env.local` (see `.env.example`):

```bash
STT_PROVIDER=auto        # auto | deepgram | mock
DEEPGRAM_API_KEY=        # set to enable real transcription (Nova-3)
STT_MODEL=nova-3
STT_LANGUAGE=en
STT_KEYWORDS=penicillin,triage   # boosted vocabulary
```

Without a `DEEPGRAM_API_KEY`, the scripted mock engine runs so the whole pipeline works out of the box.

## Server-side speech synthesis (Phase 3)

Quick phrases and the hearing composer speak via ElevenLabs when configured, browser voice otherwise:

```bash
ELEVENLABS_API_KEY=            # set to enable expressive server voices
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM
ELEVENLABS_MODEL=eleven_turbo_v2_5
ELEVENLABS_STABILITY=0.5
ELEVENLABS_SIMILARITY_BOOST=0.75
```

- `POST /api/tts` → MP3 bytes (`{ text, voiceId? }`, 2000-char cap, `X-Aura-TTS-Cache: HIT/MISS`); 503 without a key.
- `GET /api/tts/voices` → voice picker catalog (cached 10 min).
- Repeat phrases are served from an in-memory LRU — second tap is instant and costs no quota.

## Real ambient sound detection (Phase 4)

In a room, the AI Co-Pilot streams mic audio to the signaling server, where an AudioSet classifier labels 4 s windows and broadcasts detections back to everyone. Outside a room (or without a backend engine) it runs the local simulation — same chips, flashes, and haptics either way.

```bash
AMBIENT_PROVIDER=auto       # auto | hf | mock
HF_TOKEN=                   # HuggingFace token with Inference Providers permission
AMBIENT_MODEL=MIT/ast-finetuned-audioset-10-10-0.4593
AMBIENT_WINDOW_S=4
AMBIENT_THRESHOLD=0.3
AMBIENT_COOLDOWN_S=20
```

A sensitivity picker (Low / Standard / High) filters which priorities reach you. Privacy note: ambient mic audio leaves the device only when the server engine is active in a joined room — and every detection is announced visually, never audio-only.

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
