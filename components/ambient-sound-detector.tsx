"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Sparkles, Trash2, Vibrate } from "lucide-react";
import { useAura, type AmbientEvent } from "@/components/aura-provider";
import { useRealtime } from "@/components/realtime-provider";
import { useRoomAmbient } from "@/lib/realtime/use-room-ambient";
import { AMBIENT_SOUNDS, type AmbientPriority } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
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

/** Map a server detection label to a local icon (server sends label/priority/intensity). */
function iconForLabel(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("siren")) return "siren";
  if (l.includes("fire") || l.includes("alarm")) return "flame";
  if (l.includes("door") || l.includes("knock")) return "door-closed";
  if (l.includes("baby") || l.includes("cry")) return "baby";
  if (l.includes("glass") || l.includes("shatter")) return "wine";
  if (l.includes("dog") || l.includes("bark")) return "dog";
  if (l.includes("laugh")) return "laugh";
  if (l.includes("horn") || l.includes("traffic") || l.includes("car")) return "car";
  if (l.includes("phone") || l.includes("ring")) return "phone";
  if (l.includes("shout") || l.includes("yell") || l.includes("scream")) return "megaphone";
  return "sparkles";
}

type Sensitivity = "low" | "standard" | "high";
const SENSITIVITY_KEY = "aura-ambient-sensitivity";

let sensitivityCache: Sensitivity | null = null;
const sensitivityListeners = new Set<() => void>();

function readSensitivity(): Sensitivity {
  if (!sensitivityCache) {
    try {
      const raw = window.localStorage.getItem(SENSITIVITY_KEY);
      sensitivityCache = raw === "low" || raw === "high" ? raw : "standard";
    } catch {
      sensitivityCache = "standard";
    }
  }
  return sensitivityCache;
}

function writeSensitivity(s: Sensitivity): void {
  sensitivityCache = s;
  try {
    window.localStorage.setItem(SENSITIVITY_KEY, s);
  } catch {
    /* storage unavailable */
  }
  sensitivityListeners.forEach((l) => l());
}

function subscribeSensitivity(cb: () => void): () => void {
  sensitivityListeners.add(cb);
  return () => {
    sensitivityListeners.delete(cb);
  };
}

function passesSensitivity(priority: AmbientPriority, s: Sensitivity): boolean {
  if (s === "high") return true;
  if (s === "standard") return priority !== "info";
  return priority === "critical";
}

/**
 * AI Co-Pilot ambient sound identification (Phase 4).
 *
 * Two engines, one policy:
 * - **Server** (preferred in a room): mic streams to the signaling server,
 *   an AudioSet classifier labels windows, detections fan out over the room.
 * - **Local sim** (fallback): scripted detections so the full cue pipeline
 *   — chip + screen flash + haptics, criticals captioned + spoken — works
 *   with zero backend.
 */
export function AmbientSoundDetector({ className }: { className?: string }) {
  const { ambientEvents, pushAmbient, clearAmbient, triggerFlash, vibrate, speak, addCaption } =
    useAura();
  const { onMessage, roomId, connectionState } = useRealtime();
  const roomAmbient = useRoomAmbient();
  const [coPilotOn, setCoPilotOn] = useState(true);
  const sensitivity = useSyncExternalStore(subscribeSensitivity, readSensitivity, () => "standard" as Sensitivity);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const useServer =
    coPilotOn &&
    connectionState === "open" &&
    roomId !== null &&
    roomAmbient.provider !== "none";

  /* Shared policy: every detection → chip + flash + haptics; criticals → caption + speech */
  const handleDetection = useCallback(
    (def: { label: string; icon: string; intensity: number; priority: AmbientPriority }) => {
      if (!passesSensitivity(def.priority, readSensitivity())) return;
      pushAmbient(def);
      triggerFlash(def.priority === "critical" ? "critical" : "sound");
      vibrate(VIBRATE_PATTERNS[def.priority]);
      if (def.priority === "critical") {
        addCaption({ speaker: "system", text: `[${def.label}]` });
        speak(`Alert: ${def.label}`, 1.1);
      }
    },
    [pushAmbient, triggerFlash, vibrate, speak, addCaption]
  );

  const { state: ambientEngineState, start: startAmbientEngine, stop: stopAmbientEngine } = roomAmbient;

  /* Server engine lifecycle follows the co-pilot toggle + room membership */
  useEffect(() => {
    if (!useServer) {
      if (ambientEngineState === "active" || ambientEngineState === "starting") {
        stopAmbientEngine();
      }
      return;
    }
    if (ambientEngineState === "idle") {
      void startAmbientEngine();
    }
    // active/error states are driven by server ambient-status messages
  }, [useServer, ambientEngineState, startAmbientEngine, stopAmbientEngine]);

  /* Inbound room detections (own echo + peers) go through the same policy */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type !== "ambient") return;
      handleDetection({
        label: msg.event.label,
        icon: iconForLabel(msg.event.label),
        intensity: msg.event.intensity,
        priority: msg.event.priority,
      });
    });
  }, [onMessage, handleDetection]);

  /* Local simulation fallback */
  useEffect(() => {
    if (!coPilotOn || useServer) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }
    intervalRef.current = setInterval(() => {
      const def = AMBIENT_SOUNDS[Math.floor(Math.random() * AMBIENT_SOUNDS.length)];
      handleDetection(def);
    }, 5200);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [coPilotOn, useServer, handleDetection]);

  const engineLabel = !coPilotOn
    ? "Off"
    : useServer
      ? roomAmbient.provider === "hf"
        ? "Server · AudioSet"
        : "Server · Demo engine"
      : "Local sim";

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
          <Badge variant="outline" title="Detection engine in use">
            {engineLabel}
          </Badge>
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

      {roomAmbient.error && useServer && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {roomAmbient.error}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex items-center gap-2">
          <label htmlFor="sensitivity" className="text-xs text-muted-foreground">
            Sensitivity
          </label>
          <select
            id="sensitivity"
            value={sensitivity}
            onChange={(e) => writeSensitivity(e.target.value as Sensitivity)}
            className="h-8 cursor-pointer rounded-lg border border-border bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Detection sensitivity: low shows critical sounds only, standard adds warnings, high shows everything"
          >
            <option value="low">Low — critical only</option>
            <option value="standard">Standard</option>
            <option value="high">High — everything</option>
          </select>
        </div>
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
          <Button type="button" variant="ghost" size="sm" onClick={clearAmbient} aria-label="Clear detections">
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}
