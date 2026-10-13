/**
 * End-to-end encryption for private rooms (Phase 8.2).
 *
 * AES-GCM-256 with keys derived per room via PBKDF2-SHA256
 * (passphrase + roomId salt, 100k iterations). The server relays only
 * ciphertext — it never sees plaintext or keys.
 *
 * Scope: caption text + ambient labels. Sequence numbers, utterance ids,
 * speaker labels, and intensity stay plaintext (routing metadata).
 * Server-side STT/ambient are incompatible by design (they need plaintext
 * server processing) and are refused in private rooms.
 */

export interface SealedEnvelope {
  alg: "A256GCM";
  /** base64 nonce */
  iv: string;
  /** base64 ciphertext */
  ct: string;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Derive a room key. Same (passphrase, roomId) → same key, on any device. */
export async function deriveRoomKey(passphrase: string, roomId: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(`aura-v1:${roomId}`),
      iterations: 100_000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function sealText(key: CryptoKey, plaintext: string): Promise<SealedEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return { alg: "A256GCM", iv: b64encode(iv), ct: b64encode(new Uint8Array(ct)) };
}

export async function openEnvelope(key: CryptoKey, env: SealedEnvelope): Promise<string> {
  if (env.alg !== "A256GCM") throw new Error("unsupported envelope");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64decode(env.iv) },
    key,
    b64decode(env.ct)
  );
  return new TextDecoder().decode(pt);
}
