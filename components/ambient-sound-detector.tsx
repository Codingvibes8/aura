"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Trash2, Vibrate } from "lucide-react";
import { useAura, type AmbientEvent } from "@/components/aura-provider";
import { AMBIENT_SOUNDS, type AmbientPriority } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { IconByName } from "@/components/icon-by-name";
import { Switch } from "@/components/ui/switch";

const PRIORITY_STYLES: Record<AmbientPriority, string> = {
  info: "border-border bg-secondary/60 text-secondary-foreground",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
  critical: "border-destructive/50 bg-destructive/15 text-destructive",
};

const VIBRATE_PATTERNS: Record<AmbientPriority, VibratePattern> = {
  info: 40,
  warning: [80, 60, 80],
  critical: [200, 100, 200, 100, 200],
};

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * AI Co-Pilot ambient sound identification.
 * In demo mode it simulates a classifier firing on random real-world sounds;
 * every detection is paired with a visual chip, a screen-flash cue, and haptics.
 */
export function AmbientSoundDetector({ className }: { className?: string }) {
  const { ambientEvents, pushAmbient, clearAmbient, triggerFlash, vibrate, speak, addCaption } =
    useAura();
  const [coPilotOn, setCoPilotOn] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* Simulated AI classifier loop */
  useEffect(() => {
    if (!coPilotOn) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      const def = AMBIENT_SOUNDS[Math.floor(Math.random() * AMBIENT_SOUNDS.length)];
      pushAmbient(def);
      triggerFlash(def.priority === "critical" ? "critical" : "sound");
      vibrate(VIBRATE_PATTERNS[def.priority]);
      // Critical sounds are also spoken aloud — with a visual caption as the primary channel.
      if (def.priority === "critical") {
        addCaption({ speaker: "system", text: `[${def.label}]` });
        speak(`Alert: ${def.label}`, 1.1);
      }
    }, 5200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [coPilotOn, pushAmbient, triggerFlash, vibrate, speak, addCaption]);

  return (
    <section
      aria-label="Ambient sound detector"
      className={cn("flex flex-col rounded-xl border border-border bg-card p-4", className)}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          AI Co-Pilot · Ambient Sounds
        </h2>
        <div className="flex items-center gap-2">
          <label htmlFor="copilot-toggle" className="text-xs text-muted-foreground">
            {coPilotOn ? "On" : "Off"}
          </label>
          <Switch
            id="copilot-toggle"
            checked={coPilotOn}
            onCheckedChange={setCoPilotOn}
            aria-label="Toggle AI ambient sound detection"
          />
        </div>
      </div>

      <div
        role="status"
        aria-live="polite"
        aria-label="Detected ambient sounds"
        className="flex min-h-24 flex-1 flex-wrap content-start gap-2 overflow-y-auto"
      >
        {ambientEvents.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Listening for sounds around you — detections appear here with visual + haptic alerts.
          </p>
        )}
        {ambientEvents.map((event: AmbientEvent) => (
          <span
            key={event.id}
            className={cn(
              "inline-flex animate-slide-up items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              PRIORITY_STYLES[event.priority]
            )}
          >
            <IconByName name={event.icon} className="size-3.5" />
            {event.label}
            <span className="opacity-60" aria-hidden="true">
              {formatTime(event.timestamp)}
            </span>
            <span className="sr-only">
              {event.priority} priority sound detected at {formatTime(event.timestamp)}
            </span>
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">
          Every detection pairs sound → sight → vibration. Nothing is audio-only.
        </p>
        <div className="flex gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const def = AMBIENT_SOUNDS[0];
              pushAmbient(def);
              triggerFlash("critical");
              vibrate(VIBRATE_PATTERNS.critical);
            }}
          >
            <Vibrate aria-hidden="true" /> Test alert
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={clearAmbient}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
