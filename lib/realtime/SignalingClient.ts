/**
 * Reconnecting WebSocket client for the Aura signaling server.
 *
 * - Exponential backoff (1s → 15s cap) with jitter
 * - Auto-rejoin of the last room after a successful reconnect
 * - Typed send helpers matching lib/realtime/schema.ts
 */

import type {
  ClientMessage,
  ServerMessage,
  CaptionPayload,
  AmbientPayload,
  Role,
} from "./schema";

export type ConnectionState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export interface SignalingClientOptions {
  url: string;
  onMessage: (msg: ServerMessage) => void;
  onStateChange?: (state: ConnectionState) => void;
  maxBackoffMs?: number;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onMessage: (msg: ServerMessage) => void;
  private onStateChange?: (state: ConnectionState) => void;
  private maxBackoffMs: number;

  private state: ConnectionState = "closed";
  private backoffMs = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  /** Room to re-join after every successful reconnect */
  private pendingJoin: { roomId: string; displayName: string; role: Role } | null = null;
  private joinedRoom: { roomId: string; displayName: string; role: Role } | null = null;

  constructor(opts: SignalingClientOptions) {
    this.url = opts.url;
    this.onMessage = opts.onMessage;
    this.onStateChange = opts.onStateChange;
    this.maxBackoffMs = opts.maxBackoffMs ?? 15_000;
  }

  /* ---------------- lifecycle ---------------- */

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.clearReconnect();
    this.manualClose = false;
    this.setState(this.joinedRoom ? "reconnecting" : "connecting");

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.backoffMs = 1000;
      this.setState("open");
      // Re-join the room we were in before the drop
      if (this.joinedRoom) {
        this.sendRaw({
          type: "join",
          roomId: this.joinedRoom.roomId,
          displayName: this.joinedRoom.displayName,
          role: this.joinedRoom.role,
        });
      }
    };

    this.ws.onmessage = (event: MessageEvent<string>) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      this.onMessage(msg);
    };

    this.ws.onclose = () => {
      this.setState("closed");
      if (!this.manualClose) this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearReconnect();
    if (this.ws) {
      if (this.joinedRoom) this.sendRaw({ type: "leave" });
      this.ws.close();
      this.ws = null;
    }
    this.joinedRoom = null;
    this.setState("closed");
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  /* ---------------- room ---------------- */

  join(roomId: string, displayName: string, role: Role): void {
    this.pendingJoin = { roomId, displayName, role };
    this.joinedRoom = { roomId, displayName, role };
    this.sendRaw({ type: "join", roomId, displayName, role });
  }

  leave(): void {
    if (this.joinedRoom) this.sendRaw({ type: "leave" });
    this.joinedRoom = null;
    this.pendingJoin = null;
  }

  /* ---------------- typed sends ---------------- */

  sendSignal(targetId: string, data: unknown): void {
    this.sendRaw({ type: "signal", targetId, data });
  }

  sendCaption(caption: Omit<CaptionPayload, "seq">): void {
    // seq is assigned server-side; 0 here is a placeholder
    this.sendRaw({ type: "caption", ...caption, seq: 0 });
  }

  sendAmbient(event: AmbientPayload): void {
    this.sendRaw({ type: "ambient", ...event });
  }

  sendPing(): void {
    this.sendRaw({ type: "ping" });
  }

  /** mic audio chunk (PCM16 mono 16kHz) for the sender's STT session */
  sendAudio(pcm: ArrayBuffer | Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
    }
  }

  startStt(opts?: { lang?: string; keywords?: string[] }): void {
    this.sendRaw({ type: "stt-start", lang: opts?.lang, keywords: opts?.keywords });
  }

  stopStt(): void {
    this.sendRaw({ type: "stt-stop" });
  }

  /* ---------------- internals ---------------- */

  private sendRaw(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    this.clearReconnect();
    this.setState("reconnecting");
    const jitter = Math.random() * 500;
    this.reconnectTimer = setTimeout(() => this.connect(), this.backoffMs + jitter);
    this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs * 2);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange?.(state);
  }
}

/* ------------------------------------------------------------------ */
/* Default URL resolution                                              */
/* ------------------------------------------------------------------ */

export function resolveSignalingUrl(): string {
  if (typeof window === "undefined") return "";
  const fromEnv = process.env.NEXT_PUBLIC_SIGNALING_URL;
  if (fromEnv) return fromEnv;
  if (window.location.protocol === "https:") {
    return `wss://${window.location.host}`;
  }
  // dev fallback — the signaling server runs on :3100 alongside Next (:3000/:3001)
  return `ws://${window.location.hostname}:3100`;
}
