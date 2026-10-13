import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Phase 6.3 — user profile (display name, role, sign language).
 *   GET  /api/profile → { id, email, display_name, role, language }
 *   PATCH /api/profile → { display_name?, role?, language? }
 * Unauthenticated → 401. Unconfigured → 503.
 */

const PatchSchema = z.object({
  display_name: z.string().min(1).max(40).optional(),
  role: z.enum(["dhh", "hearing", "interpreter"]).optional(),
  language: z.string().min(1).max(16).optional(),
});

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
    .from("profiles")
    .select("display_name, role, language")
    .eq("id", user.id)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ error: "Could not load profile." }, { status: 500 });
  }
  return NextResponse.json({
    id: user.id,
    email: user.email,
    display_name: data?.display_name ?? "Aura user",
    role: data?.role ?? "dhh",
    language: data?.language ?? "asl",
  });
}

export async function PATCH(req: NextRequest) {
  const limit = checkRate(req, "profile", RATE_LIMITS.profile);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const ctx = await authed();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { supabase, user } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "Provide display_name, role, and/or language." }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").upsert(
    { id: user.id, ...parsed.data },
    { onConflict: "id" }
  );
  if (error) {
    return NextResponse.json({ error: "Could not save profile." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
