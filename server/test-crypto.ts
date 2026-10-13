/**
 * Unit tests for private-room E2EE (Phase 8.2).
 *
 * PBKDF2 key derivation determinism, AES-GCM seal/open roundtrip,
 * wrong-passphrase and tampered-ciphertext rejection. Uses the WebCrypto
 * available in Node 24 — no browser needed.
 *
 * Run: node --no-warnings server/test-crypto.ts
 */

import { deriveRoomKey, sealText, openEnvelope } from "../lib/realtime/crypto.ts";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

async function main(): Promise<void> {
  console.log("[test] E2EE crypto unit checks…");

  if (typeof crypto === "undefined" || !crypto.subtle) {
    console.log("[test] SKIP — WebCrypto unavailable");
    process.exit(0);
  }

  /* ---- key derivation ---- */
  const k1 = await deriveRoomKey("correct horse", "ROOM-1");
  const k2 = await deriveRoomKey("correct horse", "ROOM-1");
  const k3 = await deriveRoomKey("correct horse", "ROOM-2");
  const ct1 = await sealText(k1, "hello captions");
  const open1 = await openEnvelope(k2, ct1);
  check("same passphrase+room re-derives a working key", open1 === "hello captions", open1);

  let roomIsolation = false;
  try {
    await openEnvelope(k3, ct1);
  } catch {
    roomIsolation = true;
  }
  check("room id salts the key (cross-room open fails)", roomIsolation);

  /* ---- roundtrip ---- */
  const key = await deriveRoomKey("s3cr3t-passphrase", "PRIV-9");
  const messages = ["", "Hi!", "A longer line with punctuation, numbers 123, and emoji 👋"];
  for (const m of messages) {
    const env = await sealText(key, m);
    check(`roundtrip ${JSON.stringify(m).slice(0, 24)}`, (await openEnvelope(key, env)) === m);
    check("envelope shape", env.alg === "A256GCM" && env.iv.length > 0 && env.ct.length > 0, env.alg);
  }

  /* ---- wrong passphrase ---- */
  const wrong = await deriveRoomKey("wrong-passphrase", "PRIV-9");
  let rejected = false;
  try {
    await openEnvelope(wrong, await sealText(key, "secret"));
  } catch {
    rejected = true;
  }
  check("wrong passphrase rejected", rejected);

  /* ---- tampering ---- */
  const env = await sealText(key, "tamper me");
  const raw = Uint8Array.from(atob(env.ct), (c) => c.charCodeAt(0));
  raw[raw.length - 1] ^= 0xff;
  let tamperRejected = false;
  try {
    let s = "";
    for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
    await openEnvelope(key, { ...env, ct: btoa(s) });
  } catch {
    tamperRejected = true;
  }
  check("tampered ciphertext rejected (GCM auth)", tamperRejected);

  /* ---- nonce uniqueness ---- */
  const a = await sealText(key, "same plaintext");
  const b = await sealText(key, "same plaintext");
  check("random nonces (identical input differs)", a.ct !== b.ct || a.iv !== b.iv);

  console.log(failures === 0 ? "\n[test] ALL CHECKS PASSED" : `\n[test] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
