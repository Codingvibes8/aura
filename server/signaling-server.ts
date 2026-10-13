/**
 * Aura signaling server — Phase 1 real-time transport.
 *
 * A standalone WebSocket server that manages rooms, relays WebRTC signaling,
 * and broadcasts caption / ambient events between peers.
 *
 * Run:  npm run dev:server   (node with native TS type-stripping)
 *
 * The Next.js app never holds WS connections directly; this process is the
 * single source of truth for live sessions. Phase 2 attaches the STT stream
 * to this same channel, Phase 5 attaches the interpreter queue.
 */

import { WebSocketServer, WebSocket } from "ws";
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
} from "../lib/realtime/schema.ts";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.SIGNALING_PORT ?? 3100);
const HOST = process.env.SIGNALING_HOST ?? "0.0.0.0";
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
const MAX_ROOM_SIZE = 8;
const MAX_MESSAGE_BYTES = 64 * 1024;

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
  /** simple token-bucket rate limiter */
  tokens: number;
  lastRefill: number;
}

interface Room {
  id: string;
  peers: Map<string, Peer>;
  createdAt: number;
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { id: roomId, peers: new Map(), createdAt: Date.now() };
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

function leaveRoom(peer: Peer, reason: "left" | "disconnected"): void {
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
  sendTo(peer, { type: "welcome", clientId: peer.id, roomId, peers });
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
    tokens: RATE_LIMIT_CAP,
    lastRefill: Date.now(),
  };
  peer.info.roomId = undefined;
  socket.auraPeer = peer;

  socket.on("pong", () => {
    socket.isAlive = true;
    peer.isAlive = true;
  });

  socket.on("message", (data) => {
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
    if (socket.auraPeer?.info.roomId) {
      leaveRoom(socket.auraPeer, "disconnected");
    }
  });

  socket.on("error", () => {
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
