/**
 * In-memory fixed-window rate limiter for Next.js Route Handlers (Phase 8.1).
 *
 * Keyed by client IP (+ route). Single-instance safe; use Redis/Upstash for
 * multi-instance production (see BACKEND_ROADMAP 8.1). Quota-critical routes
 * (TTS synthesis → ElevenLabs spend) get the tightest budgets.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimit {
  /** requests allowed per window */
  limit: number;
  /** window length in ms */
  windowMs: number;
}

export const RATE_LIMITS = {
  /** ElevenLabs spend protection */
  ttsSynthesize: { limit: 30, windowMs: 60_000 },
  ttsStatus: { limit: 120, windowMs: 60_000 },
  phrasesWrite: { limit: 60, windowMs: 60_000 },
  phrasesRead: { limit: 300, windowMs: 60_000 },
  settings: { limit: 120, windowMs: 60_000 },
  profile: { limit: 120, windowMs: 60_000 },
  account: { limit: 10, windowMs: 60_000 },
} satisfies Record<string, RateLimit>;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

export interface RateCheck {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export function checkRate(req: Request, route: string, rule: RateLimit): RateCheck {
  const key = `${route}:${clientIp(req)}`;
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + rule.windowMs };
    buckets.set(key, bucket);
  }
  // opportunistic cleanup to bound memory
  if (buckets.size > 5000 && Math.random() < 0.01) {
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }
  if (bucket.count >= rule.limit) {
    return { allowed: false, remaining: 0, resetSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count++;
  return {
    allowed: true,
    remaining: rule.limit - bucket.count,
    resetSeconds: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

export function rateLimitedResponse(check: RateCheck): Response {
  return Response.json(
    { error: "Rate limit exceeded — slow down.", retryAfterSeconds: check.resetSeconds },
    {
      status: 429,
      headers: {
        "Retry-After": String(check.resetSeconds),
        "X-RateLimit-Remaining": String(check.remaining),
      },
    }
  );
}
