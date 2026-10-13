"use client";

import { useEffect, useRef, useState } from "react";
import { useAura } from "@/components/aura-provider";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { readPrefs, writePrefs, subscribePrefs } from "@/lib/use-server-tts";
import { readSensitivity, writeSensitivity, subscribeSensitivity } from "@/components/ambient-sound-detector";

const PUSH_DEBOUNCE_MS = 1200;

interface ServerSettings {
  font_scale: number;
  high_contrast: boolean;
  dark: boolean;
  haptics: boolean;
  reduced_motion: boolean;
  tts_voice_id: string;
  tts_rate: number;
  ambient_sensitivity: "low" | "standard" | "high";
  updated_at?: string;
}

/**
 * Cloud settings sync (Phases 6.3 + 7 + 3.2). Mounted once inside the
 * dashboard layout. Renders nothing.
 *
 * - On sign-in: pulls /api/settings and applies it (aura + TTS prefs +
 *   ambient sensitivity). Last-write-wins afterwards.
 * - On any local change (debounced): pushes the full snapshot.
 * - Signed out or unconfigured: completely inert, localStorage rules.
 */
export function CloudSync() {
  const aura = useAura();
  const [userId, setUserId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const applyingRef = useRef(false);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const auraRef = useRef(aura);

  /* keep the ref current without writing during render */
  useEffect(() => {
    auraRef.current = aura;
  });

  /* Session tracking */
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user.id ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  /* Re-render on TTS/sensitivity store changes so pushes include them */
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const un1 = subscribePrefs(bump);
    const un2 = subscribeSensitivity(bump);
    return () => {
      un1();
      un2();
    };
  }, []);

  /* Pull on sign-in */
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok || cancelled) return;
        const s = (await res.json()) as ServerSettings;
        applyingRef.current = true;
        try {
          auraRef.current.applySettings({
            fontScale: s.font_scale,
            highContrast: s.high_contrast,
            dark: s.dark,
            haptics: s.haptics,
            reducedMotion: s.reduced_motion,
          });
          writePrefs({ voiceId: s.tts_voice_id, rate: s.tts_rate });
          writeSensitivity(s.ambient_sensitivity);
        } finally {
          // release after listeners settle so the pull echo isn't pushed back
          setTimeout(() => {
            applyingRef.current = false;
          }, PUSH_DEBOUNCE_MS + 100);
        }
      } catch {
        /* offline — local stands */
      }
    };
    void pull();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /* Push on local change (debounced) */
  useEffect(() => {
    if (!userId || applyingRef.current) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      const a = auraRef.current;
      const prefs = readPrefs();
      const body: ServerSettings = {
        font_scale: a.fontScale,
        high_contrast: a.highContrast,
        dark: a.dark,
        haptics: a.haptics,
        reduced_motion: a.reducedMotion,
        tts_voice_id: prefs.voiceId,
        tts_rate: prefs.rate,
        ambient_sensitivity: readSensitivity(),
      };
      void fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => undefined);
    }, PUSH_DEBOUNCE_MS);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
  }, [
    userId,
    tick,
    aura.fontScale,
    aura.highContrast,
    aura.dark,
    aura.haptics,
    aura.reducedMotion,
  ]);

  return null;
}
