"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Headset, PhoneOff, Video } from "lucide-react";
import { useRealtime } from "@/components/realtime-provider";
import { usePeerCall } from "@/lib/realtime/use-peer-call";
import { useWakeLock } from "@/lib/use-wake-lock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { VideoView } from "@/components/video-view";

const LANGUAGE_OPTIONS = [
  { id: "asl", label: "ASL" },
  { id: "bsl", label: "BSL" },
  { id: "lsf", label: "LSF" },
  { id: "is", label: "International Sign" },
  { id: "any", label: "Any" },
];

interface IncomingRequest {
  requestId: string;
  roomId: string;
  displayName: string;
  language: string;
  priority: "standard" | "emergency";
}

/**
 * Interpreter console (Phase 5.1): availability + languages register
 * presence with the server queue; incoming match requests can be
 * accepted (auto-joins the requester's room with camera) or declined
 * (request requeues at front). Video answers automatically on offer.
 */
export function InterpreterConsole() {
  const { join, roomId, connectionState, onMessage, vrsSetAvailable, vrsDecline, vrsEnd } = useRealtime();
  const call = usePeerCall();
  const hangUpCall = call.hangUp;

  const [available, setAvailable] = useState(false);
  const [languages, setLanguages] = useState<string[]>(["asl"]);
  const [name, setName] = useState("");
  const [incoming, setIncoming] = useState<IncomingRequest[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [endedNote, setEndedNote] = useState<string | null>(null);

  useWakeLock(activeRequestId !== null);

  const displayName = name.trim() || "Interpreter";

  /* Publish presence whenever availability, languages, or identity change.
     Going available without a room first joins the interpreters lobby. */
  useEffect(() => {
    if (connectionState !== "open") return;
    if (available && !roomId) {
      join("INTERPRETERS", displayName, "interpreter");
    }
    vrsSetAvailable(available, languages);
    // presence refresh is fire-and-forget; server holds last state
  }, [available, languages, connectionState, roomId, displayName, join, vrsSetAvailable]);

  /* Match requests + call end */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === "interpreter-match-request") {
        setIncoming((prev) =>
          prev.some((r) => r.requestId === msg.requestId)
            ? prev
            : [
                ...prev,
                {
                  requestId: msg.requestId,
                  roomId: msg.roomId,
                  displayName: msg.displayName,
                  language: msg.language,
                  priority: msg.priority,
                },
              ]
        );
      } else if (msg.type === "interpreter-ended") {
        setIncoming((prev) => prev.filter((r) => r.requestId !== msg.requestId));
        if (activeRequestId === msg.requestId) {
          setActiveRequestId(null);
          hangUpCall();
          setEndedNote(
            msg.reason === "disconnected"
              ? "The other side disconnected — session logged."
              : "Call ended. Session logged."
          );
        }
      }
    });
  }, [onMessage, activeRequestId, hangUpCall]);

  const toggleLanguage = (id: string) => {
    setLanguages((prev) => (prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]));
  };

  const accept = async (req: IncomingRequest) => {
    setEndedNote(null);
    // Join the requester's room so WebRTC signals route, then warm the camera.
    // The requester's offer auto-answers once media is ready.
    if (roomId !== req.roomId) {
      join(req.roomId, displayName, "interpreter");
    }
    await call.preview();
    setIncoming((prev) => prev.filter((r) => r.requestId !== req.requestId));
    setActiveRequestId(req.requestId);
  };

  const decline = (requestId: string) => {
    vrsDecline(requestId);
    setIncoming((prev) => prev.filter((r) => r.requestId !== requestId));
  };

  const endCall = () => {
    vrsEnd();
    call.hangUp();
    setActiveRequestId(null);
    setEndedNote("Call ended. Session logged.");
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Presence */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Headset className="size-4 text-primary" aria-hidden="true" />
            Availability
          </CardTitle>
          <CardDescription>Your presence feeds the live matching queue.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="interp-name" className="text-sm font-medium">
              Display name
            </label>
            <input
              id="interp-name"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="Interpreter"
              className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Languages you sign</legend>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((l) => {
                const on = languages.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => toggleLanguage(l.id)}
                    aria-pressed={on}
                    className={
                      on
                        ? "cursor-pointer rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        : "cursor-pointer rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    }
                  >
                    {l.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
            <div>
              <label htmlFor="interp-available" className="text-sm font-semibold">
                Available for calls
              </label>
              <p className="text-xs text-muted-foreground">
                {available ? "You can be matched right now." : "You are hidden from matching."}
              </p>
            </div>
            <Switch
              id="interp-available"
              checked={available}
              onCheckedChange={setAvailable}
              aria-label="Available for interpreter calls"
            />
          </div>
          {available && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
              Live in the queue{roomId ? ` · room ${roomId}` : " · join a request to enter its room"}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Incoming requests */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Incoming requests</CardTitle>
          <CardDescription>Declined requests requeue at the front.</CardDescription>
        </CardHeader>
        <CardContent>
          {incoming.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              No requests right now. Keep availability on — matches arrive here in real time.
            </p>
          ) : (
            <ul className="space-y-2">
              {incoming.map((req) => (
                <li key={req.requestId} className="rounded-lg border border-border p-3">
                  <div className="flex items-center gap-2">
                    <p className="flex-1 text-sm font-semibold">{req.displayName}</p>
                    <Badge variant="secondary">{req.language.toUpperCase()}</Badge>
                    {req.priority === "emergency" && <Badge variant="destructive">Emergency</Badge>}
                  </div>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">Room {req.roomId}</p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" onClick={() => void accept(req)}>
                      <Video aria-hidden="true" /> Accept + join
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => decline(req.requestId)}>
                      Decline
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Active call */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active call</CardTitle>
          <CardDescription>Video answers automatically on offer.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {endedNote && !activeRequestId && (
            <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
              {endedNote}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <VideoView stream={call.localStream} label="You" muted className="aspect-video" />
            <VideoView stream={call.remoteStream} label="Caller" className="aspect-video" />
          </div>
          {call.error && (
            <p role="alert" className="text-xs text-destructive">
              {call.error}
            </p>
          )}
          {call.callState === "calling" && (
            <p role="status" className="text-center text-sm text-muted-foreground">
              Ringing…
            </p>
          )}
          {(activeRequestId || call.callState !== "idle") && (
            <Button type="button" variant="outline" onClick={endCall} className="w-full">
              <PhoneOff aria-hidden="true" /> End call
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
