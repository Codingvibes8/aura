"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Mic } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Real-time sound intensity meter.
 * Starts on a synthetic demo signal; the user can opt in to live
 * microphone capture with a single tap (privacy-friendly, no
 * permission prompt on page load).
 */
export function SoundVisualizer({
  barCount = 24,
  className,
}: {
  barCount?: number;
  className?: string;
}) {
  const [level, setLevel] = useState(0);
  const [source, setSource] = useState<"demo" | "mic">("demo");
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const demoStartRef = useRef<number>(0);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  /* Synthetic demo signal — keeps the meter alive without mic access */
  useEffect(() => {
    if (source !== "demo") return;
    demoStartRef.current = performance.now();
    const t0 = demoStartRef.current;
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      const synthetic =
        0.18 +
        0.25 * Math.abs(Math.sin(t * 0.9)) +
        0.12 * Math.abs(Math.sin(t * 2.3 + 1.4)) +
        0.06 * Math.sin(t * 5.1);
      setLevel(Math.min(1, synthetic));
      rafRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(rafRef.current);
  }, [source]);

  /* Live microphone capture via Web Audio API */
  const enableMic = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stopTracks();
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(analyser);
      setSource("mic");
      cancelAnimationFrame(rafRef.current);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;
        // Perceptual curve so quiet rooms don't look dead
        setLevel(Math.min(1, Math.pow(avg * 1.6, 0.8)));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setSource("demo");
    }
  }, [stopTracks]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      stopTracks();
      void audioRef.current?.close().catch(() => undefined);
    };
  }, [stopTracks]);

  const bars = Array.from({ length: barCount });
  const activeBars = Math.round(level * barCount);

  const colorFor = (i: number) => {
    const ratio = i / barCount;
    if (ratio > 0.75) return "bg-destructive";
    if (ratio > 0.5) return "bg-amber-500";
    return "bg-emerald-500";
  };

  return (
    <section
      aria-label="Sound level visualizer"
      className={cn("rounded-xl border border-border bg-card p-4", className)}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Activity className="size-4 text-primary" aria-hidden="true" />
          Sound Intensity
        </h2>
        <span className="text-xs text-muted-foreground" aria-live="off">
          {source === "mic" ? "Live microphone" : "Demo signal"}
        </span>
      </div>

      <div
        role="meter"
        aria-label="Ambient sound level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-valuetext={`${Math.round(level * 100)} percent`}
        className="flex h-16 items-end gap-[3px]"
      >
        {bars.map((_, i) => {
          const isActive = i < activeBars;
          const height = 18 + (i / barCount) * 82;
          return (
            <div
              key={i}
              className={cn(
                "flex-1 rounded-sm transition-[height,opacity] duration-100 motion-reduce:transition-none",
                isActive ? colorFor(i) : "bg-muted",
                isActive ? "opacity-100" : "opacity-40"
              )}
              style={{ height: `${isActive ? height : 12}%` }}
            />
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Visual replacement for audio cues — loudness is always shown, never only heard.
        </p>
        {source === "demo" && (
          <Button type="button" variant="outline" size="sm" onClick={enableMic} className="shrink-0">
            <Mic aria-hidden="true" /> Use live microphone
          </Button>
        )}
      </div>
    </section>
  );
}
