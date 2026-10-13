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
- [x] **3.2 Rate & voice persistence** — Voice + rate persist per-device and sync to the profile on sign-in (`PUT /api/settings`); server-side profile sync live. **Status: shipped with Phase 6/7.**
- [x] **3.3 TTS playback sync** — `useServerTts()` plays server audio via HTMLAudio (rate → `playbackRate`), interrupts in-flight audio on new input, and falls back to browser `speechSynthesis` when unconfigured or on fetch failure. **Status: shipped + browser-verified.**

## Phase 4 — AI Co-Pilot (Ambient Sound Identification)  ✅ COMPLETE

- [x] **4.1 Audio capture service** — Dedicated mic pipe (`useRoomAmbient`) reusing the PCM16 worklet; binary frames multiplexed on the signaling socket with a `0x02` stream header (STT uses `0x01`). Server accumulates 4 s windows per session. **Status: shipped.**
- [x] **4.2 Real classifier** — AudioSet AST via HuggingFace Inference (`router.huggingface.co`, WAV-wrapped windows); AudioSet labels mapped to Aura's curated defs with confidence threshold; speech/music ignored. Mock classifier keeps zero-key demo/CI green. **Status: shipped + unit-tested (`server/test-ambient.ts`, 18/18).**
- [x] **4.3 Event fan-out** — Detections broadcast inclusively to the room as `ambient` messages (existing Phase 1 channel); detector renders own echo + peers through one shared policy. **Status: shipped + E2E-tested.**
- [x] **4.4 Priority & policy engine** — Per-sound 20 s cooldowns server-side; client sensitivity (Low = critical only / Standard / High = everything) persisted per-device; criticals captioned + spoken, everything flashed + vibrated. **Status: shipped.**

## Phase 5 — Interpreter Relay Service (VRS)  ✅ COMPLETE

- [x] **5.1 Interpreter directory & matching** — Live presence pool: interpreters publish availability + languages from the `/interpreter` console; server matches by language overlap (exact or `any`). No DB yet — presence is in-memory, directory persistence lands with Phase 6. **Status: shipped.**
- [x] **5.2 Queue system** — Emergency requests sort ahead of standard; live position + ETA broadcasts; cancel; interpreter decline requeues at front; auto-rematch on free; demo fallback auto-matches a virtual interpreter (configurable, on by default). **Status: shipped + tested (`server/test-vrs.ts`).**
- [x] **5.3 VRS video call** — 1:1 WebRTC video (requester calls, interpreter auto-answers) over the existing signal relay with public STUN. Same-machine/LAN verified; symmetric NATs need TURN (Phase 8). **Status: shipped; media verified where devices exist.**
- [x] **5.4 Session records** — Append-only JSONL metadata log (parties, language, duration, end reason) — never audio/video content. **Status: shipped (`data/vrs-sessions.jsonl`).**

## Phase 6 — Auth, Users & Persistence  ✅ COMPLETE (Supabase)

- [x] **6.1 Auth system** — Supabase Auth: email/password + Google/Apple OAuth, PKCE callback route, cookie sessions via `@supabase/ssr`. `proxy.ts` refreshes sessions and gates `/interpreter` behind login (only when configured — demo stays open). **Status: shipped.**
- [x] **6.2 Database & ORM** — Supabase Postgres, `supabase/migrations/0001_aura.sql` (`profiles`, `user_settings`, `custom_phrases`, owner-only RLS + `updated_at` triggers). supabase-js client; no separate ORM needed. **Status: shipped, see `supabase/README.md`.**
- [x] **6.3 User profiles** — `GET/PATCH /api/profile` (display name, role, language); header shows identity + sign-out. **Status: shipped.**
- [x] **6.4 Custom phrases API** — `GET/POST/DELETE /api/phrases` (200-phrase cap, ordered); client merges server + local with localStorage as offline cache. **Status: shipped + browser-verified.**

## Phase 7 — Settings & Accessibility Sync  ✅ COMPLETE

- [x] **7.1 Settings API** — `GET/PUT /api/settings` (a11y flags + TTS prefs + ambient sensitivity, last-write-wins). **Status: shipped.**
- [x] **7.2 Server-driven theme** — `CloudSync` pulls on sign-in (applies aura settings, TTS prefs, sensitivity) and pushes debounced snapshots; signed out it is fully inert. **Status: shipped.**

## Phase 8 — Production Hardening  ✅ COMPLETE

- [x] **8.1 Rate limiting & abuse protection** — Fixed-window per-IP throttling on all API routes (`lib/rate-limit.ts`, 429 + `Retry-After`; TTS synthesis capped to protect ElevenLabs spend); signaling server keeps its token bucket plus a 20-connection per-IP cap and 64 KB frame limits. Redis-backed limits noted for multi-instance deploys. **Status: shipped + 429-tested.**
- [x] **8.2 End-to-end encryption option** — Opt-in private rooms: AES-GCM-256 captions/ambient labels with PBKDF2 room keys derived from a passphrase the server never sees; server STT/ambient refused in private rooms (clients fall back to on-device); locked tabs show placeholders with zero leakage. **Status: shipped + browser-verified; 11 crypto unit checks.**
- [x] **8.3 Observability** — Structured logs (`LOG_FORMAT=json` for ingestion), W3C-shaped trace ids per room, `GET /api/health` (capability flags, no secrets) and signaling `/healthz` (uptime, rooms, peers, queue depth) for uptime monitors; Docker healthcheck wired. Full OTel SDK deliberately deferred (trace correlation in place). **Status: shipped.**
- [x] **8.4 Compliance** — `GET /api/account` export + `DELETE /api/account` erasure (GDPR/CCPA); VRS logging consent toggle gating the session log; privacy posture documented (no content logging, RLS, E2EE option). HIPAA attestation explicitly out of scope — noted as aligned practices only. **Status: shipped.**
- [x] **8.5 Deployment** — Multi-stage `Dockerfile` (Next standalone + signaling) + `docker-compose.yml` (env passthrough, `/data` volume, healthcheck); TURN configurable via `NEXT_PUBLIC_TURN_*` (`lib/realtime/ice.ts`); same-origin reverse proxy recommended for `wss://`. **Status: shipped (compose not run in CI here).**

## Phase 9 — Mobile / PWA (Stretch)  ✅ COMPLETE (web-feasible slice)

- [x] **9.1 PWA manifest & installability** — `app/manifest.ts` (standalone, themed), generated PNG icons (`/icon`, `/apple-icon`), iOS web-app meta; hand-rolled `/sw.js` (shell precache, network-first navigations with `/offline` fallback, cache-first statics; production-only registration). **Status: shipped + 15 shape checks.**
- [x] **9.2 Native vibration patterns** — Web Vibration is Android-only with no iOS API to call: honest scope is (a) vibration where supported, (b) critical flashes upgraded to double-pulse for everyone, (c) settings states the iOS limitation plainly. Capacitor/native shell noted as the true fix. **Status: shipped (web-max).**
- [x] **9.3 Background audio capture** — Mobile browsers suspend capture with the screen off, so: `useWakeLock` keeps the screen alive during live captions and relay calls; MediaSession puts the active call on the lock screen; Web Push pipeline (VAPID, subscriptions table + API, SW push handler, self test endpoint) delivers critical alerts even hidden; detector notifies via SW when the tab is hidden. **Status: shipped; live-push needs a signed-in grant (manual QA).**

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
| Ambient sounds | ~~`setInterval` + `AMBIENT_SOUNDS`~~ | ✅ Phase 4 shipped — AudioSet classifier with local-sim fallback |
| Interpreter queue | ~~`INTERPRETER_QUEUE_STEPS` timers~~ | ✅ Phase 5 shipped — real queue, matching, video, session log |
| Custom phrases | ~~`localStorage`~~ | ✅ Phase 6.4 shipped — cloud CRUD with local cache |
| Settings | ~~`localStorage` `aura-settings`~~ | ✅ Phase 7 shipped — synced on sign-in, local otherwise |
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
