/**
 * STT provider abstraction (Phase 2).
 *
 * The signaling server streams per-peer PCM16 audio to a provider and
 * receives transcript events back. Two implementations ship:
 *   - DeepgramSttProvider — real streaming STT (needs DEEPGRAM_API_KEY)
 *   - MockSttProvider     — scripted transcripts, no key, for demo/CI
 *
 * A faster-whisper sidecar can implement this same interface later
 * without touching the signaling server.
 */

export interface SttWord {
  word: string;
  /** diarized speaker index from the engine (0-based), if available */
  speaker?: number;
}

export interface SttTranscript {
  text: string;
  isFinal: boolean;
  /** true when the engine is confident the utterance is complete */
  speechFinal: boolean;
  words: SttWord[];
  /** engine confidence 0..1, if reported */
  confidence?: number;
}

export interface SttSessionCallbacks {
  onTranscript: (t: SttTranscript) => void;
  onError: (message: string) => void;
  onClose: () => void;
}

export interface SttSessionOptions {
  /** BCP-47 tag, e.g. "en". Passed to the engine. */
  lang: string;
  /** boosted vocabulary terms (Phase 2.4 custom vocabulary) */
  keywords: string[];
  model: string;
}

export interface SttSession {
  /** push a PCM16 mono 16kHz chunk */
  sendAudio: (pcm: Buffer) => void;
  close: () => void;
  readonly closed: boolean;
}

export interface SttProvider {
  readonly name: "deepgram" | "mock";
  /** false when the provider can't run (e.g. missing API key) */
  readonly available: boolean;
  unavailableReason?: string;
  openSession: (opts: SttSessionOptions, cb: SttSessionCallbacks) => SttSession;
}
