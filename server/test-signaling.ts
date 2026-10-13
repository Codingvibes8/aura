/**
 * End-to-end test for the Aura signaling server (Phase 1).
 *
 * Boots the server, connects two clients, and verifies:
 *   - join / welcome handshake with peer list
 *   - peer-joined broadcast
 *   - WebRTC signal relay (targeted)
 *   - caption broadcast (excluding sender)
 *   - malformed message rejection
 *   - ping/pong heartbeat
 *   - leave → peer-left broadcast
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
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hit = inbox.find((m) => m.type === type);
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
    { env: { ...process.env, SIGNALING_PORT: String(PORT) }, stdio: "pipe" }
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
    a.send(JSON.stringify({ type: "join", roomId: "room-1", displayName: "Alice", role: "dhh" }));

    const welcomeA = await waitFor(aBox, "welcome");
    check("A receives welcome", welcomeA?.type === "welcome");
    const aId = welcomeA?.type === "welcome" ? welcomeA.clientId : "";
    check("A has client id", aId.length > 0, aId);
    check(
      "A is listed in its own peer list",
      welcomeA?.type === "welcome" && welcomeA.peers.length === 1
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

    /* ---- 5. malformed rejection ---- */
    a.send(JSON.stringify({ type: "nope" }));
    const err = await waitFor(aBox, "error");
    check("malformed message → error response", err?.type === "error" && err.code === "BAD_MESSAGE", err);

    /* ---- 6. ping/pong ---- */
    a.send(JSON.stringify({ type: "ping" }));
    const pong = await waitFor(aBox, "pong");
    check("ping → pong", !!pong);

    /* ---- 7. leave → peer-left ---- */
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
