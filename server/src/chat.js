// ============================================================================
// Chat della stanza: messaggi pubblici e privati, storico a pagine, risposte,
// reazioni, cancellazione, "sta scrivendo", elenco giocatori.
//
// Identità: il server sa già quale pid sta dietro ogni socket (index.js), quindi
// il mittente lo decide sempre il server e non il client. Il pid resta segreto:
// agli altri giocatori viaggia solo un identificativo pubblico casuale (uid).
// Autorizzazione: può leggere e scrivere solo chi è oggi un giocatore umano della
// stanza; i privati li vedono soltanto i due interessati.
// ============================================================================
import { randomBytes } from "crypto";
import { FILE_CONFIG } from "./chatFiles.js";

export const CHAT_CONFIG = {
    maxText: 2000,
    maxFilesPerMessage: 10,
    pageSize: 40,
    maxPerConv: 2000,        // oltre, i messaggi più vecchi (e i loro file) vengono scartati
    maxReactionKinds: 20,
    giphyKey: process.env.GIPHY_API_KEY || "",   // ricerca GIF online: opzionale
};

const rid = (n = 9) => randomBytes(n).toString("base64url");

// limite a finestra mobile, per giocatore
class Limiter {
    constructor(max, ms) { this.max = max; this.ms = ms; this.hits = new Map(); }
    ok(key) {
        const now = Date.now();
        const arr = (this.hits.get(key) || []).filter((t) => now - t < this.ms);
        const pass = arr.length < this.max;
        if (pass) arr.push(now);
        this.hits.set(key, arr);
        return pass;
    }
}
export const limits = {
    msg: new Limiter(8, 10_000),
    react: new Limiter(30, 10_000),
    typing: new Limiter(25, 10_000),
    del: new Limiter(20, 10_000),
    upload: new Limiter(25, 60_000),
    gif: new Limiter(30, 60_000),
};

// token per scaricare/caricare file: token -> { chat, uid }
export const chatTokens = new Map();

const cleanText = (t) =>
    String(t ?? "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();

// un'emoji (anche composta: pelle, ZWJ, bandiere, tastierini) e nient'altro
const isEmoji = (s) =>
    typeof s === "string" && s.length > 0 && s.length <= 16 && !/[\s\p{L}<>]/u.test(s) &&
    /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s);

const GIF_URL = /^https:\/\/(media\d*|i)\.giphy\.com\/[^\s"'<>]+$/;

export class RoomChat {
    constructor(room, io, files) {
        this.room = room;
        this.io = io;
        this.files = files;
        this.byPid = new Map();     // pid -> member { uid, pid, name, token }
        this.byUid = new Map();     // uid -> member
        this.convs = new Map();     // conv -> [messaggi in ordine]
        this.msgs = new Map();      // id -> messaggio
        this.sent = new Map();      // `${uid}|${clientId}` -> id (anti-duplicato)
        this.seq = 0;
    }

    // ---------- giocatori ----------
    /** Membro per un pid, solo se è oggi un giocatore umano della stanza. */
    memberFor(pid) {
        const p = this.room.players.find((x) => x.id === pid && !x.bot);
        if (!p) return null;
        let m = this.byPid.get(pid);
        if (!m) {
            m = { uid: rid(), pid, name: p.name, token: rid(24) };
            this.byPid.set(pid, m);
            this.byUid.set(m.uid, m);
            chatTokens.set(m.token, { chat: this, uid: m.uid });
        }
        m.name = p.name;
        return m;
    }

    playerOf(uid) {
        const m = this.byUid.get(uid);
        return m ? this.room.players.find((p) => p.id === m.pid && !p.bot) || null : null;
    }
    isActive(uid) { return !!this.playerOf(uid); }

    roster() {
        const list = this.room.players.map((p) => {
            if (p.bot) return { uid: null, name: p.name, bot: true, online: true, seat: p.seat };
            const m = this.memberFor(p.id);
            return { uid: m.uid, name: p.name, bot: false, online: !!p.connected, seat: p.seat };
        });
        // chi è uscito resta visibile nelle vecchie conversazioni, ma non è più raggiungibile
        for (const m of this.byUid.values())
            if (!this.isActive(m.uid)) list.push({ uid: m.uid, name: m.name, bot: false, online: false, left: true });
        return list;
    }

    broadcastRoster() {
        const roster = this.roster();
        this.emitTo(this.activeUids(), "chat:roster", roster);
    }

    activeUids() { return [...this.byUid.keys()].filter((u) => this.isActive(u)); }

    emitTo(uids, ev, data) {
        for (const uid of uids) {
            const p = this.playerOf(uid);
            if (p?.socketId) this.io.to(p.socketId).emit(ev, data);
        }
    }

    // ---------- conversazioni ----------
    static dmId(a, b) { return `dm:${[a, b].sort().join(":")}`; }

    canAccess(uid, conv) {
        if (!this.isActive(uid)) return false;
        if (conv === "room") return true;
        if (typeof conv !== "string" || !conv.startsWith("dm:")) return false;
        const parts = conv.slice(3).split(":");
        return parts.length === 2 && parts.includes(uid) && parts.every((u) => this.byUid.has(u)) && parts[0] !== parts[1];
    }

    audience(conv) {
        if (conv === "room") return this.activeUids();
        return conv.slice(3).split(":").filter((u) => this.isActive(u));
    }

    preview(m) {
        if (!m) return null;
        return {
            id: m.id, from: m.from, name: m.name, deleted: m.deleted,
            text: m.deleted ? "" : m.text.slice(0, 160),
            media: m.deleted ? null : m.gif ? "gif" : m.attachments.length ? m.attachments[0].kind : null,
        };
    }

    toPublic(m) {
        return {
            id: m.id, seq: m.seq, conv: m.conv, from: m.from, name: m.name, ts: m.ts,
            text: m.text, deleted: m.deleted, clientId: m.clientId,
            attachments: m.attachments, gif: m.gif,
            replyTo: m.replyTo ? this.preview(this.msgs.get(m.replyTo)) || { id: m.replyTo, deleted: true } : null,
            reactions: [...m.reactions].map(([e, set]) => ({ e, uids: [...set] })),
        };
    }

    hello(m) {
        const dms = [];
        for (const [conv, list] of this.convs) {
            if (!conv.startsWith("dm:") || !list.length || !this.canAccess(m.uid, conv)) continue;
            const peer = conv.slice(3).split(":").find((u) => u !== m.uid);
            dms.push({ conv, peer, last: this.toPublic(list[list.length - 1]) });
        }
        return {
            me: m.uid, token: m.token, roster: this.roster(), dms,
            config: {
                maxFileMB: FILE_CONFIG.maxFileBytes / 1048576, maxFiles: CHAT_CONFIG.maxFilesPerMessage,
                maxText: CHAT_CONFIG.maxText, gifSearch: !!CHAT_CONFIG.giphyKey,
            },
        };
    }

    history(m, { conv, before }) {
        if (!this.canAccess(m.uid, conv)) return { ok: false, error: "Conversazione non disponibile" };
        const list = this.convs.get(conv) || [];
        const upto = Number.isFinite(before) ? list.filter((x) => x.seq < before) : list;
        const page = upto.slice(-CHAT_CONFIG.pageSize);
        return { ok: true, messages: page.map((x) => this.toPublic(x)), hasMore: upto.length > page.length };
    }

    send(m, { conv, text, replyTo, attachments, gif, clientId }) {
        if (!this.canAccess(m.uid, conv)) return { ok: false, error: "Conversazione non disponibile" };
        // ritrasmissione dopo una riconnessione: restituisce lo stesso messaggio, niente doppioni
        const key = typeof clientId === "string" && clientId.length <= 64 ? `${m.uid}|${clientId}` : null;
        if (key && this.sent.has(key)) {
            const prev = this.msgs.get(this.sent.get(key));
            if (prev) return { ok: true, message: this.toPublic(prev) };
        }
        if (!limits.msg.ok(m.uid)) return { ok: false, error: "Stai scrivendo troppo in fretta, aspetta un attimo", retry: true };
        if (conv !== "room" && this.audience(conv).length < 2)
            return { ok: false, error: "Il giocatore non è più nella stanza" };

        const body = cleanText(text);
        if (body.length > CHAT_CONFIG.maxText) return { ok: false, error: "Messaggio troppo lungo" };
        const ids = Array.isArray(attachments) ? attachments.filter((x) => typeof x === "string") : [];
        if (ids.length > CHAT_CONFIG.maxFilesPerMessage) return { ok: false, error: "Troppi allegati" };
        let g = null;
        if (gif) {
            if (!CHAT_CONFIG.giphyKey || typeof gif.url !== "string" || !GIF_URL.test(gif.url) || gif.url.length > 500)
                return { ok: false, error: "GIF non valida" };
            g = { url: gif.url, w: Math.min(Math.max(+gif.w || 200, 20), 1000), h: Math.min(Math.max(+gif.h || 200, 20), 1000),
                title: cleanText(gif.title).slice(0, 80) };
        }
        if (!body && !ids.length && !g) return { ok: false, error: "Messaggio vuoto" };
        const target = typeof replyTo === "string" ? this.msgs.get(replyTo) : null;
        if (replyTo && (!target || target.conv !== conv)) return { ok: false, error: "Messaggio citato non trovato" };

        const id = rid();
        const files = ids.length ? this.files.claim(ids, { room: this.room.code, uid: m.uid, conv, msgId: id }) : [];
        if (!files) return { ok: false, error: "Allegato non valido o scaduto" };

        const msg = {
            id, seq: ++this.seq, conv, from: m.uid, name: m.name, ts: Date.now(), text: body,
            attachments: files, gif: g, replyTo: target ? target.id : null,
            reactions: new Map(), deleted: false, clientId: key ? clientId : null,
        };
        const list = this.convs.get(conv) || [];
        list.push(msg);
        this.convs.set(conv, list);
        this.msgs.set(id, msg);
        if (key) this.sent.set(key, id);
        while (list.length > CHAT_CONFIG.maxPerConv) this.forget(list.shift());

        const pub = this.toPublic(msg);
        this.emitTo(this.audience(conv), "chat:msg", pub);
        return { ok: true, message: pub };
    }

    forget(msg) {
        for (const a of msg.attachments) this.files.remove(a.id);
        this.msgs.delete(msg.id);
        if (msg.clientId) this.sent.delete(`${msg.from}|${msg.clientId}`);
    }

    remove(m, { id }) {
        const msg = this.msgs.get(id);
        if (!msg || msg.from !== m.uid || !this.canAccess(m.uid, msg.conv)) return { ok: false, error: "Non puoi cancellare questo messaggio" };
        if (!limits.del.ok(m.uid)) return { ok: false, error: "Troppe operazioni, aspetta un attimo" };
        for (const a of msg.attachments) this.files.remove(a.id);
        Object.assign(msg, { deleted: true, text: "", attachments: [], gif: null, reactions: new Map() });
        this.update(msg);
        return { ok: true };
    }

    react(m, { id, emoji }) {
        const msg = this.msgs.get(id);
        if (!msg || msg.deleted || !this.canAccess(m.uid, msg.conv)) return { ok: false, error: "Messaggio non disponibile" };
        if (!isEmoji(emoji)) return { ok: false, error: "Reazione non valida" };
        if (!limits.react.ok(m.uid)) return { ok: false, error: "Troppe reazioni, aspetta un attimo" };
        const set = msg.reactions.get(emoji) || new Set();
        if (set.has(m.uid)) set.delete(m.uid);
        else {
            if (!msg.reactions.has(emoji) && msg.reactions.size >= CHAT_CONFIG.maxReactionKinds)
                return { ok: false, error: "Troppe reazioni diverse" };
            set.add(m.uid);
        }
        if (set.size) msg.reactions.set(emoji, set); else msg.reactions.delete(emoji);
        this.update(msg);
        return { ok: true };
    }

    update(msg) {
        this.emitTo(this.audience(msg.conv), "chat:upd", this.toPublic(msg));
        // chi aveva citato questo messaggio deve vedere l'anteprima aggiornata (es. cancellato)
        for (const other of this.convs.get(msg.conv) || [])
            if (other.replyTo === msg.id) this.emitTo(this.audience(msg.conv), "chat:upd", this.toPublic(other));
    }

    typing(m, { conv, on }) {
        if (!this.canAccess(m.uid, conv) || !limits.typing.ok(m.uid)) return;
        this.emitTo(this.audience(conv).filter((u) => u !== m.uid), "chat:typing", { conv, uid: m.uid, name: m.name, on: !!on });
    }

    /** Il richiedente uid può vedere il file f? */
    canSeeFile(uid, f) {
        if (f.room !== this.room.code) return false;
        if (!f.msgId) return f.owner === uid && this.isActive(uid);   // caricato ma non ancora inviato
        const msg = this.msgs.get(f.msgId);
        return !!msg && !msg.deleted && this.canAccess(uid, f.conv);
    }

    destroy() {
        for (const m of this.byUid.values()) chatTokens.delete(m.token);
        this.files.removeRoom(this.room.code);
    }
}
