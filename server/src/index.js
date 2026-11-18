// ============================================================================
// Server Socket.IO per Cart King multiplayer.
// In produzione serve ANCHE il frontend buildato (client/dist), così frontend
// e backend stanno su un unico servizio. La logica di gioco è in room.js/engine.js
// e NON viene toccata qui.
// Avvio: node src/index.js  (o npm run dev nel package server)
// ============================================================================
import { createServer } from "http";
import { randomBytes, timingSafeEqual } from "crypto";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, extname, dirname, sep } from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import { GameRoom } from "./room.js";
import { RoomChat, CHAT_CONFIG, chatTokens, limits } from "./chat.js";
import { FileStore } from "./chatFiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
// cartella del frontend buildato (client/dist). Se assente, il server fa solo da backend.
const DIST = join(__dirname, "..", "..", "client", "dist");
const hasDist = existsSync(join(DIST, "index.html"));

const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain",
};

// Cache HTTP: la pagina e il service worker vanno sempre ricontrollati (così gli
// aggiornamenti arrivano subito); i file con l'hash nel nome non cambiano mai.
function cacheHeader(urlPath, filePath) {
    if (urlPath.startsWith("/assets/")) return "public, max-age=31536000, immutable";
    if (filePath.endsWith("index.html") || urlPath === "/sw.js" || urlPath.endsWith(".webmanifest")) return "no-cache";
    return "public, max-age=86400";                     // carte, icone, schermate di avvio
}

const files = new FileStore();

// ---------- API HTTP della chat: upload/download allegati e ricerca GIF ----------
// Autenticazione: token personale ricevuto via socket (chat:hello), legato a
// stanza + giocatore. Il server ricontrolla ogni volta che il giocatore sia ancora
// nella stanza e che possa vedere quella conversazione.
async function chatApi(req, res, url) {
    const cors = {
        "Access-Control-Allow-Origin": process.env.CLIENT_ORIGIN || "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
    const send = (code, body) => {
        if (res.headersSent) return;
        res.writeHead(code, { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    const auth = chatTokens.get(url.searchParams.get("t") || "");
    if (!auth || !auth.chat.isActive(auth.uid)) return send(403, { error: "Non autorizzato" });
    const { chat, uid } = auth;

    if (url.pathname === "/api/chat/upload" && req.method === "POST") {
        if (!limits.upload.ok(uid)) return send(429, { error: "Troppi caricamenti, aspetta un attimo" });
        return files.upload(req, res, { room: chat.room.code, uid }, url.searchParams.get("name"), send);
    }
    const fm = url.pathname.match(/^\/api\/chat\/file\/([a-f0-9]{24})$/);
    if (fm && req.method === "GET") {
        for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
        return files.serve(req, res, fm[1], url.searchParams.has("dl"), (f) => chat.canSeeFile(uid, f));
    }
    if (url.pathname === "/api/chat/gifs" && req.method === "GET") {
        if (!CHAT_CONFIG.giphyKey) return send(404, { error: "Ricerca GIF non configurata" });
        if (!limits.gif.ok(uid)) return send(429, { error: "Troppe ricerche, aspetta un attimo" });
        const q = (url.searchParams.get("q") || "").slice(0, 60);
        const api = new URL(`https://api.giphy.com/v1/gifs/${q ? "search" : "trending"}`);
        api.search = new URLSearchParams({ api_key: CHAT_CONFIG.giphyKey, q, limit: "24", rating: "pg-13", lang: "it" });
        try {
            const r = await fetch(api, { signal: AbortSignal.timeout(6000) });
            const j = await r.json();
            return send(200, (j.data || []).map((g) => ({
                id: g.id, title: g.title,
                url: g.images?.fixed_height?.url, w: +g.images?.fixed_height?.width, h: +g.images?.fixed_height?.height,
                preview: g.images?.fixed_height_small?.url || g.images?.fixed_height?.url,
            })).filter((g) => g.url));
        } catch {
            return send(502, { error: "Servizio GIF non raggiungibile" });
        }
    }
    return send(404, { error: "Not found" });
}

const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    if (url.pathname.startsWith("/api/chat/")) return chatApi(req, res, url);
    // se non c'è il frontend buildato, resta un semplice endpoint di stato
    if (!hasDist) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("Cart King server attivo (solo backend). Builda il client per servirlo da qui.");
        return;
    }
    try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        let filePath = join(DIST, urlPath);
        // niente percorsi che escono dalla cartella del gioco (es. /../server/…)
        if (filePath !== DIST && !filePath.startsWith(DIST + sep)) { res.writeHead(404); return res.end("Not found"); }
        // routing SPA: percorsi come /room/K7P2 non sono file → servi index.html
        if (urlPath === "/" || !existsSync(filePath) || !extname(filePath)) {
            filePath = join(DIST, "index.html");
        }
        const data = await readFile(filePath);
        res.writeHead(200, {
            "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
            "Cache-Control": cacheHeader(urlPath, filePath),
            ...(urlPath === "/sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
        });
        res.end(data);
    } catch {
        res.writeHead(404); res.end("Not found");
    }
});

// ---- stabilità della connessione (configurabile da variabili d'ambiente) ----
const PING_MS = (Number(process.env.PING_INTERVAL_S) || 10) * 1000;      // battito
const PONG_MS = (Number(process.env.PING_TIMEOUT_S) || 20) * 1000;       // tolleranza risposta
const GRACE_MS = (Number(process.env.RECONNECT_GRACE_S) || 90) * 1000;   // posto tenuto a chi cade
const EMPTY_ROOM_MS = GRACE_MS + 30000;                                   // stanza senza umani connessi

// token di sessione: segreto dato solo al proprietario del posto, serve per riprenderlo
const newToken = () => randomBytes(18).toString("base64url");
function tokenOk(p, token) {
    if (!p.token || typeof token !== "string") return false;
    const a = Buffer.from(p.token), b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
}

// CORS: in locale accetta tutto; in produzione puoi restringere con CLIENT_ORIGIN
const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || "*", methods: ["GET", "POST"] },
    // ottimizzazioni per reti mobili instabili
    // heartbeat: un ping ogni PING_MS; il socket è considerato caduto solo dopo
    // PING_MS + PONG_MS senza risposta (cioè dopo più battiti mancati, non uno solo).
    // Caduto il socket, il giocatore NON esce: resta "offline" per GRACE_MS (vedi sotto).
    pingInterval: PING_MS,
    pingTimeout: PONG_MS,
    connectTimeout: 20000,      // tempo per stabilire la connessione iniziale
    perMessageDeflate: {        // compressione dei messaggi (stato di gioco) per ridurre il traffico
        threshold: 512,           // comprime solo payload > 512 byte
    },
    transports: ["websocket", "polling"], // websocket preferito, polling come fallback
    maxHttpBufferSize: 1e6,     // limite ragionevole per i messaggi
});

/** @type {Map<string, GameRoom>} */
const rooms = new Map();

const genCode = () =>
    Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

io.on("connection", (socket) => {
    let currentRoom = null;
    let playerId = null;

    // Il giocatore legato a QUESTO socket. Se la sessione è stata ripresa da un'altra
    // connessione (nuova scheda, riconnessione), il socket vecchio non conta più:
    // così un'azione arrivata in ritardo dal vecchio canale non può essere giocata due volte.
    const me = () => {
        const p = currentRoom?.players.find((x) => x.id === playerId);
        return p && !p.bot && p.socketId === socket.id ? p : null;
    };

    // Lega il socket al posto del giocatore e gli rimanda lo stato autoritativo completo.
    function bind(room, p) {
        clearTimeout(p.dropTimer); p.dropTimer = null;
        const old = p.socketId;
        p.socketId = socket.id;
        p.connected = true;
        socket.join(room.code);
        currentRoom = room;
        playerId = p.id;
        clearTimeout(room.emptyTimer); room.emptyTimer = null;
        // se la stessa sessione era ancora aperta su un altro canale, quello viene chiuso
        if (old && old !== socket.id) {
            const prev = io.sockets.sockets.get(old);
            if (prev) { prev.emit("session:replaced"); prev.disconnect(true); }
        }
        if (room.message && room.message.endsWith("si è disconnesso…")) room.message = "";
        room.emit();
        socket.emit("chat:ready");
        room.chat.broadcastRoster();
    }

    // Ripresa della sessione: solo per chi ha già un posto e ne conosce il token.
    // Non crea mai un giocatore nuovo.
    function resume({ room: code, pid, token } = {}) {
        const room = rooms.get(String(code || "").toUpperCase());
        if (!room || room.status === "closed") return { ok: false, error: "gone" };
        const p = room.players.find((x) => x.id === pid && !x.bot);
        if (!p) return { ok: false, error: "gone" };
        if (!tokenOk(p, token)) return { ok: false, error: "auth" };
        bind(room, p);
        return { ok: true, code: room.code, token: p.token };
    }

    // ripresa automatica già nella stretta di mano: lo stato arriva prima di ogni altra cosa
    const auth = socket.handshake.auth || {};
    if (auth.room && auth.pid) {
        const r = resume(auth);
        if (!r.ok) socket.emit("session:invalid", { error: r.error, room: auth.room });
    }

    socket.on("resumeSession", (payload, cb) => cb?.(resume(payload || {})));

    socket.on("createRoom", ({ name, difficulty, gameType, pid }, cb) => {
        if (typeof pid !== "string" || !pid) return cb?.({ ok: false, error: "Errore" });
        let code;
        do { code = genCode(); } while (rooms.has(code));
        const room = new GameRoom(code, io);
        room.chat = new RoomChat(room, io, files);
        room.setConfig({ difficulty, gameType });
        rooms.set(code, room);
        const p = room.addHuman(pid, name, socket.id);
        p.token = newToken();
        cb?.({ ok: true, code, token: p.token });
        bind(room, p);
    });

    socket.on("joinRoom", ({ code, name, pid, token }, cb) => {
        const room = rooms.get((code || "").toUpperCase());
        if (!room) return cb?.({ ok: false, error: "Stanza non trovata" });
        if (typeof pid !== "string" || !pid) return cb?.({ ok: false, error: "Errore" });
        const existing = room.players.find((x) => x.id === pid && !x.bot);
        if (existing) {
            // stesso giocatore che rientra: deve dimostrare di essere lui
            if (!tokenOk(existing, token)) return cb?.({ ok: false, error: "Sessione non valida per questo posto" });
            cb?.({ ok: true, code: room.code, token: existing.token });
            return bind(room, existing);
        }
        if (room.status !== "lobby") return cb?.({ ok: false, error: "La partita è già iniziata" });
        const p = room.addHuman(pid, name, socket.id);
        if (!p) return cb?.({ ok: false, error: "Stanza piena" });
        p.token = newToken();
        cb?.({ ok: true, code: room.code, token: p.token });
        bind(room, p);
    });

    // controllo di vita chiesto dal client quando torna in primo piano
    socket.on("ck:ping", (cb) => typeof cb === "function" && cb({ ok: true, inRoom: !!me() }));

    const isOwner = () => !!me() && currentRoom.ownerId === playerId;
    socket.on("setConfig", (cfg) => {
        if (isOwner()) {
            currentRoom.setConfig(cfg);
            currentRoom.emit();
        }
    });

    socket.on("startGame", () => {
        if (isOwner() && currentRoom.status === "lobby") {
            currentRoom.start();
        }
    });

    // azioni di gioco: valgono solo dal canale attuale del giocatore.
    // Il server rifiuta comunque mosse fuori turno o carte non in mano, quindi
    // un invio ripetuto dopo una riconnessione non può duplicare nulla.
    const act = (fn) => (payload) => { if (me()) fn(payload && typeof payload === "object" ? payload : {}); };
    socket.on("playCard", act(({ cardId }) => currentRoom.playCard(playerId, cardId)));
    socket.on("chooseTrump", act(({ suit }) => currentRoom.chooseTrump(playerId, suit)));
    socket.on("chooseBlind", act(({ blind }) => currentRoom.chooseBlind(playerId, blind)));
    socket.on("dominoPass", act(() => currentRoom.dominoPass(playerId)));
    socket.on("nextMode", act(() => currentRoom.nextMode(playerId)));
    // ---- gioco a coppie ----
    socket.on("setTeam", act(({ seat, team }) => currentRoom.setTeam(playerId, seat, team)));
    socket.on("proposeModes", act(({ modes }) => currentRoom.proposeModes(playerId, modes)));
    socket.on("decideMode", act(({ key, trump }) => currentRoom.decideMode(playerId, key, trump)));

    // ---- chat: il mittente è sempre il giocatore legato a questo socket ----
    const chatMember = () => (me() ? currentRoom.chat.memberFor(playerId) : null);
    const chatCall = (fn) => (payload, cb) => {
        const m = chatMember();
        const reply = typeof cb === "function" ? cb : () => {};
        if (!m) return reply({ ok: false, error: "Non sei in questa stanza" });
        reply(fn(currentRoom.chat, m, payload && typeof payload === "object" ? payload : {}));
    };
    socket.on("chat:hello", chatCall((chat, m) => ({ ok: true, ...chat.hello(m) })));
    socket.on("chat:history", chatCall((chat, m, p) => chat.history(m, p)));
    socket.on("chat:send", chatCall((chat, m, p) => chat.send(m, p)));
    socket.on("chat:delete", chatCall((chat, m, p) => chat.remove(m, p)));
    socket.on("chat:react", chatCall((chat, m, p) => chat.react(m, p)));
    socket.on("chat:typing", chatCall((chat, m, p) => { chat.typing(m, p); return { ok: true }; }));

    socket.on("leaveRoom", () => {
        const p = me();
        if (p) {
            clearTimeout(p.dropTimer);
            currentRoom.playerLeaves(playerId);
            currentRoom.chat.broadcastRoster();
            cleanup(currentRoom);
        }
        currentRoom = null;
    });

    socket.on("disconnect", () => {
        const room = currentRoom;
        if (!room) return;
        const p = room.markDisconnected(socket.id);   // solo se questo era ancora il suo canale
        if (!p || p.bot) return;
        room.chat.broadcastRoster();
        room.message = `${p.name} si è disconnesso…`;
        room.emit();
        // posto tenuto per GRACE_MS: se rientra prima, bind() annulla il timer.
        // Un solo timer per giocatore: cadute ripetute non si sommano.
        clearTimeout(p.dropTimer);
        const leavingId = p.id;
        p.dropTimer = setTimeout(() => {
            const still = room.players.find((x) => x.id === leavingId);
            if (still) still.dropTimer = null;
            if (still && !still.bot && !still.connected && rooms.get(room.code) === room) {
                room.convertToBotIfStillOffline(leavingId);
                room.chat.broadcastRoster();
                cleanup(room);
            }
        }, GRACE_MS);
        cleanup(room);
    });
});

// rimuove le stanze senza umani connessi, dopo un'attesa più lunga del periodo di grazia
function cleanup(room) {
    if (room.players.some((p) => !p.bot && p.connected)) return;
    clearTimeout(room.emptyTimer);
    room.emptyTimer = setTimeout(() => {
        if (room.players.some((p) => !p.bot && p.connected)) return;
        clearTimeout(room.botTimer); room.stopWatchdog?.();
        for (const p of room.players) clearTimeout(p.dropTimer);
        room.chat.destroy(); rooms.delete(room.code);
    }, EMPTY_ROOM_MS);
}

httpServer.listen(PORT, () => console.log(`🃏 Cart King server su http://localhost:${PORT}`));
