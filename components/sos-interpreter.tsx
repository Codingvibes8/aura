"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Phone, PhoneOff, Siren, Video } from "lucide-react";
import { useRealtime } from "@/components/realtime-provider";
import { usePeerCall } from "@/lib/realtime/use-peer-call";
import type { InterpreterMatchInfo, Role } from "@/lib/realtime/schema";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { VideoView } from "@/components/video-view";

type SosState = "idle" | "queued" | "matched";

interface QueueInfo {
  requestId: string;
  position: number;
  ahead: number;
  etaSeconds: number;
  priority: "standard" | "emergency";
}

const LANGUAGES = [
  { id: "asl", label: "ASL — American Sign Language" },
  { id: "bsl", label: "BSL — British Sign Language" },
  { id: "lsf", label: "LSF — French Sign Language" },
  { id: "is", label: "International Sign" },
  { id: "any", label: "Any available" },
];

function randomRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/**
 * Aira-style on-demand interpreter access (Phase 5).
 *
 * Requests flow through the server VRS queue: live position + ETA,
 * language matching, emergency escalation, then a WebRTC video call
 * with the matched interpreter. With no interpreter online, the server
 * auto-matches a demo interpreter so the flow works out of the box.
 */
export function SosInterpreter({ compact = false, role = "dhh" }: { compact?: boolean; role?: Role }) {
  const { join, roomId, connectionState, onMessage, vrsRequest, vrsCancel, vrsEnd } = useRealtime();
  const call = usePeerCall();
  const hangUpCall = call.hangUp;

  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SosState>("idle");
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  const [match, setMatch] = useState<InterpreterMatchInfo | null>(null);
  const [endedNote, setEndedNote] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("asl");
  const [emergency, setEmergency] = useState(false);
  const [logConsent, setLogConsent] = useState(true);

  const namePlaceholder = role === "hearing" ? "Hearing user" : role === "interpreter" ? "Interpreter" : "DHH user";

  /* Server VRS events */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === "interpreter-queue") {
        setQueue({
          requestId: msg.requestId,
          position: msg.position,
          ahead: msg.ahead,
          etaSeconds: msg.etaSeconds,
          priority: msg.priority,
        });
        setState("queued");
      } else if (msg.type === "interpreter-match") {
        setMatch(msg.match);
        setQueue(null);
        setState("matched");
      } else if (msg.type === "interpreter-ended") {
        hangUpCall();
        setMatch(null);
        setQueue(null);
        setState("idle");
        setEndedNote(
          msg.reason === "declined"
            ? "The interpreter declined — you can request again to requeue."
            : msg.reason === "disconnected"
              ? "The connection dropped — request again when ready."
              : msg.reason === "cancelled"
                ? "Request cancelled."
                : "Call ended. Session logged."
        );
      }
    });
  }, [onMessage, hangUpCall]);

  const reset = () => {
    setState("idle");
    setQueue(null);
    setMatch(null);
  };

  const requestInterpreter = () => {
    setEndedNote(null);
    const displayName = name.trim() || namePlaceholder;
    const targetRoom = roomId ?? `SOS-${randomRoomCode()}`;
    if (!roomId && connectionState === "open") {
      join(targetRoom, displayName, role);
    }
    vrsRequest({
      roomId: targetRoom,
      language,
      priority: emergency ? "emergency" : "standard",
      displayName,
      logConsent,
    });
    setState("queued");
  };

  const cancelRequest = () => {
    vrsCancel();
    reset();
  };

  const endCall = () => {
    vrsEnd();
    call.hangUp();
    reset();
  };

  const handleOpenChange = (o: boolean) => {
    if (!o) {
      // closing mid-flow ends it (same-room video stops, queue slot freed)
      if (state === "queued") vrsCancel();
      if (state === "matched") {
        vrsEnd();
        call.hangUp();
      }
      reset();
    }
    setOpen(o);
  };

  const startVideo = () => {
    if (match && !match.demo) {
      void call.call(match.interpreterId);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={compact ? "outline" : "destructive"}
          size={compact ? "sm" : "default"}
          aria-label="Connect to a certified interpreter"
          className="font-semibold"
        >
          <Siren aria-hidden="true" />
          Connect to Interpreter
        </Button>
      </DialogTrigger>

      <DialogContent aria-label="Interpreter relay service" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Video Relay Service
            {state === "matched" ? (
              <Badge variant="success">Live</Badge>
            ) : state === "queued" ? (
              <Badge variant="warning">In queue</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            A certified sign-language interpreter joins over WebRTC video. Emergency requests jump
            the queue.
          </DialogDescription>
        </DialogHeader>

        {state === "idle" && (
          <div className="space-y-4 py-2">
            {endedNote && (
              <p role="status" className="rounded-lg border border-border bg-muted px-3 py-2 text-sm">
                {endedNote}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="sos-name" className="text-sm font-medium">
                  Display name
                </label>
                <input
                  id="sos-name"
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 40))}
                  placeholder={namePlaceholder}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="sos-lang" className="text-sm font-medium">
                  Sign language
                </label>
                <select
                  id="sos-lang"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="h-11 w-full cursor-pointer rounded-lg border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5">
              <div>
                <label htmlFor="sos-emergency" className="text-sm font-semibold text-destructive">
                  This is an emergency
                </label>
                <p className="text-xs text-muted-foreground">Emergency requests jump the queue.</p>
              </div>
              <Switch id="sos-emergency" checked={emergency} onCheckedChange={setEmergency} aria-label="Emergency request" />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
              <div>
                <label htmlFor="sos-log" className="text-sm font-medium">
                  Log anonymized session metadata
                </label>
                <p className="text-xs text-muted-foreground">
                  Who, when, and how long — never audio or video.
                </p>
              </div>
              <Switch id="sos-log" checked={logConsent} onCheckedChange={setLogConsent} aria-label="Consent to session metadata logging" />
            </div>
          </div>
        )}

        {state === "queued" && queue && (
          <div className="space-y-4 py-2">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={queue.ahead === 0 ? 90 : Math.round((1 / (queue.ahead + 1)) * 100)}
              aria-label="Queue progress"
              className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${queue.ahead === 0 ? 90 : (1 / (queue.ahead + 1)) * 100}%` }}
              />
            </div>
            <p role="status" aria-live="polite" className="text-center text-sm font-medium">
              {queue.ahead === 0 ? (
                <>Matching you with an interpreter…</>
              ) : (
                <>
                  Position {queue.position} — {queue.ahead} ahead of you · ~{queue.etaSeconds}s wait
                </>
              )}
              {queue.priority === "emergency" && (
                <span className="ms-2 rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-semibold text-destructive">
                  Emergency
                </span>
              )}
            </p>
          </div>
        )}

        {state === "matched" && match && (
          <div className="space-y-3 py-2">
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/50 p-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">
                {match.interpreterName.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-32 flex-1">
                <p className="text-sm font-semibold">{match.interpreterName}</p>
                <p className="text-xs text-muted-foreground">
                  {match.language.toUpperCase()} · {match.priority}
                  {match.demo && " · demo (no live video)"}
                </p>
              </div>
              <Badge variant="success">Matched</Badge>
            </div>

            {!match.demo ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <VideoView stream={call.localStream} label="You" muted className="aspect-video" />
                  <VideoView stream={call.remoteStream} label={match.interpreterName} className="aspect-video" />
                </div>
                {call.error && (
                  <p role="alert" className="text-xs text-destructive">
                    {call.error}
                  </p>
                )}
                {call.callState === "idle" && (
                  <Button type="button" className="w-full" onClick={startVideo}>
                    <Video aria-hidden="true" /> Start video call
                  </Button>
                )}
                {call.callState === "calling" && (
                  <p role="status" className="text-center text-sm text-muted-foreground">
                    Ringing {match.interpreterName}…
                  </p>
                )}
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted-foreground">
                Demo interpreter connected — open this app in a second tab as an interpreter for
                live video.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {state === "idle" && (
            <Button
              type="button"
              variant="destructive"
              onClick={requestInterpreter}
              disabled={connectionState !== "open"}
            >
              <Phone aria-hidden="true" />
              {connectionState !== "open" ? "Connecting…" : "Request interpreter now"}
            </Button>
          )}
          {state === "queued" && (
            <Button type="button" variant="ghost" onClick={cancelRequest}>
              Cancel request
            </Button>
          )}
          {state === "matched" && (
            <Button type="button" variant="outline" onClick={endCall}>
              <PhoneOff aria-hidden="true" /> End call
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
