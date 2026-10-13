/**
 * Unit tests for the ambient detection pipeline (Phase 4).
 *
 * No network, mic, or API token needed:
 *   - DetectionMapper: AudioSet label mapping, thresholds, cooldowns
 *   - MockClassifier: scripted predictions advance per call
 *   - pcm16ToWav: WAV container validity
 *
 * Run: node --no-warnings server/test-ambient.ts
 */

import { DetectionMapper } from "./ambient/map.ts";
import { MockClassifier } from "./ambient/mock-classifier.ts";
import { HfAstClassifier } from "./ambient/hf-classifier.ts";
import { pcm16ToWav } from "./ambient/classifier.ts";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

async function main(): Promise<void> {
  console.log("[test] Ambient pipeline unit checks…");

  /* ---- mapping ---- */
  const mapper = new DetectionMapper({ threshold: 0.3, cooldownMs: 20_000 });
  const siren = mapper.map([{ label: "Siren", score: 0.91 }], { now: 1000 });
  check("Siren → critical siren def", siren.length === 1 && siren[0].priority === "critical" && siren[0].id === "siren", siren);
  check("detection carries engine score", siren.length === 1 && siren[0].score === 0.91);

  /* ---- threshold ---- */
  const quiet = new DetectionMapper({ threshold: 0.3 });
  check("below-threshold predictions dropped", quiet.map([{ label: "Siren", score: 0.2 }]).length === 0);

  /* ---- speech/music ignored ---- */
  const ignored = new DetectionMapper();
  check("Speech ignored (STT owns it)", ignored.map([{ label: "Speech", score: 0.95 }]).length === 0);
  check("Music ignored", ignored.map([{ label: "Music", score: 0.9 }]).length === 0);

  /* ---- cooldown ---- */
  const cd = new DetectionMapper({ cooldownMs: 20_000 });
  const first = cd.map([{ label: "Knock", score: 0.8 }], { now: 0 });
  const second = cd.map([{ label: "Knock", score: 0.85 }], { now: 5_000 });
  const third = cd.map([{ label: "Knock", score: 0.85 }], { now: 25_000 });
  check("first detection fires", first.length === 1 && first[0].id === "door-knock");
  check("repeat inside cooldown suppressed", second.length === 0);
  check("repeat after cooldown fires", third.length === 1);

  /* ---- multiple labels, best-first ---- */
  const multi = new DetectionMapper();
  const both = multi.map([
    { label: "Dog", score: 0.6 },
    { label: "Laughter", score: 0.75 },
  ]);
  check(
    "distinct defs both surface",
    both.length === 2 && both[0].id === "laughter" && both[1].id === "dog-barking",
    both.map((d) => d.id)
  );

  /* ---- mock classifier ---- */
  const mock = new MockClassifier();
  check("mock available without key", mock.available && mock.name === "mock");
  const m1 = await mock.classify(Buffer.alloc(100));
  const m2 = await mock.classify(Buffer.alloc(100));
  check("mock advances script per call", m1[0]?.label === "Siren" && m2[0]?.label === "Knock", [m1, m2]);

  /* ---- HF classifier config ---- */
  const hfNone = new HfAstClassifier(undefined, "model");
  check("HF unavailable without token", !hfNone.available && !!hfNone.unavailableReason);
  let threw = false;
  try {
    await hfNone.classify(Buffer.alloc(100));
  } catch {
    threw = true;
  }
  check("HF classify without token throws (no network)", threw);

  let calls = 0;
  const hfStub = new HfAstClassifier("tok", "some-model", (async () => {
    calls++;
    return new Response(JSON.stringify([{ label: "Siren", score: 0.9 }]), { status: 200 });
  }) as typeof fetch);
  const preds = await hfStub.classify(Buffer.alloc(3200));
  check("HF parses predictions", calls === 1 && preds[0]?.label === "Siren" && preds[0]?.score === 0.9, preds);

  /* ---- WAV container ---- */
  const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  const wav = pcm16ToWav(pcm);
  check("WAV has RIFF/WAVE/fmt/data markers", wav.subarray(0, 4).toString() === "RIFF" && wav.subarray(8, 12).toString() === "WAVE");
  check("WAV length = 44 + pcm", wav.length === 44 + pcm.length);
  check("WAV declares 16kHz mono PCM16", wav.readUInt32LE(24) === 16000 && wav.readUInt16LE(22) === 1 && wav.readUInt16LE(34) === 16);

  console.log(failures === 0 ? "\n[test] ALL CHECKS PASSED" : `\n[test] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
