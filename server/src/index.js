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

const httpServer = createServer(async (req, res) => {
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
});

/** @type {Map<string, GameRoom>} */
const rooms = new Map();

const genCode = () =>
  Array.from({ length: 4 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");

io.on("connection", (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on("createRoom", ({ name, difficulty, pid }, cb) => {
    let code;
    do { code = genCode(); } while (rooms.has(code));
    const room = new GameRoom(code, io);
    room.setConfig({ difficulty });
    rooms.set(code, room);
    playerId = pid;
    const p = room.addHuman(pid, name, socket.id);
    socket.join(code);
    currentRoom = room;
    cb?.({ ok: true, code });
    room.emit();
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
  socket.on("dominoPass", () => currentRoom?.dominoPass(playerId));
  socket.on("nextMode", () => currentRoom?.nextMode(playerId));

  socket.on("leaveRoom", () => {
    if (currentRoom) {
      currentRoom.playerLeaves(playerId);
      cleanup(currentRoom);
      currentRoom = null;
    }
  });

  socket.on("disconnect", () => {
    if (currentRoom) {
      const room = currentRoom;
      const p = room.markDisconnected(socket.id);
      if (p && !p.bot) {
        room.message = `${p.name} si è disconnesso…`;
        room.emit();
        // periodo di grazia per riconnessione: se non torna, diventa bot (o chiude se master)
        const leavingId = p.id;
        setTimeout(() => {
          const still = room.players.find((x) => x.id === leavingId);
          if (still && !still.bot && !still.connected) {
            room.convertToBotIfStillOffline(leavingId);
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
      if (stillEmpty) { clearTimeout(room.botTimer); room.stopWatchdog?.(); rooms.delete(room.code); }
    }, 60000); // 60s di grazia per riconnessione
  }
}

httpServer.listen(PORT, () => console.log(`🃏 Cart King server su http://localhost:${PORT}`));
