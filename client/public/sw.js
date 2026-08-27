// Service worker minimale: abilita l'installazione PWA e mette in cache il guscio.
// NON tocca la logica di gioco; il multiplayer resta sempre live via WebSocket.
const CACHE = "cartking-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // mai mettere in cache le connessioni socket.io / API: devono essere sempre live
  if (url.pathname.startsWith("/socket.io") || e.request.method !== "GET") return;
  // network-first per la navigazione, così l'app si aggiorna; fallback alla cache offline
  if (e.request.mode === "navigate") {
    e.respondWith(fetch(e.request).catch(() => caches.match("/index.html")));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
