"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime } from "@/components/realtime-provider";
import type { AmbientProviderName } from "@/lib/realtime/schema";

/**
 * Server-side ambient detection mic pipe (Phase 4).
 *
 * Streams microphone audio (PCM16 mono 16 kHz, stream header 0x02) to the
 * signaling server, which classifies windows and broadcasts `ambient`
 * events back to the room. Rendering + policy (flash/vibrate/speak) live
 * in the detector component — this hook only owns capture + lifecycle.
 */

export type RoomAmbientState = "idle" | "starting" | "active" | "error";

export interface AmbientEngine {
  state: RoomAmbientState;
  error: string | null;
  supported: boolean;
  /** "hf" | "mock" when the server has a classifier, else "none" */
  provider: AmbientProviderName;
  start: () => Promise<boolean>;
  stop: () => void;
}

export function useRoomAmbient(): AmbientEngine {
  const { sendAudio, startAmbient, stopAmbient, onMessage, connectionState } = useRealtime();
  const [state, setState] = useState<RoomAmbientState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<AmbientProviderName>("none");
  const [supported] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof AudioWorkletNode !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia
  );

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const stateRef = useRef<RoomAmbientState>("idle");

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
      if (msg.type === "ambient-status") {
        setProvider(msg.provider);
        if (msg.status === "active") {
          setState("active");
          setError(null);
        } else if (msg.status === "error") {
          setState("error");
          setError(msg.message ?? "Ambient detection failed on the server.");
          teardown();
        } else if (msg.status === "unavailable") {
          setState("error");
          setError("Server ambient detection is not configured.");
          teardown();
        } else if (stateRef.current === "active") {
          setState("idle");
          teardown();
        }
      } else if (msg.type === "welcome") {
        setProvider(msg.ambientProvider);
      }
    });
  }, [onMessage, teardown]);

  const start = useCallback(async () => {
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
        sendAudio(event.data, "ambient");
      };
      const sink = ctx.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      await ctx.resume();
      startAmbient();
      return true;
    } catch (e) {
      teardown();
      setState("error");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Microphone access denied. Allow mic permission for ambient detection."
          : "Could not start the microphone."
      );
      return false;
    }
  }, [supported, connectionState, sendAudio, startAmbient, teardown]);

  const stop = useCallback(() => {
    stopAmbient();
    teardown();
    setState("idle");
  }, [stopAmbient, teardown]);

  useEffect(() => {
    if (connectionState === "closed" || connectionState === "reconnecting") {
      if (stateRef.current === "active" || stateRef.current === "starting") {
        teardown();
        setState("idle");
      }
    }
  }, [connectionState, teardown]);

  useEffect(() => teardown, [teardown]);

  return { state, error, supported, provider, start, stop };
}
