"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const CUSTOM_KEY = "aura-custom-phrases";

function loadLocal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveLocal(phrases: string[]): void {
  try {
    window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(phrases));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Custom quick phrases with cloud sync (Phase 6.4).
 *
 * localStorage is always the offline cache. When signed in, server phrases
 * merge in (union, local order first) and adds/deletes propagate to
 * /api/phrases. Signed out, everything stays local.
 */
export function useCloudPhrases() {
  const [custom, setCustom] = useState<string[]>(loadLocal);
  const [cloud, setCloud] = useState(false);
  const idsRef = useRef(new Map<string, string>()); // text → server uuid
  const userRef = useRef<string | null>(null);

  /* Session tracking + initial merge on login */
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    let cancelled = false;

    const merge = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      const userId = session?.user.id ?? null;
      userRef.current = userId;
      setCloud(!!userId);
      if (!userId) return;
      try {
        const res = await fetch("/api/phrases");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { phrases?: { id: string; text: string }[] };
        const server = data.phrases ?? [];
        const ids = new Map(server.map((p) => [p.text, p.id] as [string, string]));
        idsRef.current = ids;
        setCustom((prev) => {
          const seen = new Set(prev);
          const merged = [...prev];
          for (const p of server) {
            if (!seen.has(p.text)) {
              seen.add(p.text);
              merged.push(p.text);
            }
          }
          if (merged.length !== prev.length) saveLocal(merged);
          return merged;
        });
      } catch {
        /* offline — local cache stands */
      }
    };

    void merge();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null;
      userRef.current = userId;
      setCloud(!!userId);
      if (userId) void merge();
      else idsRef.current = new Map();
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const add = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    let next: string[] = [];
    setCustom((prev) => {
      if (prev.includes(clean)) return prev;
      next = [...prev, clean];
      saveLocal(next);
      return next;
    });
    if (userRef.current) {
      try {
        const res = await fetch("/api/phrases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (res.ok) {
          const created = (await res.json()) as { id: string; text: string };
          idsRef.current.set(created.text, created.id);
        }
      } catch {
        /* stays local-only until next merge */
      }
    }
  }, []);

  const remove = useCallback(async (text: string) => {
    setCustom((prev) => {
      const next = prev.filter((p) => p !== text);
      saveLocal(next);
      return next;
    });
    const id = idsRef.current.get(text);
    if (userRef.current && id) {
      idsRef.current.delete(text);
      try {
        await fetch(`/api/phrases?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      } catch {
        /* local delete stands */
      }
    }
  }, []);

  return { custom, add, remove, cloud };
}
