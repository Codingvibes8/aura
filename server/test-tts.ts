/**
 * Unit tests for the ElevenLabs TTS client (Phase 3).
 *
 * No API key or network needed — a stub fetch verifies validation,
 * the LRU phrase cache, and error mapping.
 *
 * Run: node --no-warnings server/test-tts.ts
 */

import {
  ElevenLabsTts,
  getTtsConfig,
  TtsNotConfiguredError,
  TtsValidationError,
  TtsUpstreamError,
  TTS_MAX_CHARS,
} from "./tts/elevenlabs.ts";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((url: string, init?: RequestInit) => Promise.resolve(handler(url, init))) as typeof fetch;
}

function audioResponse(bytes: Uint8Array): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

async function main(): Promise<void> {
  console.log("[test] TTS client unit checks…");

  /* ---- config ---- */
  const empty = getTtsConfig({} as unknown as NodeJS.ProcessEnv);
  check("no key → unconfigured", !empty.configured && empty.provider === "none", empty);
  const withKey = getTtsConfig({ ELEVENLABS_API_KEY: "k" } as unknown as NodeJS.ProcessEnv);
  check("key → configured elevenlabs", withKey.configured && withKey.provider === "elevenlabs");
  check("default model is low-latency turbo", withKey.model === "eleven_turbo_v2_5", withKey.model);

  /* ---- constructor ---- */
  let threw = false;
  try {
    new ElevenLabsTts("");
  } catch (e) {
    threw = e instanceof TtsNotConfiguredError;
  }
  check("empty key throws TtsNotConfiguredError", threw);

  /* ---- validation (no network) ---- */
  const strict = new ElevenLabsTts("k", {
    fetchImpl: stubFetch(() => {
      throw new Error("network should not be hit");
    }),
  });
  threw = false;
  try {
    await strict.synthesize("   ", "voice");
  } catch (e) {
    threw = e instanceof TtsValidationError;
  }
  check("empty text → validation error", threw);

  threw = false;
  try {
    await strict.synthesize("x".repeat(TTS_MAX_CHARS + 1), "voice");
  } catch (e) {
    threw = e instanceof TtsValidationError;
  }
  check(`over-${TTS_MAX_CHARS}-char text → validation error`, threw);

  /* ---- synthesis + LRU cache ---- */
  let calls = 0;
  let lastUrl = "";
  let lastBody = "";
  const tts = new ElevenLabsTts("test-key", {
    fetchImpl: stubFetch((url, init) => {
      calls++;
      lastUrl = String(url);
      lastBody = String(init?.body ?? "");
      return audioResponse(new Uint8Array([1, 2, 3, 4]));
    }),
  });

  const first = await tts.synthesize("Hello there", "voice-1");
  check("first synthesis returns audio bytes", first.audio.length === 4 && !first.cached);
  check("request hits text-to-speech endpoint", lastUrl.includes("/v1/text-to-speech/voice-1"), lastUrl);
  const body = JSON.parse(lastBody) as { text?: string; model_id?: string; voice_settings?: object };
  check("request carries text + model + voice settings", body.text === "Hello there" && !!body.model_id && !!body.voice_settings, body);

  const second = await tts.synthesize("Hello there", "voice-1");
  check("repeat phrase served from cache", second.cached && second.audio.length === 4);
  check("cache avoids second network call", calls === 1, calls);

  await tts.synthesize("Different line", "voice-1");
  check("new text misses cache", calls === 2, calls);
  check("cache tracks entries", tts.cacheSize() === 2, tts.cacheSize());

  /* ---- upstream errors ---- */
  const failing = new ElevenLabsTts("bad-key", {
    fetchImpl: stubFetch(
      () =>
        new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "nope" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        })
    ),
  });
  threw = false;
  let status = 0;
  try {
    await failing.synthesize("hi", "voice-1");
  } catch (e) {
    threw = e instanceof TtsUpstreamError;
    status = (e as TtsUpstreamError).status;
  }
  check("401 upstream → TtsUpstreamError with status", threw && status === 401, status);

  /* ---- voices ---- */
  const voicesTts = new ElevenLabsTts("k", {
    fetchImpl: stubFetch(
      () =>
        new Response(
          JSON.stringify({ voices: [{ voice_id: "v1", name: "Rachel", category: "premade" }] }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    ),
  });
  const voices = await voicesTts.listVoices();
  check("voices mapped to id/name", voices.length === 1 && voices[0].id === "v1" && voices[0].name === "Rachel", voices);

  console.log(failures === 0 ? "\n[test] ALL CHECKS PASSED" : `\n[test] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
