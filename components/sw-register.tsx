"use client";

import { useEffect } from "react";

/**
 * Phase 9.1 — registers /sw.js in production only (dev HMR and service
 * workers do not mix). Renders nothing.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return null;
}
