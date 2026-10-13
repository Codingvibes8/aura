/**
 * HuggingFace AudioSet classifier (Phase 4.2).
 *
 * POSTs WAV-encoded windows to the Inference API:
 *   POST https://router.huggingface.co/hf-inference/models/{model}
 *   Authorization: Bearer <HF_TOKEN>
 *
 * Default model MIT/ast-finetuned-audioset-10-10-0.4593 returns
 * [{ label, score }] with human-readable AudioSet names.
 */

import { pcm16ToWav, type AudioClassifier, type ClassifiedSound } from "./classifier.ts";

export class HfAstClassifier implements AudioClassifier {
  readonly name = "hf" as const;
  readonly available: boolean;
  readonly unavailableReason?: string;
  private token: string;
  private model: string;
  private fetchImpl: typeof fetch;

  constructor(token: string | undefined, model: string, fetchImpl: typeof fetch = fetch) {
    this.token = token ?? "";
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.available = this.token.length > 0;
    if (!this.available) {
      this.unavailableReason = "HF_TOKEN is not set";
    }
  }

  async classify(pcm: Buffer): Promise<ClassifiedSound[]> {
    if (!this.available) throw new Error("HF classifier not configured");
    if (pcm.length === 0) return [];

    const wav = pcm16ToWav(pcm);
    const res = await this.fetchImpl(
      `https://router.huggingface.co/hf-inference/models/${this.model}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "audio/wav",
        },
        body: new Uint8Array(wav),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`HF inference ${res.status}: ${text.slice(0, 160)}`);
    }

    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (d): d is { label: string; score: number } =>
          typeof d === "object" &&
          d !== null &&
          typeof (d as { label?: unknown }).label === "string" &&
          typeof (d as { score?: unknown }).score === "number"
      )
      .map((d) => ({ label: d.label, score: d.score }));
  }
}
