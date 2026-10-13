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

function leaveRoom(peer: Peer, reason: "left" | "disconnected"): void {
  stopStt(peer, false);
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
  sendTo(peer, { type: "welcome", clientId: peer.id, roomId, peers, sttProvider: sttProviderName });
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
    tokens: RATE_LIMIT_CAP,
    lastRefill: Date.now(),
  };
  peer.info.roomId = undefined;
  socket.auraPeer = peer;

  // Advertise STT capability immediately so clients can pick an engine
  // before joining a room.
  sendTo(peer, {
    type: "stt-status",
    status: stt ? "idle" : "unavailable",
    provider: sttProviderName,
  });

  socket.on("pong", () => {
    socket.isAlive = true;
    peer.isAlive = true;
  });

  socket.on("message", (data, isBinary) => {
    // Binary frames carry raw PCM16 mono 16kHz microphone audio for the
    // sender's STT session. They bypass the text rate-limiter (a mic
    // stream would trip it instantly) but are still size-capped.
    if (isBinary) {
      const buf = toAudioBuffer(data);
      if (!buf || buf.length > MAX_BINARY_BYTES) return;
      peer.isAlive = true;
      try {
        peer.stt?.sendAudio(buf);
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
      if (socket.joined) return; // already in a room — must leave first
      socket.joined = true;
      handleJoin(peer, msg.roomId, msg.displayName, msg.role);
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
    if (socket.auraPeer?.info.roomId) {
      leaveRoom(socket.auraPeer, "disconnected");
    }
  });

  socket.on("error", () => {
    stopStt(peer, false);
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
