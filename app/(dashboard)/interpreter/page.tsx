"use client";

import { Headset } from "lucide-react";
import { InterpreterConsole } from "@/components/interpreter-console";

/**
 * Interpreter View — the other side of the relay service.
 * Publish availability + languages, accept incoming requests with video,
 * decline to requeue. Session metadata is logged server-side.
 */
export default function InterpreterPage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="flex size-11 items-center justify-center rounded-xl bg-violet-600/10 text-violet-600 dark:text-violet-400">
          <Headset className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-40 flex-1">
          <h1 className="text-lg font-bold tracking-tight">Interpreter console</h1>
          <p className="text-sm text-muted-foreground">
            Go available to receive live relay requests with video.
          </p>
        </div>
      </div>

      <InterpreterConsole />
    </div>
  );
}
