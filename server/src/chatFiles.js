// ============================================================================
// Allegati della chat: upload via HTTP, verifica del contenuto reale del file,
// salvataggio su disco per stanza e download solo per chi è autorizzato.
// Nessun servizio esterno: i file stanno in una cartella temporanea e spariscono
// quando la stanza viene chiusa (o al riavvio del server).
// ============================================================================
import { createWriteStream, createReadStream, mkdirSync, rmSync, unlinkSync } from "fs";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

export const FILE_CONFIG = {
    maxFileBytes: (Number(process.env.CHAT_MAX_FILE_MB) || 20) * 1024 * 1024,
    roomQuotaBytes: (Number(process.env.CHAT_ROOM_QUOTA_MB) || 200) * 1024 * 1024,
    // un file caricato ma mai inviato in un messaggio viene buttato dopo 30 minuti
    orphanTtlMs: 30 * 60 * 1000,
};

const ROOT = join(tmpdir(), "cartking-chat");
rmSync(ROOT, { recursive: true, force: true });   // al riavvio non resta nulla di vecchio
mkdirSync(ROOT, { recursive: true });

// tipi ammessi: estensioni accettate e tipo servito. Il tipo vero si ricava dai byte.
const TYPES = {
    png: { ext: ["png"], mime: "image/png", kind: "image" },
    jpeg: { ext: ["jpg", "jpeg"], mime: "image/jpeg", kind: "image" },
    gif: { ext: ["gif"], mime: "image/gif", kind: "image" },
    webp: { ext: ["webp"], mime: "image/webp", kind: "image" },
    pdf: { ext: ["pdf"], mime: "application/pdf", kind: "file" },
    docx: { ext: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "file" },
    xlsx: { ext: ["xlsx"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "file" },
    txt: { ext: ["txt"], mime: "text/plain; charset=utf-8", kind: "file" },
};

// riconosce il formato dalle "firme" nei primi byte (e, per docx/xlsx, dal contenuto dello zip)
function sniff(buf) {
    const at = (off, bytes) => bytes.every((b, i) => buf[off + i] === b);
    const ascii = (off, s) => buf.toString("latin1", off, off + s.length) === s;
    if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
    if (at(0, [0xff, 0xd8, 0xff])) return "jpeg";
    if (ascii(0, "GIF87a") || ascii(0, "GIF89a")) return "gif";
    if (ascii(0, "RIFF") && ascii(8, "WEBP")) return "webp";
    if (ascii(0, "%PDF-")) return "pdf";
    if (at(0, [0x50, 0x4b, 0x03, 0x04])) {
        // docx e xlsx sono zip: i nomi delle parti interne sono in chiaro negli header
        if (buf.includes("word/document.xml")) return "docx";
        if (buf.includes("xl/workbook.xml")) return "xlsx";
        return null;
    }
    // testo: UTF-8 valido e nessun byte nullo
    if (!buf.includes(0)) {
        try { new TextDecoder("utf-8", { fatal: true }).decode(buf); return "txt"; } catch { return null; }
    }
    return null;
}

const cleanName = (name) =>
    (String(name || "file").normalize("NFC").replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_").trim() || "file").slice(0, 120);

export class FileStore {
    constructor() {
        /** @type {Map<string, any>} */
        this.files = new Map();
        setInterval(() => this.sweepOrphans(), 5 * 60 * 1000).unref();
    }

    roomUsage(code) {
        let n = 0;
        for (const f of this.files.values()) if (f.room === code) n += f.size;
        return n;
    }

    /** Riceve il corpo della richiesta e lo salva. auth = { room, uid }. */
    upload(req, res, auth, rawName, send) {
        const name = cleanName(rawName);
        const ext = (name.split(".").pop() || "").toLowerCase();
        const declared = Number(req.headers["content-length"]);
        if (!Object.values(TYPES).some((t) => t.ext.includes(ext)))
            return send(415, { error: "Tipo di file non ammesso" });
        if (!declared || declared > FILE_CONFIG.maxFileBytes)
            return send(413, { error: `File troppo grande (max ${FILE_CONFIG.maxFileBytes / 1048576} MB)` });
        if (this.roomUsage(auth.room) + declared > FILE_CONFIG.roomQuotaBytes)
            return send(507, { error: "Spazio della stanza esaurito" });

        const id = randomBytes(12).toString("hex");
        const dir = join(ROOT, auth.room);
        mkdirSync(dir, { recursive: true });
        const path = join(dir, id);
        const out = createWriteStream(path);
        let size = 0, failed = false;
        const fail = (code, msg) => {
            if (failed) return;
            failed = true;
            out.destroy();
            try { unlinkSync(path); } catch { /* già rimosso */ }
            send(code, { error: msg });
        };

        req.on("data", (chunk) => {
            size += chunk.length;
            if (size > FILE_CONFIG.maxFileBytes || size > declared) { fail(413, "File troppo grande"); req.destroy(); }
        });
        // upload annullato dal client o connessione caduta: niente file a metà
        req.on("close", () => { if (!req.complete) fail(400, "Upload interrotto"); });
        req.on("error", () => fail(400, "Upload interrotto"));
        req.pipe(out);
        out.on("error", () => fail(500, "Errore di scrittura"));
        out.on("finish", async () => {
            if (failed) return;
            if (size !== declared) return fail(400, "Upload incompleto");
            const buf = await readFile(path);
            const type = sniff(buf);
            if (!type || !TYPES[type].ext.includes(ext))
                return fail(415, "Il contenuto del file non corrisponde a un formato ammesso");
            const t = TYPES[type];
            const meta = { id, room: auth.room, owner: auth.uid, name, mime: t.mime, kind: t.kind,
                size, path, conv: null, msgId: null, ts: Date.now() };
            this.files.set(id, meta);
            send(200, this.publicMeta(meta));
        });
    }

    publicMeta(f) {
        return { id: f.id, name: f.name, mime: f.mime.split(";")[0], kind: f.kind, size: f.size };
    }

    /** Serve un file; canSee(file) decide se il richiedente può vederlo. */
    serve(req, res, id, download, canSee) {
        const f = this.files.get(id);
        if (!f || !canSee(f)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
        const inline = f.kind === "image" && !download;
        res.writeHead(200, {
            "Content-Type": f.mime,
            "Content-Length": f.size,
            "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=3600",
        });
        createReadStream(f.path).pipe(res);
    }

    /** Lega gli allegati a un messaggio: solo file propri, della stanza, non ancora usati. */
    claim(ids, { room, uid, conv, msgId }) {
        const list = [];
        for (const id of ids) {
            const f = this.files.get(id);
            if (!f || f.room !== room || f.owner !== uid || f.msgId) return null;
            list.push(f);
        }
        for (const f of list) { f.conv = conv; f.msgId = msgId; }
        return list.map((f) => this.publicMeta(f));
    }

    remove(id) {
        const f = this.files.get(id);
        if (!f) return;
        this.files.delete(id);
        try { unlinkSync(f.path); } catch { /* già rimosso */ }
    }

    removeRoom(code) {
        for (const [id, f] of this.files) if (f.room === code) this.files.delete(id);
        rmSync(join(ROOT, code), { recursive: true, force: true });
    }

    sweepOrphans() {
        const now = Date.now();
        for (const f of [...this.files.values()])
            if (!f.msgId && now - f.ts > FILE_CONFIG.orphanTtlMs) this.remove(f.id);
    }
}
