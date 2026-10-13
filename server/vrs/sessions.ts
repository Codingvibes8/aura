/**
 * VRS session records (Phase 5.4).
 *
 * Append-only JSONL log of relay sessions: who, when, duration, language.
 * No audio/video content is ever recorded — metadata only. The log path is
 * configurable (VRS_LOG_FILE) so tests can point it at a temp file.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface VrsSessionStart {
  sessionId: string;
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

export interface VrsSessionEnd extends VrsSessionStart {
  endedAt: number;
  durationS: number;
  endReason: "ended" | "cancelled" | "disconnected" | "declined";
}

type Listener = (session: VrsSessionEnd) => void;

export class VrsSessionLog {
  private file: string | null;
  private listeners = new Set<Listener>();

  constructor(file: string | null) {
    this.file = file;
    if (file) {
      try {
        mkdirSync(dirname(file), { recursive: true });
      } catch {
        /* best effort — logging must never break calls */
      }
    }
  }

  onEnd(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  recordEnd(session: VrsSessionEnd): void {
    if (this.file) {
      try {
        appendFileSync(this.file, `${JSON.stringify(session)}\n`, "utf8");
      } catch {
        /* best effort */
      }
    }
    this.listeners.forEach((l) => {
      try {
        l(session);
      } catch {
        /* listener must never break the server */
      }
    });
  }
}

export function resolveVrsLogFile(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.VRS_LOG === "off") return null;
  return env.VRS_LOG_FILE ?? "data/vrs-sessions.jsonl";
}
