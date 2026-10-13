/**
 * Interpreter queue + matching (Phase 5.1 / 5.2).
 *
 * Pure logic, no sockets: the signaling server drives it with peer ids and
 * ships the resulting notifications. Emergency requests sort ahead of
 * standard ones; interpreters match by overlapping language.
 */

export type VrsPriority = "standard" | "emergency";

export interface QueueEntry {
  requestId: string;
  peerId: string;
  roomId: string;
  displayName: string;
  language: string;
  priority: VrsPriority;
  /** Phase 8.4: false skips session logging */
  logConsent: boolean;
  enqueuedAt: number;
}

export interface InterpreterPresence {
  peerId: string;
  displayName: string;
  languages: string[];
  available: boolean;
  /** requestId currently being served, if any */
  busyWith: string | null;
}

export interface Match {
  requestId: string;
  peerId: string;
  roomId: string;
  displayName: string;
  language: string;
  priority: VrsPriority;
  logConsent: boolean;
  interpreterId: string;
  interpreterName: string;
  demo: boolean;
}

export function normalizeLanguage(lang: string): string {
  return lang.trim().toLowerCase();
}

export function languagesOverlap(a: string[], b: string): boolean {
  const want = normalizeLanguage(b);
  return a.some((l) => {
    const have = normalizeLanguage(l);
    return have === want || have === "any" || want === "any";
  });
}

function compareEntries(a: QueueEntry, b: QueueEntry): number {
  if (a.priority !== b.priority) {
    return a.priority === "emergency" ? -1 : 1;
  }
  return a.enqueuedAt - b.enqueuedAt;
}

export class InterpreterQueue {
  private entries: QueueEntry[] = [];
  private interpreters = new Map<string, InterpreterPresence>();
  private seq = 0;

  /** snapshot ordered front → back */
  list(): QueueEntry[] {
    return [...this.entries].sort(compareEntries);
  }

  enqueue(e: Omit<QueueEntry, "requestId" | "enqueuedAt">): QueueEntry {
    this.seq++;
    const entry: QueueEntry = {
      ...e,
      language: normalizeLanguage(e.language),
      requestId: `vr-${Date.now().toString(36)}-${this.seq}`,
      enqueuedAt: Date.now(),
    };
    // one active request per peer — replace any stale entry
    this.entries = this.entries.filter((x) => x.peerId !== e.peerId);
    this.entries.push(entry);
    return entry;
  }

  cancel(requestId: string, peerId: string): QueueEntry | null {
    const idx = this.entries.findIndex((x) => x.requestId === requestId && x.peerId === peerId);
    if (idx < 0) return null;
    const [removed] = this.entries.splice(idx, 1);
    return removed;
  }

  cancelForPeer(peerId: string): QueueEntry | null {
    const idx = this.entries.findIndex((x) => x.peerId === peerId);
    if (idx < 0) return null;
    const [removed] = this.entries.splice(idx, 1);
    return removed;
  }

  /** 0-based position in the ordered queue, -1 when not queued */
  positionOf(requestId: string): number {
    return this.list().findIndex((x) => x.requestId === requestId);
  }

  setInterpreter(p: InterpreterPresence): void {
    this.interpreters.set(p.peerId, {
      ...p,
      languages: p.languages.map(normalizeLanguage),
    });
  }

  removeInterpreter(peerId: string): InterpreterPresence | undefined {
    const p = this.interpreters.get(peerId);
    this.interpreters.delete(peerId);
    return p;
  }

  getInterpreter(peerId: string): InterpreterPresence | undefined {
    return this.interpreters.get(peerId);
  }

  interpretersList(): InterpreterPresence[] {
    return [...this.interpreters.values()];
  }

  /**
   * Match the highest-priority entry against available interpreters.
   * Returns the match (entry removed, interpreter marked busy) or null.
   */
  matchNext(): Match | null {
    for (const entry of this.list()) {
      const interp = [...this.interpreters.values()]
        .filter((i) => i.available && !i.busyWith)
        .find((i) => languagesOverlap(i.languages, entry.language));
      if (!interp) continue;
      this.entries = this.entries.filter((x) => x.requestId !== entry.requestId);
      interp.busyWith = entry.requestId;
      return {
        requestId: entry.requestId,
        peerId: entry.peerId,
        roomId: entry.roomId,
        displayName: entry.displayName,
        language: entry.language,
        priority: entry.priority,
        logConsent: entry.logConsent,
        interpreterId: interp.peerId,
        interpreterName: interp.displayName,
        demo: false,
      };
    }
    return null;
  }

  /** free an interpreter (call ended / declined / disconnect) */
  releaseInterpreter(peerId: string): void {
    const interp = this.interpreters.get(peerId);
    if (interp) interp.busyWith = null;
  }

  /** requeue a request at the front (e.g. interpreter declined) */
  requeueFront(entry: Omit<QueueEntry, "requestId" | "enqueuedAt">): QueueEntry {
    const re = this.enqueue(entry);
    // enqueue appends — move to front preserving emergency ordering fairly:
    // give it the oldest timestamp so it sorts first within its priority
    re.enqueuedAt = 0;
    return re;
  }
}

/** Rough ETA heuristic: 15s base + 30s per entry ahead. */
export function estimateWaitSeconds(ahead: number): number {
  return 15 + ahead * 30;
}
