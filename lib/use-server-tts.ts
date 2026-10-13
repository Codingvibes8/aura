"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAura } from "@/components/aura-provider";

export interface TtsVoiceOption {
  id: string;
  name: string;
}

interface TtsPrefs {
  voiceId: string;
  rate: number;
}

const PREFS_KEY = "aura-tts-prefs";

const DEFAULT_PREFS: TtsPrefs = { voiceId: "", rate: 1 };

function loadPrefs(): Partial<TtsPrefs> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as Partial<TtsPrefs>) : {};
  } catch {
    return {};
  }
}

/* Module-level prefs store. useSyncExternalStore is the sanctioned way to
   read localStorage without SSR hydration mismatches or effect cascades. */
let prefsCache: TtsPrefs | null = null;
const prefsListeners = new Set<() => void>();

export function readPrefs(): TtsPrefs {
  if (!prefsCache) {
    const stored = loadPrefs();
    prefsCache = {
      voiceId: typeof stored.voiceId === "string" ? stored.voiceId : "",
      rate:
        typeof stored.rate === "number" && stored.rate >= 0.5 && stored.rate <= 2
          ? stored.rate
          : 1,
    };
  }
  return prefsCache;
}

export function writePrefs(patch: Partial<TtsPrefs>): void {
  const next = { ...readPrefs(), ...patch };
  next.rate = Math.min(2, Math.max(0.5, next.rate || 1));
  prefsCache = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  }
  prefsListeners.forEach((l) => l());
}

function subscribePrefs(cb: () => void): () => void {
  prefsListeners.add(cb);
  return () => {
    prefsListeners.delete(cb);
  };
}

export { subscribePrefs };

function useTtsPrefs(): { prefs: TtsPrefs; setVoiceId: (id: string) => void; setRate: (r: number) => void } {
  const prefs = useSyncExternalStore(subscribePrefs, readPrefs, () => DEFAULT_PREFS);
  const setVoiceId = useCallback((id: string) => writePrefs({ voiceId: id }), []);
  const setRate = useCallback((r: number) => writePrefs({ rate: r }), []);
  return { prefs, setVoiceId, setRate };
}

/**
 * Phase 3 TTS hook — server-side ElevenLabs audio when configured,
 * browser speech synthesis otherwise (Phase 3.3 playback sync).
 *
 * - `speak()` stops any in-flight audio first (interrupt support)
 * - `rate` maps to HTMLAudio playbackRate for server voices
 * - voice + rate persist to localStorage; server-side profile sync
 *   lands with Phase 6 auth (see BACKEND_ROADMAP 3.2)
 */
export function useServerTts() {
  const { speak: browserSpeak, stopSpeaking: browserStop, speaking: browserSpeaking } = useAura();
  const { prefs, setVoiceId: persistVoiceId, setRate: persistRate } = useTtsPrefs();
  const { voiceId, rate } = prefs;

  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState<"elevenlabs" | "none">("none");
  const [voices, setVoices] = useState<TtsVoiceOption[]>([]);
  const [serverSpeaking, setServerSpeaking] = useState(false);
  const [loading, setLoading] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  /* Discover server TTS capability + voice catalog */
  useEffect(() => {
    let cancelled = false;
    const discover = async () => {
      try {
        const res = await fetch("/api/tts");
        if (!res.ok) return;
        const status = (await res.json()) as {
          configured: boolean;
          provider: "elevenlabs" | "none";
          defaultVoice: string;
        };
        if (cancelled) return;
        setConfigured(status.configured);
        setProvider(status.provider);
        if (!readPrefs().voiceId && status.defaultVoice) {
          persistVoiceId(status.defaultVoice);
        }

        const vres = await fetch("/api/tts/voices");
        if (!vres.ok) return;
        const catalog = (await vres.json()) as { voices?: TtsVoiceOption[] };
        if (cancelled) return;
        if (catalog.voices && catalog.voices.length > 0) setVoices(catalog.voices);
      } catch {
        /* offline / route missing — browser fallback stays */
      }
    };
    void discover();
    return () => {
      cancelled = true;
    };
  }, [persistVoiceId]);

  const setVoiceId = useCallback(
    (id: string) => persistVoiceId(id),
    [persistVoiceId]
  );

  const setRate = useCallback(
    (r: number) => {
      persistRate(r);
      if (audioRef.current) {
        audioRef.current.playbackRate = Math.min(2, Math.max(0.5, r));
      }
    },
    [persistRate]
  );

  const teardownAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setServerSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    teardownAudio();
    browserStop();
  }, [teardownAudio, browserStop]);

  const speak = useCallback(
    async (text: string, opts?: { rate?: number; voiceId?: string }) => {
      const clean = text.trim();
      if (!clean) return;
      const speakRate = opts?.rate ?? rate;
      const speakVoice = opts?.voiceId ?? voiceId;

      // Interrupt: stop anything currently playing first
      teardownAudio();
      browserStop();

      if (!configured) {
        browserSpeak(clean, speakRate);
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voiceId: speakVoice || undefined }),
        });
        if (!res.ok) throw new Error(`TTS ${res.status}`);
        const buf = await res.arrayBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
        urlRef.current = url;
        const audio = new Audio(url);
        audio.playbackRate = speakRate;
        audioRef.current = audio;
        setServerSpeaking(true);
        audio.onended = () => teardownAudio();
        audio.onerror = () => teardownAudio();
        await audio.play();
      } catch {
        teardownAudio();
        browserSpeak(clean, speakRate);
      } finally {
        setLoading(false);
      }
    },
    [configured, rate, voiceId, teardownAudio, browserStop, browserSpeak]
  );

  useEffect(() => teardownAudio, [teardownAudio]);

  return {
    speaking: serverSpeaking || browserSpeaking,
    loading,
    speak,
    stop,
    configured,
    provider,
    voices,
    voiceId,
    setVoiceId,
    rate,
    setRate,
  };
}
