/**
 * Tests for the interpreter relay service (Phase 5).
 *
 * Part 1 — pure queue logic (no server): ordering, language overlap,
 * decline requeue, ETA heuristic.
 * Part 2 — server protocol: presence, request → queue → match, second
 * requester waits, end frees + auto-matches, decline requeues, emergency
 * ordering, disconnect handling, demo fallback, session log.
 *
 * Run: node --no-warnings server/test-vrs.ts
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { readFileSync, rmSync } from "node:fs";
import WebSocket from "ws";
import type { ServerMessage } from "../lib/realtime/schema.ts";
import {
  InterpreterQueue,
  estimateWaitSeconds,
  languagesOverlap,
} from "./vrs/queue.ts";

const PORT = 3098;
const URL = `ws://127.0.0.1:${PORT}`;
const LOG_FILE = `${process.cwd()}/data/test-vrs-sessions.jsonl`;

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name}`, detail !== undefined ? detail : "");
  }
}

/* ------------------------------------------------------------------ */
/* Part 1 — queue unit checks                                          */
/* ------------------------------------------------------------------ */

function unitChecks(): void {
  console.log("[test] VRS queue unit checks…");
  const q = new InterpreterQueue();

  check("language overlap exact", languagesOverlap(["asl"], "asl"));
  check("language overlap any-wildcard", languagesOverlap(["any"], "bsl"));
  check("language mismatch rejected", !languagesOverlap(["asl"], "bsl"));

  const std = q.enqueue({ peerId: "a", roomId: "r", displayName: "A", language: "asl", priority: "standard", logConsent: true });
  const emg = q.enqueue({ peerId: "b", roomId: "r", displayName: "B", language: "asl", priority: "emergency", logConsent: true });
  const order = q.list();
  check("emergency sorts ahead of standard", order[0].requestId === emg.requestId, order.map((e) => e.priority));

  check("position lookup", q.positionOf(emg.requestId) === 0 && q.positionOf(std.requestId) === 1);

  q.setInterpreter({ peerId: "i1", displayName: "Ivy", languages: ["bsl"], available: true, busyWith: null });
  check("no match on language mismatch", q.matchNext() === null);

  q.setInterpreter({ peerId: "i2", displayName: "Ash", languages: ["asl"], available: false, busyWith: null });
  check("no match when interpreter unavailable", q.matchNext() === null);

  q.setInterpreter({ peerId: "i2", displayName: "Ash", languages: ["asl"], available: true, busyWith: null });
  const m = q.matchNext();
  check("emergency matched first", m?.requestId === emg.requestId && m.interpreterId === "i2", m);
  check("matched entry dequeued", q.positionOf(emg.requestId) === -1);
  check("interpreter marked busy", q.getInterpreter("i2")?.busyWith === emg.requestId);

  const re = q.requeueFront({ peerId: "b", roomId: "r", displayName: "B", language: "asl", priority: "emergency", logConsent: true });
  check("declined request requeues at front", q.positionOf(re.requestId) === 0);

  q.releaseInterpreter("i2");
  check("release frees interpreter", q.getInterpreter("i2")?.busyWith === null);

  check("ETA grows with queue ahead", estimateWaitSeconds(2) > estimateWaitSeconds(0), [estimateWaitSeconds(0), estimateWaitSeconds(2)]);
}

/* ------------------------------------------------------------------ */
/* Part 2 — server protocol                                            */
/* ------------------------------------------------------------------ */

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

async function waitForWhere(
  inbox: ServerMessage[],
  pred: (m: ServerMessage, index: number) => boolean,
  timeout = 4000
): Promise<ServerMessage | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const hit = inbox.find(pred);
    if (hit) return hit;
    await sleep(25);
  }
  return undefined;
}

function bootServer(extraEnv: Record<string, string>): Promise<ChildProcess> {
  return new Promise((resolve) => {
    const server = spawn(process.execPath, ["--no-warnings", "server/signaling-server.ts"], {
      env: { ...process.env, SIGNALING_PORT: String(PORT), STT_PROVIDER: "mock", AMBIENT_PROVIDER: "mock", VRS_LOG_FILE: LOG_FILE, ...extraEnv },
      stdio: "pipe",
    });
    server.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
    server.stderr?.on("data", (d) => process.stderr.write(`[server-err] ${d}`));
    resolve(server);
  });
}

async function waitUp(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      await connect().then((w) => w.close());
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("server did not come up");
}

async function protocolChecks(): Promise<void> {
  console.log("[test] VRS server protocol checks (demo off)…");
  const server = await bootServer({ VRS_DEMO_MODE: "false" });
  try {
    await waitUp();

    /* interpreter presence */
    const interp = await connect();
    const iBox = collect(interp);
    interp.send(JSON.stringify({ type: "join", roomId: "ROOM-V", displayName: "Ivy", role: "interpreter" }));
    await waitForWhere(iBox, (m) => m.type === "welcome");
    interp.send(JSON.stringify({ type: "interpreter-status", available: true, languages: ["asl"] }));
    await sleep(200);

    /* requester A → immediate match */
    const a = await connect();
    const aBox = collect(a);
    a.send(JSON.stringify({ type: "join", roomId: "ROOM-V", displayName: "Alice", role: "dhh" }));
    await waitForWhere(aBox, (m) => m.type === "welcome");
    let mark = aBox.length;
    a.send(JSON.stringify({ type: "interpreter-request", roomId: "ROOM-V", language: "asl", priority: "standard" }));
    const qA = await waitForWhere(aBox, (m, i) => m.type === "interpreter-queue" && i >= mark);
    check("requester gets queue position", qA?.type === "interpreter-queue" && qA.position === 1 && qA.ahead === 0, qA);
    const matchA = await waitForWhere(aBox, (m, i) => m.type === "interpreter-match" && i >= mark);
    check(
      "requester matched with live interpreter",
      matchA?.type === "interpreter-match" && matchA.match.interpreterName === "Ivy" && !matchA.match.demo,
      matchA
    );
    const matchReq = await waitForWhere(iBox, (m) => m.type === "interpreter-match-request");
    check(
      "interpreter receives match request",
      matchReq?.type === "interpreter-match-request" && matchReq.displayName === "Alice",
      matchReq
    );
    const reqIdA = matchA?.type === "interpreter-match" ? matchA.match.requestId : "";

    /* requester B queues behind the busy interpreter */
    const b = await connect();
    const bBox = collect(b);
    b.send(JSON.stringify({ type: "join", roomId: "ROOM-V", displayName: "Bob", role: "dhh" }));
    await waitForWhere(bBox, (m) => m.type === "welcome");
    mark = bBox.length;
    b.send(JSON.stringify({ type: "interpreter-request", roomId: "ROOM-V", language: "asl" }));
    const qB = await waitForWhere(bBox, (m, i) => m.type === "interpreter-queue" && i >= mark);
    check("second requester queues (interpreter busy)", qB?.type === "interpreter-queue" && qB.ahead === 0, qB);

    /* A ends → both notified, B auto-matched */
    mark = aBox.length;
    const markB = bBox.length;
    const markI = iBox.length;
    a.send(JSON.stringify({ type: "interpreter-end" }));
    const endA = await waitForWhere(aBox, (m, i) => m.type === "interpreter-ended" && i >= mark);
    check("requester notified of call end", endA?.type === "interpreter-ended" && endA.reason === "ended", endA);
    const endI = await waitForWhere(iBox, (m, i) => m.type === "interpreter-ended" && i >= markI);
    check("interpreter notified of call end", !!endI);
    const matchB = await waitForWhere(bBox, (m, i) => m.type === "interpreter-match" && i >= markB, 5000);
    check("freed interpreter auto-matches next in queue", !!matchB);
    const reqIdB = matchB?.type === "interpreter-match" ? matchB.match.requestId : "";
    void reqIdA;

    /* interpreter declines → Bob requeues at front and instantly rematches
       (Ivy is free again), so expect a NEW match, not a queue message */
    mark = bBox.length;
    interp.send(JSON.stringify({ type: "interpreter-decline", requestId: reqIdB }));
    const rematchB = await waitForWhere(bBox, (m, i) => m.type === "interpreter-match" && i >= mark);
    check(
      "declined request requeues and rematches",
      rematchB?.type === "interpreter-match" && rematchB.match.requestId !== reqIdB && !rematchB.match.demo,
      rematchB
    );

    /* emergency ordering: C standard, D emergency (Bob is in a call, so the
       queue holds C then D → sorted D first). Dan should land at front
       (ahead 0) while Cara drops behind (ahead 1). */
    const c = await connect();
    const cBox = collect(c);
    c.send(JSON.stringify({ type: "join", roomId: "ROOM-V", displayName: "Cara", role: "dhh" }));
    await waitForWhere(cBox, (m) => m.type === "welcome");
    c.send(JSON.stringify({ type: "interpreter-request", roomId: "ROOM-V", language: "asl", priority: "standard" }));
    await waitForWhere(cBox, (m) => m.type === "interpreter-queue");
    const d = await connect();
    const dBox = collect(d);
    d.send(JSON.stringify({ type: "join", roomId: "ROOM-V", displayName: "Dan", role: "dhh" }));
    await waitForWhere(dBox, (m) => m.type === "welcome");
    const markD = dBox.length;
    const markC = cBox.length;
    d.send(JSON.stringify({ type: "interpreter-request", roomId: "ROOM-V", language: "asl", priority: "emergency" }));
    const qD = await waitForWhere(dBox, (m, i) => m.type === "interpreter-queue" && i >= markD);
    check("emergency lands at front of queue", qD?.type === "interpreter-queue" && qD.ahead === 0, qD);
    const qC = await waitForWhere(
      cBox,
      (m, i) => m.type === "interpreter-queue" && i >= markC && m.ahead === 1
    );
    check("standard request drops behind emergency", !!qC);

    /* B disconnects mid-queue → positions update */
    b.close();
    await sleep(400);

    /* D cancels → ended(cancelled) */
    const markD2 = dBox.length;
    d.send(JSON.stringify({ type: "interpreter-cancel" }));
    const cancelD = await waitForWhere(dBox, (m, i) => m.type === "interpreter-ended" && i >= markD2);
    check("cancel ends queued request", cancelD?.type === "interpreter-ended" && cancelD.reason === "cancelled", cancelD);

    a.close();
    c.close();
    d.close();
    interp.close();
    await sleep(300);
  } finally {
    server.kill();
  }

  /* session log assertions */
  let lines: string[] = [];
  try {
    lines = readFileSync(LOG_FILE, "utf8").split("\n").filter((l) => l.trim());
  } catch {
    /* missing log */
  }
  check("session log file written", lines.length >= 1, lines.length);
  const first = lines.length > 0 ? (JSON.parse(lines[0]) as { requesterName?: string; interpreterName?: string; durationS?: number; endReason?: string }) : null;
  check(
    "session record has parties + duration + reason",
    !!first && first.requesterName === "Alice" && first.interpreterName === "Ivy" && typeof first.durationS === "number",
    first
  );
}

async function demoCheck(): Promise<void> {
  console.log("[test] VRS demo fallback check…");
  const server = await bootServer({ VRS_DEMO_MODE: "true", VRS_DEMO_DELAY_S: "1" });
  try {
    await waitUp();
    const a = await connect();
    const aBox = collect(a);
    a.send(JSON.stringify({ type: "join", roomId: "ROOM-D", displayName: "Zed", role: "dhh" }));
    await waitForWhere(aBox, (m) => m.type === "welcome");
    const mark = aBox.length;
    a.send(JSON.stringify({ type: "interpreter-request", roomId: "ROOM-D", language: "asl" }));
    const match = await waitForWhere(aBox, (m, i) => m.type === "interpreter-match" && i >= mark, 6000);
    check(
      "demo interpreter auto-matches with no humans online",
      match?.type === "interpreter-match" && match.match.demo === true,
      match
    );
    a.close();
    await sleep(300);
  } finally {
    server.kill();
  }
}

async function switchCheck(): Promise<void> {
  console.log("[test] VRS room-hop regression check…");
  const server = await bootServer({ VRS_DEMO_MODE: "false" });
  try {
    await waitUp();
    // interpreter idles in the lobby, requester waits in a call room
    const i = await connect();
    const iBox = collect(i);
    i.send(JSON.stringify({ type: "join", roomId: "LOBBY", displayName: "Hop", role: "interpreter" }));
    await waitForWhere(iBox, (m) => m.type === "welcome");
    i.send(JSON.stringify({ type: "interpreter-status", available: true, languages: ["asl"] }));
    await sleep(200);

    const a = await connect();
    const aBox = collect(a);
    a.send(JSON.stringify({ type: "join", roomId: "ROOM-S", displayName: "Sam", role: "dhh" }));
    await waitForWhere(aBox, (m) => m.type === "welcome");
    a.send(JSON.stringify({ type: "interpreter-request", roomId: "ROOM-S", language: "asl" }));
    const match = await waitForWhere(aBox, (m) => m.type === "interpreter-match");
    check("lobby interpreter matches call-room request", !!match);
    const reqId = match?.type === "interpreter-match" ? match.match.requestId : "";

    // interpreter hops INTO the call room — the call must survive
    i.send(JSON.stringify({ type: "join", roomId: "ROOM-S", displayName: "Hop", role: "interpreter" }));
    await sleep(600);
    const killedOnHop = aBox.some(
      (m) => m.type === "interpreter-ended" && (m as { requestId?: string }).requestId === reqId
    );
    check("call survives hop into the call room", !killedOnHop);

    // requester ends normally → both sides notified (call was alive)
    const markA = aBox.length;
    const markI = iBox.length;
    a.send(JSON.stringify({ type: "interpreter-end" }));
    const endA = await waitForWhere(aBox, (m, i2) => m.type === "interpreter-ended" && i2 >= markA);
    const endI = await waitForWhere(iBox, (m, i2) => m.type === "interpreter-ended" && i2 >= markI);
    check(
      "post-hop call ends cleanly for both sides",
      endA?.type === "interpreter-ended" && endA.reason === "ended" && !!endI
    );

    a.close();
    i.close();
    await sleep(300);
  } finally {
    server.kill();
  }
}

async function consentCheck(): Promise<void> {
  console.log("[test] VRS log-consent check (Phase 8.4)…");
  const server = await bootServer({ VRS_DEMO_MODE: "false" });
  try {
    await waitUp();
    const i = await connect();
    const iBox = collect(i);
    i.send(JSON.stringify({ type: "join", roomId: "ROOM-C", displayName: "Con", role: "interpreter" }));
    await waitForWhere(iBox, (m) => m.type === "welcome");
    i.send(JSON.stringify({ type: "interpreter-status", available: true, languages: ["any"] }));
    await sleep(200);

    const a = await connect();
    const aBox = collect(a);
    a.send(JSON.stringify({ type: "join", roomId: "ROOM-C", displayName: "NoLog", role: "dhh" }));
    await waitForWhere(aBox, (m) => m.type === "welcome");
    const mark = aBox.length;
    a.send(
      JSON.stringify({ type: "interpreter-request", roomId: "ROOM-C", language: "asl", logConsent: false })
    );
    const match = await waitForWhere(aBox, (m, idx) => m.type === "interpreter-match" && idx >= mark);
    check("opt-out request still matches", !!match);
    const reqId = match?.type === "interpreter-match" ? match.match.requestId : "";
    a.send(JSON.stringify({ type: "interpreter-end" }));
    await waitForWhere(aBox, (m, idx) => m.type === "interpreter-ended" && idx >= mark);
    await sleep(300);
    a.close();
    i.close();
    await sleep(300);

    let logged = false;
    try {
      const lines = readFileSync(LOG_FILE, "utf8").split("\n").filter((l) => l.trim());
      logged = lines.some((l) => l.includes(reqId));
    } catch {
      /* missing log */
    }
    check("opted-out call leaves no session record", !!reqId && !logged, reqId);
  } finally {
    server.kill();
  }
}

async function main(): Promise<void> {
  try {
    rmSync(LOG_FILE, { force: true });
  } catch {
    /* nothing to clean */
  }
  unitChecks();
  await protocolChecks();
  await demoCheck();
  await switchCheck();
  await consentCheck();
  console.log(failures === 0 ? "\n[test] ALL CHECKS PASSED" : `\n[test] ${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[test] fatal:", e);
  process.exit(1);
});
