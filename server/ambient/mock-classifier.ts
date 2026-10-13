/**
 * Mock ambient classifier — scripted detections, no key, for demo/CI.
 *
 * Each `classify()` call advances a script and returns the next canned
 * prediction set, so the mapping → cooldown → broadcast pipeline is
 * exercisable without a microphone or API token.
 */

import type { AudioClassifier, ClassifiedSound } from "./classifier.ts";

const SCRIPT: ClassifiedSound[][] = [
  [{ label: "Siren", score: 0.91 }],
  [{ label: "Knock", score: 0.77 }],
  [{ label: "Laughter", score: 0.66 }],
  [{ label: "Speech", score: 0.88 }], // ignored by the mapper (STT owns speech)
  [{ label: "Dog", score: 0.71 }],
  [{ label: "Fire alarm", score: 0.93 }],
];

export class MockClassifier implements AudioClassifier {
  readonly name = "mock" as const;
  readonly available = true;
  private step = 0;

  async classify(): Promise<ClassifiedSound[]> {
    const out = SCRIPT[this.step % SCRIPT.length];
    this.step++;
    return out;
  }
}
