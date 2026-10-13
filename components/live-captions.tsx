"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Captions, Mic, MicOff, Play, Square, Trash2 } from "lucide-react";
import { useAura } from "@/components/aura-provider";
import { useRealtime } from "@/components/realtime-provider";
import { useRoomStt } from "@/lib/realtime/use-room-stt";
import { useWakeLock } from "@/lib/use-wake-lock";
import { sealText, openEnvelope } from "@/lib/realtime/crypto";
import { roomKey } from "@/lib/realtime/room-key";
import type { SttProviderName } from "@/lib/realtime/schema";
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

interface ServerInterim {
  utteranceId: string;
  text: string;
  label: string;
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
  const { onMessage, clientId, roomId, roomPrivate, connectionState, sendCaption } = useRealtime();
  const roomStt = useRoomStt();

  const [browserListening, setBrowserListening] = useState(false);
  const [demo, setDemo] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [serverSttProvider, setServerSttProvider] = useState<SttProviderName | null>(null);
  const [serverInterim, setServerInterim] = useState<ServerInterim | null>(null);
  const [peerSpeaking, setPeerSpeaking] = useState<string | null>(null);
  const recognitionRef = useRef<Recog | null>(null);
  const demoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerSpeakingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const localUtterance = useRef(0);

  const listening = browserListening || roomStt.state === "active" || roomStt.state === "starting";

  // Keep the screen awake while transcribing — mobile browsers suspend
  // mic capture when the screen sleeps.
  useWakeLock(listening);

  /* Server STT availability comes from stt-status (on connect) + welcome */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === "stt-status") {
        setServerSttProvider(msg.provider);
      } else if (msg.type === "welcome") {
        setServerSttProvider(msg.sttProvider);
      }
    });
  }, [onMessage]);

  const canUseServerStt =
    connectionState === "open" &&
    roomId !== null &&
    !roomPrivate &&
    serverSttProvider !== null &&
    serverSttProvider !== "none";

  /* ---------------- Room captions (server STT + peer sends, Phase 1/2/8) ---------------- */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type !== "caption") return;
      const own = msg.fromId === clientId;

      const commit = (text: string | null, label: string) => {
        const display =
          text ?? "🔒 Encrypted caption — unlock the room with its passphrase to read it.";
        const uid = msg.caption.utteranceId ?? `${msg.fromId}:live`;
        if (!msg.caption.isFinal) {
          if (own) {
            setServerInterim({ utteranceId: uid, text: display, label });
          } else {
            setPeerSpeaking(label);
            if (peerSpeakingTimer.current) clearTimeout(peerSpeakingTimer.current);
            peerSpeakingTimer.current = setTimeout(() => setPeerSpeaking(null), 4000);
          }
          return;
        }
        setServerInterim((prev) => (prev && own && prev.utteranceId === uid ? null : prev));
        if (!own) setPeerSpeaking(null);
        addCaption({ speaker: own ? "self" : "peer", text: display, label });
        triggerFlash("sound");
        vibrate(30);
      };

      if (msg.caption.crypto) {
        // Sealed caption: read the key live so an unlock mid-room applies
        // to already-received messages on the next update.
        const key = roomId ? roomKey(roomId) : undefined;
        if (!key) {
          commit(null, msg.caption.speaker || (own ? "You" : "Speaker A"));
          return;
        }
        void openEnvelope(key, msg.caption.crypto).then(
          (text) => commit(text, msg.caption.speaker || (own ? "You" : "Speaker A")),
          () => commit(null, msg.caption.speaker || (own ? "You" : "Speaker A"))
        );
        return;
      }
      const label = msg.caption.speaker || (own ? "You" : "Speaker A");
      commit(msg.caption.text, label);
    });
  }, [onMessage, clientId, roomId, addCaption, triggerFlash, vibrate]);

  /* ---------------- Live STT via Web Speech API (fallback + private rooms) ---------------- */
  const stopBrowserListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setBrowserListening(false);
    setInterim("");
  }, []);

  /** Share a locally-recognized line with the room (sealed when private). */
  const shareLocalLine = useCallback(
    (text: string, isFinal: boolean) => {
      if (!roomId) return;
      const key = roomPrivate ? roomKey(roomId) : undefined;
      const utteranceId = `local-${clientId ?? "you"}-${localUtterance.current}`;
      if (key) {
        void sealText(key, text).then(
          (crypto) => {
            sendCaption({ text: "", isFinal, speaker: "Speaker B", utteranceId, crypto });
            if (isFinal) localUtterance.current++;
          },
          () => undefined
        );
        return;
      }
      sendCaption({ text, isFinal, speaker: "Speaker B", utteranceId });
      if (isFinal) localUtterance.current++;
    },
    [roomId, roomPrivate, clientId, sendCaption]
  );

  const startBrowserListening = useCallback(() => {
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
          const clean = text.trim();
          addCaption({ speaker: "peer", text: clean });
          // Every detected utterance gets a visual pulse (no sound-only feedback).
          triggerFlash("sound");
          vibrate(30);
          shareLocalLine(clean, true);
        } else {
          interimText += text;
        }
      }
      const trimmed = interimText.trim();
      setInterim(trimmed);
      if (trimmed) shareLocalLine(trimmed, false);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setMicError("Microphone access denied. Allow mic permission for live captions.");
        setBrowserListening(false);
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
          setBrowserListening(false);
        }
      }
    };

    try {
      rec.start();
      recognitionRef.current = rec;
      setBrowserListening(true);
    } catch {
      setMicError("Could not start the microphone.");
    }
  }, [addCaption, triggerFlash, vibrate, shareLocalLine]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  /* ---------------- Mic button: server STT preferred, browser fallback ---------------- */
  const startListening = useCallback(() => {
    if (canUseServerStt) {
      setMicError(null);
      void roomStt.start();
    } else {
      startBrowserListening();
    }
  }, [canUseServerStt, roomStt, startBrowserListening]);

  const stopListening = useCallback(() => {
    stopBrowserListening();
    roomStt.stop();
    setServerInterim(null);
  }, [stopBrowserListening, roomStt]);

  /* ---------------- Demo conversation engine ---------------- */
  useEffect(() => {
    if (!demo) {
      if (demoTimerRef.current) clearTimeout(demoTimerRef.current);
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
  }, [captions, interim, serverInterim, peerSpeaking]);

  const speakerMeta = {
    peer: { label: "Speaker A", classes: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300" },
    self: { label: "Speaker B", classes: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300" },
    system: { label: "Aura", classes: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300" },
  } as const;

  const engineLabel = roomPrivate
    ? "Private room · E2EE"
    : canUseServerStt
      ? serverSttProvider === "deepgram"
        ? "Server · Deepgram"
        : "Server · Demo engine"
      : "Browser STT";

  const error = micError ?? roomStt.error;

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
          <Badge variant="outline" title="Speech recognition engine in use">
            {engineLabel}
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
      {error && (
        <p role="alert" className="border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
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
        {captions.length === 0 && !interim && !serverInterim && (
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
                {cap.label ?? meta.label}
              </span>
              <p className="text-base leading-relaxed">{cap.text}</p>
            </div>
          );
        })}
        {serverInterim && (
          <div aria-hidden="true">
            <span className="mb-1 inline-block rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-semibold text-muted-foreground">
              {serverInterim.label}
            </span>
            <p className="italic text-muted-foreground">{serverInterim.text}…</p>
          </div>
        )}
        {interim && (
          <p className="italic text-muted-foreground" aria-hidden="true">
            {interim}…
          </p>
        )}
        {peerSpeaking && (
          <p className="text-xs text-muted-foreground" aria-hidden="true">
            <span className="me-1.5 inline-block size-2 animate-pulse rounded-full bg-indigo-500" />
            {peerSpeaking} is speaking…
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
