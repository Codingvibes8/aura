import { NextRequest, NextResponse } from "next/server";
import webpush from "web-push";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { checkRate, rateLimitedResponse, RATE_LIMITS } from "@/lib/rate-limit";

/**
 * Phase 9.3 — send a Web Push to the caller's own devices.
 *   POST /api/push/test { title?, body?, url? } → { sent, failed }
 *
 * Proves the VAPID pipeline end-to-end (works with the screen off, as long
 * as the browser runs). Stale endpoints (410/404) are pruned.
 */

const TestSchema = z.object({
  title: z.string().max(80).default("Aura test alert"),
  body: z.string().max(200).default("Push pipeline works — critical alerts can reach you here."),
  url: z.string().max(200).default("/dhh"),
});

function vapidConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export async function POST(req: NextRequest) {
  const limit = checkRate(req, "push-test", RATE_LIMITS.account);
  if (!limit.allowed) return rateLimitedResponse(limit);

  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Auth is not configured." }, { status: 503 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!vapidConfigured()) {
    return NextResponse.json({ error: "Push is not configured (VAPID keys missing)." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json().catch(() => ({}));
  } catch {
    body = {};
  }
  const parsed = TestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  webpush.setVapidDetails(
    "mailto:aura@example.com",
    process.env.VAPID_PUBLIC_KEY as string,
    process.env.VAPID_PRIVATE_KEY as string
  );

  const { data: subs, error } = await supabase
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: "Could not load subscriptions." }, { status: 500 });
  }

  const payload = JSON.stringify(parsed.data);
  let sent = 0;
  let failed = 0;
  const stale: string[] = [];
  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload
        );
        sent++;
      } catch (e) {
        failed++;
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) stale.push(s.endpoint);
      }
    })
  );
  if (stale.length > 0) {
    await supabase.from("push_subscriptions").delete().eq("user_id", user.id).in("endpoint", stale);
  }
  return NextResponse.json({ sent, failed, pruned: stale.length });
}
