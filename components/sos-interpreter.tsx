"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Siren, Video } from "lucide-react";
import { INTERPRETER_QUEUE_STEPS } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
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

type SosState = "idle" | "queuing" | "connecting" | "connected";

/**
 * Aira-style on-demand interpreter access.
 * Simulates the VRS queue progression entirely client-side so the
 * emergency flow is testable with zero backend.
 */
export function SosInterpreter({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SosState>("idle");
  const [queueLabel, setQueueLabel] = useState(INTERPRETER_QUEUE_STEPS[0].label);
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  const clear = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => clear, []);

  const startQueue = () => {
    clear();
    setState("queuing");
    setProgress(0);
    setQueueLabel(INTERPRETER_QUEUE_STEPS[0].label);
    startRef.current = Date.now();

    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const step = [...INTERPRETER_QUEUE_STEPS].reverse().find((s) => elapsed >= s.at);
      if (step) setQueueLabel(step.label);
      setProgress(Math.min(1, elapsed / INTERPRETER_QUEUE_STEPS[INTERPRETER_QUEUE_STEPS.length - 1].at));
      if (elapsed >= INTERPRETER_QUEUE_STEPS[INTERPRETER_QUEUE_STEPS.length - 1].at) {
        clear();
        setState("connected");
      }
    }, 250);
  };

  const endCall = () => {
    clear();
    setState("idle");
    setProgress(0);
    setQueueLabel(INTERPRETER_QUEUE_STEPS[0].label);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : endCall())}>
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

      <DialogContent aria-label="Interpreter relay service">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Video Relay Service
            {state === "connected" ? (
              <Badge variant="success">Live</Badge>
            ) : state !== "idle" ? (
              <Badge variant="warning">Connecting</Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            A certified sign-language interpreter joins over secure WebRTC video — typically under
            15 seconds.
          </DialogDescription>
        </DialogHeader>

        {state === "connected" ? (
          <div className="flex flex-col items-center gap-4 py-4">
            <div
              className="flex h-28 w-full items-center justify-center rounded-xl border border-border bg-gradient-to-br from-primary/20 to-accent/30"
              role="img"
              aria-label="Interpreter video feed placeholder"
            >
              <Video className="size-10 text-primary" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium">Interpreter is on screen — sign naturally.</p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="Queue progress"
              className="h-2.5 w-full overflow-hidden rounded-full bg-secondary"
            >
              <div
                className={cn(
                  "h-full rounded-full bg-primary transition-[width] duration-300",
                  state === "idle" && "opacity-0"
                )}
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p role="status" aria-live="polite" className="text-center text-sm font-medium">
              {state === "idle" ? "Ready when you are — help is one tap away." : queueLabel}
            </p>
          </div>
        )}

        <DialogFooter>
          {state === "idle" || state === "queuing" || state === "connecting" ? (
            <>
              {state !== "idle" && (
                <Button type="button" variant="ghost" onClick={endCall}>
                  Cancel
                </Button>
              )}
              <Button type="button" variant="destructive" onClick={startQueue} disabled={state !== "idle"}>
                <Phone aria-hidden="true" />
                {state === "idle" ? "Request interpreter now" : "Requesting…"}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={endCall}>
              <PhoneOff aria-hidden="true" /> End call
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
