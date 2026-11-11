// Minimal service worker: keeps the app shell available offline. Frames wait in IndexedDB and
// upload when the connection returns (CaptureSession); this worker never caches API calls.
const SHELL = "soulprint-shell-v1";
self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(["/manifest.webmanifest", "/icon.svg"]))));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/evidence") || url.pathname.startsWith("/api")) return;
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
  }
});
