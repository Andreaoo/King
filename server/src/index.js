// ============================================================================
// Server Socket.IO per Cart King multiplayer.
// In produzione serve ANCHE il frontend buildato (client/dist), così frontend
// e backend stanno su un unico servizio. La logica di gioco è in room.js/engine.js
// e NON viene toccata qui.
// Avvio: node src/index.js  (o npm run dev nel package server)
// ============================================================================
import { createServer } from "http";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, extname, dirname } from "path";
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
    ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
    ".json": "application/json", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon",
    ".woff2": "font/woff2", ".txt": "text/plain",
};

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
        // routing SPA: percorsi come /room/K7P2 non sono file → servi index.html
        if (urlPath === "/" || !existsSync(filePath) || !extname(filePath)) {
            filePath = join(DIST, "index.html");
        }
        const data = await readFile(filePath);
        res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
        res.end(data);
    } catch {
        res.writeHead(404); res.end("Not found");
    }
});

// CORS: in locale accetta tutto; in produzione puoi restringere con CLIENT_ORIGIN
const io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || "*", methods: ["GET", "POST"] },
    // ottimizzazioni per reti mobili instabili
    pingInterval: 20000,        // ping ogni 20s per tenere viva la connessione
    pingTimeout: 25000,         // tolleranza prima di considerare caduta la connessione (reti lente)
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

    socket.on("createRoom", ({ name, difficulty, gameType, pid }, cb) => {
        let code;
        do { code = genCode(); } while (rooms.has(code));
        const room = new GameRoom(code, io);
        room.chat = new RoomChat(room, io, files);
        room.setConfig({ difficulty, gameType });
        rooms.set(code, room);
        playerId = pid;
        const p = room.addHuman(pid, name, socket.id);
        socket.join(code);
        currentRoom = room;
        cb?.({ ok: true, code });
        room.emit();
        socket.emit("chat:ready");
        room.chat.broadcastRoster();
    });

    socket.on("joinRoom", ({ code, name, pid }, cb) => {
        const room = rooms.get((code || "").toUpperCase());
        if (!room) return cb?.({ ok: false, error: "Stanza non trovata" });
        if (room.status !== "lobby" && !room.players.find((x) => x.id === pid))
            return cb?.({ ok: false, error: "La partita è già iniziata" });
        playerId = pid;
        const p = room.addHuman(pid, name, socket.id);
        if (!p) return cb?.({ ok: false, error: "Stanza piena" });
        socket.join(room.code);
        currentRoom = room;
        cb?.({ ok: true, code: room.code });
        room.emit();
        socket.emit("chat:ready");
        room.chat.broadcastRoster();
    });

    socket.on("setConfig", (cfg) => {
        if (currentRoom && currentRoom.ownerId === playerId) {
            currentRoom.setConfig(cfg);
            currentRoom.emit();
        }
    });

    socket.on("startGame", () => {
        if (currentRoom && currentRoom.ownerId === playerId && currentRoom.status === "lobby") {
            currentRoom.start();
        }
    });

    socket.on("playCard", ({ cardId }) => currentRoom?.playCard(playerId, cardId));
    socket.on("chooseTrump", ({ suit }) => currentRoom?.chooseTrump(playerId, suit));
    socket.on("chooseBlind", ({ blind }) => currentRoom?.chooseBlind(playerId, blind));
    socket.on("dominoPass", () => currentRoom?.dominoPass(playerId));
    socket.on("nextMode", () => currentRoom?.nextMode(playerId));
    // ---- gioco a coppie ----
    socket.on("setTeam", ({ seat, team }) => currentRoom?.setTeam(playerId, seat, team));
    socket.on("proposeModes", ({ modes }) => currentRoom?.proposeModes(playerId, modes));
    socket.on("decideMode", ({ key, trump }) => currentRoom?.decideMode(playerId, key, trump));

    // ---- chat: il mittente è sempre il giocatore legato a questo socket ----
    const chatMember = () => (currentRoom ? currentRoom.chat.memberFor(playerId) : null);
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
        if (currentRoom) {
            currentRoom.playerLeaves(playerId);
            currentRoom.chat.broadcastRoster();
            cleanup(currentRoom);
            currentRoom = null;
        }
    });

    socket.on("disconnect", () => {
        if (currentRoom) {
            const room = currentRoom;
            const p = room.markDisconnected(socket.id);
            room.chat.broadcastRoster();
            if (p && !p.bot) {
                room.message = `${p.name} si è disconnesso…`;
                room.emit();
                // periodo di grazia per riconnessione: se non torna, diventa bot (o chiude se master)
                const leavingId = p.id;
                setTimeout(() => {
                    const still = room.players.find((x) => x.id === leavingId);
                    if (still && !still.bot && !still.connected) {
                        room.convertToBotIfStillOffline(leavingId);
                        room.chat.broadcastRoster();
                    }
                }, 30000); // 30s per rientrare
            }
            cleanup(room);
        }
    });
});

// rimuove stanze vuote (nessun umano connesso) dopo un po'
function cleanup(room) {
    const anyHuman = room.players.some((p) => !p.bot && p.connected);
    if (!anyHuman) {
        setTimeout(() => {
            const stillEmpty = !room.players.some((p) => !p.bot && p.connected);
            if (stillEmpty) { clearTimeout(room.botTimer); room.stopWatchdog?.(); room.chat.destroy(); rooms.delete(room.code); }
        }, 60000); // 60s di grazia per riconnessione
    }
}

httpServer.listen(PORT, () => console.log(`🃏 Cart King server su http://localhost:${PORT}`));
