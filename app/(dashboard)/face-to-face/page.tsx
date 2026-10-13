"use client";

import { Info } from "lucide-react";
import { LiveCaptions } from "@/components/live-captions";
import { QuickPhrases } from "@/components/quick-phrases";
import { Badge } from "@/components/ui/badge";

/**
 * Face-to-Face Mode — table split-screen.
 * The top half is rotated 180° so the person sitting across the screen
 * reads it upside-down-from-your-perspective; the bottom half serves the
 * DHH user. Both share one live transcript.
 */
export default function FaceToFacePage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-amber-600/10 text-amber-600 dark:text-amber-400">
          <Info className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="text-lg font-bold tracking-tight">Face-to-face table mode</h1>
          <p className="text-sm text-muted-foreground">
            Lay the screen flat between you — the top half is rotated for the person across from
            you.
          </p>
        </div>
        <Badge variant="warning" aria-hidden="true">
          Rotate device for best fit
        </Badge>
      </div>

      <div className="flex h-[calc(100dvh-13rem)] min-h-[30rem] flex-col gap-3">
        {/* Far side — rotated 180° so the opposite reader sees it upright */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          <div className="h-full rotate-180" aria-label="Transcript oriented for the person across the screen">
            <LiveCaptions compact className="h-full" />
          </div>
        </div>

        {/* Near side — DHH user: phrases + compact transcript */}
        <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
          <QuickPhrases className="h-full" />
        </div>
      </div>
    </div>
  );
}
