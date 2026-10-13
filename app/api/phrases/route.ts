import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Phase 6.4 — cloud custom phrases (replaces localStorage per-account).
 *   GET    /api/phrases → { phrases: [{ id, text }] } (ordered)
 *   POST   /api/phrases { text } → { id, text }
 *   DELETE /api/phrases?id=<uuid> → { ok: true }
 * Unauthenticated → 401. Unconfigured → 503.
 */

const PostSchema = z.object({
  text: z.string().trim().min(1).max(280),
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

function unauthenticated(status: 401 | 503) {
  return NextResponse.json(
    { error: status === 401 ? "Not signed in." : "Auth is not configured." },
    { status }
  );
}

export async function GET(req: NextRequest) {
  const limit = checkRate(req, "phrases-read", RATE_LIMITS.phrasesRead);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const ctx = await authed();
  if (!ctx) {
    const supabase = await createClient();
    return unauthenticated(supabase ? 401 : 503);
  }
  const { supabase, user } = ctx;
  const { data, error } = await supabase
    .from("custom_phrases")
    .select("id, text")
    .eq("user_id", user.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: "Could not load phrases." }, { status: 500 });
  }
  return NextResponse.json({ phrases: data ?? [] });
}

export async function POST(req: NextRequest) {
  const limit = checkRate(req, "phrases-write", RATE_LIMITS.phrasesWrite);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const ctx = await authed();
  if (!ctx) return unauthenticated(401);
  const { supabase, user } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Field 'text' (1–280 chars) is required." }, { status: 400 });
  }

  const { count } = await supabase
    .from("custom_phrases")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if ((count ?? 0) >= 200) {
    return NextResponse.json({ error: "Phrase limit reached (200)." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("custom_phrases")
    .insert({ user_id: user.id, text: parsed.data.text, position: count ?? 0 })
    .select("id, text")
    .single();
  if (error || !data) {
    return NextResponse.json({ error: "Could not save phrase." }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const limit = checkRate(req, "phrases-write", RATE_LIMITS.phrasesWrite);
  if (!limit.allowed) return rateLimitedResponse(limit);
  const ctx = await authed();
  if (!ctx) return unauthenticated(401);
  const { supabase, user } = ctx;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Query param 'id' is required." }, { status: 400 });
  }
  const { error, count } = await supabase
    .from("custom_phrases")
    .delete({ count: "exact" })
    .eq("user_id", user.id)
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: "Could not delete phrase." }, { status: 500 });
  }
  if ((count ?? 0) === 0) {
    return NextResponse.json({ error: "Phrase not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
