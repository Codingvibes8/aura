/**
 * Aura real-time data-channel schema.
 *
 * The single source of truth for every message that flows through the
 * signaling server. The server (server/signaling-server.ts) validates
 * inbound messages with the zod schemas; clients use the TypeScript types.
 *
 * Wire format: JSON text frames over WebSocket.
 * Envelope: { type: <discriminator>, ...payload, t?: number (client send time) }
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Roles & peers                                                       */
/* ------------------------------------------------------------------ */

export const ROLES = ["dhh", "hearing", "interpreter"] as const;
export type Role = (typeof ROLES)[number];

export interface PeerInfo {
  id: string;
  displayName: string;
  role: Role;
  joinedAt: number;
}

/* ------------------------------------------------------------------ */
/* Caption payload (Phase 2 will fill this from the STT service)       */
/* ------------------------------------------------------------------ */

export interface CaptionPayload {
  text: string;
  isFinal: boolean;
  /** diarization label — "Speaker A", "Speaker B", … (or "You") */
  speaker: string;
  lang?: string;
  /** sequence number per room for ordering / gap detection */
  seq: number;
  /**
   * Groups interim updates with their final (Phase 2 server STT).
   * Interim messages sharing an utteranceId replace each other client-side.
   */
  utteranceId?: string;
}

/* ------------------------------------------------------------------ */
/* Ambient sound event (Phase 4 will fill this from the classifier)    */
/* ------------------------------------------------------------------ */

export type AmbientPriority = "info" | "warning" | "critical";

export interface AmbientPayload {
  label: string;
  priority: AmbientPriority;
  /** 0..1 loudness, drives the visualizer on receiving clients */
  intensity: number;
}

/* ------------------------------------------------------------------ */
/* Client → Server messages                                            */
/* ------------------------------------------------------------------ */

export const JoinMessage = z.object({
  type: z.literal("join"),
  roomId: z.string().min(1).max(64),
  displayName: z.string().min(1).max(40),
  role: z.enum(ROLES),
  /** auth token — verified once Phase 6 lands; accepted-but-ignored now */
  token: z.string().optional(),
});

export const SignalMessage = z.object({
  type: z.literal("signal"),
  /** target peer id; server relays only within the same room */
  targetId: z.string().min(1),
  /** WebRTC SDP offer/answer or ICE candidate */
  data: z.unknown(),
});

export const CaptionMessage = z.object({
  type: z.literal("caption"),
  text: z.string().max(4000),
  isFinal: z.boolean(),
  speaker: z.string().max(40),
  lang: z.string().max(10).optional(),
  seq: z.number().int().nonnegative(),
});

export const AmbientMessage = z.object({
  type: z.literal("ambient"),
  label: z.string().max(80),
  priority: z.enum(["info", "warning", "critical"]),
  intensity: z.number().min(0).max(1),
});

export const PingMessage = z.object({ type: z.literal("ping") });
export const LeaveMessage = z.object({ type: z.literal("leave") });

/** Begin server-side streaming STT for this peer (Phase 2) */
export const SttStartMessage = z.object({
  type: z.literal("stt-start"),
  /** BCP-47 tag, e.g. "en". Defaults to server STT_LANGUAGE. */
  lang: z.string().max(10).optional(),
  /** boosted vocabulary terms (max 10 forwarded to the engine) */
  keywords: z.array(z.string().max(40)).max(20).optional(),
});

/** End server-side streaming STT for this peer */
export const SttStopMessage = z.object({ type: z.literal("stt-stop") });

export const ClientMessage = z.discriminatedUnion("type", [
  JoinMessage,
  SignalMessage,
  CaptionMessage,
  AmbientMessage,
  SttStartMessage,
  SttStopMessage,
  PingMessage,
  LeaveMessage,
]);

export type ClientMessage = z.infer<typeof ClientMessage>;

/* ------------------------------------------------------------------ */
/* Server → Client messages                                             */
/* ------------------------------------------------------------------ */

export type SttProviderName = "deepgram" | "mock" | "none";
export type SttStatus = "active" | "idle" | "error" | "unavailable";

export type ServerMessage =
  | { type: "welcome"; clientId: string; roomId: string; peers: PeerInfo[]; sttProvider: SttProviderName }
  | { type: "peer-joined"; peer: PeerInfo }
  | { type: "peer-left"; peerId: string; reason: "left" | "disconnected" }
  | { type: "signal"; fromId: string; data: unknown }
  | { type: "caption"; fromId: string; caption: CaptionPayload }
  | { type: "ambient"; fromId: string; event: AmbientPayload }
  | { type: "room-state"; roomId: string; peerCount: number }
  | { type: "stt-status"; status: SttStatus; provider: SttProviderName; message?: string }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export const SERVER_ERRORS = {
  NOT_JOINED: "NOT_JOINED",
  BAD_MESSAGE: "BAD_MESSAGE",
  UNKNOWN_PEER: "UNKNOWN_PEER",
  NOT_IN_ROOM: "NOT_IN_ROOM",
  RATE_LIMITED: "RATE_LIMITED",
  STT_UNAVAILABLE: "STT_UNAVAILABLE",
  STT_FAILED: "STT_FAILED",
} as const;
export type ServerErrorCode = (typeof SERVER_ERRORS)[keyof typeof SERVER_ERRORS];

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return ClientMessage.parse(parsed);
  } catch {
    return null;
  }
}

export function toServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
