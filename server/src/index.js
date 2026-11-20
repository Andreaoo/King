// ============================================================================
// Server Socket.IO per King multiplayer.
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
import { verifyUser, guestFrom, recordGame, newGameId, guestHistory, claimGuest, deleteUser } from "./accounts.js";

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

// Indirizzo pubblico del sito (per og:image ecc.). PUBLIC_URL lo fissa; altrimenti lo si
// ricava dalla richiesta (dietro Render/proxy arriva x-forwarded-proto = https).
function publicOrigin(req) {
    const fixed = (process.env.PUBLIC_URL || "").trim().replace(/\/+$/, "");
    if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(fixed)) return fixed;
    const first = (v) => String(v || "").split(",")[0].trim();
    const proto = first(req.headers["x-forwarded-proto"]) === "https" ? "https" : (req.socket.encrypted ? "https" : "http");
    let host = first(req.headers["x-forwarded-host"]) || first(req.headers.host);
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) host = "localhost";   // niente valori strani nella pagina
    return `${proto}://${host}`;
}

// Cache HTTP: la pagina e il service worker vanno sempre ricontrollati (così gli
// aggiornamenti arrivano subito); i file con l'hash nel nome non cambiano mai.
function cacheHeader(urlPath, filePath) {
    if (urlPath.startsWith("/assets/")) return "public, max-age=31536000, immutable";
    if (filePath.endsWith("index.html") || urlPath === "/sw.js" || urlPath.endsWith(".webmanifest")) return "no-cache";
    // icone che Safari chiede da solo, senza versione nell'indirizzo: sempre ricontrollate
    if (["/apple-touch-icon.png", "/apple-touch-icon-precomposed.png", "/favicon.ico", "/favicon.png"].includes(urlPath)) return "no-cache";
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

// ---------- API account (Supabase) ----------
// Autenticazione: "Authorization: Bearer <token di accesso Supabase>", verificato dal server.
async function readJson(req, max = 4096) {
    let body = "";
    for await (const chunk of req) { body += chunk; if (body.length > max) throw new Error("troppo grande"); }
    return body ? JSON.parse(body) : {};
}
async function accountApi(req, res, url) {
    const send = (code, body) => {
        res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(body));
    };
    if (req.method !== "POST") return send(405, { ok: false, error: "Metodo non ammesso" });
    let body;
    try { body = await readJson(req); } catch { return send(400, { ok: false, error: "Richiesta non valida" }); }
    // statistiche temporanee dell'ospite: si dimostra l'identità con il suo segreto
    if (url.pathname === "/api/guest/history") return send(200, await guestHistory(body.guest));
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await verifyUser(token);
    if (!user) return send(401, { ok: false, error: "Sessione scaduta: accedi di nuovo." });
    if (url.pathname === "/api/account/claim-guest") return send(200, await claimGuest(user, body.guest));
    if (url.pathname === "/api/account/delete") return send(200, await deleteUser(user));
    return send(404, { ok: false, error: "Not found" });
}

const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    if (url.pathname.startsWith("/api/chat/")) return chatApi(req, res, url);
    if (url.pathname.startsWith("/api/account/") || url.pathname.startsWith("/api/guest/")) return accountApi(req, res, url);
    // se non c'è il frontend buildato, resta un semplice endpoint di stato
    if (!hasDist) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("King server attivo (solo backend). Builda il client per servirlo da qui.");
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
        let data = await readFile(filePath);
        // anteprima dei link: le immagini og/twitter devono avere un indirizzo assoluto
        if (filePath.endsWith("index.html")) data = Buffer.from(data.toString("utf8").replaceAll("__ORIGIN__", publicOrigin(req)));
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

// ---------------- stanze private: identificativo, codice d'accesso, invito ----------------
// room.code   : identificativo interno (URL /room/…). Conoscerlo NON permette di entrare.
// accessCode  : 6 caratteri da digitare (32^6 ≈ 1 miliardo di combinazioni + limite di tentativi)
// invite      : segreto del link /invite/… (96 bit). Codice e invito si rigenerano insieme.
const ALPHA = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // niente 0/O, 1/I: si legge e si detta bene
const randCode = (n) => Array.from(randomBytes(n), (x) => ALPHA[x % 32]).join("");
const genCode = () => randCode(6);
const INVITE_TTL = (Number(process.env.INVITE_TTL_H) || 24) * 3600 * 1000;  // validità del link d'invito

const byInvite = new Map();     // invite → room
const byAccess = new Map();     // accessCode → room
const deadInvites = new Map();  // invite/codice non più validi → { reason, at } (per spiegare l'errore)
function retire(key, reason) {
    if (!key) return;
    deadInvites.set(key, { reason, at: Date.now() });
    if (deadInvites.size > 5000) for (const [k, v] of deadInvites) if (Date.now() - v.at > 48 * 3600e3) deadInvites.delete(k);
}
function dropInvites(room, reason) {
    if (room.invite && byInvite.get(room.invite) === room) { byInvite.delete(room.invite); retire(room.invite, reason); }
    if (room.accessCode && byAccess.get(room.accessCode) === room) { byAccess.delete(room.accessCode); retire(room.accessCode, reason); }
}
function issueInvite(room, reason = "revoked") {
    dropInvites(room, reason);
    do { room.accessCode = randCode(6); } while (byAccess.has(room.accessCode));
    room.invite = randomBytes(12).toString("base64url");
    room.inviteExpires = Date.now() + INVITE_TTL;
    byInvite.set(room.invite, room);
    byAccess.set(room.accessCode, room);
}

// messaggi chiari per ogni caso in cui non si può entrare
const DEAD_MSG = {
    revoked: "Questo invito non è più valido: il proprietario ne ha creato uno nuovo. Chiedigli il link aggiornato.",
    expired: "Invito scaduto. Chiedi al tuo amico un nuovo link.",
    closed: "Il proprietario ha chiuso la stanza.",
    over: "La partita è terminata.",
    gone: "La stanza non esiste più.",
};
// trova la stanza da invito o codice; altrimenti il messaggio d'errore
function resolveRoom({ invite, accessCode }) {
    const key = invite ? String(invite).slice(0, 64) : String(accessCode || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
    if (!key) return { error: "Inserisci il codice della partita o usa il link d'invito.", bad: true };
    const room = invite ? byInvite.get(key) : byAccess.get(key);
    if (!room) {
        const dead = deadInvites.get(key);
        if (dead) return { error: DEAD_MSG[dead.reason] || DEAD_MSG.gone };
        return { error: invite ? "Invito non valido. Controlla di aver aperto il link completo." : "Codice non valido. Controlla di averlo scritto bene.", bad: true };
    }
    if (invite && Date.now() > room.inviteExpires && room.status === "lobby") return { error: DEAD_MSG.expired };
    if (room.status === "closed") return { error: room.closeReason === "owner" ? DEAD_MSG.closed : DEAD_MSG.gone };
    if (room.status === "gameOver") return { error: DEAD_MSG.over };
    return { room };
}

// limite ai tentativi sbagliati per indirizzo IP: indovinare un codice diventa impossibile
const failures = new Map(); // ip → { n, since }
const FAIL_MAX = 12, FAIL_WINDOW = 10 * 60 * 1000;
function ipOf(socket) {
    const fwd = String(socket.handshake.headers["x-forwarded-for"] || "").split(",")[0].trim();
    return fwd || socket.handshake.address || "?";
}
function blocked(ip) {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.since > FAIL_WINDOW) { failures.delete(ip); return false; }
    return f.n >= FAIL_MAX;
}
function fail(ip) {
    const f = failures.get(ip);
    if (!f || Date.now() - f.since > FAIL_WINDOW) failures.set(ip, { n: 1, since: Date.now() });
    else f.n++;
}

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
        let p = room.players.find((x) => x.id === pid && !x.bot);
        if (!p) {
            // sostituito da un bot dopo la disconnessione: riprende il posto se è davvero lui
            const held = room.banned.has(pid) ? null : room.seatHeldFor(pid);
            if (!held) return { ok: false, error: "gone" };
            if (!tokenOk(held.formerHuman, token)) return { ok: false, error: "auth" };
            p = room.restoreHuman(held);
        } else if (!tokenOk(p, token)) return { ok: false, error: "auth" };
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

    // Chi è il giocatore: account (token verificato da Supabase) oppure ospite (id + segreto).
    // null = token presente ma non valido: si chiede di accedere di nuovo.
    async function identify({ accessToken, guest } = {}) {
        if (accessToken) {
            const user = await verifyUser(accessToken);
            return user ? { userId: user.id } : null;
        }
        return { guest: guestFrom(guest) };
    }
    const setIdentity = (p, who) => { p.userId = who.userId || null; p.guest = who.userId ? null : (who.guest || null); };
    const onGameOver = (room) => {
        const r = room.gameRecord();
        if (!r) return;
        recordGame(r).then((x) => { if (!x.ok && !x.skipped) console.error("statistiche: partita non salvata", x.status, JSON.stringify(x.error)); })
            .catch((e) => console.error("statistiche:", e.message));
    };

    socket.on("createRoom", async ({ name, difficulty, gameType, pid, accessToken, guest } = {}, cb) => {
        if (typeof pid !== "string" || !pid) return cb?.({ ok: false, error: "Errore" });
        const who = await identify({ accessToken, guest });
        if (!who) return cb?.({ ok: false, error: "Sessione scaduta: accedi di nuovo." });
        let code;
        do { code = genCode(); } while (rooms.has(code));
        const room = new GameRoom(code, io);
        room.chat = new RoomChat(room, io, files);
        room.setConfig({ difficulty, gameType });
        rooms.set(code, room);
        issueInvite(room);
        room.onGameOver = onGameOver;
        room.newGameId = newGameId;
        const p = room.addHuman(pid, String(name || "").trim().slice(0, 14) || "Giocatore", socket.id);
        p.token = newToken();
        setIdentity(p, who);
        cb?.({ ok: true, code, token: p.token, accessCode: room.accessCode, invite: room.invite });
        bind(room, p);
    });

    // Ingresso in una stanza privata: SOLO con invito valido o codice d'accesso valido.
    // L'identificativo della stanza (quello nell'URL /room/…) non basta.
    socket.on("joinRoom", async ({ invite, accessCode, name, pid, token, accessToken, guest } = {}, cb) => {
        const reply = typeof cb === "function" ? cb : () => {};
        if (typeof pid !== "string" || !pid || pid.length > 64) return reply({ ok: false, error: "Errore di sessione: ricarica la pagina." });
        const who = await identify({ accessToken, guest });
        if (!who) return reply({ ok: false, error: "Sessione scaduta: accedi di nuovo." });
        const ip = ipOf(socket);
        if (blocked(ip)) return reply({ ok: false, error: "Troppi tentativi sbagliati. Riprova tra qualche minuto." });
        const r = resolveRoom({ invite, accessCode });
        if (!r.room) { if (r.bad) fail(ip); return reply({ ok: false, error: r.error }); }
        const room = r.room;
        if (room.banned.has(pid)) return reply({ ok: false, error: "Il proprietario ti ha rimosso da questa stanza." });

        // stesso ACCOUNT già al tavolo (es. da un altro dispositivo): riprende il suo posto
        if (who.userId) {
            const mine = room.players.find((x) => !x.bot && x.userId === who.userId);
            if (mine) { reply({ ok: true, code: room.code, token: mine.token }); return bind(room, mine); }
            const heldMine = room.players.find((x) => x.bot && x.formerHuman && x.formerHuman.userId === who.userId);
            if (heldMine && !room.banned.has(heldMine.formerHuman.id)) {
                const p = room.restoreHuman(heldMine);
                reply({ ok: true, code: room.code, token: p.token }); return bind(room, p);
            }
        }
        const existing = room.players.find((x) => x.id === pid && !x.bot);
        if (existing) {
            // stesso giocatore che rientra: deve dimostrare di essere lui
            if (!tokenOk(existing, token)) return reply({ ok: false, error: "Questo posto è già occupato da un'altra sessione." });
            reply({ ok: true, code: room.code, token: existing.token });
            return bind(room, existing);
        }
        const held = room.seatHeldFor(pid);
        if (held) {
            // era in partita ed è stato sostituito da un bot: rientra al suo posto
            if (!tokenOk(held.formerHuman, token)) return reply({ ok: false, error: "Questo posto è già occupato da un'altra sessione." });
            const p = room.restoreHuman(held);
            reply({ ok: true, code: room.code, token: p.token });
            return bind(room, p);
        }
        if (room.status !== "lobby") return reply({ ok: false, error: "La partita è già iniziata e non ci sono posti liberi." });
        const clean = String(name || "").trim().slice(0, 14) || "Giocatore";
        const p = room.addHuman(pid, clean, socket.id);
        if (!p) return reply({ ok: false, error: "La stanza è piena (4 giocatori su 4)." });
        p.token = newToken();
        setIdentity(p, who);
        reply({ ok: true, code: room.code, token: p.token });
        bind(room, p);
    });

    // anteprima di un invito (prima di scegliere come entrare): chi invita, quanti posti
    socket.on("inviteInfo", ({ invite } = {}, cb) => {
        if (typeof cb !== "function") return;
        const ip = ipOf(socket);
        if (blocked(ip)) return cb({ ok: false, error: "Troppi tentativi sbagliati. Riprova tra qualche minuto." });
        const r = resolveRoom({ invite });
        if (!r.room) { if (r.bad) fail(ip); return cb({ ok: false, error: r.error }); }
        const room = r.room;
        cb({ ok: true, host: room.owner ? room.owner.name : "", players: room.humans().length, max: 4,
            started: room.status !== "lobby", gameType: room.gameType });
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

    // ---- comandi del proprietario (verificati qui: mai fidarsi del client) ----
    socket.on("kickPlayer", ({ seat } = {}) => {
        if (!isOwner()) return;
        const room = currentRoom;
        const k = room.kick(Number(seat));
        if (!k) return;
        room.chat.broadcastRoster();
        const ks = k.socketId && io.sockets.sockets.get(k.socketId);
        if (ks) { ks.emit("room:kicked", { room: room.code }); ks.leave(room.code); }
    });
    socket.on("closeRoom", () => {
        if (!isOwner()) return;
        const room = currentRoom;
        dropInvites(room, "closed");
        room.close("owner");
        cleanup(room, true);
    });
    socket.on("regenerateInvite", (a, b) => {
        const cb = typeof a === "function" ? a : b;
        const reply = typeof cb === "function" ? cb : () => {};
        if (!isOwner()) return reply({ ok: false });
        issueInvite(currentRoom, "revoked");
        currentRoom.emit();
        reply({ ok: true });
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
    // sala d'attesa: "sono pronto"
    socket.on("setReady", act(({ ready }) => currentRoom.setReady(playerId, ready)));

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
            const room = currentRoom;
            const { closed } = room.playerLeaves(playerId);
            if (closed) dropInvites(room, "gone");
            room.chat.broadcastRoster();
            cleanup(room);
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
function cleanup(room, closedNow = false) {
    if (room.status === "gameOver") dropInvites(room, "over");          // partita finita: l'invito non serve più
    if (room.status === "closed") dropInvites(room, room.closeReason === "owner" ? "closed" : "gone");
    if (!closedNow && room.status !== "closed" && room.players.some((p) => !p.bot && p.connected)) return;
    clearTimeout(room.emptyTimer);
    // stanza chiusa: qualche secondo perché tutti ricevano l'avviso, poi si libera la memoria
    const closing = closedNow || room.status === "closed";
    room.emptyTimer = setTimeout(() => {
        if (!closing && room.players.some((p) => !p.bot && p.connected)) return;
        clearTimeout(room.botTimer); clearTimeout(room.negTimer); room.stopWatchdog?.();
        for (const p of room.players) clearTimeout(p.dropTimer);
        dropInvites(room, room.status === "gameOver" ? "over" : room.closeReason === "owner" ? "closed" : "gone");
        room.chat.destroy(); rooms.delete(room.code);
    }, closing ? 30000 : EMPTY_ROOM_MS);
}

httpServer.listen(PORT, () => console.log(`🃏 King server su http://localhost:${PORT}`));
