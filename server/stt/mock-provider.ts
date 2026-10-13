/**
 * Mock STT provider — scripted transcripts with zero dependencies.
 *
 * Used when no DEEPGRAM_API_KEY is configured (and in CI). Emits
 * word-by-word interim results followed by finals on a timer once the
 * session opens, so the full caption pipeline is exercisable end to end
 * without a microphone or API key.
 */

import type {
  SttProvider,
  SttSession,
  SttSessionCallbacks,
  SttSessionOptions,
  SttTranscript,
} from "./provider.ts";

const SCRIPT = [
  "Testing the live caption pipeline",
  "This is a simulated transcript from the mock engine",
  "Speak into your microphone to stream real audio frames",
  "Interim results update as you talk",
];

const WORD_INTERVAL_MS = 140;

export class MockSttProvider implements SttProvider {
  readonly name = "mock" as const;
  readonly available = true;

  openSession(_opts: SttSessionOptions, cb: SttSessionCallbacks): SttSession {
    let closed = false;
    let lineIndex = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const emitLine = (line: string) => {
      if (closed) return;
      const words = line.split(" ");
      let shown = 0;

      const step = () => {
        if (closed) return;
        shown += 1;
        const text = words.slice(0, shown).join(" ");
        const isFinal = shown >= words.length;
        const t: SttTranscript = {
          text,
          isFinal,
          speechFinal: isFinal,
          words: words.slice(0, shown).map((word) => ({ word, speaker: 0 })),
          confidence: 0.99,
        };
        cb.onTranscript(t);
        if (!isFinal) {
          timer = setTimeout(step, WORD_INTERVAL_MS);
        } else {
          timer = setTimeout(() => {
            lineIndex = (lineIndex + 1) % SCRIPT.length;
            emitLine(SCRIPT[lineIndex]);
          }, 1200);
        }
      };
      step();
    };

    // Start on first audio — or after a short delay so mic-less tests work
    const kickoff = setTimeout(() => emitLine(SCRIPT[lineIndex]), 400);

    return {
      sendAudio: () => {
        // Mock ignores audio content; timing drives the script
      },
      close: () => {
        if (closed) return;
        closed = true;
        clearTimeout(kickoff);
        if (timer) clearTimeout(timer);
        cb.onClose();
      },
      get closed() {
        return closed;
      },
    };
  }
}
