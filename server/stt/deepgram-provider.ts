/**
 * Deepgram streaming STT provider (Phase 2.1).
 *
 * Opens one `wss://api.deepgram.com/v1/listen` connection per peer session,
 * streams PCM16 mono 16kHz audio, and surfaces interim + final transcripts
 * with diarized speaker indices (Phase 2.2).
 *
 * Query surface used: model, language (2.3), encoding, sample_rate,
 * channels, interim_results, endpointing, smart_format, punctuate,
 * diarize, utterance_end_ms, vad_events, keywords (2.4).
 */

import WebSocket from "ws";
import type {
  SttProvider,
  SttSession,
  SttSessionCallbacks,
  SttSessionOptions,
} from "./provider.ts";

const DEEPGRAM_URL = "wss://api.deepgram.com/v1/listen";
const OPEN_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 3_000;
const KEEPALIVE_IDLE_MS = 5_000;
const MAX_KEYWORDS = 10;

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  speaker?: number;
  start?: number;
  end?: number;
  confidence?: number;
}

interface DeepgramResult {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: {
      transcript?: string;
      confidence?: number;
      words?: DeepgramWord[];
    }[];
  };
  description?: string;
}

export class DeepgramSttProvider implements SttProvider {
  readonly name = "deepgram" as const;
  readonly available: boolean;
  readonly unavailableReason?: string;
  private apiKey: string;
  private defaultModel: string;

  constructor(apiKey: string | undefined, defaultModel: string) {
    this.apiKey = apiKey ?? "";
    this.defaultModel = defaultModel;
    this.available = this.apiKey.length > 0;
    if (!this.available) {
      this.unavailableReason = "DEEPGRAM_API_KEY is not set";
    }
  }

  openSession(opts: SttSessionOptions, cb: SttSessionCallbacks): SttSession {
    const params = new URLSearchParams({
      model: opts.model || this.defaultModel,
      language: opts.lang || "en",
      encoding: "linear16",
      sample_rate: "16000",
      channels: "1",
      interim_results: "true",
      endpointing: "300",
      smart_format: "true",
      punctuate: "true",
      diarize: "true",
      utterance_end_ms: "1000",
      vad_events: "true",
    });
    for (const kw of opts.keywords.slice(0, MAX_KEYWORDS)) {
      params.append("keywords", `${kw}:2`);
    }

    const ws = new WebSocket(`${DEEPGRAM_URL}?${params.toString()}`, {
      headers: { Authorization: `Token ${this.apiKey}` },
    });

    let closed = false;
    let opened = false;
    let lastAudioAt = Date.now();

    const openTimer = setTimeout(() => {
      if (!opened && !closed) {
        closed = true;
        try {
          ws.close();
        } catch {
          /* already closing */
        }
        cb.onError("Timed out connecting to Deepgram");
      }
    }, OPEN_TIMEOUT_MS);

    const keepalive = setInterval(() => {
      if (closed || !opened) return;
      if (Date.now() - lastAudioAt > KEEPALIVE_IDLE_MS) {
        try {
          ws.send(JSON.stringify({ type: "KeepAlive" }));
        } catch {
          /* socket dying — close handler reports it */
        }
      }
    }, KEEPALIVE_INTERVAL_MS);

    const teardown = () => {
      clearTimeout(openTimer);
      clearInterval(keepalive);
    };

    ws.on("open", () => {
      opened = true;
      lastAudioAt = Date.now();
    });

    ws.on("message", (data) => {
      let msg: DeepgramResult;
      try {
        msg = JSON.parse(data.toString()) as DeepgramResult;
      } catch {
        return;
      }
      if (msg.type === "Results") {
        const alt = msg.channel?.alternatives?.[0];
        const text = (alt?.transcript ?? "").trim();
        if (!text) return;
        cb.onTranscript({
          text,
          isFinal: msg.is_final === true,
          speechFinal: msg.speech_final === true,
          words: (alt?.words ?? []).map((w) => ({
            word: w.punctuated_word ?? w.word ?? "",
            speaker: w.speaker,
          })),
          confidence: alt?.confidence,
        });
      } else if (msg.type === "Metadata") {
        // handshake metadata — nothing to surface
      } else if (msg.type === "UtteranceEnd" || msg.type === "SpeechStarted") {
        // VAD events — utterance lifecycle is tracked via speech_final
      } else if (msg.description) {
        cb.onError(`Deepgram: ${msg.description}`);
      }
    });

    ws.on("error", () => {
      if (!closed) {
        closed = true;
        teardown();
        cb.onError(opened ? "Deepgram connection error" : "Could not reach Deepgram — check API key and network");
      }
    });

    ws.on("close", () => {
      if (!closed) {
        closed = true;
        teardown();
        cb.onClose();
      } else {
        teardown();
      }
    });

    return {
      sendAudio: (pcm: Buffer) => {
        if (closed || !opened) return;
        lastAudioAt = Date.now();
        try {
          ws.send(pcm, { binary: true });
        } catch {
          /* backpressure or dying socket — close handler reports it */
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        teardown();
        try {
          if (opened) ws.send(JSON.stringify({ type: "CloseStream" }));
        } catch {
          /* best effort */
        }
        setTimeout(() => {
          try {
            ws.close();
          } catch {
            /* already closed */
          }
        }, 300).unref?.();
        cb.onClose();
      },
      get closed() {
        return closed;
      },
    };
  }
}
