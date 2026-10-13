"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushState = "unsupported" | "denied" | "off" | "on" | "error";

/**
 * Phase 9.3 — critical-alert notifications.
 *
 * - `enabled` reflects an active push subscription (toggle in settings).
 * - `notifyCritical()` shows a notification via the service worker when the
 *   page is hidden — the in-app flash covers the visible case.
 * - Works signed-out too for local notifications; server fan-out needs auth.
 */
export function usePushNotifications() {
  // Lazy init runs client-side on first render (settings sheet content is
  // never SSR'd), so permission/support checks can't mismatch hydration.
  const [state, setState] = useState<PushState>(() => {
    if (typeof window === "undefined") return "off";
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      return "unsupported";
    }
    if (Notification.permission === "denied") return "denied";
    return "off";
  });
  const supported = state !== "unsupported";
  const subRef = useRef<PushSubscription | null>(null);

  /* Reflect any pre-existing subscription (async read — no render cascade) */
  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        if (cancelled) return;
        subRef.current = sub;
        if (sub) setState("on");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supported]);

  const enable = useCallback(async (): Promise<boolean> => {
    if (!supported) return false;
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return false;
      }
      const reg = await navigator.serviceWorker.ready;
      const statusRes = await fetch("/api/push");
      const status = (await statusRes.json().catch(() => ({}))) as { vapidPublicKey?: string };
      if (!status.vapidPublicKey) {
        // No server keys — local notifications still work; nothing to send to.
        setState("on");
        return true;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ToBytes(status.vapidPublicKey),
      });
      subRef.current = sub;
      // Persist for server fan-out (signed-in users; 401 otherwise — fine).
      await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      }).catch(() => undefined);
      setState("on");
      return true;
    } catch {
      setState("error");
      return false;
    }
  }, [supported]);

  const disable = useCallback(async () => {
    try {
      const sub = subRef.current;
      if (sub) {
        const json = sub.toJSON();
        await sub.unsubscribe();
        subRef.current = null;
        if (json.endpoint) {
          await fetch("/api/push", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: json.endpoint }),
          }).catch(() => undefined);
        }
      }
    } finally {
      setState("off");
    }
  }, []);

  /** Show a critical alert if the page isn't visible (flash covers visible). */
  const notifyCritical = useCallback(
    async (title: string, body: string, url = "/dhh") => {
      if (!supported || Notification.permission !== "granted") return;
      if (!document.hidden) return;
      try {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, {
          body,
          icon: "/icon",
          badge: "/icon",
          tag: "aura-critical",
          renotify: true,
          requireInteraction: true,
          data: { url },
        } as NotificationOptions & { renotify?: boolean });
      } catch {
        /* notification failed — in-app cues remain */
      }
    },
    [supported]
  );

  return { state, supported, enable, disable, notifyCritical };
}
