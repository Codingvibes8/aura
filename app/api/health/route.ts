import { NextResponse } from "next/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { getTtsConfig } from "@/server/tts/elevenlabs";

/**
 * Phase 8.3 — service health for uptime monitoring. Reports capability
 * flags only (never secrets): auth/TTS/STT/ambient configuration states.
 */
export async function GET(req: Request) {
  const check = checkRate(req, "health", RATE_LIMITS.ttsStatus);
  if (!check.allowed) return rateLimitedResponse(check);

  const tts = getTtsConfig();
  return NextResponse.json({
    status: "ok",
    time: new Date().toISOString(),
    services: {
      auth: !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      tts: tts.configured,
      stt: true, // signaling server advertises its own provider over WS
      ambient: true,
      vrs: true,
    },
  });
}
