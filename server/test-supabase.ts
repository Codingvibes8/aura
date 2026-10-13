/**
 * API shape tests for Auth/Profile/Settings/Phrases (Phase 6).
 *
 * Without Supabase credentials the routes must fail CLOSED and
 * predictably: 401 (signed out) / 503 (unconfigured) / 400 (bad input).
 * Run against a live dev server: `npm run dev` in another shell, then
 * `npm run test:supabase`. Skips cleanly if the server is unreachable.
 *
 * Run: node --no-warnings server/test-supabase.ts
 */

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";

let failures = 0;
let skipped = false;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`);
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

async function post(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

async function put(path: string, payload: unknown): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

async function del(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  console.log(`[test] Supabase API shape checks against ${BASE}…`);

  try {
    await fetch(`${BASE}/api/tts`, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.log("[test] SKIP — dev server unreachable (run `npm run dev` first)");
    skipped = true;
    process.exit(0);
  }

  /* ---- unauthenticated access fails closed ---- */
  const profile = await get("/api/profile");
  check("GET /api/profile without session → 401/503", profile.status === 401 || profile.status === 503, profile.status);

  const settings = await get("/api/settings");
  check("GET /api/settings without session → 401/503", settings.status === 401 || settings.status === 503, settings.status);

  const phrases = await get("/api/phrases");
  check("GET /api/phrases without session → 401/503", phrases.status === 401 || phrases.status === 503, phrases.status);

  /* ---- auth gate first (401 signed out, 503 unconfigured), validation second ---- */
  const badPhrase = await post("/api/phrases", { text: "" });
  check(
    "POST /api/phrases empty text → 400 or 401",
    badPhrase.status === 400 || badPhrase.status === 401,
    badPhrase.status
  );

  const badSettings = await put("/api/settings", { font_scale: 99 });
  check(
    "PUT /api/settings out-of-range → 400 or 401",
    badSettings.status === 400 || badSettings.status === 401,
    badSettings.status
  );

  const delNoId = await del("/api/phrases");
  check(
    "DELETE /api/phrases without id → 400 or 401",
    delNoId.status === 400 || delNoId.status === 401,
    delNoId.status
  );

  /* ---- error bodies carry messages ---- */
  const body = profile.body as { error?: string } | null;
  check("error responses carry messages", !!body && typeof body.error === "string", body);

  /* ---- pages serve ---- */
  const loginPage = await fetch(`${BASE}/login`);
  check("GET /login serves", loginPage.status === 200, loginPage.status);

  /* ---- rate limiting (Phase 8.1): hammer TTS synthesis until 429 ---- */
  let saw429 = false;
  for (let n = 0; n < 40; n++) {
    const r = await post("/api/tts", { text: "rate limit probe" });
    if (r.status === 429) {
      saw429 = true;
      const body = r.body as { retryAfterSeconds?: number };
      check("429 carries retry hint", typeof body.retryAfterSeconds === "number", body);
      break;
    }
  }
  check("TTS synthesis throttled with 429", saw429);

  console.log(
    failures === 0
      ? `\n[test] ALL CHECKS PASSED${skipped ? " (skipped)" : ""}`
      : `\n[test] ${failures} CHECK(S) FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
