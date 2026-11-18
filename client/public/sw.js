// Service worker di KING: rende l'app installabile e apribile anche offline (solo il guscio).
// Regole:
//  - il multiplayer (WebSocket /socket.io) e le API della chat (/api/) NON passano mai dalla cache;
//  - stato di gioco, sessione e token restano in memoria/localStorage, mai qui;
//  - pagina: prima la rete (così arrivano gli aggiornamenti), la copia in cache serve solo offline;
//  - file con l'hash nel nome (/assets/…), carte, icone e font: dalla cache, sono immutabili.
const VERSION = "king-v5";
const SHELL = `${VERSION}-shell`;     // pagina, manifest, icone, carte
const ASSETS = `${VERSION}-assets`;   // JS/CSS buildati e font
const MAX_ASSETS = 40;

const CARDS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
  .flatMap((r) => ["hearts", "diamonds", "clubs", "spades"].map((s) => `/cards/${r}${s}.jpg`));
const PRECACHE = ["/", "/manifest.webmanifest", "/cover.jpg", "/cover-768.jpg", "/icons/icon-192.png", "/icons/icon-512.png", ...CARDS];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);
    // anche JS e CSS della versione attuale, letti dalla pagina appena scaricata
    try {
      const html = await (await c.match("/")).text();
      const files = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
      if (files.length) await (await caches.open(ASSETS)).addAll(files);
    } catch { /* la cache si riempirà al primo uso */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS]);
    for (const k of await caches.keys()) if (!keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isLive = (url) =>
  url.pathname.startsWith("/socket.io") || url.pathname.startsWith("/api/");

async function trim(cacheName, max) {
  const c = await caches.open(cacheName);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - max; i++) await c.delete(keys[i]);
}

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && (res.type === "basic" || res.type === "cors")) {
    const c = await caches.open(cacheName);
    await c.put(req, res.clone());
    if (cacheName === ASSETS) trim(ASSETS, MAX_ASSETS);
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;

  // multiplayer, chat, allegati: sempre e solo rete
  if (same && isLive(url)) return;

  // pagina (anche /room/CODICE): rete prima; offline si apre la copia salvata
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req, { cache: "no-store" });
        if (res.ok) (await caches.open(SHELL)).put("/", res.clone());
        return res;
      } catch {
        return (await caches.match("/")) || Response.error();
      }
    })());
    return;
  }

  if (same && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/cards/")
      || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/splash/"))) {
    e.respondWith(cacheFirst(req, url.pathname.startsWith("/assets/") ? ASSETS : SHELL));
    return;
  }
  // font di Google: immutabili, utili per il guscio offline
  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    e.respondWith(cacheFirst(req, ASSETS).catch(() => caches.match(req)));
    return;
  }
  // tutto il resto: rete normale (con la cache solo se offline)
  if (same) e.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r || Response.error())));
});
