/**
 * PWA + push shape tests (Phase 9).
 *
 * Verifies manifest/icons/offline/SW serving and push API gates against a
 * live dev server. Skips cleanly if unreachable. A real end-to-end push
 * needs a signed-in browser with Notification permission (manual QA).
 *
 * Run: node --no-warnings server/test-pwa.ts
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const ROOT = process.cwd();

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

async function main(): Promise<void> {
  console.log(`[test] PWA shape checks against ${BASE}…`);

  try {
    await fetch(`${BASE}/api/tts`, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.log("[test] SKIP — dev server unreachable (run `npm run dev` first)");
    process.exit(0);
  }

  /* ---- service worker source ---- */
  const swPath = join(ROOT, "public", "sw.js");
  check("sw.js exists", existsSync(swPath));
  const sw = existsSync(swPath) ? readFileSync(swPath, "utf8") : "";
  check("SW handles push events", sw.includes('addEventListener("push"'));
  check("SW handles notification clicks", sw.includes("notificationclick"));
  check("SW has offline fallback", sw.includes("/offline"));

  /* ---- manifest ---- */
  const manRes = await fetch(`${BASE}/manifest.webmanifest`);
  let manifest: Record<string, unknown> = {};
  try {
    manifest = (await manRes.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  check("manifest serves", manRes.status === 200, manRes.status);
  check("manifest has name + icons + start_url", !!manifest.name && Array.isArray(manifest.icons) && typeof manifest.start_url === "string", {
    name: manifest.name,
    icons: Array.isArray(manifest.icons) ? manifest.icons.length : 0,
  });
  check("manifest is standalone", manifest.display === "standalone", manifest.display);

  /* ---- icons + offline ---- */
  const icon = await fetch(`${BASE}/icon`);
  check("GET /icon → PNG", icon.status === 200 && (icon.headers.get("content-type") ?? "").includes("image"), `${icon.status} ${icon.headers.get("content-type")}`);
  const apple = await fetch(`${BASE}/apple-icon`);
  check("GET /apple-icon → 200", apple.status === 200, apple.status);
  const offline = await fetch(`${BASE}/offline`);
  check("GET /offline serves", offline.status === 200, offline.status);
  const swServe = await fetch(`${BASE}/sw.js`);
  check("GET /sw.js serves", swServe.status === 200, swServe.status);

  /* ---- push API gates ---- */
  const pushStatus = await fetch(`${BASE}/api/push`);
  check("GET /api/push serves capability flags", pushStatus.status === 200, pushStatus.status);
  const pushBody = (await pushStatus.json().catch(() => ({}))) as { configured?: boolean };
  check("push status reports configured flag", typeof pushBody.configured === "boolean", pushBody);

  const subAnon = await fetch(`${BASE}/api/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: "https://example.com/x", keys: { p256dh: "a", auth: "b" } }),
  });
  check("POST /api/push without session → 401", subAnon.status === 401, subAnon.status);

  const testAnon = await fetch(`${BASE}/api/push/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("POST /api/push/test without session → 401", testAnon.status === 401, testAnon.status);

  console.log(failures === 0 ? "\n[test] ALL CHECKS PASSED" : `\n[test] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
