import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Phases 6.3 + 7 + 3.2 — synced settings: accessibility flags, TTS prefs,
 * ambient sensitivity. Last write wins (updated_at orders conflicts).
 *   GET /api/settings → full settings object (defaults when never saved)
 *   PUT /api/settings → replace (partial body merged over stored row)
 * Unauthenticated → 401. Unconfigured → 503.
 */

const SettingsSchema = z.object({
  font_scale: z.number().min(0.5).max(2).optional(),
  high_contrast: z.boolean().optional(),
  dark: z.boolean().optional(),
  haptics: z.boolean().optional(),
  reduced_motion: z.boolean().optional(),
  tts_voice_id: z.string().max(80).optional(),
  tts_rate: z.number().min(0.5).max(2).optional(),
  ambient_sensitivity: z.enum(["low", "standard", "high"]).optional(),
});

export type SettingsRow = {
  font_scale: number;
  high_contrast: boolean;
  dark: boolean;
  haptics: boolean;
  reduced_motion: boolean;
  tts_voice_id: string;
  tts_rate: number;
  ambient_sensitivity: "low" | "standard" | "high";
  updated_at?: string;
};

const DEFAULTS: SettingsRow = {
  font_scale: 1,
  high_contrast: false,
  dark: false,
  haptics: true,
  reduced_motion: false,
  tts_voice_id: "",
  tts_rate: 1,
  ambient_sensitivity: "standard",
};

async function authed() {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, user };
}

export async function GET() {
  const ctx = await authed();
  if (!ctx) {
    const supabase = await createClient();
    return NextResponse.json(
      { error: supabase ? "Not signed in." : "Auth is not configured." },
      { status: supabase ? 401 : 503 }
    );
  }
  const { supabase, user } = ctx;
  const { data, error } = await supabase
    .from("user_settings")
    .select("font_scale, high_contrast, dark, haptics, reduced_motion, tts_voice_id, tts_rate, ambient_sensitivity, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not load settings." }, { status: 500 });
  }
  return NextResponse.json({ ...(data ?? DEFAULTS) });
}

export async function PUT(req: NextRequest) {
  const ctx = await authed();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { supabase, user } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Provide at least one settings field." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, ...parsed.data }, { onConflict: "user_id" });
  if (error) {
    return NextResponse.json({ error: "Could not save settings." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
