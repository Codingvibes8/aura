/**
 * End-to-end test for the Aura signaling server (Phase 1 + Phase 2 STT).
 *
 * Boots the server, connects two clients, and verifies:
 *   - join / welcome handshake with peer list (+ sttProvider advertisement)
 *   - stt-status on connect (provider available)
 *   - peer-joined broadcast
 *   - WebRTC signal relay (targeted)
 *   - caption broadcast (excluding sender)
 *   - server STT: stt-start → active, scripted captions incl. interim +
 *     utterance grouping, stt-stop → idle
 *   - malformed message rejection
 *   - ping/pong heartbeat
 *   - leave → peer-left broadcast
 *
 * STT runs against the mock provider (STT_PROVIDER=mock) so no API key
 * or microphone is needed.
 *
 * Run: node --no-warnings server/test-signaling.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";
import type { ServerMessage } from "../lib/realtime/schema.ts";

const PORT = 3099;
const URL = `ws://127.0.0.1:${PORT}`;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function collect(ws: WebSocket): ServerMessage[] {
  const inbox: ServerMessage[] = [];
  ws.on("message", (d) => {
    try {
      inbox.push(JSON.parse(d.toString()) as ServerMessage);
    } catch {
      /* ignore */
    }
  });
  return inbox;
}

async function waitFor(inbox: ServerMessage[], type: ServerMessage["type"], timeout = 3000): Promise<ServerMessage | undefined> {
  return waitForWhere(inbox, (m) => m.type === type, timeout);
}

async function waitForWhere(
  inbox: ServerMessage[],
  pred: (m: ServerMessage, index: number) => boolean,
  timeout = 3000
): Promise<ServerMessage | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hit = inbox.find(pred);
    if (hit) return hit;
    await sleep(25);
  }
  return undefined;
}

async function main(): Promise<void> {
  console.log(`[test] booting signaling server on port ${PORT}…`);
  const server: ChildProcess = spawn(
    process.execPath,
    ["--no-warnings", "server/signaling-server.ts"],
    {
      env: { ...process.env, SIGNALING_PORT: String(PORT), STT_PROVIDER: "mock" },
      stdio: "pipe",
    }
  );
  server.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  server.stderr?.on("data", (d) => process.stderr.write(`[server-err] ${d}`));

  try {
    // wait for listener
    let up = false;
    for (let i = 0; i < 40; i++) {
      try {
        await connect().then((w) => w.close());
        up = true;
        break;
      } catch {
        await sleep(100);
      }
    }
    if (!up) throw new Error("server did not come up");

    console.log("[test] server up — running protocol checks…");

    /* ---- 1. join / welcome ---- */
    const a = await connect();
    const aBox = collect(a);

    const preJoinStatus = await waitFor(aBox, "stt-status");
    check(
      "stt-status advertised on connect (mock)",
      preJoinStatus?.type === "stt-status" &&
        preJoinStatus.status === "idle" &&
        preJoinStatus.provider === "mock",
      preJoinStatus
    );

    a.send(JSON.stringify({ type: "join", roomId: "room-1", displayName: "Alice", role: "dhh" }));

    const welcomeA = await waitFor(aBox, "welcome");
    check("A receives welcome", welcomeA?.type === "welcome");
    const aId = welcomeA?.type === "welcome" ? welcomeA.clientId : "";
    check("A has client id", aId.length > 0, aId);
    check(
      "A is listed in its own peer list",
      welcomeA?.type === "welcome" && welcomeA.peers.length === 1
    );
    check(
      "welcome advertises mock STT provider",
      welcomeA?.type === "welcome" && welcomeA.sttProvider === "mock",
      welcomeA?.type === "welcome" ? welcomeA.sttProvider : undefined
    );

    /* ---- 2. peer-joined broadcast ---- */
    const b = await connect();
    const bBox = collect(b);
    b.send(JSON.stringify({ type: "join", roomId: "room-1", displayName: "Bob", role: "hearing" }));

    const welcomeB = await waitFor(bBox, "welcome");
    check("B receives welcome", welcomeB?.type === "welcome");
    const bId = welcomeB?.type === "welcome" ? welcomeB.clientId : "";
    check(
      "B sees A in peer list",
      welcomeB?.type === "welcome" && welcomeB.peers.some((p) => p.id === aId)
    );

    const joinedA = await waitFor(aBox, "peer-joined");
    check(
      "A notified of B joining",
      joinedA?.type === "peer-joined" && joinedA.peer.displayName === "Bob",
      joinedA
    );

    /* ---- 3. signal relay (targeted) ---- */
    a.send(JSON.stringify({ type: "signal", targetId: bId, data: { sdp: "offer-test" } }));
    const sigB = await waitFor(bBox, "signal");
    check(
      "B receives relayed WebRTC signal",
      sigB?.type === "signal" && JSON.stringify(sigB.data).includes("offer-test"),
      sigB
    );
    check("signal carries fromId", sigB?.type === "signal" && sigB.fromId === aId);

    /* ---- 4. caption broadcast ---- */
    a.send(JSON.stringify({ type: "caption", text: "hello", isFinal: true, speaker: "Speaker A", seq: 0 }));
    const capB = await waitFor(bBox, "caption");
    check("B receives caption broadcast", capB?.type === "caption" && capB.caption.text === "hello", capB);
    check("caption seq assigned by server", capB?.type === "caption" && capB.caption.seq === 0);

    const capAtA = aBox.find((m) => m.type === "caption");
    check("sender does NOT receive own caption", !capAtA);

    /* ---- 5. server STT (mock provider) ---- */
    // only match statuses arriving after this mark (earlier idle ones are stale)
    const mark = aBox.length;
    a.send(JSON.stringify({ type: "stt-start", lang: "en" }));
    const sttActive = await waitForWhere(
      aBox,
      (m, i) => m.type === "stt-status" && i >= mark,
      3000
    );
    check(
      "stt-start → active status",
      sttActive?.type === "stt-status" && sttActive.status === "active",
      sttActive
    );

    // mock emits interim word-by-word then finals; collect a few captions
    const sttCaptions: { text: string; isFinal: boolean; utteranceId?: string; speaker: string }[] = [];
    const capStart = Date.now();
    while (Date.now() - capStart < 9000 && sttCaptions.length < 6) {
      for (const m of aBox) {
        if (
          m.type === "caption" &&
          m.fromId === aId &&
          !sttCaptions.some(
            (c) => c.text === m.caption.text && c.isFinal === m.caption.isFinal
          )
        ) {
          sttCaptions.push({
            text: m.caption.text,
            isFinal: m.caption.isFinal,
            utteranceId: m.caption.utteranceId,
            speaker: m.caption.speaker,
          });
        }
      }
      if (sttCaptions.length < 6) await sleep(100);
    }
    check("STT captions stream to the speaker too", sttCaptions.length > 0, sttCaptions.length);
    check(
      "STT interim results arrive before finals",
      sttCaptions.some((c) => !c.isFinal),
      sttCaptions.map((c) => (c.isFinal ? "F" : "i")).join("")
    );
    const finals = sttCaptions.filter((c) => c.isFinal);
    check(
      "STT finals carry diarized speaker labels",
      finals.length > 0 && finals.every((c) => c.speaker.startsWith("Speaker ")),
      finals.map((c) => c.speaker)
    );
    check(
      "STT captions carry utterance grouping ids",
      finals.length > 0 && finals.every((c) => typeof c.utteranceId === "string" && c.utteranceId.length > 0),
      finals.map((c) => c.utteranceId)
    );

    // binary audio frames are accepted mid-session (no error, no crash)
    const errorsBefore = aBox.filter((m) => m.type === "error").length;
    a.send(Buffer.alloc(3200));
    await sleep(300);
    const errorsAfter = aBox.filter((m) => m.type === "error").length;
    check("binary audio frames accepted without errors", errorsAfter === errorsBefore);

    a.send(JSON.stringify({ type: "stt-stop" }));
    const mark2 = aBox.length;
    const sttIdle = await waitForWhere(
      aBox,
      (m, i) => m.type === "stt-status" && i >= mark2,
      3000
    );
    check(
      "stt-stop → idle status",
      sttIdle?.type === "stt-status" && sttIdle.status === "idle",
      sttIdle
    );

    /* ---- 6. malformed rejection ---- */
    a.send(JSON.stringify({ type: "nope" }));
    const err = await waitFor(aBox, "error");
    check("malformed message → error response", err?.type === "error" && err.code === "BAD_MESSAGE", err);

    /* ---- 7. ping/pong ---- */
    a.send(JSON.stringify({ type: "ping" }));
    const pong = await waitFor(aBox, "pong");
    check("ping → pong", !!pong);

    /* ---- 8. leave → peer-left ---- */
    b.send(JSON.stringify({ type: "leave" }));
    const leftA = await waitFor(aBox, "peer-left");
    check(
      "A notified of B leaving",
      leftA?.type === "peer-left" && leftA.peerId === bId && leftA.reason === "left",
      leftA
    );

    a.close();
    b.close();
  } finally {
    server.kill();
  }

  console.log(failures === 0 ? "\n[test] ALL CHECKS PASSED" : `\n[test] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
