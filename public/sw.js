/* Aura service worker (Phase 9.1 + 9.3 push plumbing).
 *
 * - Precaches the app shell + offline fallback on install.
 * - Navigations: network-first, falling back to cache, then /offline.
 * - Static assets (_next/static, icons): cache-first.
 * - Push events: renders critical-alert notifications.
 * - notificationclick: focuses the app at the payload URL.
 */

const CACHE = "aura-shell-v2";
const SHELL = ["/", "/offline", "/dhh", "/hearing", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // API + signaling-adjacent traffic always hits the network.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match("/offline"))
        )
    );
    return;
  }

  // Static assets: cache-first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname === "/icon" || url.pathname === "/apple-icon" || url.pathname === "/sw.js") {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
            return res;
          })
      )
    );
  }
});

self.addEventListener("push", (event) => {
  let title = "Aura alert";
  let body = "Something needs your attention.";
  let url = "/dhh";
  try {
    const data = event.data ? event.data.json() : {};
    if (typeof data.title === "string") title = data.title;
    if (typeof data.body === "string") body = data.body;
    if (typeof data.url === "string") url = data.url;
  } catch {
    /* malformed payload — defaults stand */
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon",
      badge: "/icon",
      tag: "aura-critical",
      renotify: true,
      requireInteraction: true,
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dhh";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const w of windows) {
          if ("focus" in w) return w.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
        return undefined;
      })
  );
});
