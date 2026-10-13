/**
 * ElevenLabs TTS client (Phase 3.1).
 *
 * Pure module — no Next.js imports — so it runs in Route Handlers and in
 * plain-node unit tests (`server/test-tts.ts`). Uses the REST API:
 *   POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
 *   GET  /v1/voices
 *
 * Repeated phrases (quick-phrase macros hit the same lines constantly) are
 * served from an in-memory LRU of synthesized MP3 buffers to save quota
 * and cut latency to ~0.
 */

import { createHash } from "node:crypto";

export const TTS_MAX_CHARS = 2000;
const CACHE_MAX_ENTRIES = 50;
const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MODEL = "eleven_turbo_v2_5";
/** Rachel — ElevenLabs' long-standing default voice id */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export interface TtsConfig {
  configured: boolean;
  provider: "elevenlabs" | "none";
  model: string;
  defaultVoice: string;
  stability: number;
  similarityBoost: number;
}

export interface TtsVoice {
  id: string;
  name: string;
  category?: string;
}

export class TtsNotConfiguredError extends Error {
  constructor() {
    super("Server TTS is not configured (ELEVENLABS_API_KEY missing)");
    this.name = "TtsNotConfiguredError";
  }
}

export class TtsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TtsValidationError";
  }
}

export class TtsUpstreamError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`ElevenLabs error ${status}: ${message}`);
    this.name = "TtsUpstreamError";
    this.status = status;
  }
}

export function getTtsConfig(env: NodeJS.ProcessEnv = process.env): TtsConfig {
  const apiKey = env.ELEVENLABS_API_KEY ?? "";
  return {
    configured: apiKey.length > 0,
    provider: apiKey.length > 0 ? "elevenlabs" : "none",
    model: env.ELEVENLABS_MODEL ?? DEFAULT_MODEL,
    defaultVoice: env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
    stability: Number(env.ELEVENLABS_STABILITY ?? 0.5),
    similarityBoost: Number(env.ELEVENLABS_SIMILARITY_BOOST ?? 0.75),
  };
}

function cacheKey(model: string, voiceId: string, text: string, stability: number, similarity: number): string {
  return createHash("sha256")
    .update(`${model}|${voiceId}|${stability}|${similarity}|${text}`)
    .digest("hex");
}

export interface ElevenLabsTtsDeps {
  fetchImpl?: typeof fetch;
  apiBase?: string;
}

export class ElevenLabsTts {
  private apiKey: string;
  private model: string;
  private stability: number;
  private similarityBoost: number;
  private fetchImpl: typeof fetch;
  private apiBase: string;
  private cache = new Map<string, Buffer>();
  private voicesCache: { at: number; voices: TtsVoice[] } | null = null;

  constructor(apiKey: string, opts?: { model?: string; stability?: number; similarityBoost?: number } & ElevenLabsTtsDeps) {
    if (!apiKey) throw new TtsNotConfiguredError();
    this.apiKey = apiKey;
    this.model = opts?.model ?? DEFAULT_MODEL;
    this.stability = opts?.stability ?? 0.5;
    this.similarityBoost = opts?.similarityBoost ?? 0.75;
    this.fetchImpl = opts?.fetchImpl ?? fetch;
    this.apiBase = opts?.apiBase ?? "https://api.elevenlabs.io";
  }

  /** MP3 bytes for text; served from LRU cache on repeat input */
  async synthesize(text: string, voiceId: string): Promise<{ audio: Buffer; cached: boolean }> {
    const clean = text.trim();
    if (!clean) throw new TtsValidationError("Text must not be empty");
    if (clean.length > TTS_MAX_CHARS) {
      throw new TtsValidationError(`Text exceeds ${TTS_MAX_CHARS} characters`);
    }
    if (!voiceId) throw new TtsValidationError("voiceId is required");

    const key = cacheKey(this.model, voiceId, clean, this.stability, this.similarityBoost);
    const hit = this.cache.get(key);
    if (hit) {
      // refresh LRU position
      this.cache.delete(key);
      this.cache.set(key, hit);
      return { audio: hit, cached: true };
    }

    const res = await this.fetchImpl(
      `${this.apiBase}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: clean,
          model_id: this.model,
          voice_settings: {
            stability: this.stability,
            similarity_boost: this.similarityBoost,
          },
        }),
      }
    );

    if (!res.ok) {
      throw new TtsUpstreamError(res.status, await describeUpstreamError(res));
    }

    const audio = Buffer.from(await res.arrayBuffer());
    this.cache.set(key, audio);
    while (this.cache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (oldest.done) break;
      this.cache.delete(oldest.value);
    }
    return { audio, cached: false };
  }

  async listVoices(): Promise<TtsVoice[]> {
    if (this.voicesCache && Date.now() - this.voicesCache.at < VOICES_CACHE_TTL_MS) {
      return this.voicesCache.voices;
    }
    const res = await this.fetchImpl(`${this.apiBase}/v1/voices`, {
      headers: { "xi-api-key": this.apiKey },
    });
    if (!res.ok) {
      throw new TtsUpstreamError(res.status, await describeUpstreamError(res));
    }
    const data = (await res.json()) as { voices?: { voice_id?: string; name?: string; category?: string }[] };
    const voices = (data.voices ?? [])
      .filter((v) => v.voice_id && v.name)
      .map((v) => ({ id: v.voice_id as string, name: v.name as string, category: v.category }));
    this.voicesCache = { at: Date.now(), voices };
    return voices;
  }

  cacheSize(): number {
    return this.cache.size;
  }
}

async function describeUpstreamError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const data = JSON.parse(text) as { detail?: { message?: string } | string; message?: string };
      if (typeof data.detail === "string") return data.detail;
      if (data.detail?.message) return data.detail.message;
      if (data.message) return data.message;
    } catch {
      /* not JSON */
    }
    return text.slice(0, 200) || res.statusText;
  } catch {
    return res.statusText;
  }
}

/* Module singleton used by the Route Handlers (rebuilt if env changes) */
let singleton: ElevenLabsTts | null = null;
let singletonKey = "";

export function getElevenLabsTts(env: NodeJS.ProcessEnv = process.env): ElevenLabsTts {
  const cfg = getTtsConfig(env);
  if (!cfg.configured) throw new TtsNotConfiguredError();
  const key = `${env.ELEVENLABS_API_KEY}|${cfg.model}|${cfg.stability}|${cfg.similarityBoost}`;
  if (!singleton || singletonKey !== key) {
    singleton = new ElevenLabsTts(env.ELEVENLABS_API_KEY as string, {
      model: cfg.model,
      stability: cfg.stability,
      similarityBoost: cfg.similarityBoost,
    });
    singletonKey = key;
  }
  return singleton;
}
