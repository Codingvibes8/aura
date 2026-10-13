"use client";

import * as React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type CaptionSpeaker = "peer" | "self" | "system";

export interface Caption {
  id: string;
  speaker: CaptionSpeaker;
  text: string;
  timestamp: number;
  /** server diarization label (e.g. "Speaker C") — shown instead of the default badge */
  label?: string;
}

export interface AmbientEvent {
  id: string;
  label: string;
  icon: string;
  intensity: number;
  priority: "info" | "warning" | "critical";
  timestamp: number;
}

export interface FlashSignal {
  kind: "sound" | "critical" | "info";
  key: number;
}

export interface Settings {
  fontScale: number; // 0.875 – 1.5, applied to root font-size
  highContrast: boolean;
  dark: boolean;
  haptics: boolean;
  reducedMotion: boolean;
}

interface AuraContextValue extends Settings {
  captions: Caption[];
  ambientEvents: AmbientEvent[];
  flash: FlashSignal | null;
  speaking: boolean;
  setFontScale: (v: number) => void;
  toggleHighContrast: () => void;
  toggleDark: () => void;
  toggleHaptics: () => void;
  toggleReducedMotion: () => void;
  /** merge a partial settings object (cloud sync pull) */
  applySettings: (patch: Partial<Settings>) => void;
  addCaption: (c: Omit<Caption, "id" | "timestamp">) => void;
  clearCaptions: () => void;
  pushAmbient: (e: Omit<AmbientEvent, "id" | "timestamp">) => void;
  clearAmbient: () => void;
  triggerFlash: (kind: FlashSignal["kind"]) => void;
  vibrate: (pattern: VibratePattern) => void;
  speak: (text: string, rate?: number) => void;
  stopSpeaking: () => void;
}

const DEFAULT_SETTINGS: Settings = {
  fontScale: 1,
  highContrast: false,
  dark: false,
  haptics: true,
  reducedMotion: false,
};

const STORAGE_KEY = "aura-settings";

const AuraContext = createContext<AuraContextValue | null>(null);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export function AuraProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [ambientEvents, setAmbientEvents] = useState<AmbientEvent[]>([]);
  const [flash, setFlash] = useState<FlashSignal | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Chrome blocks navigator.vibrate until the user activates the page */
  useEffect(() => {
    const mark = () => setInteracted(true);
    window.addEventListener("pointerdown", mark, { once: true });
    window.addEventListener("keydown", mark, { once: true });
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  /* Apply side effects for each setting */
  useEffect(() => {
    document.documentElement.style.fontSize = `${16 * settings.fontScale}px`;
  }, [settings.fontScale]);

  useEffect(() => {
    document.documentElement.classList.toggle("hc", settings.highContrast);
  }, [settings.highContrast]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.dark);
  }, [settings.dark]);

  useEffect(() => {
    document.documentElement.classList.toggle("reduced-motion", settings.reducedMotion);
  }, [settings.reducedMotion]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* storage unavailable — settings stay in memory */
    }
  }, [settings]);

  const setFontScale = useCallback(
    (v: number) => setSettings((s) => ({ ...s, fontScale: Math.min(1.5, Math.max(0.875, v)) })),
    []
  );
  const toggleHighContrast = useCallback(
    () => setSettings((s) => ({ ...s, highContrast: !s.highContrast })),
    []
  );
  const toggleDark = useCallback(() => setSettings((s) => ({ ...s, dark: !s.dark })), []);
  const toggleHaptics = useCallback(() => setSettings((s) => ({ ...s, haptics: !s.haptics })), []);
  const toggleReducedMotion = useCallback(
    () => setSettings((s) => ({ ...s, reducedMotion: !s.reducedMotion })),
    []
  );

  const applySettings = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      next.fontScale = Math.min(1.5, Math.max(0.875, next.fontScale || 1));
      next.highContrast = !!next.highContrast;
      next.dark = !!next.dark;
      next.haptics = next.haptics !== false;
      next.reducedMotion = !!next.reducedMotion;
      return next;
    });
  }, []);

  /* ---------------- Captions ---------------- */
  const addCaption = useCallback((c: Omit<Caption, "id" | "timestamp">) => {
    setCaptions((prev) => {
      const next = [...prev, { ...c, id: nextId("cap"), timestamp: Date.now() }];
      // Keep the log bounded for memory; the transcript view virtualizes visually.
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  }, []);

  const clearCaptions = useCallback(() => setCaptions([]), []);

  /* ---------------- Ambient events ---------------- */
  const pushAmbient = useCallback((e: Omit<AmbientEvent, "id" | "timestamp">) => {
    setAmbientEvents((prev) => {
      const next = [...prev, { ...e, id: nextId("amb"), timestamp: Date.now() }];
      return next.length > 12 ? next.slice(next.length - 12) : next;
    });
  }, []);

  const clearAmbient = useCallback(() => setAmbientEvents([]), []);

  /* ---------------- Flash overlay (visual cue for every audio event) ---------------- */
  const triggerFlash = useCallback((kind: FlashSignal["kind"]) => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setFlash({ kind, key: Date.now() });
    flashTimer.current = setTimeout(() => setFlash(null), kind === "critical" ? 1200 : 700);
  }, []);

  /* ---------------- Haptics ---------------- */
  const vibrate = useCallback(
    (pattern: VibratePattern) => {
      if (!settings.haptics || !interacted) return;
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(pattern);
        } catch {
          /* unsupported device */
        }
      }
    },
    [settings.haptics, interacted]
  );

  /* ---------------- Text-to-speech ---------------- */
  const speak = useCallback((text: string, rate = 1) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = rate;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  }, []);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setSpeaking(false);
  }, []);

  const value = useMemo<AuraContextValue>(
    () => ({
      ...settings,
      captions,
      ambientEvents,
      flash,
      speaking,
      setFontScale,
      toggleHighContrast,
      toggleDark,
      toggleHaptics,
      toggleReducedMotion,
      applySettings,
      addCaption,
      clearCaptions,
      pushAmbient,
      clearAmbient,
      triggerFlash,
      vibrate,
      speak,
      stopSpeaking,
    }),
    [
      settings,
      captions,
      ambientEvents,
      flash,
      speaking,
      setFontScale,
      toggleHighContrast,
      toggleDark,
      toggleHaptics,
      toggleReducedMotion,
      applySettings,
      addCaption,
      clearCaptions,
      pushAmbient,
      clearAmbient,
      triggerFlash,
      vibrate,
      speak,
      stopSpeaking,
    ]
  );

  return (
    <AuraContext.Provider value={value}>
      {children}
      <FlashOverlay signal={flash} />
      <Announcer />
    </AuraContext.Provider>
  );
}

export function useAura(): AuraContextValue {
  const ctx = useContext(AuraContext);
  if (!ctx) throw new Error("useAura must be used within <AuraProvider>");
  return ctx;
}

/* ------------------------------------------------------------------ */
/* Screen flash — every audio cue has a visual indicator               */
/* ------------------------------------------------------------------ */

function FlashOverlay({ signal }: { signal: FlashSignal | null }) {
  if (!signal) return null;
  const palette =
    signal.kind === "critical"
      ? "shadow-[inset_0_0_0_6px_var(--destructive)]"
      : signal.kind === "sound"
        ? "shadow-[inset_0_0_0_4px_var(--primary)]"
        : "shadow-[inset_0_0_0_4px_var(--accent))";

  return (
    <div
      key={signal.key}
      role="alert"
      aria-live="assertive"
      className={`pointer-events-none fixed inset-0 z-[90] rounded-none ${palette} animate-flash-ring motion-reduce:animate-none [animation-fill-mode:forwards]`}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Visually hidden assertive announcer for screen readers              */
/* ------------------------------------------------------------------ */

function Announcer() {
  const { flash } = useAura();

  const message = !flash
    ? ""
    : flash.kind === "critical"
      ? "Critical alert. Check the visual indicator."
      : flash.kind === "sound"
        ? "Sound detected nearby."
        : "Notification.";

  return (
    <div role="status" aria-live="assertive" className="sr-only">
      {message}
    </div>
  );
}
