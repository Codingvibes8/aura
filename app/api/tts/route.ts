/**
 * Phase 3.1 — server-side TTS endpoint (ElevenLabs).
 *
 *   GET  /api/tts          → { configured, provider, model, defaultVoice }
 *   POST /api/tts          → audio/mpeg bytes for { text, voiceId? }
 *
 * The API key never leaves the server. Responses carry X-Aura-TTS-Cache
 * (HIT/MISS) so clients can observe the phrase cache. Without a key the
 * endpoint reports unconfigured and clients fall back to browser speech
 * synthesis — the app works either way.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";
import {
  getTtsConfig,
  getElevenLabsTts,
  TtsNotConfiguredError,
  TtsValidationError,
  TtsUpstreamError,
  TTS_MAX_CHARS,
} from "@/server/tts/elevenlabs";

export async function GET(req: NextRequest) {
  const limit = checkRate(req, "tts-status", RATE_LIMITS.ttsStatus);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const cfg = getTtsConfig();
  return NextResponse.json({
    configured: cfg.configured,
    provider: cfg.provider,
    model: cfg.model,
    defaultVoice: cfg.defaultVoice,
  });
}

export async function POST(req: NextRequest) {
  const limit = checkRate(req, "tts-synthesize", RATE_LIMITS.ttsSynthesize);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const cfg = getTtsConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      { error: "Server TTS is not configured.", fallback: "browser" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const text = typeof (body as { text?: unknown }).text === "string"
    ? ((body as { text: string }).text ?? "")
    : "";
  const voiceIdRaw = (body as { voiceId?: unknown }).voiceId;
  const voiceId = typeof voiceIdRaw === "string" && voiceIdRaw ? voiceIdRaw : cfg.defaultVoice;

  if (!text.trim()) {
    return NextResponse.json({ error: "Field 'text' must not be empty." }, { status: 400 });
  }
  if (text.length > TTS_MAX_CHARS) {
    return NextResponse.json(
      { error: `Field 'text' exceeds ${TTS_MAX_CHARS} characters.` },
      { status: 400 }
    );
  }

  try {
    const tts = getElevenLabsTts();
    const { audio, cached } = await tts.synthesize(text, voiceId);
    return new NextResponse(new Uint8Array(audio), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "no-store",
        "X-Aura-TTS-Cache": cached ? "HIT" : "MISS",
        "X-Aura-TTS-Voice": voiceId,
      },
    });
  } catch (e) {
    if (e instanceof TtsNotConfiguredError) {
      return NextResponse.json(
        { error: "Server TTS is not configured.", fallback: "browser" },
        { status: 503 }
      );
    }
    if (e instanceof TtsValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof TtsUpstreamError) {
      const status = e.status === 401 || e.status === 403 ? 502 : e.status >= 500 ? 502 : e.status;
      return NextResponse.json(
        { error: "Speech synthesis failed upstream.", fallback: "browser" },
        { status }
      );
    }
    return NextResponse.json(
      { error: "Speech synthesis failed.", fallback: "browser" },
      { status: 500 }
    );
  }
}
