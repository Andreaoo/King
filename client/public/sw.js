// Service worker di KING: rende l'app installabile e apribile anche offline (solo il guscio).
// Regole:
//  - il multiplayer (WebSocket /socket.io) e le API della chat (/api/) NON passano mai dalla cache;
//  - stato di gioco, sessione e token restano in memoria/localStorage, mai qui;
//  - pagina: prima la rete (così arrivano gli aggiornamenti), la copia in cache serve solo offline;
//  - file con l'hash nel nome (/assets/…), carte, icone e font: dalla cache, sono immutabili.
const VERSION = "king-v9";
const SHELL = `${VERSION}-shell`;     // pagina, manifest, icone, carte
const ASSETS = `${VERSION}-assets`;   // JS/CSS buildati e font
const MAX_ASSETS = 40;

const CARDS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]
  .flatMap((r) => ["hearts", "diamonds", "clubs", "spades"].map((s) => `/cards/${r}${s}.jpg`));
const PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/brand/king-home.jpg", ...CARDS];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(PRECACHE);
    // se il server stava ancora dormendo "/" è la pagina d'attesa di Render: installazione annullata, si riprova dopo
    const home = await c.match("/");
    if (!home || !isKing(await home.clone().text())) throw new Error("pagina di avvio non valida");
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

// la pagina vera di King (e non la pagina d'attesa di Render o di un proxy)
const HTML_H = { "Content-Type": "text/html; charset=utf-8" };
const isKing = (html) => html.includes('name="ck-app"');

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

  // pagina (anche /room/CODICE): rete prima, ma solo se risponde davvero King e in fretta.
  // Se il server gratuito dorme, Render risponde con la sua pagina "Application loading":
  // in quel caso (o offline, o rete lenta) si apre subito la copia salvata, che mostra la
  // nostra schermata di avvio e si collega da sola appena il server è sveglio.
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      const cached = await caches.match("/");
      const net = (async () => {
        const res = await fetch(req, { cache: "no-store" });
        const html = await res.text();
        if (!res.ok || !isKing(html)) throw new Error("non è King");
        await (await caches.open(SHELL)).put("/", new Response(html, { headers: HTML_H }));
        return new Response(html, { headers: HTML_H });
      })();
      if (!cached) return net.catch(() => fetch(req)); // primo avvio in assoluto: non c'è altro
      const timeout = new Promise((r) => setTimeout(() => r(null), 3000));
      const res = await Promise.race([net.catch(() => null), timeout]);
      if (res) return res;
      e.waitUntil(net.catch(() => {})); // la versione nuova, se arriva, sarà pronta al prossimo avvio
      return cached;
    })());
    return;
  }

  if (same && (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/cards/")
      || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/splash/") || url.pathname.startsWith("/brand/"))) {
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
