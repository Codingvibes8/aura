"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Captions, Mic, MicOff, Play, Square, Trash2 } from "lucide-react";
import { useAura } from "@/components/aura-provider";
import { DEMO_CONVERSATION } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface LiveCaptionsProps {
  /** compact = read-only transcript without control bar (embedded views) */
  compact?: boolean;
  className?: string;
}

type Recog = SpeechRecognition;

function getRecognitionCtor(): SpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export function LiveCaptions({ compact = false, className }: LiveCaptionsProps) {
  const {
    captions,
    addCaption,
    clearCaptions,
    triggerFlash,
    vibrate,
    setFontScale,
    fontScale,
  } = useAura();

  const [listening, setListening] = useState(false);
  const [demo, setDemo] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const recognitionRef = useRef<Recog | null>(null);
  const demoIndexRef = useRef(0);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  /* ---------------- Live STT via Web Speech API ---------------- */
  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setMicError("Live speech recognition is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    setMicError(null);
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          addCaption({ speaker: "peer", text: text.trim() });
          // Every detected utterance gets a visual pulse (no sound-only feedback).
          triggerFlash("sound");
          vibrate(30);
        } else {
          interimText += text;
        }
      }
      setInterim(interimText.trim());
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMicError("Microphone access denied. Allow mic permission for live captions.");
        setListening(false);
      } else if (event.error !== "aborted") {
        setMicError(`Speech recognition error: ${event.error}`);
      }
    };

    rec.onend = () => {
      // Chrome stops recognition after silence — restart while "listening" is on.
      if (recognitionRef.current === rec) {
        try {
          rec.start();
        } catch {
          setListening(false);
        }
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
    } catch {
      setMicError("Could not start the microphone.");
    }
  }, [addCaption, triggerFlash, vibrate]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  /* ---------------- Demo conversation engine ---------------- */
  useEffect(() => {
    if (!demo) {
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
      demoIndexRef.current = 0;
      return;
    }
    let cancelled = false;

    const runLine = (index: number) => {
      if (cancelled) return;
      const line = DEMO_CONVERSATION[index % DEMO_CONVERSATION.length];
      addCaption({ speaker: line.speaker, text: line.text });
      if (line.speaker === "peer") {
        triggerFlash("sound");
        vibrate(30);
      }
      demoIndexRef.current = index + 1;
      demoTimerRef.current = setTimeout(() => runLine(index + 1), line.delay);
    };
    demoTimerRef.current = setTimeout(() => runLine(0), 600);

    return () => {
      cancelled = true;
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
    };
  }, [demo, addCaption, triggerFlash, vibrate]);

  /* ---------------- Auto-scroll transcript ---------------- */
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions, interim]);

  const speakerMeta = {
    peer: { label: "Speaker A", classes: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300" },
    self: { label: "Speaker B", classes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
    system: { label: "Aura", classes: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  } as const;

  return (
    <section
      aria-label="Live caption transcript"
      className={cn("flex flex-col rounded-xl border border-border bg-card", className)}
    >
      {/* Control bar */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <Captions className="size-5 text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Live Transcript</h2>
          <Badge variant={listening ? "success" : "secondary"} aria-live="polite">
            {listening ? "Listening" : "Idle"}
          </Badge>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={listening ? "destructive" : "default"}
              size="sm"
              onClick={listening ? stopListening : startListening}
              aria-pressed={listening}
            >
              {listening ? <MicOff aria-hidden="true" /> : <Mic aria-hidden="true" />}
              {listening ? "Stop mic" : "Start live captions"}
            </Button>
            <Button
              type="button"
              variant={demo ? "secondary" : "outline"}
              size="sm"
              onClick={() => setDemo((d) => !d)}
              aria-pressed={demo}
            >
              {demo ? <Square aria-hidden="true" /> : <Play aria-hidden="true" />}
              {demo ? "Stop demo" : "Demo chat"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clearCaptions}>
              <Trash2 aria-hidden="true" /> Clear
            </Button>
            <div className="flex items-center gap-1" role="group" aria-label="Transcript font size">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Decrease transcript font size"
                onClick={() => setFontScale(fontScale - 0.125)}
                disabled={fontScale <= 0.875}
              >
                A−
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Increase transcript font size"
                onClick={() => setFontScale(fontScale + 0.125)}
                disabled={fontScale >= 1.5}
              >
                A+
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Mic error */}
      {micError && (
        <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {micError}
        </p>
      )}

      {/* Transcript — role=log gives implicit aria-live=polite for screen readers */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation transcript"
        className="min-h-48 flex-1 space-y-3 overflow-y-auto p-4"
      >
        {captions.length === 0 && !interim && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No captions yet — start the microphone or play the demo.
          </p>
        )}
        {captions.map((cap) => {
          const meta = speakerMeta[cap.speaker];
          return (
            <div key={cap.id} className="animate-slide-up">
              <span
                className={cn(
                  "mb-1 inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                  meta.classes
                )}
              >
                {meta.label}
              </span>
              <p className="text-base leading-relaxed">{cap.text}</p>
            </div>
          );
        })}
        {interim && (
          <p className="italic text-muted-foreground" aria-hidden="true">
            {interim}…
          </p>
        )}
      </div>

      {/* Footer status (diarization legend) */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-indigo-500" aria-hidden="true" /> Speaker A (them)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-emerald-500" aria-hidden="true" /> Speaker B (you)
          </span>
          <span className="ms-auto inline-flex items-center gap-1.5">
            <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
            Auto-diarization active
          </span>
        </div>
      )}
    </section>
  );
}
