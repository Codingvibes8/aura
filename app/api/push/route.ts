import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Phase 9.3 — Web Push subscription storage.
 *   GET    /api/push → { configured, vapidPublicKey }
 *   POST   /api/push { endpoint, keys: { p256dh, auth } } → { ok: true }
 *   DELETE /api/push { endpoint } → { ok: true }
 * Requires sign-in (subscriptions are per-user). Without VAPID keys the
 * client can still register locally, but sends are disabled.
 */

const SubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(300),
    auth: z.string().min(1).max(300),
  }),
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

export async function GET(req: NextRequest) {
  const limit = checkRate(req, "push", RATE_LIMITS.ttsStatus);
  if (!limit.allowed) return rateLimitedResponse(limit);
  return NextResponse.json({
    configured: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY),
    vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
  });
}

export async function POST(req: NextRequest) {
  const limit = checkRate(req, "push", RATE_LIMITS.settings);
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
  const parsed = SubscriptionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid push subscription required." }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) {
    return NextResponse.json({ error: "Could not save subscription." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const limit = checkRate(req, "push", RATE_LIMITS.settings);
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
  const endpoint = (body as { endpoint?: unknown }).endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return NextResponse.json({ error: "Field 'endpoint' is required." }, { status: 400 });
  }
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  if (error) {
    return NextResponse.json({ error: "Could not delete subscription." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
