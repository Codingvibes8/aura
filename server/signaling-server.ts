/**
 * Aura signaling server — Phase 1 real-time transport + Phase 2 server STT.
 *
 * A standalone WebSocket server that manages rooms, relays WebRTC signaling,
 * broadcasts caption / ambient events, and streams per-peer microphone audio
 * (binary frames) to a speech-to-text provider. STT transcripts are fanned
 * out to the room as `caption` messages with server-assigned sequence
 * numbers and diarized speaker labels.
 *
 * Run:  npm run dev:server   (node with native TS type-stripping)
 *
 * Env (.env.local supported): SIGNALING_PORT/HOST, STT_PROVIDER
 * (auto|deepgram|mock), DEEPGRAM_API_KEY, STT_MODEL, STT_LANGUAGE,
 * STT_KEYWORDS (comma-separated boosted terms).
 */

import { WebSocketServer, WebSocket } from "ws";
import { loadServerEnv } from "./env.ts";
import { DeepgramSttProvider } from "./stt/deepgram-provider.ts";
import { MockSttProvider } from "./stt/mock-provider.ts";
import type { SttProvider, SttSession } from "./stt/provider.ts";
import { HfAstClassifier } from "./ambient/hf-classifier.ts";
import { MockClassifier } from "./ambient/mock-classifier.ts";
import { DetectionMapper } from "./ambient/map.ts";
import type { AudioClassifier } from "./ambient/classifier.ts";
import { InterpreterQueue, estimateWaitSeconds, type QueueEntry } from "./vrs/queue.ts";
import { VrsSessionLog, resolveVrsLogFile } from "./vrs/sessions.ts";
import {
  parseClientMessage,
  toServerMessage,
  SERVER_ERRORS,
  type PeerInfo,
  type Role,
  type ServerMessage,
  type ClientMessage,
  type CaptionPayload,
  type AmbientPayload,
  type SttProviderName,
  type AmbientProviderName,
} from "../lib/realtime/schema.ts";

loadServerEnv();

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.SIGNALING_PORT ?? 3100);
const HOST = process.env.SIGNALING_HOST ?? "0.0.0.0";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_ROOM_SIZE = 8;
const MAX_MESSAGE_BYTES = 64 * 1024;
/** binary mic frames bypass the text rate-limiter but are still size-capped */
const MAX_BINARY_BYTES = 256 * 1024;

/* ------------------------------------------------------------------ */
/* STT provider selection (Phase 2)                                    */
/* ------------------------------------------------------------------ */

const STT_MODEL = process.env.STT_MODEL ?? "nova-3";
const STT_LANGUAGE = process.env.STT_LANGUAGE ?? "en";
const STT_KEYWORDS = (process.env.STT_KEYWORDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

const deepgram = new DeepgramSttProvider(process.env.DEEPGRAM_API_KEY, STT_MODEL);
const mock = new MockSttProvider();

const STT_WANT = (process.env.STT_PROVIDER ?? "auto").toLowerCase();
let stt: SttProvider | null = null;
if (STT_WANT === "mock") stt = mock;
else if (STT_WANT === "deepgram") stt = deepgram.available ? deepgram : null;
else stt = deepgram.available ? deepgram : mock; // "auto"

const sttProviderName: SttProviderName = stt ? stt.name : "none";

/* ------------------------------------------------------------------ */
/* Ambient classifier selection (Phase 4)                              */
/* ------------------------------------------------------------------ */

const AMBIENT_MODEL = process.env.AMBIENT_MODEL ?? "MIT/ast-finetuned-audioset-10-10-0.4593";
const AMBIENT_WINDOW_S = Number(process.env.AMBIENT_WINDOW_S ?? 4);
const AMBIENT_THRESHOLD = Number(process.env.AMBIENT_THRESHOLD ?? 0.3);
const AMBIENT_COOLDOWN_S = Number(process.env.AMBIENT_COOLDOWN_S ?? 20);
const AMBIENT_WINDOW_BYTES = Math.max(1, Math.floor(AMBIENT_WINDOW_S)) * 16000 * 2;

const hfClassifier = new HfAstClassifier(process.env.HF_TOKEN, AMBIENT_MODEL);
const mockClassifier = new MockClassifier();

const AMBIENT_WANT = (process.env.AMBIENT_PROVIDER ?? "auto").toLowerCase();
let ambient: AudioClassifier | null = null;
if (AMBIENT_WANT === "mock") ambient = mockClassifier;
else if (AMBIENT_WANT === "hf") ambient = hfClassifier.available ? hfClassifier : null;
else ambient = hfClassifier.available ? hfClassifier : mockClassifier; // "auto"

const ambientProviderName: AmbientProviderName = ambient ? ambient.name : "none";

/* ------------------------------------------------------------------ */
/* Interpreter relay (Phase 5)                                         */
/* ------------------------------------------------------------------ */

const VRS_DEMO_MODE = (process.env.VRS_DEMO_MODE ?? "true").toLowerCase() !== "false";
const VRS_DEMO_DELAY_S = Number(process.env.VRS_DEMO_DELAY_S ?? 8);

const vrsQueue = new InterpreterQueue();
const vrsLog = new VrsSessionLog(resolveVrsLogFile());

interface VrsCall {
  requestId: string;
  roomId: string;
  requesterId: string;
  requesterName: string;
  interpreterId: string;
  interpreterName: string;
  language: string;
  priority: "standard" | "emergency";
  demo: boolean;
  startedAt: number;
}

const vrsCalls = new Map<string, VrsCall>();
const vrsDemoTimers = new Map<string, ReturnType<typeof setTimeout>>();

function findPeerById(id: string): Peer | undefined {
  for (const room of rooms.values()) {
    const p = room.peers.get(id);
    if (p) return p;
  }
  return undefined;
}

function clearDemoTimer(requestId: string): void {
  const t = vrsDemoTimers.get(requestId);
  if (t) {
    clearTimeout(t);
    vrsDemoTimers.delete(requestId);
  }
}

function sendQueuePosition(entry: QueueEntry): void {
  const peer = findPeerById(entry.peerId);
  if (!peer) return;
  const position = vrsQueue.positionOf(entry.requestId);
  if (position < 0) return;
  sendTo(peer, {
    type: "interpreter-queue",
    requestId: entry.requestId,
    position: position + 1,
    ahead: position,
    etaSeconds: estimateWaitSeconds(position),
    priority: entry.priority,
  });
}

function broadcastQueuePositions(): void {
  for (const entry of vrsQueue.list()) {
    sendQueuePosition(entry);
  }
}

function startVrsCall(call: Omit<VrsCall, "startedAt">): void {
  const full: VrsCall = { ...call, startedAt: Date.now() };
  vrsCalls.set(call.requestId, full);
  clearDemoTimer(call.requestId);

  const requester = findPeerById(call.requesterId);
  if (requester) {
    requester.vrsRequestId = call.requestId;
    const interp = vrsQueue.getInterpreter(call.interpreterId);
    sendTo(requester, {
      type: "interpreter-match",
      match: {
        requestId: call.requestId,
        roomId: call.roomId,
        interpreterId: call.interpreterId,
        interpreterName: call.interpreterName,
        languages: interp ? interp.languages : [call.language],
        language: call.language,
        priority: call.priority,
        demo: call.demo,
      },
    });
  }

  if (!call.demo) {
    const interpPeer = findPeerById(call.interpreterId);
    if (interpPeer) {
      sendTo(interpPeer, {
        type: "interpreter-match-request",
        requestId: call.requestId,
        roomId: call.roomId,
        displayName: call.requesterName,
        language: call.language,
        priority: call.priority,
      });
    }
  }
  console.log(
    `[aura] VRS match ${call.requestId}: ${call.requesterName} ↔ ${call.interpreterName} (${call.language}${call.demo ? ", demo" : ""})`
  );
}

/** Match queued requests against available interpreters until none match. */
function tryMatchVrs(): void {
  for (;;) {
    const match = vrsQueue.matchNext();
    if (!match) break;
    startVrsCall({
      requestId: match.requestId,
      roomId: match.roomId,
      requesterId: match.peerId,
      requesterName: match.displayName,
      interpreterId: match.interpreterId,
      interpreterName: match.interpreterName,
      language: match.language,
      priority: match.priority,
      demo: false,
    });
  }
  broadcastQueuePositions();
}

function endVrsCall(
  requestId: string,
  reason: "ended" | "cancelled" | "disconnected" | "declined",
  rematch = true
): void {
  const call = vrsCalls.get(requestId);
  if (!call) return;
  vrsCalls.delete(requestId);
  clearDemoTimer(requestId);
  vrsQueue.releaseInterpreter(call.interpreterId);

  const requester = findPeerById(call.requesterId);
  if (requester) {
    if (requester.vrsRequestId === requestId) requester.vrsRequestId = null;
    sendTo(requester, { type: "interpreter-ended", requestId, reason });
  }
  if (!call.demo) {
    const interpPeer = findPeerById(call.interpreterId);
    if (interpPeer) {
      sendTo(interpPeer, { type: "interpreter-ended", requestId, reason });
    }
  }

  const now = Date.now();
  vrsLog.recordEnd({
    sessionId: requestId,
    requestId,
    roomId: call.roomId,
    requesterId: call.requesterId,
    requesterName: call.requesterName,
    interpreterId: call.interpreterId,
    interpreterName: call.interpreterName,
    language: call.language,
    priority: call.priority,
    demo: call.demo,
    startedAt: call.startedAt,
    endedAt: now,
    durationS: Math.max(0, Math.round((now - call.startedAt) / 1000)),
    endReason: reason,
  });
  console.log(`[aura] VRS call ${requestId} ended (${reason})`);

  if (rematch) tryMatchVrs();
}

/** Demo fallback: auto-match a virtual interpreter when none is live. */
function scheduleDemoFallback(requestId: string): void {
  if (!VRS_DEMO_MODE) return;
  clearDemoTimer(requestId);
  const t = setTimeout(() => {
    vrsDemoTimers.delete(requestId);
    const entry = vrsQueue.list().find((e) => e.requestId === requestId);
    if (!entry) return; // matched or cancelled meanwhile
    vrsQueue.cancel(entry.requestId, entry.peerId);
    startVrsCall({
      requestId: entry.requestId,
      roomId: entry.roomId,
      requesterId: entry.peerId,
      requesterName: entry.displayName,
      interpreterId: "demo-interpreter",
      interpreterName: "Demo Interpreter",
      language: entry.language,
      priority: entry.priority,
      demo: true,
    });
    broadcastQueuePositions();
  }, VRS_DEMO_DELAY_S * 1000);
  vrsDemoTimers.set(requestId, t);
}

function randomRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function handleVrsRequest(
  peer: Peer,
  msg: { roomId?: string; language: string; priority: "standard" | "emergency"; displayName?: string }
): void {
  const alreadyQueued = vrsQueue.list().some((e) => e.peerId === peer.id);
  if (alreadyQueued) {
    sendTo(peer, {
      type: "error",
      code: SERVER_ERRORS.VRS_ALREADY_QUEUED,
      message: "You already have an active interpreter request.",
    });
    return;
  }
  const inCall = [...vrsCalls.values()].some(
    (c) => c.requesterId === peer.id || c.interpreterId === peer.id
  );
  if (inCall) {
    sendTo(peer, {
      type: "error",
      code: SERVER_ERRORS.VRS_ALREADY_QUEUED,
      message: "You are already in a relay call.",
    });
    return;
  }

  // The interpreter joins the requester where they are; SOS from outside a
  // room auto-creates one.
  let roomId = peer.info.roomId ?? msg.roomId;
  if (!roomId) {
    roomId = `SOS-${randomRoomCode()}`;
  }
  if (!peer.info.roomId) {
    handleJoin(peer, roomId, msg.displayName ?? peer.info.displayName, peer.info.role);
    (peer.socket as ExtendedSocket).joined = true;
  } else {
    roomId = peer.info.roomId;
  }

  const entry = vrsQueue.enqueue({
    peerId: peer.id,
    roomId,
    displayName: msg.displayName ?? peer.info.displayName,
    language: msg.language,
    priority: msg.priority,
  });
  peer.vrsRequestId = entry.requestId;
  console.log(
    `[aura] VRS request ${entry.requestId} from ${entry.displayName} (${entry.language}, ${entry.priority})`
  );
  sendQueuePosition(entry);
  tryMatchVrs();
  if (vrsQueue.positionOf(entry.requestId) >= 0) {
    scheduleDemoFallback(entry.requestId);
  }
}

function handleVrsCancel(peer: Peer): void {
  const removed = vrsQueue.cancelForPeer(peer.id);
  if (removed) {
    clearDemoTimer(removed.requestId);
    if (peer.vrsRequestId === removed.requestId) peer.vrsRequestId = null;
    sendTo(peer, { type: "interpreter-ended", requestId: removed.requestId, reason: "cancelled" });
    broadcastQueuePositions();
    return;
  }
  const active = [...vrsCalls.values()].find((c) => c.requesterId === peer.id);
  if (active) {
    endVrsCall(active.requestId, "cancelled");
    return;
  }
  sendTo(peer, {
    type: "error",
    code: SERVER_ERRORS.VRS_NOT_QUEUED,
    message: "No active interpreter request to cancel.",
  });
}

function handleInterpreterStatus(peer: Peer, available: boolean, languages: string[]): void {
  const existing = vrsQueue.getInterpreter(peer.id);
  vrsQueue.setInterpreter({
    peerId: peer.id,
    displayName: peer.info.displayName,
    languages,
    available,
    busyWith: existing?.busyWith ?? null,
  });
  console.log(
    `[aura] Interpreter ${peer.info.displayName} ${available ? "available" : "unavailable"} [${languages.join(", ") || "—"}]`
  );
  tryMatchVrs();
}

function handleInterpreterDecline(peer: Peer, requestId: string): void {
  const call = vrsCalls.get(requestId);
  if (!call || call.interpreterId !== peer.id || call.demo) return;
  // end without rematching yet — the declined request requeues at front first
  endVrsCall(requestId, "declined", false);
  const re = vrsQueue.requeueFront({
    peerId: call.requesterId,
    roomId: call.roomId,
    displayName: call.requesterName,
    language: call.language,
    priority: call.priority,
  });
  const requester = findPeerById(call.requesterId);
  if (requester) requester.vrsRequestId = re.requestId;
  tryMatchVrs();
  if (vrsQueue.positionOf(re.requestId) >= 0) {
    scheduleDemoFallback(re.requestId);
  }
}

function handleInterpreterEnd(peer: Peer): void {
  const active = [...vrsCalls.values()].find(
    (c) => c.requesterId === peer.id || c.interpreterId === peer.id
  );
  if (!active) {
    sendTo(peer, {
      type: "error",
      code: SERVER_ERRORS.VRS_NOT_QUEUED,
      message: "No active relay call to end.",
    });
    return;
  }
  endVrsCall(active.requestId, "ended");
}

/** Queue/interpreter/call cleanup on leave + disconnect (logs sessions). */
function cleanupVrsPeer(peer: Peer): void {
  const removed = vrsQueue.cancelForPeer(peer.id);
  if (removed) {
    clearDemoTimer(removed.requestId);
    broadcastQueuePositions();
  }
  if (peer.vrsRequestId) peer.vrsRequestId = null;

  const presence = vrsQueue.getInterpreter(peer.id);
  if (presence) {
    vrsQueue.removeInterpreter(peer.id);
    if (presence.busyWith) {
      endVrsCall(presence.busyWith, "disconnected");
    }
  }
  for (const [reqId, call] of [...vrsCalls]) {
    if (call.requesterId === peer.id || call.interpreterId === peer.id) {
      endVrsCall(reqId, "disconnected");
    }
  }
}

/* ------------------------------------------------------------------ */
/* Room state                                                          */
/* ------------------------------------------------------------------ */

interface Peer {
  id: string;
  socket: WebSocket;
  /** PeerInfo plus the server-side room ref (not broadcast) */
  info: PeerInfo & { roomId?: string };
  isAlive: boolean;
  joinedAt: number;
  /** per-room monotonic caption sequence (assigned server-side) */
  captionSeq: number;
  /** per-peer monotonic utterance counter for grouping STT interim/final */
  utteranceSeq: number;
  /** active server-STT session, if any */
  stt: SttSession | null;
  /** active VRS request id (queued or in call), if any */
  vrsRequestId: string | null;
  /** active ambient classification session, if any */
  ambientSession: {
    chunks: Buffer[];
    bufferedBytes: number;
    classifying: boolean;
    stopped: boolean;
    mapper: DetectionMapper;
  } | null;
  /** simple token-bucket rate limiter */
  tokens: number;
  lastRefill: number;
}

interface Room {
  id: string;
  peers: Map<string, Peer>;
  createdAt: number;
  /** diarization map: `${peerId}:${engineSpeakerIdx}` → "Speaker A"… */
  speakerLabels: Map<string, string>;
  speakerCount: number;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, peers: new Map(), createdAt: Date.now(), speakerLabels: new Map(), speakerCount: 0 };
    rooms.set(roomId, room);
  }
  return room;
}

function broadcast(room: Room, msg: ServerMessage, exceptId?: string): void {
  const frame = toServerMessage(msg);
  for (const peer of room.peers.values()) {
    if (peer.id === exceptId) continue;
    if (peer.socket.readyState === WebSocket.OPEN) {
      peer.socket.send(frame);
    }
  }
}

function sendTo(peer: Peer, msg: ServerMessage): void {
  if (peer.socket.readyState === WebSocket.OPEN) {
    peer.socket.send(toServerMessage(msg));
  }
}

/** Normalize a ws binary frame (Buffer | ArrayBuffer | Buffer[]) to Buffer */
function toAudioBuffer(data: unknown): Buffer | null {
  try {
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (Array.isArray(data)) return Buffer.concat(data);
    return null;
  } catch {
    return null;
  }
}

function leaveRoom(peer: Peer, reason: "left" | "disconnected", cleanupVrs = true): void {
  stopStt(peer, false);
  stopAmbient(peer, false);
  if (cleanupVrs) cleanupVrsPeer(peer);
  const room = rooms.get(peer.info.roomId ?? "");
  if (!room) return;
  if (room.peers.get(peer.id) === peer) {
    room.peers.delete(peer.id);
    broadcast(room, { type: "peer-left", peerId: peer.id, reason });
    broadcast(room, {
      type: "room-state",
      roomId: room.id,
      peerCount: room.peers.size,
    });
  }
  if (room.peers.size === 0) {
    rooms.delete(room.id);
  }
  // clear room ref so stale sends no-op
  peer.info.roomId = undefined;
}

/** Stop a peer's ambient session; optionally notify the peer of the new state */
function stopAmbient(peer: Peer, notify: boolean): void {
  if (peer.ambientSession) {
    peer.ambientSession.stopped = true;
    peer.ambientSession = null;
  }
  if (notify) {
    sendTo(peer, { type: "ambient-status", status: "idle", provider: ambientProviderName });
  }
}

function startAmbient(peer: Peer): void {
  stopAmbient(peer, false);
  if (!ambient) {
    sendTo(peer, {
      type: "error",
      code: SERVER_ERRORS.AMBIENT_UNAVAILABLE,
      message: "Server ambient sound detection is not configured.",
    });
    sendTo(peer, { type: "ambient-status", status: "unavailable", provider: "none" });
    return;
  }

  const room = peer.info.roomId ? rooms.get(peer.info.roomId) : undefined;
  if (!room) return;

  peer.ambientSession = {
    chunks: [],
    bufferedBytes: 0,
    classifying: false,
    stopped: false,
    mapper: new DetectionMapper({ threshold: AMBIENT_THRESHOLD, cooldownMs: AMBIENT_COOLDOWN_S * 1000 }),
  };
  sendTo(peer, { type: "ambient-status", status: "active", provider: ambientProviderName });
  console.log(`[aura] Ambient detection started for ${peer.info.displayName} (${ambient.name})`);
}

async function pumpAmbient(peer: Peer): Promise<void> {
  const session = peer.ambientSession;
  const room = peer.info.roomId ? rooms.get(peer.info.roomId) : undefined;
  if (!session || session.stopped || !room || !ambient) return;
  if (session.classifying || session.bufferedBytes < AMBIENT_WINDOW_BYTES) return;

  session.classifying = true;
  const window = Buffer.concat(session.chunks);
  const clip = window.subarray(0, AMBIENT_WINDOW_BYTES);
  const rest = window.subarray(AMBIENT_WINDOW_BYTES);
  session.chunks = rest.length > 0 ? [rest] : [];
  session.bufferedBytes = rest.length;

  try {
    const predictions = await ambient.classify(clip);
    if (session.stopped) return;
    const detections = session.mapper.map(predictions);
    for (const d of detections) {
      const event: AmbientPayload = { label: d.label, priority: d.priority, intensity: d.intensity };
      // Ambient events describe the shared environment — the detecting
      // client renders them too, so broadcast inclusively.
      broadcast(room, { type: "ambient", fromId: peer.id, event });
      console.log(`[aura] Ambient [${d.priority}] ${d.label} (score ${d.score.toFixed(2)}) in room ${room.id}`);
    }
  } catch (e) {
    if (!session.stopped) {
      const message = e instanceof Error ? e.message : "Ambient classification failed";
      sendTo(peer, {
        type: "error",
        code: SERVER_ERRORS.AMBIENT_FAILED,
        message,
      });
      sendTo(peer, { type: "ambient-status", status: "error", provider: ambientProviderName, message });
      stopAmbient(peer, false);
      return;
    }
  } finally {
    if (peer.ambientSession === session) {
      session.classifying = false;
      // keep pumping while buffered audio remains
      if (session.bufferedBytes >= AMBIENT_WINDOW_BYTES && !session.stopped) {
        void pumpAmbient(peer);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Server STT sessions (Phase 2)                                       */
/* ------------------------------------------------------------------ */

function speakerLabelFor(room: Room, peerId: string, engineSpeaker: number): string {
  const key = `${peerId}:${engineSpeaker}`;
  let label = room.speakerLabels.get(key);
  if (!label) {
    const n = room.speakerCount++;
    label = n < 26 ? `Speaker ${String.fromCharCode(65 + n)}` : `Speaker ${n + 1}`;
    room.speakerLabels.set(key, label);
  }
  return label;
}

/** Stop a peer's STT session; optionally notify the peer of the new state */
function stopStt(peer: Peer, notify: boolean): void {
  if (!peer.stt) return;
  try {
    peer.stt.close();
  } catch {
    /* already torn down */
  }
  peer.stt = null;
  if (notify) {
    sendTo(peer, { type: "stt-status", status: "idle", provider: sttProviderName });
  }
}

function startStt(peer: Peer, lang: string | undefined, keywords: string[] | undefined): void {
  stopStt(peer, false);
  if (!stt) {
    sendTo(peer, {
      type: "error",
      code: SERVER_ERRORS.STT_UNAVAILABLE,
      message: "Server speech recognition is not configured.",
    });
    sendTo(peer, { type: "stt-status", status: "unavailable", provider: "none" });
    return;
  }

  const room = peer.info.roomId ? rooms.get(peer.info.roomId) : undefined;
  if (!room) return;

  const session = stt.openSession(
    {
      lang: lang || STT_LANGUAGE,
      keywords: keywords && keywords.length > 0 ? keywords : STT_KEYWORDS,
      model: STT_MODEL,
    },
    {
      onTranscript: (t) => {
        const engineSpeaker = t.words.find((w) => w.speaker !== undefined)?.speaker ?? 0;
        const label = speakerLabelFor(room, peer.id, engineSpeaker);
        const caption: CaptionPayload = {
          text: t.text,
          isFinal: t.isFinal,
          speaker: label,
          lang: lang || STT_LANGUAGE,
          seq: peer.captionSeq++,
          utteranceId: `${peer.id}:${peer.utteranceSeq}`,
        };
        if (t.speechFinal) peer.utteranceSeq++;
        // STT captions go to the whole room INCLUDING the speaker, so the
        // speaker's own transcript stays in sync with everyone else's.
        broadcast(room, { type: "caption", fromId: peer.id, caption });
      },
      onError: (message) => {
        if (peer.stt === session) peer.stt = null;
        sendTo(peer, {
          type: "error",
          code: SERVER_ERRORS.STT_FAILED,
          message,
        });
        sendTo(peer, { type: "stt-status", status: "error", provider: sttProviderName, message });
      },
      onClose: () => {
        if (peer.stt === session) {
          peer.stt = null;
          sendTo(peer, { type: "stt-status", status: "idle", provider: sttProviderName });
        }
      },
    }
  );

  peer.stt = session;
  sendTo(peer, { type: "stt-status", status: "active", provider: sttProviderName });
  console.log(`[aura] STT started for ${peer.info.displayName} (${stt.name}, lang=${lang || STT_LANGUAGE})`);
}

/** Move a peer between rooms (interpreters hopping to calls). A call only
 *  ends when the peer leaves THAT call's room — hopping from a lobby into
 *  the call room preserves it. Queued requests are room-bound and drop. */
function switchRoom(peer: Peer, roomId: string, displayName: string, role: Role): void {
  const fromRoom = peer.info.roomId;
  for (const [reqId, call] of [...vrsCalls]) {
    if (call.requesterId === peer.id || call.interpreterId === peer.id) {
      if (fromRoom === call.roomId && roomId !== call.roomId) {
        endVrsCall(reqId, "disconnected");
      }
    }
  }
  const queued = vrsQueue.cancelForPeer(peer.id);
  if (queued) {
    clearDemoTimer(queued.requestId);
    broadcastQueuePositions();
  }
  if (peer.vrsRequestId) peer.vrsRequestId = null;
  if (peer.info.roomId) {
    leaveRoom(peer, "left", false);
  }
  handleJoin(peer, roomId, displayName, role);
}

/* ------------------------------------------------------------------ */
/* Message handlers (server-joined peers only)                         */
/* ------------------------------------------------------------------ */

const RATE_LIMIT_CAP = 30; // messages
const RATE_LIMIT_REFILL_MS = 1_000; // per second

function rateLimitExceeded(peer: Peer): boolean {
  const now = Date.now();
  const elapsed = now - peer.lastRefill;
  peer.tokens = Math.min(RATE_LIMIT_CAP, peer.tokens + (elapsed / RATE_LIMIT_REFILL_MS) * RATE_LIMIT_CAP);
  peer.lastRefill = now;
  if (peer.tokens < 1) return true;
  peer.tokens -= 1;
  return false;
}

function handleMessage(peer: Peer, msg: ClientMessage): void {
  if (!peer.info.roomId) return;
  const room = rooms.get(peer.info.roomId);
  if (!room) return;

  switch (msg.type) {
    case "leave": {
      leaveRoom(peer, "left");
      (peer.socket as ExtendedSocket).joined = false;
      return;
    }

    case "signal": {
      const target = room.peers.get(msg.targetId);
      if (!target) {
        sendTo(peer, {
          type: "error",
          code: SERVER_ERRORS.UNKNOWN_PEER,
          message: `No peer '${msg.targetId}' in this room.`,
        });
        return;
      }
      sendTo(target, { type: "signal", fromId: peer.id, data: msg.data });
      return;
    }

    case "caption": {
      const caption: CaptionPayload = { ...msg, seq: peer.captionSeq++ };
      broadcast(room, { type: "caption", fromId: peer.id, caption }, peer.id);
      return;
    }

    case "ambient": {
      const event: AmbientPayload = msg;
      broadcast(room, { type: "ambient", fromId: peer.id, event }, peer.id);
      return;
    }

    case "stt-start": {
      startStt(peer, msg.lang, msg.keywords);
      return;
    }

    case "stt-stop": {
      stopStt(peer, true);
      return;
    }

    case "ambient-start": {
      startAmbient(peer);
      return;
    }

    case "ambient-stop": {
      stopAmbient(peer, true);
      return;
    }

    case "interpreter-request": {
      handleVrsRequest(peer, msg);
      return;
    }

    case "interpreter-cancel": {
      handleVrsCancel(peer);
      return;
    }

    case "interpreter-status": {
      handleInterpreterStatus(peer, msg.available, msg.languages);
      return;
    }

    case "interpreter-decline": {
      handleInterpreterDecline(peer, msg.requestId);
      return;
    }

    case "interpreter-end": {
      handleInterpreterEnd(peer);
      return;
    }

    case "ping": {
      sendTo(peer, { type: "pong" });
      return;
    }

    default: {
      sendTo(peer, {
        type: "error",
        code: SERVER_ERRORS.BAD_MESSAGE,
        message: "Unrecognized message type.",
      });
    }
  }
}

function handleJoin(peer: Peer, roomId: string, displayName: string, role: Role): void {
  const room = getOrCreateRoom(roomId);

  if (room.peers.size >= MAX_ROOM_SIZE) {
    sendTo(peer, {
      type: "error",
      code: SERVER_ERRORS.RATE_LIMITED,
      message: `Room '${roomId}' is full (max ${MAX_ROOM_SIZE}).`,
    });
    peer.socket.close(1130, "room full");
    return;
  }

  const info: PeerInfo = {
    id: peer.id,
    displayName,
    role,
    joinedAt: Date.now(),
  };
  peer.info = info;
  peer.info.roomId = roomId;
  peer.captionSeq = 0;
  peer.tokens = RATE_LIMIT_CAP;
  peer.lastRefill = Date.now();

  room.peers.set(peer.id, peer);

  const peers = [...room.peers.values()].map((p) => p.info);
  sendTo(peer, { type: "welcome", clientId: peer.id, roomId, peers, sttProvider: sttProviderName, ambientProvider: ambientProviderName });
  broadcast(room, { type: "peer-joined", peer: info }, peer.id);
  broadcast(room, { type: "room-state", roomId, peerCount: room.peers.size }, peer.id);

  console.log(`[aura] ${displayName} (${role}) joined room ${roomId} — ${room.peers.size} peer(s)`);
}

/* ------------------------------------------------------------------ */
/* Connection lifecycle                                                */
/* ------------------------------------------------------------------ */

interface ExtendedSocket extends WebSocket {
  isAlive: boolean;
  auraPeer?: Peer;
  joined: boolean;
}

function nextClientId(): string {
  return crypto.randomUUID();
}

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: MAX_MESSAGE_BYTES,
});

wss.on("connection", (socket: ExtendedSocket) => {
  socket.isAlive = true;
  socket.joined = false;

  const clientId = nextClientId();
  const peer: Peer = {
    id: clientId,
    socket,
    info: {
      id: clientId,
      displayName: "Anonymous",
      role: "hearing",
      joinedAt: Date.now(),
    },
    isAlive: true,
    joinedAt: Date.now(),
    captionSeq: 0,
    utteranceSeq: 0,
    stt: null,
    ambientSession: null,
    vrsRequestId: null,
    tokens: RATE_LIMIT_CAP,
    lastRefill: Date.now(),
  };
  peer.info.roomId = undefined;
  socket.auraPeer = peer;

  // Advertise STT + ambient capability immediately so clients can pick an
  // engine before joining a room.
  sendTo(peer, {
    type: "stt-status",
    status: stt ? "idle" : "unavailable",
    provider: sttProviderName,
  });
  sendTo(peer, {
    type: "ambient-status",
    status: ambient ? "idle" : "unavailable",
    provider: ambientProviderName,
  });

  socket.on("pong", () => {
    socket.isAlive = true;
    peer.isAlive = true;
  });

  socket.on("message", (data, isBinary) => {
    // Binary frames carry raw PCM16 mono 16kHz microphone audio. The first
    // byte selects the stream: 0x01 = STT session, 0x02 = ambient session.
    // They bypass the text rate-limiter (a mic stream would trip it
    // instantly) but are still size-capped.
    if (isBinary) {
      const buf = toAudioBuffer(data);
      if (!buf || buf.length < 2 || buf.length > MAX_BINARY_BYTES) return;
      peer.isAlive = true;
      const stream = buf[0];
      const pcm = buf.subarray(1);
      try {
        if (stream === 0x01) {
          peer.stt?.sendAudio(pcm);
        } else if (stream === 0x02) {
          const session = peer.ambientSession;
          if (session && !session.stopped) {
            session.chunks.push(pcm);
            session.bufferedBytes += pcm.length;
            void pumpAmbient(peer);
          }
        }
        // unknown stream ids are ignored (forward-compatible)
      } catch {
        /* session dying — its close handler reports it */
      }
      return;
    }

    let text: string;
    try {
      text = data.toString();
    } catch {
      return;
    }
    if (text.length > MAX_MESSAGE_BYTES) return;

    const msg = parseClientMessage(text);
    if (!msg) {
      sendTo(peer, {
        type: "error",
        code: SERVER_ERRORS.BAD_MESSAGE,
        message: "Malformed or unknown message.",
      });
      return;
    }

    peer.isAlive = true;

    if (msg.type === "join") {
      if (socket.joined && peer.info.roomId) {
        switchRoom(peer, msg.roomId, msg.displayName, msg.role);
      } else {
        socket.joined = true;
        handleJoin(peer, msg.roomId, msg.displayName, msg.role);
      }
      return;
    }

    if (!socket.joined || !peer.info.roomId) {
      sendTo(peer, {
        type: "error",
        code: SERVER_ERRORS.NOT_JOINED,
        message: "Send a 'join' message before any other type.",
      });
      return;
    }

    if (msg.type === "ping") {
      sendTo(peer, { type: "pong" });
      return;
    }

    if (rateLimitExceeded(peer)) {
      sendTo(peer, {
        type: "error",
        code: SERVER_ERRORS.RATE_LIMITED,
        message: "Rate limit exceeded — slow down.",
      });
      return;
    }

    handleMessage(peer, msg);
  });

  socket.on("close", () => {
    stopStt(peer, false);
    stopAmbient(peer, false);
    if (socket.auraPeer?.info.roomId) {
      leaveRoom(socket.auraPeer, "disconnected");
    }
  });

  socket.on("error", () => {
    stopStt(peer, false);
    stopAmbient(peer, false);
    if (socket.auraPeer?.info.roomId) {
      leaveRoom(socket.auraPeer, "disconnected");
    }
  });
});

/* ------------------------------------------------------------------ */
/* Heartbeat — terminate silent sockets                                */
/* ------------------------------------------------------------------ */

const heartbeat = setInterval(() => {
  for (const socket of wss.clients) {
    const ext = socket as ExtendedSocket;
    if (!ext.isAlive) {
      if (ext.auraPeer?.info.roomId) leaveRoom(ext.auraPeer, "disconnected");
      return socket.terminate();
    }
    ext.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

/* ------------------------------------------------------------------ */
/* Boot + graceful shutdown                                            */
/* ------------------------------------------------------------------ */

wss.on("close", () => clearInterval(heartbeat));

console.log(`[aura] Signaling server listening on ws://${HOST}:${PORT}`);
console.log(`[aura] Heartbeat ${HEARTBEAT_INTERVAL_MS / 1000}s, timeout ${HEARTBEAT_TIMEOUT_MS / 1000}s, max room ${MAX_ROOM_SIZE}`);
console.log(
  `[aura] STT provider: ${sttProviderName}${sttProviderName === "deepgram" ? ` (model=${STT_MODEL}, lang=${STT_LANGUAGE})` : ""}`
);
console.log(
  `[aura] Ambient provider: ${ambientProviderName}${ambientProviderName === "hf" ? ` (model=${AMBIENT_MODEL}, window=${AMBIENT_WINDOW_S}s)` : ""}`
);
console.log(
  `[aura] VRS relay: demo=${VRS_DEMO_MODE ? `on (${VRS_DEMO_DELAY_S}s)` : "off"}, log=${resolveVrsLogFile() ?? "disabled"}`
);

process.on("SIGINT", () => {
  console.log("\n[aura] Shutting down…");
  clearInterval(heartbeat);
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
});

process.on("SIGTERM", () => {
  clearInterval(heartbeat);
  wss.close(() => process.exit(0));
});
