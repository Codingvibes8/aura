# Aura Backend Roadmap

This document tracks what needs to be built to replace Aura's current client-side simulations
with production backend infrastructure. Every item maps to a feature that **already works in
demo mode** and needs a real server counterpart.

---

## Phase 1 — Real-Time Transport Layer  ✅ COMPLETE

The app is architected for WebRTC/WebSocket; today streams are simulated in-page.

- [x] **1.1 WebSocket signaling server** — `ws` Node server; rooms (max 8), join/leave, 30s heartbeat, token-bucket rate limiting. **Status: shipped + E2E-tested (`server/test-signaling.ts`, 16/16 checks).**
- [x] **1.2 WebRTC peer-to-peer audio/video** — STUN/TURN servers (e.g. Twilio STUN or self-hosted coturn) for NAT traversal; SDP offer/answer relayed through the signaling server. *(Signal relay shipped — STUN/TURN config still open.)*
- [ ] **1.3 Media server / SFU (optional)** — For group conversations or relay quality, an SFU (mediasoup / LiveKit / Janus) instead of pure mesh.
- [x] **1.4 Caption-over-data-channel** — Caption events flow as typed JSON over the WebSocket (schema in `lib/realtime/schema.ts`, server assigns monotonic `seq` per room). **Status: shipped + tested.**
- [x] **1.5 Reconnection & resilience** — Auto-reconnect with exponential backoff (1s→15s + jitter), automatic room re-join on reconnect, heartbeat kills silent sockets. **Status: shipped.**

## Phase 2 — Speech-to-Text (Live Captions)  ✅ COMPLETE

- [x] **2.1 Deepgram / Whisper streaming STT** — Mic audio (PCM16 mono 16 kHz via AudioWorklet) streams as binary WebSocket frames to the signaling server, which fans out to a per-peer provider session and broadcasts interim + final `caption` messages back to the room. **Status: shipped.** Provider selected by `STT_PROVIDER` (`auto` = Deepgram when `DEEPGRAM_API_KEY` is set, else mock). Whisper can implement the same `SttProvider` interface later (`server/stt/provider.ts`).
- [x] **2.2 Speaker diarization** — Deepgram `diarize=true`; server maps `(peer, engineSpeaker)` pairs to room-scoped `Speaker A/B/C…` labels, grouped by `utteranceId`. **Status: shipped.**
- [x] **2.3 Multi-language support** — `stt-start` accepts `lang` (BCP-47, default `STT_LANGUAGE`); forwarded to the engine per session. **Status: shipped.**
- [x] **2.4 Custom vocabulary** — `stt-start` accepts `keywords[]` (or server `STT_KEYWORDS`); forwarded as Deepgram keyword boosts. **Status: shipped.**

## Phase 3 — Text-to-Speech  ✅ COMPLETE

- [x] **3.1 ElevenLabs / server-side TTS** — `POST /api/tts` returns MP3 audio (`eleven_turbo_v2_5`, stability/clarity controls via env); `GET /api/tts/voices` serves the voice picker catalog. In-memory LRU caches repeat phrases (quick-phrase macros) to ~0 latency and zero extra quota. API key never leaves the server. **Status: shipped + unit-tested (`server/test-tts.ts`, 15/15).**
- [x] **3.2 Rate & voice persistence** — Voice + rate persist per-device in `localStorage` today (no identity exists yet); the hook is documented to switch to server-side profile sync when Phase 6 auth lands. **Status: client-persisted, server sync deferred to Phase 6.**
- [x] **3.3 TTS playback sync** — `useServerTts()` plays server audio via HTMLAudio (rate → `playbackRate`), interrupts in-flight audio on new input, and falls back to browser `speechSynthesis` when unconfigured or on fetch failure. **Status: shipped + browser-verified.**

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
| Demo chat | `DEMO_CONVERSATION` in `mock-data.ts` | Kept as no-mic demo; live path is Phase 2.1 server STT |
| Ambient sounds | `setInterval` + `AMBIENT_SOUNDS` | Phase 4.2 real classifier |
| Interpreter queue | `INTERPRETER_QUEUE_STEPS` timers | Phase 5.2 real queue |
| Custom phrases | `localStorage` | Phase 6.4 phrases API |
| Settings | `localStorage` `aura-settings` | Phase 7.1 settings API |
| TTS | ~~browser `speechSynthesis`~~ | ✅ Phase 3 shipped — ElevenLabs server audio with browser fallback |
| Captions transport | ~~React context in-memory~~ | ✅ Phase 1.4 shipped — WebSocket data channel live |
| WebRTC signaling | ~~n/a~~ | ✅ Phase 1.1/1.2 relay shipped (`server/signaling-server.ts`) |
| Live STT engine | ~~Web Speech API only~~ | ✅ Phase 2 shipped — server STT (Deepgram/mock) with browser fallback |

## Phase 1 delivery notes

- **Server**: `server/signaling-server.ts` — standalone Node process on port **3100** (`SIGNALING_PORT` env to override). `npm run dev` boots Next + signaling together via `concurrently`; `npm run start:server` runs it alone.
- **Schema**: `lib/realtime/schema.ts` — zod-validated client→server messages; typed server→client messages. Add new message types here first.
- **Client**: `lib/realtime/SignalingClient.ts` (reconnect/backoff/rejoin) + `components/realtime-provider.tsx` (`useRealtime()` context) + `components/connection-status.tsx` (header status + room join UI).
- **Tests**: `npm run test:server` — boots the server, two clients join, asserts signal relay, caption broadcast + seq assignment, malformed rejection, ping/pong, leave notification.
- **Rooms**: max 8 peers, token-bucket 30 msg/s, 64KB max frame, 30s heartbeat. Interpreter role (`interpreter`) reserved for Phase 5.
- **Production**: point `NEXT_PUBLIC_SIGNALING_URL` at your deployed `wss://` endpoint (same-origin reverse proxy works too — client defaults to `wss://<host>` under HTTPS).
