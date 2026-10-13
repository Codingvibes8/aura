"use client";

import { Ear, Siren } from "lucide-react";
import { LiveCaptions } from "@/components/live-captions";
import { SoundVisualizer } from "@/components/sound-visualizer";
import { AmbientSoundDetector } from "@/components/ambient-sound-detector";
import { QuickPhrases } from "@/components/quick-phrases";
import { SosInterpreter } from "@/components/sos-interpreter";

/**
 * DHH User View — high-contrast, large-type transcript-first layout.
 * Every audio cue (peer speech, ambient sounds, critical alerts) is paired
 * with visual flash + optional vibration; nothing is conveyed by sound alone.
 */
export default function DhhPage() {
  return (
    <div className="space-y-4">
      {/* Page heading + emergency SOS */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400">
          <Ear className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="text-lg font-bold tracking-tight">Deaf / Hard of Hearing view</h1>
          <p className="text-sm text-muted-foreground">
            Transcript-first. Sounds become text, light, and vibration.
          </p>
        </div>
        <SosInterpreter />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Primary transcript + phrase macros */}
        <div className="flex min-h-[32rem] flex-col gap-4 lg:col-span-2">
          <LiveCaptions className="min-h-0 flex-1" />
          <QuickPhrases className="min-h-80" />
        </div>

        {/* Awareness column */}
        <div className="flex flex-col gap-4">
          <SoundVisualizer />
          <AmbientSoundDetector className="min-h-64" />
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Siren className="size-4 text-destructive" aria-hidden="true" />
              Emergency-ready
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The red button above connects you to a certified sign-language interpreter over video
              relay — tap it any time, from anywhere in the app it is one keystroke away via{" "}
              <kbd>Tab</kbd>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
