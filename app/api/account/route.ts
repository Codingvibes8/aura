import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Phase 8.4 — data rights (GDPR/CCPA access + erasure).
 *   GET    /api/account → full export: profile + settings + phrases
 *   DELETE /api/account → erase all rows owned by the caller, then sign out
 *     (the auth.users row itself requires the service role — see note).
 * Unauthenticated → 401. Unconfigured → 503.
 */

async function authed() {
  const supabase = await createClient();
  if (!supabase) return null;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, user };
}

export async function GET(req: Request) {
  const limit = checkRate(req, "account", RATE_LIMITS.account);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const ctx = await authed();
  if (!ctx) {
    const supabase = await createClient();
    return NextResponse.json(
      { error: supabase ? "Not signed in." : "Auth is not configured." },
      { status: supabase ? 401 : 503 }
    );
  }
  const { supabase, user } = ctx;
  const [profile, settings, phrases] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("user_settings").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("custom_phrases").select("id, text, position, created_at").eq("user_id", user.id),
  ]);
  if (profile.error || settings.error || phrases.error) {
    return NextResponse.json({ error: "Could not assemble export." }, { status: 500 });
  }
  return NextResponse.json({
    exported_at: new Date().toISOString(),
    user_id: user.id,
    email: user.email,
    profile: profile.data,
    settings: settings.data,
    custom_phrases: phrases.data ?? [],
  });
}

export async function DELETE(req: Request) {
  const limit = checkRate(req, "account", RATE_LIMITS.account);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const ctx = await authed();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { supabase, user } = ctx;

  // Order matters only for readability — FK cascades would handle it anyway.
  const ops = await Promise.all([
    supabase.from("custom_phrases").delete().eq("user_id", user.id),
    supabase.from("user_settings").delete().eq("user_id", user.id),
    supabase.from("profiles").delete().eq("id", user.id),
  ]);
  const failed = ops.find((o) => o.error);
  if (failed?.error) {
    return NextResponse.json({ error: "Could not erase all data." }, { status: 500 });
  }
  await supabase.auth.signOut();
  return NextResponse.json({
    ok: true,
    note: "All Aura data rows erased and signed out. The auth identity itself is retained unless deleted with the service role (see BACKEND_ROADMAP 8.4).",
  });
}
