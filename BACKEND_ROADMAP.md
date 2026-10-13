# Aura Backend Roadmap

This document tracks what needs to be built to replace Aura's current client-side simulations
with production backend infrastructure. Every item maps to a feature that **already works in
demo mode** and needs a real server counterpart.

---

## Phase 1 — Real-Time Transport Layer

The app is architected for WebRTC/WebSocket; today streams are simulated in-page.

- [ ] **1.1 WebSocket signaling server** — `socket.io` or native `ws` Node server; rooms, join/leave, heartbeat. Replaces in-browser caption streaming.
- [ ] **1.2 WebRTC peer-to-peer audio/video** — STUN/TURN servers (e.g. Twilio STUN or self-hosted coturn) for NAT traversal; SDP offer/answer relayed through the signaling server.
- [ ] **1.3 Media server / SFU (optional)** — For group conversations or relay quality, an SFU (mediasoup / LiveKit / Janus) instead of pure mesh.
- [ ] **1.4 Caption-over-data-channel** — Stream caption events as typed messages (JSON) over the WS/WebRTC data channel rather than local React state. Define the message envelope schema (speaker, text, isFinal, timestamp).
- [ ] **1.5 Reconnection & resilience** — Auto-reconnect with exponential backoff, offline queueing of captions, ICE restart handling.

## Phase 2 — Speech-to-Text (Live Captions)

Currently: Web Speech API in-browser + demo-chat simulation.

- [ ] **2.1 Deepgram / Whisper streaming STT** — Server-side audio ingestion via WebSocket, streaming partial + final results back to clients. (Deepgram Nova-2 or Whisper-large-v3 via `faster-whisper` / `deepgram-python`.)
- [ ] **2.2 Speaker diarization** — Server-side speaker embedding (pyannote.audio) or Deepgram diarization to label "Speaker A / B / C" server-side, removing the client-side mock.
- [ ] **2.3 Multi-language support** — Auto language detection + per-room language config; wire into the STT session.
- [ ] **2.4 Custom vocabulary** — Boost medical/technical terms (user-supplied phrase lists already stored per-account in quick phrases).

## Phase 3 — Text-to-Speech

Currently: in-browser `speechSynthesis` via the `speak()` helper.

- [ ] **3.1 ElevenLabs / server-side TTS** — REST endpoint that returns audio streams; voice selection, stability/clarity controls.
- [ ] **3.2 Rate & voice persistence** — Store per-user TTS preferences server-side instead of `localStorage`.
- [ ] **3.3 TTS playback sync** — Client receives TTS job completion over WS and plays the returned audio buffer; supports interrupt (cancel current job on new input).

## Phase 4 — AI Co-Pilot (Ambient Sound Identification)

Currently: `setInterval` simulation firing random sounds from `AMBIENT_SOUNDS`.

- [ ] **4.1 Audio capture service** — Dedicated mic stream on a trusted client (or always-on mobile companion) piped to the classifier.
- [ ] **4.2 Real classifier** — AudioSet-based model (YAMNet / BEAST) or hosted API (AudioSet ONNX) returning `[label, confidence, priority]`.
- [ ] **4.3 Event fan-out** — Detection events pushed to all room participants over the real-time channel; persisted for the session log.
- [ ] **4.4 Priority & policy engine** — Configurable rules: which sounds trigger flash vs. vibration vs. spoken alert; per-user sensitivity.

## Phase 5 — Interpreter Relay Service (VRS)

Currently: simulated queue with `INTERPRETER_QUEUE_STEPS` timers.

- [ ] **5.1 Interpreter directory & matching** — Database of certified interpreters (language pairs, certifications, availability). Matching algorithm by language + queue position.
- [ ] **5.2 Queue system** — Real queue with position broadcasting, estimated wait, and priority/emergency escalation.
- [ ] **5.3 VRS video call** — WebRTC video room between deaf user, interpreter, and hearing party (3-way call).
- [ ] **5.4 Session records** — Signed session metadata for compliance (who, when, duration) — optional recording with consent.

## Phase 6 — Auth, Users & Persistence

Currently: no auth; settings/custom phrases in `localStorage`.

- [ ] **6.1 Auth system** — Email/password + OAuth (Google/Apple); JWT or session cookies; Next.js middleware for route protection.
- [ ] **6.2 Database & ORM** — Postgres (Supabase / Neon / RDS) + Prisma or Drizzle schema: users, rooms, sessions, phrase lists, TTS preferences, interpreter profiles.
- [ ] **6.3 User profiles** — DHH vs. hearing role, language preferences, accessibility defaults (font scale, high contrast, haptics) synced across devices.
- [ ] **6.4 Custom phrases API** — CRUD endpoint replacing `localStorage` custom-phrase storage.

## Phase 7 — Settings & Accessibility Sync

Currently: `localStorage` via `aura-settings` key.

- [ ] **7.1 Settings API** — Per-user accessibility settings (fontScale, highContrast, dark, haptics, reducedMotion) persisted server-side and applied at login.
- [ ] **7.2 Server-driven theme** — Theme class / CSS variable injection based on profile, not only client state.

## Phase 8 — Production Hardening

- [ ] **8.1 Rate limiting & abuse protection** — WS message rate limits, API throttling.
- [ ] **8.2 End-to-end encryption option** — Insertable Streams / E2EE for sensitive conversations (medical, legal).
- [ ] **8.3 Observability** — Structured logging, OpenTelemetry traces for the caption pipeline, uptime monitoring.
- [ ] **8.4 Compliance** — GDPR/CCPA data handling, HIPAA-aligned storage for medical-phrase usage, consent flows.
- [ ] **8.5 Deployment** — Containerized signaling + STT services; HTTPS/WSS everywhere; TURN behind firewall rules.

## Phase 9 — Mobile / PWA (Stretch)

- [ ] **9.1 PWA manifest & installability** — Offline shell, push notifications for critical alerts.
- [ ] **9.2 Native vibration patterns** — Reliable haptics on iOS/Android (Web Vibration API is Android-only today).
- [ ] **9.3 Background audio capture** — Co-pilot continues while screen is off (requires native or iOS/Android app).

---

## Suggested sequencing

1. **Phases 1 + 6** first — real-time transport + auth/data foundation everything else plugs into.
2. **Phase 2** next — highest user value (real captions) and most technically de-risking.
3. **Phases 3 + 4** — media features layered on the transport.
4. **Phase 5** — the differentiator; can run in parallel with 3/4.
5. **Phases 7 + 8** — hardening as the feature set stabilizes.
6. **Phase 9** — once web product-market fit is proven.

## Current "demo seam" inventory (what to un-mock)

| Feature | Current simulation | Replaced by |
|---|---|---|
| Demo chat | `DEMO_CONVERSATION` in `mock-data.ts` | Phase 2.1 real STT stream |
| Ambient sounds | `setInterval` + `AMBIENT_SOUNDS` | Phase 4.2 real classifier |
| Interpreter queue | `INTERPRETER_QUEUE_STEPS` timers | Phase 5.2 real queue |
| Custom phrases | `localStorage` | Phase 6.4 phrases API |
| Settings | `localStorage` `aura-settings` | Phase 7.1 settings API |
| TTS | browser `speechSynthesis` | Phase 3.1 ElevenLabs |
| Captions transport | React context in-memory | Phase 1.4 data-channel messages |
