"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@/components/realtime-provider";

/**
 * Server-side STT microphone pipe (Phase 2).
 *
 * Captures mic audio through an AudioWorklet (downsampled to PCM16 mono
 * 16 kHz) and streams binary chunks over the signaling WebSocket. The
 * server returns transcripts as `caption` messages on the same socket.
 *
 * Transcripts themselves are consumed via `useRealtime().onMessage` by the
 * transcript UI — this hook only owns capture + session lifecycle.
 */

export type RoomSttState = "idle" | "starting" | "active" | "error";

export function useRoomStt() {
  const { sendAudio, startStt, stopStt, onMessage, connectionState } = useRealtime();
  const [state, setState] = useState<RoomSttState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
  );

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stateRef = useRef<RoomSttState>("idle");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const teardown = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => undefined);
      ctxRef.current = null;
    }
  }, []);

  /* Server session status drives our state (source of truth) */
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type !== "stt-status") return;
      if (msg.status === "active") {
        setState("active");
        setError(null);
      } else if (msg.status === "error") {
        setState("error");
        setError(msg.message ?? "Speech recognition failed on the server.");
        teardown();
      } else if (msg.status === "unavailable") {
        setState("error");
        setError("Server speech recognition is not configured.");
        teardown();
      } else {
        // idle — only reflect it if we were running (avoid clobbering "starting")
        if (stateRef.current === "active") setState("idle");
        teardown();
      }
    });
  }, [onMessage, teardown]);

  const start = useCallback(
    async (opts?: { lang?: string; keywords?: string[] }) => {
      if (!supported) {
        setError("Microphone capture is not supported in this browser.");
        return false;
      }
      if (connectionState !== "open") {
        setError("Not connected to the live server.");
        return false;
      }
      setError(null);
      setState("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        streamRef.current = stream;
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        await ctx.audioWorklet.addModule("/stt-capture-processor.js");
        const source = ctx.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(ctx, "aura-stt-capture");
        node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
          sendAudio(event.data);
        };
        // Zero-gain sink keeps the graph running without audible feedback
        const sink = ctx.createGain();
        sink.gain.value = 0;
        source.connect(node);
        node.connect(sink);
        sink.connect(ctx.destination);
        await ctx.resume();
        startStt(opts);
        return true;
      } catch (e) {
        teardown();
        setState("error");
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Microphone access denied. Allow mic permission for live captions."
            : "Could not start the microphone."
        );
        return false;
      }
    },
    [supported, connectionState, sendAudio, startStt, teardown]
  );

  const stop = useCallback(() => {
    stopStt();
    teardown();
    setState("idle");
  }, [stopStt, teardown]);

  /* Stop capture if the socket drops mid-session */
  useEffect(() => {
    if (connectionState === "closed" || connectionState === "reconnecting") {
      if (stateRef.current === "active" || stateRef.current === "starting") {
        teardown();
        setState("idle");
      }
    }
  }, [connectionState, teardown]);

  useEffect(() => teardown, [teardown]);

  return { state, error, supported, start, stop };
}
