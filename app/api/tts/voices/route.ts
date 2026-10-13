/**
 * Phase 3.1 — voice catalog for the TTS voice picker.
 *
 *   GET /api/tts/voices → { configured, voices: [{ id, name, category? }] }
 *
 * Proxied from ElevenLabs (10-minute server cache). When unconfigured,
 * returns the default voice entry so the picker still renders.
 */

import { NextResponse } from "next/server";
import { getTtsConfig, getElevenLabsTts } from "@/server/tts/elevenlabs";

export async function GET() {
  const cfg = getTtsConfig();
  if (!cfg.configured) {
    return NextResponse.json({
      configured: false,
      voices: [{ id: cfg.defaultVoice, name: "Default voice (browser fallback active)" }],
    });
  }
  try {
    const tts = getElevenLabsTts();
    const voices = await tts.listVoices();
    return NextResponse.json({ configured: true, voices });
  } catch {
    return NextResponse.json(
      {
        configured: true,
        voices: [{ id: cfg.defaultVoice, name: "Default voice" }],
        warning: "Could not reach ElevenLabs; showing default voice only.",
      },
      { status: 200 }
    );
  }
}
