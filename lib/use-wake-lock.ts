"use client";

import { useEffect } from "react";

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}

/**
 * Phase 9.3 — keeps the screen on while a live session runs.
 *
 * Mobile browsers suspend mic/camera capture when the screen sleeps, so a
 * wake lock is the web platform's honest answer to "background audio":
 * the session survives dimming, and the lock releases automatically.
 * No-ops where unsupported (iOS Safari).
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === "undefined") return;
    const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!wl) return;

    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;
    const acquire = () => {
      wl.request("screen")
        .then((l) => {
          if (cancelled) void l.release();
          else lock = l;
        })
        .catch(() => undefined);
    };
    acquire();
    // locks drop on visibility change — re-acquire when visible again
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled && !lock) acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
