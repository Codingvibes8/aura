/**
 * Ambient audio classifier abstraction (Phase 4).
 *
 * The signaling server accumulates per-peer PCM16 mono 16kHz windows and
 * asks a provider to label them. Two implementations ship:
 *   - HfAstClassifier  — AudioSet AST via HuggingFace Inference (needs HF_TOKEN)
 *   - MockClassifier   — scripted detections, no key, for demo/CI
 */

export interface ClassifiedSound {
  /** raw engine label, e.g. "Siren" */
  label: string;
  /** engine confidence 0..1 */
  score: number;
}

export interface AudioClassifier {
  readonly name: "hf" | "mock";
  readonly available: boolean;
  unavailableReason?: string;
  /** classify one PCM16 mono 16kHz window */
  classify: (pcm: Buffer) => Promise<ClassifiedSound[]>;
}

/** Wrap raw PCM16 mono samples in a minimal WAV container (44-byte header). */
export function pcm16ToWav(pcm: Buffer, sampleRate = 16000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
