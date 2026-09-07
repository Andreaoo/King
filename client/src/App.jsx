import React, { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";

// In produzione il client è servito dallo stesso server Node → stesso origin.
// In sviluppo punta al server locale su :3001 (override con VITE_SERVER_URL).
const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? "http://localhost:3001" : window.location.origin);

const SUITS = ["hearts", "diamonds", "clubs", "spades"];
const SUIT_SYMBOL = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
const SUIT_NAME = { hearts: "Cuori", diamonds: "Quadri", clubs: "Fiori", spades: "Picche" };
const SUIT_RED = { hearts: true, diamonds: true, clubs: false, spades: false };
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const RANK_LABEL = { "10": "10", J: "J", Q: "Q", K: "K", A: "A" };
// ordine specifico del Domino: l'Asso è la carta più bassa (sotto il 2)
const DOMINO_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const dominoValue = (r) => DOMINO_RANKS.indexOf(r);
const rv = (r) => RANKS.indexOf(r);
const LAYOUT = ["bottom", "left", "top", "right"];
// ordine di visualizzazione della mano: i semi si alternano per colore (nero/rosso)
const FAN_SUIT_ORDER = ["spades", "diamonds", "clubs", "hearts"];
const sortForFan = (cards) =>
  [...cards].sort(
    (a, b) =>
      FAN_SUIT_ORDER.indexOf(a.suit) - FAN_SUIT_ORDER.indexOf(b.suit) ||
      rv(b.rank) - rv(a.rank)
  );

// id persistente del giocatore (per riconnessione)
function usePlayerId() {
  return useMemo(() => {
    let id = localStorage.getItem("ck_pid");
    if (!id) { id = "p_" + Math.random().toString(36).slice(2, 10); localStorage.setItem("ck_pid", id); }
    return id;
  }, []);
}

// legge un eventuale codice stanza dall'URL: /room/K7P2  oppure  ?room=K7P2
function readRoomFromUrl() {
  const m = window.location.pathname.match(/\/room\/([A-Za-z0-9]{4})/);
  if (m) return m[1].toUpperCase();
  const q = new URLSearchParams(window.location.search).get("room");
  return q ? q.toUpperCase() : "";
}

export default function App() {
  const pid = usePlayerId();
  const socketRef = useRef(null);
  const [connStatus, setConnStatus] = useState("connecting"); // connecting | online | lost
  const [view, setView] = useState("home"); // home | join | lobby | game
  const [state, setState] = useState(null);
  const [name, setName] = useState(localStorage.getItem("ck_name") || "");
  const [joinCode, setJoinCode] = useState(readRoomFromUrl());
  const [difficulty, setDifficulty] = useState("neutral");
  const [gameType, setGameType] = useState("teams"); // "teams" | "classic"
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null); // avviso centrale (giocatore uscito)
  const lastActionKey = useRef(null);
  const lastNotice = useRef(null);
  const urlRoom = useMemo(readRoomFromUrl, []);

  useEffect(() => {
    const socket = io(SERVER_URL, {
      transports: ["websocket", "polling"], // websocket preferito, polling se il websocket è bloccato
      reconnection: true,
      reconnectionDelay: 800,        // primo tentativo dopo 0.8s
      reconnectionDelayMax: 5000,    // fino a 5s tra i tentativi
      reconnectionAttempts: Infinity, // continua a riprovare (utile su mobile che va e viene)
      timeout: 20000,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      setConnStatus("online");
      // riconnessione automatica: se ero in una stanza, rientro con lo stesso pid
      const lastRoom = sessionStorage.getItem("ck_room");
      if (lastRoom) {
        socket.emit("joinRoom", { code: lastRoom, name: name || localStorage.getItem("ck_name") || "Giocatore", pid }, () => {});
      }
    });
    socket.on("disconnect", () => setConnStatus("lost"));
    socket.io.on("reconnect_attempt", () => setConnStatus("connecting"));
    socket.on("state", (s) => {
      setState(s);
      sessionStorage.setItem("ck_room", s.code);
      // mostra l'avviso centrale solo quando è nuovo (evita ripetizioni ad ogni update)
      if (s.notice && s.notice !== lastNotice.current) {
        lastNotice.current = s.notice;
        setNotice(s.notice);
      }
      if (s.status === "lobby") setView("lobby");
      else if (s.status !== "closed") setView("game");
    });
    return () => socket.disconnect();
  }, []); // eslint-disable-line

  // se apro un link /room/CODICE, vai direttamente alla schermata "entra"
  useEffect(() => {
    if (urlRoom) setView("join");
  }, [urlRoom]);

  const emit = (ev, payload, cb) => socketRef.current?.emit(ev, payload, cb);

  function createRoom() {
    localStorage.setItem("ck_name", name);
    emit("createRoom", { name: name || "Giocatore", difficulty, gameType, pid }, (res) => {
      if (!res?.ok) setError(res?.error || "Errore");
      else if (res.code) window.history.replaceState(null, "", `/room/${res.code}`);
    });
  }
  function joinRoom() {
    localStorage.setItem("ck_name", name);
    const code = joinCode.toUpperCase();
    emit("joinRoom", { code, name: name || "Giocatore", pid }, (res) => {
      if (!res?.ok) setError(res?.error || "Errore");
      else window.history.replaceState(null, "", `/room/${code}`);
    });
  }
  function leaveRoom() {
    emit("leaveRoom");
    sessionStorage.removeItem("ck_room");
    window.history.replaceState(null, "", "/");
    setView("home"); setState(null); setError("");
  }

  // guardia anti-doppio invio: agisce solo quando cambia lo stato osservabile
  function guardedAct(s, fn) {
    const boardSig = Object.entries(s.dominoBoard || {}).map(([k, v]) => k + v.low + v.high).join("");
    const key = `${s.modeIndex}|${s.trickNumber}|${s.table.length}|${s.myHand.length}|${boardSig}|${s.awaitingTrump}`;
    if (key === lastActionKey.current) return;
    lastActionKey.current = key;
    fn();
  }

  const connBanner = <ConnBanner status={connStatus} />;

  if (connStatus === "connecting" && !state)
    return <Shell notice={notice} onCloseNotice={() => setNotice(null)}>{connBanner}<Connecting /></Shell>;

  if (view === "home" || view === "join")
    return (
      <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
        {connBanner}
        <Home
          view={view} setView={setView} name={name} setName={setName}
          difficulty={difficulty} setDifficulty={setDifficulty}
          gameType={gameType} setGameType={setGameType}
          joinCode={joinCode} setJoinCode={setJoinCode}
          onCreate={createRoom} onJoin={joinRoom} error={error}
          urlRoom={urlRoom}
        />
      </Shell>
    );

  if (!state) return <Shell notice={notice} onCloseNotice={() => setNotice(null)}>{connBanner}<div className="ck-center-msg">Caricamento…</div></Shell>;

  if (state.status === "closed" && state.closedByMaster)
    return (
      <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
        {connBanner}
        <div className="closed-screen">
          <div className="closed-icon">🚪</div>
          <h1>Partita chiusa</h1>
          <p>Il proprietario della stanza ha lasciato la partita.</p>
          <button className="btn primary wide" onClick={leaveRoom}>Torna al menu</button>
        </div>
      </Shell>
    );

  if (state.status === "lobby")
    return (
      <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
        {connBanner}
        <Lobby
          state={state} pid={pid}
          onStart={() => emit("startGame")}
          onConfig={(cfg) => emit("setConfig", cfg)}
          onSetTeam={(seat, team) => emit("setTeam", { seat, team })}
          onLeave={leaveRoom}
        />
      </Shell>
    );

  if (state.status === "choosing")
    return (
      <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
        {connBanner}
        <ModeChoice
          s={state}
          onPropose={(modes) => emit("proposeModes", { modes })}
          onDecide={(key, trump) => emit("decideMode", { key, trump })}
        />
      </Shell>
    );

  if (state.status === "draw")
    return (
      <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
        {connBanner}
        <DrawScreen state={state} />
      </Shell>
    );

  return (
    <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
      {connBanner}
      <Game
        state={state} pid={pid} guardedAct={guardedAct}
        onPlay={(cardId) => emit("playCard", { cardId })}
        onTrump={(suit) => emit("chooseTrump", { suit })}
        onBlind={(blind) => emit("chooseBlind", { blind })}
        onPass={() => emit("dominoPass")}
        onNext={() => emit("nextMode")}
        onLeave={leaveRoom}
      />
    </Shell>
  );
}

/* ---------------- SORTEGGIO ---------------- */
function DrawScreen({ state }) {
  const winner = state.startSeat ?? 0;
  const [hi, setHi] = useState(0);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let n = 0;
    const iv = setInterval(() => {
      n++;
      setHi((h) => (h + 1) % 4);
      if (n > 14) { clearInterval(iv); setHi(winner); setDone(true); }
    }, 180);
    return () => clearInterval(iv);
  }, []); // eslint-disable-line
  return (
    <div className="draw-box">
      <h2 className="draw-title">Chi inizia?</h2>
      <p className="draw-sub">{done ? `Inizia ${state.players[winner]?.name}!` : "Sorteggio in corso…"}</p>
      <div className="draw-slots">
        {state.players.map((p, i) => (
          <div key={i} className={`draw-slot ${hi === i ? "hot" : ""} ${done && winner === i ? "won" : ""}`}>
            <span className="draw-ava">{p.bot ? "🤖" : "👤"}</span>
            <span className="draw-name">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- BANNER CONNESSIONE ---------------- */
function ConnBanner({ status }) {
  if (status === "online")
    return <div className="conn-banner online" role="status">🟢 Connesso</div>;
  if (status === "connecting")
    return <div className="conn-banner connecting" role="status">🟡 Connessione…</div>;
  return <div className="conn-banner lost" role="status">🔴 Connessione persa — riconnessione…</div>;
}

/* ---------------- HOME ---------------- */
const GAME_TYPES = [
  { k: "teams",   t: "👥 Gioco a Coppie",  d: "Due squadre da due. Punteggio della coppia, 4 negative e 3 positive per squadra." },
  { k: "classic", t: "👤 Partita classica", d: "Ognuno per sé, le 13 mani nell'ordine fisso." },
];

function Home({ view, setView, name, setName, difficulty, setDifficulty, gameType, setGameType, joinCode, setJoinCode, onCreate, onJoin, error, urlRoom }) {
  const cameFromLink = urlRoom && view === "join";
  return (
    <div className="home">
      <div className="home-logo">🃏</div>
      <h1 className="home-title">CART KING</h1>
      <p className="home-sub">Barbu · 13 mani · multiplayer online</p>

      {cameFromLink && (
        <div className="invite-note">Sei stato invitato nella stanza <b>{urlRoom}</b> — scrivi il tuo nome ed entra.</div>
      )}

      <label className="field">Nome
        <input value={name} maxLength={14} onChange={(e) => setName(e.target.value)} placeholder="Il tuo nome" />
      </label>

      {view === "home" ? (
        <>
          <div className="field">Tipo di partita
            <div className="opt-list">
              {GAME_TYPES.map((o) => (
                <button key={o.k} className={`opt ${gameType === o.k ? "sel" : ""}`}
                  onClick={() => setGameType(o.k)}>
                  <span className="dot" />
                  <span><span className="t">{o.t}</span><span className="d">{o.d}</span></span>
                </button>
              ))}
            </div>
          </div>
          <div className="field">Difficoltà bot (riempiono i posti vuoti)
            <div className="seg">
              {[["easy", "Facile"], ["neutral", "Neutro"], ["hard", "Difficile"]].map(([k, l]) => (
                <button key={k} className={difficulty === k ? "on" : ""} onClick={() => setDifficulty(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="home-actions">
            <button className="btn primary" onClick={onCreate}>CREA STANZA</button>
            <button className="btn ghost" onClick={() => setView("join")}>ENTRA IN UNA STANZA</button>
          </div>
        </>
      ) : (
        <>
          <label className="field">Codice stanza
            <input value={joinCode} maxLength={4} onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ABCD" style={{ letterSpacing: ".3em", textTransform: "uppercase" }} />
          </label>
          <div className="home-actions">
            <button className="btn primary" onClick={onJoin}>ENTRA</button>
            <button className="btn ghost" onClick={() => setView("home")}>← Indietro</button>
          </div>
        </>
      )}
      {error && <p className="err">{error}</p>}
      <InstallHint />
      <p className="home-note">Condividi il codice stanza con gli amici. I posti liberi vengono riempiti da bot quando il proprietario avvia.</p>
    </div>
  );
}

/* ---------------- INSTALLA SULLA HOME ---------------- */
// icona "Condividi" di iOS (quadrato con freccia), disegnata inline così è sempre nitida
function ShareIcon() {
  return (
    <svg className="ih-share" viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 15V3" /><path d="M8 7l4-4 4 4" />
      <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPadOS si spaccia per Mac
const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

// iOS non espone alcun prompt di installazione: va spiegato dove toccare.
// Android/Chrome invece emette "beforeinstallprompt" e possiamo mostrare un pulsante.
function InstallHint() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem("ck_installhint") === "off");
  const [deferred, setDeferred] = useState(null);

  useEffect(() => {
    const on = (e) => { e.preventDefault(); setDeferred(e); };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  if (dismissed || isStandalone()) return null;          // già installata: niente avviso
  if (!isIOS() && !deferred) return null;                // browser che non sa installare

  const close = () => { localStorage.setItem("ck_installhint", "off"); setDismissed(true); };

  return (
    <div className="install-hint">
      <button className="ih-close" onClick={close} aria-label="Chiudi">✕</button>
      <div className="ih-title">📲 Installa Cart King</div>
      {isIOS() ? (
        <p className="ih-text">
          Tocca <b>Condividi</b> <ShareIcon /> nella barra di Safari,
          poi <b>Aggiungi a Home</b>. Il gioco si apre a schermo intero, senza barre del browser.
        </p>
      ) : (
        <>
          <p className="ih-text">Aggiungi il gioco alla schermata principale come una vera app.</p>
          <button className="btn primary" onClick={async () => { deferred.prompt(); await deferred.userChoice; setDeferred(null); }}>
            INSTALLA
          </button>
        </>
      )}
    </div>
  );
}

/* ---------------- SCHERMATA DI CONNESSIONE ---------------- */
// Se il server non risponde entro qualche secondo compaiono le spiegazioni e,
// nell'APK, il campo per correggere l'indirizzo: senza questo l'app resterebbe
// bloccata qui per sempre, senza alcun modo di rimediare.
function Connecting() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="connecting">
      <div className="conn-spinner" aria-hidden />
      <p className="conn-main">Connessione al server…</p>
      <p className="conn-url">{SERVER_URL.replace(/^https?:\/\//, "")}</p>
      {slow && (
        <div className="conn-slow">
          <p>
            Ci sta mettendo più del solito. Se il server è ospitato su un piano
            gratuito potrebbe essersi addormentato: il primo avvio richiede
            <b> 30-50 secondi</b>.
          </p>
          <button className="btn ghost wide" onClick={() => window.location.reload()}>
            RIPROVA
          </button>
        </div>
      )}
    </div>
  );
}

/* ---------------- LOBBY ---------------- */
// Riquadro delle squadre: ogni posto si sposta con un tocco. La validazione
// 2 contro 2 blocca l'avvio finché la configurazione non è corretta.
function TeamsBox({ state, pid, onSetTeam }) {
  // Le squadre sono assegnate ai POSTI, non ai giocatori: i posti ancora vuoti
  // verranno riempiti dai bot ma la loro squadra è già decisa e visibile.
  const seats = [0, 1, 2, 3];
  const dellaSquadra = (t) => seats.filter((i) => state.teams[i] === t);
  const nb = dellaSquadra(0).length, nr = dellaSquadra(1).length;
  const ok = state.teamsValid;

  const col = (t, cls, titolo) => (
    <div className={`team ${cls}`}>
      <div className="team-head">
        <span className="team-name">{titolo}</span>
        <span className="team-count">{dellaSquadra(t).length}/2</span>
      </div>
      {dellaSquadra(t).map((i) => {
        const p = state.players[i];
        return (
          <button key={i} className={`pill-player ${state.youSeat === i ? "me" : ""} ${p ? "" : "vuoto"}`}
            onClick={() => onSetTeam(i, t === 0 ? 1 : 0)}>
            <span>{p ? (p.bot ? "🤖" : "👤") : "➕"}</span>
            <span>{p ? p.name : `posto ${i + 1}`}</span>
            <span className="tag">{state.youSeat === i ? "TU" : p ? "" : "→ bot"}</span>
          </button>
        );
      })}
      {dellaSquadra(t).length === 0 && <div className="slot-empty">nessun posto</div>}
    </div>
  );

  return (
    <>
      <div className="teams">{col(0, "blu", "🔵 SQUADRA BLU")}{col(1, "rossa", "🔴 SQUADRA ROSSA")}</div>
      <div className={`valid-note ${ok ? "ok" : "bad"}`}>
        {ok ? "✓ Squadre valide — 2 contro 2" : `✗ Servono 2 contro 2 (ora ${nb} blu / ${nr} rossi)`}
      </div>
      <p className="lobby-hint">Tocca un posto per spostarlo nell\'altra squadra.
        I posti liberi diventano bot all\'avvio.</p>
    </>
  );
}

function Lobby({ state, pid, onStart, onConfig, onSetTeam, onLeave }) {
  const isOwner = state.ownerId === pid;
  const humans = state.players.filter((p) => !p.bot).length;
  const [copied, setCopied] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // 13 booleani: quali mani giocare (default tutte). Il proprietario le modifica.
  const [enabled, setEnabled] = useState(() => (state.modeOrder || Array(13).fill(0)).map(() => true));

  const modeLabels = useMemo(() => {
    let cc = 0;
    return (state.modeOrder || []).map((k) => {
      if (k === "chosenTrump") { cc++; return `Seme scelto ${cc}`; }
      return MODE_TITLES[k] || k;
    });
  }, [state.modeOrder]);
  const selectedCount = enabled.filter(Boolean).length;

  const toggleMode = (i) => {
    setEnabled((prev) => {
      if (prev[i] && selectedCount === 1) return prev; // almeno una
      const next = [...prev]; next[i] = !next[i];
      onConfig({ enabledModes: next });
      return next;
    });
  };
  const setAll = (val) => {
    const next = (state.modeOrder || []).map(() => val);
    if (!val) next[0] = true;
    setEnabled(next); onConfig({ enabledModes: next });
  };

  const roomUrl = `${window.location.origin}/room/${state.code}`;
  const shareText = `🃏 Vieni a giocare a Cart King!\n\nLink: ${roomUrl}\nCodice stanza: ${state.code}`;

  async function share() {
    if (navigator.share) {
      try { await navigator.share({ title: "Cart King", text: shareText, url: roomUrl }); return; }
      catch { /* annullato */ }
    }
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = shareText; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="lobby">
      <button className="link-back" onClick={onLeave}>← Esci</button>
      <div className="room-code"><span>STANZA</span><b>{state.code}</b></div>

      <button className="btn share" onClick={share}>
        {copied ? "✓ Copiato negli appunti" : "📤 Condividi stanza"}
      </button>

      {isOwner && (
        <button className="btn ghost wide" onClick={() => setShowSettings(true)}>
          ⚙️ Mani da giocare ({selectedCount}/{modeLabels.length})
        </button>
      )}

      {state.gameType === "teams" ? (
        <TeamsBox state={state} pid={pid} onSetTeam={onSetTeam} />
      ) : (
        <div className="seats">
          {state.players.map((p, i) => (
            <div className="seat-row" key={i}>
              <span>{p.bot ? "🤖" : "👤"} {p.name}{!p.connected && " (offline)"}</span>
              <em>{p.bot ? p.diffLabel : i === 0 ? "proprietario" : "in attesa"}</em>
            </div>
          ))}
          {Array.from({ length: 4 - state.players.length }).map((_, i) => (
            <div className="seat-row empty" key={"e" + i}><span>posto libero</span><em>→ bot</em></div>
          ))}
        </div>
      )}
      <p className="lobby-hint">{humans}/4 umani · i posti restanti diventano bot</p>
      {isOwner ? (
        <button className="btn primary wide" onClick={onStart}
          disabled={state.gameType === "teams" && !state.teamsValid}>AVVIA PARTITA</button>
      ) : (
        <div className="waiting">In attesa che il proprietario avvii la partita…</div>
      )}

      {showSettings && (
        <div className="settings-overlay" onClick={() => setShowSettings(false)}>
          <div className="settings-box" onClick={(e) => e.stopPropagation()}>
            <div className="settings-head">
              <h3>Mani da giocare</h3>
              <button className="settings-close" onClick={() => setShowSettings(false)}>✕</button>
            </div>
            <div className="settings-actions">
              <button onClick={() => setAll(true)}>Tutte</button>
              <button onClick={() => setAll(false)}>Nessuna</button>
            </div>
            <div className="mode-list-sel">
              {modeLabels.map((label, i) => (
                <label key={i} className={`mode-item ${enabled[i] ? "on" : ""}`}>
                  <input type="checkbox" checked={!!enabled[i]} onChange={() => toggleMode(i)} />
                  <span className="mode-num">{i + 1}</span>
                  <span className="mode-name">{label}</span>
                  {enabled[i] && <span className="mode-check">✓</span>}
                </label>
              ))}
            </div>
            <div className="settings-foot">
              <span>{selectedCount} mani selezionate</span>
              <button className="btn primary" onClick={() => setShowSettings(false)}>Fatto</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const MODE_DESC = {
  noKingsJacks: "ogni Re o Fante preso vale −2", noQueens: "ogni Donna presa vale −3",
  no8Diamonds: "chi prende l'8♦ fa −8", noKingHearts: "chi prende il K♥ fa −8",
  noHearts: "ogni cuori preso vale −1", lastTwoTricks: "le ultime due prese valgono −4",
  noTricks: "ogni presa vale −1", domino: "scarta tutte le carte partendo dai 7",
  chosenTrump: "ogni presa vale +1, con briscola a scelta", hiddenTrump: "ogni presa vale +2, senza briscola",
};
const POSITIVE_MODES = ["chosenTrump", "hiddenTrump"];
const ALL_MODES = ["noKingsJacks","noQueens","no8Diamonds","noKingHearts","noHearts",
  "lastTwoTricks","noTricks","domino","chosenTrump","hiddenTrump"];

/* ---------------- CONTRATTAZIONE FRA COMPAGNI ----------------
   Chi propone manda due modalità al COMPAGNO di squadra, che ne accetta una
   oppure ne sceglie una terza. Il seme di «Seme scelto» si dichiara subito,
   insieme alla proposta.                                                     */
function ModeChoice({ s, onPropose, onDecide }) {
  const [sel, setSel] = useState([]);        // [{key, trump}]
  const [altKey, setAltKey] = useState(null); // terza scelta in attesa del seme
  const io = s.youSeat;
  const disp = s.availableToMe || [];

  const piano = (
    <div className="plan">
      {[0, 1].map((t) => (
        <div className={`q ${t === 0 ? "blu" : "rossa"}`} key={t}>
          <div className="qt">{t === 0 ? "🔵 BLU" : "🔴 ROSSA"}</div>
          <div className="qq"><span>negative</span><b>{s.negativeLeft[t]}<i>/4</i></b></div>
          <div className="qq"><span>positive</span><b>{s.positiveLeft[t]}<i>/3</i></b></div>
        </div>
      ))}
    </div>
  );

  const cella = (k, onClick, extra = "") => {
    const pos = POSITIVE_MODES.includes(k);
    const gia = !pos && (s.usedNegatives || []).includes(k);
    const off = !disp.includes(k);
    return (
      <button key={k} className={`mode-btn ${off ? "used" : ""} ${extra}`} disabled={off} onClick={onClick}>
        {MODE_TITLES[k]}
        {pos && <span className="flag pos">POSITIVA</span>}
        {gia && <span className="flag gia">GIÀ GIOCATA</span>}
        <small>{MODE_DESC[k]}</small>
      </button>
    );
  };

  // ---- fase PROPOSTA ----
  if (s.phase === "propose") {
    if (s.proposer !== io)
      return (
        <div className="mode-pane">
          <h2 className="mc-title">Proposta</h2>
          <p className="mc-sub"><b>{s.players[s.proposer].name}</b> sceglie due modalità
            da mandare al compagno <b>{s.players[s.decider].name}</b>…</p>
          {piano}<div className="waiting">In attesa…</div>
        </div>
      );
    const seme = sel.find((x) => x.key === "chosenTrump");
    const pronto = sel.length === Math.min(2, disp.length) && (!seme || seme.trump);
    const toggle = (k) => setSel((prev) => {
      const i = prev.findIndex((x) => x.key === k);
      if (i >= 0) return prev.filter((x) => x.key !== k);
      if (prev.length >= 2) return prev;
      return [...prev, { key: k, trump: null }];
    });
    return (
      <div className="mode-pane">
        <h2 className="mc-title">Proponi due modalità</h2>
        <p className="mc-sub">Scegline due e mandale al tuo compagno <b>{s.players[s.decider].name}</b>:
          ne prenderà una, oppure ne sceglierà una terza.</p>
        {piano}
        <div className="side-title">Selezionate: {sel.length}/2</div>
        <div className="mode-grid">
          {ALL_MODES.map((k) => cella(k, () => toggle(k), sel.some((x) => x.key === k) ? "sel" : ""))}
        </div>
        {seme && (
          <>
            <div className="side-title" style={{ marginTop: 14 }}>Seme per «Seme scelto» — va dichiarato ora</div>
            <div className="mode-grid">
              {SUITS.map((su) => (
                <button key={su} className={`mode-btn suit ${seme.trump === su ? "sel" : ""} ${SUIT_RED[su] ? "red" : ""}`}
                  onClick={() => setSel((prev) => prev.map((x) => x.key === "chosenTrump" ? { ...x, trump: su } : x))}>
                  {SUIT_SYMBOL[su]} {SUIT_NAME[su]}
                </button>
              ))}
            </div>
          </>
        )}
        <button className="btn primary wide" disabled={!pronto} onClick={() => onPropose(sel)}>
          MANDA AL COMPAGNO →
        </button>
      </div>
    );
  }

  // ---- fase DECISIONE ----
  const prop = s.proposals || [];
  const propBox = (
    <>
      <div className="side-title">Proposte dal compagno {s.players[s.proposer].name}</div>
      <div className="proposals">
        {prop.map((x, i) => (
          <button key={i} className="prop" onClick={() => onDecide(x.key, x.trump)}>
            <span className="n">{i + 1}</span>
            {MODE_TITLES[x.key]}
            {x.trump && <b className={SUIT_RED[x.trump] ? "red" : ""}> {SUIT_SYMBOL[x.trump]}</b>}
            {POSITIVE_MODES.includes(x.key) && <span className="flag pos" style={{ marginLeft: "auto" }}>POSITIVA</span>}
          </button>
        ))}
      </div>
    </>
  );
  if (s.decider !== io)
    return (
      <div className="mode-pane">
        <h2 className="mc-title">Decisione</h2>
        <p className="mc-sub"><b>{s.players[s.decider].name}</b> sta decidendo…</p>
        {piano}{propBox}<div className="waiting">In attesa…</div>
      </div>
    );
  const alt = disp.filter((k) => !prop.some((x) => x.key === k));
  return (
    <div className="mode-pane">
      <h2 className="mc-title">Tocca a te</h2>
      <p className="mc-sub">Il tuo compagno propone queste due. Accettane una, oppure scegline una terza.</p>
      {piano}{propBox}
      <div className="side-title">…oppure scegline una terza</div>
      <div className="mode-grid">
        {alt.map((k) => cella(k, () => (k === "chosenTrump" ? setAltKey(k) : onDecide(k, null)),
          altKey === k ? "sel" : ""))}
      </div>
      {altKey === "chosenTrump" && (
        <>
          <div className="side-title" style={{ marginTop: 14 }}>Dichiara il seme</div>
          <div className="mode-grid">
            {SUITS.map((su) => (
              <button key={su} className={`mode-btn suit ${SUIT_RED[su] ? "red" : ""}`}
                onClick={() => onDecide("chosenTrump", su)}>
                {SUIT_SYMBOL[su]} {SUIT_NAME[su]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const MODE_TITLES = {
  noKingsJacks: "No Re e Fanti", noQueens: "No Donne", no8Diamonds: "No 8 di Quadri",
  noKingHearts: "No K di Cuori", noHearts: "No Cuori", lastTwoTricks: "Ultime Due Prese",
  noTricks: "No Prese", domino: "Domino", chosenTrump: "Seme scelto", hiddenTrump: "Senza Briscola",
};

/* ---------------- GAME ---------------- */
function Game({ state: s, pid, guardedAct, onPlay, onTrump, onBlind, onPass, onNext, onLeave }) {
  const [showSidebar, setShowSidebar] = useState(false);
  const seat = s.youSeat;
  const myTurn = s.turn === seat;
  const isOwner = s.ownerId === pid;

  const seatOf = (i) => LAYOUT[(i - seat + 4) % 4]; // ruota così che "tu" sia sempre in basso

  const myValid = useMemo(() => {
    if (!s.myHand) return [];
    if (s.modeKey === "domino") {
      return s.myHand.filter((c) => {
        const b = s.dominoBoard[c.suit];
        if (!b) return c.rank === "7";
        const v = dominoValue(c.rank);
        return v === b.high + 1 || v === b.low - 1;
      }).map((c) => c.id);
    }
    if (!s.isTrickMode) return [];
    if (s.table.length === 0) {
      // apertura: applica la regola dello "spezzare"
      const prot = s.protectedSuit;
      const broken = new Set(s.brokenSuits || []);
      if (prot && !broken.has(prot)) {
        const np = s.myHand.filter((c) => c.suit !== prot);
        return (np.length ? np : s.myHand).map((c) => c.id);
      }
      return s.myHand.map((c) => c.id);
    }
    const lead = s.table[0].card.suit;
    const same = s.myHand.filter((c) => c.suit === lead);
    return (same.length ? same : s.myHand).map((c) => c.id);
  }, [s]);

  const highlight = useMemo(() => makeHighlighter(s.modeKey), [s.modeKey]);

  // Raccolta della presa in due tempi. Il server tiene le carte in tavola per
  // 900ms dopo aver annunciato il vincitore: 440ms per radunarle al centro,
  // poi 440ms di volo verso chi ha vinto. Totale 880ms, dentro il tempo.
  const [phase, setPhase] = useState(null); // null | "gather" | "fly"
  useEffect(() => {
    if (s.collecting == null) { setPhase(null); return; }
    setPhase("gather");
    const t = setTimeout(() => setPhase("fly"), 440);
    return () => clearTimeout(t);
  }, [s.collecting, s.trickNumber]);
  // la mano si mostra coi semi alternati per colore: ♠ ♦ ♣ ♥
  const fanHand = useMemo(() => sortForFan(s.myHand || []), [s.myHand]);

  if (s.status === "modeEnd" || s.status === "gameOver") {
    return <EndScreen s={s} isOwner={isOwner} onNext={onNext} onLeave={onLeave} />;
  }

  return (
    <div className="game">
      <div className="ck-topbar">
        <div className="ck-brand">
          <button className="menu-toggle" onClick={() => setShowSidebar((v) => !v)} title="Modalità e punteggi">☰</button>
          🃏 CART KING <small>· {s.code}</small>
        </div>
        <div className="ck-status">
          <span><b>Mano</b> {s.modeIndex + 1}/{s.totalModes} — {s.modeShort}</span>
          <span><b>Presa</b> {Math.min(s.trickNumber + 1, 13)}/13</span>
          {s.trump && (
            <span className={SUIT_RED[s.trump] ? "trump red" : "trump"}><b>Briscola</b> {SUIT_SYMBOL[s.trump]} {SUIT_NAME[s.trump]}</span>
          )}
          {!s.trump && s.isTrickMode && s.modeKey === "hiddenTrump" && <span className="trump hidden"><b>Senza briscola</b></span>}
        </div>
        <button className="ck-exit" onClick={() => { if (confirm("Uscire dalla partita?")) onLeave(); }}>✕ Esci</button>
      </div>

      {showSidebar && (
        <div className="side-overlay" onClick={() => setShowSidebar(false)}>
          <aside className="ck-side open" onClick={(e) => e.stopPropagation()}>
            <button className="side-close" onClick={() => setShowSidebar(false)}>✕</button>
            <div className="side-title">MODALITÀ</div>
            <ol className="mode-list">
              {(s.playOrder || []).map((realIdx, pos) => {
                const k = s.modeOrder[realIdx];
                let label = MODE_TITLES[k] || k;
                if (k === "chosenTrump") {
                  const n = s.playOrder.slice(0, pos + 1).filter((ri) => s.modeOrder[ri] === "chosenTrump").length;
                  label = `Seme scelto ${n}`;
                }
                return (
                  <li key={pos} className={pos < s.modeIndex ? "done" : pos === s.modeIndex ? "cur" : ""}>
                    <span className="tick">{pos < s.modeIndex ? "✓" : pos === s.modeIndex ? "→" : "○"}</span>
                    {pos + 1}. {label}
                  </li>
                );
              })}
            </ol>
            <div className="side-scores">
              <div className="side-title">PUNTEGGI</div>
              {s.players.map((p, i) => (
                <div key={i} className="score-row">
                  <span>{p.bot ? "🤖" : "👤"} {p.name}</span>
                  <b className={s.totalScores[i] < 0 ? "neg" : "pos"}>{s.totalScores[i]}</b>
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}

      <div className="ck-progress">
        {(s.playOrder || []).map((_, i) => (
          <span key={i} className={`dot ${i < s.modeIndex ? "done" : i === s.modeIndex ? "cur" : ""}`}>
            {i < s.modeIndex ? "●" : i === s.modeIndex ? "◉" : "○"}
          </span>
        ))}
      </div>

      {s.gameType === "teams" && (
        <div className="teambar">
          <div className="tscore blu">🔵 BLU <span className="v">{s.teamScores[0] + s.teamHandScores[0]}</span></div>
          <div className="tscore rossa">🔴 ROSSA <span className="v">{s.teamScores[1] + s.teamHandScores[1]}</span></div>
        </div>
      )}

      <div className="ck-table">
        {s.players.map((p, i) => (
          <div key={i} className={`seat ${seatOf(i)} ${s.gameType === "teams" ? (s.teams[i] === 0 ? "tblu" : "trossa") : ""} ${s.turn === i ? "active" : ""} ${s.collecting === i ? "won" : ""}`}>
            <span className="seat-name">{p.bot ? "🤖" : "👤"} {p.name}{i === seat ? " (tu)" : ""}{!p.connected && " 🔌"}</span>
            <span className="seat-meta">
              {s.isTrickMode && <span>{s.tricksWon[i]} prese</span>}
              {/* il punteggio di mano compare solo quando c'è: evita uno "0" nudo accanto al totale */}
              {s.handScores[i] !== 0 && (
                <span className={s.handScores[i] < 0 ? "neg" : "pos"}>
                  {s.handScores[i] > 0 ? "+" : ""}{s.handScores[i]}
                </span>
              )}
              <span className="tot">tot {s.totalScores[i]}</span>
            </span>
            {i !== seat && (
              <span className="seat-cards">
                {Array.from({ length: Math.min(p.handCount, 5) }).map((_, k) => <span key={k} className="mini-back" />)}
                <span className="count">{p.handCount}</span>
              </span>
            )}
          </div>
        ))}

        <div className="ck-center">
          {s.modeKey === "domino" ? (
            <DominoBoard board={s.dominoBoard} />
          ) : (
            <div className={`played ${s.collecting != null ? `collecting phase-${phase || "gather"}` : ""}`}>
              {s.table.length === 0 && s.collecting == null && <div className="ck-msg">{s.message}</div>}
              {s.table.map((t, i) => (
                <div key={i}
                  className={`played-card seat-${seatOf(t.player)} ${s.collecting != null ? `fly-to-${seatOf(s.collecting)}` : ""} ${s.collecting === t.player ? "winner-card" : ""}`}>
                  <Card card={t.card} highlight={highlight(t.card)} />
                  <span className="pc-name">{s.players[t.player].name}</span>
                </div>
              ))}
              {s.collecting != null && (
                <div className="trick-winner">
                  <span className="tw-name">{s.players[s.collecting].name}</span>
                  {s.collectingPts ? <span className={`tw-pts ${s.collectingPts > 0 ? "pos" : "neg"}`}>{s.collectingPts > 0 ? "+" : ""}{s.collectingPts}</span> : null}
                </div>
              )}
            </div>
          )}
          {myTurn && !s.awaitingTrump && <div className="your-turn">È IL TUO TURNO</div>}
        </div>
      </div>

      {s.awaitingTrump && myTurn && s.modeKey === "chosenTrump" && s.blindDecision == null && (
        <div className="trump-picker">
          <div className="tp-title">VUOI GIOCARE AL BUIO?</div>
          <div className="tp-sub">Scegli il seme senza vedere le carte e guadagni punti doppi (+2 a presa)</div>
          <div className="blind-choice">
            <button className="blind-yes" onClick={() => onBlind(true)}>SÌ, AL BUIO</button>
            <button className="blind-no" onClick={() => onBlind(false)}>NO, VEDO LE CARTE</button>
          </div>
        </div>
      )}

      {s.awaitingTrump && myTurn && (s.modeKey !== "chosenTrump" || s.blindDecision != null) && (
        <div className="trump-picker">
          <div className="tp-title">SCEGLI IL SEME DI BRISCOLA{s.blindBy === s.youSeat ? " (AL BUIO)" : ""}</div>
          <div className="tp-suits">
            {SUITS.map((su) => (
              <button key={su} className={`tp-suit ${SUIT_RED[su] ? "red" : "black"}`}
                onClick={() => guardedAct(s, () => onTrump(su))}>
                <span>{SUIT_SYMBOL[su]}</span>{SUIT_NAME[su]}
              </button>
            ))}
          </div>
        </div>
      )}
      {s.awaitingTrump && !myTurn && <div className="ck-center-msg small">In attesa della scelta della briscola…</div>}

      <div className="ck-hand">
        <div className="hand-label">LE TUE CARTE{s.modeKey === "domino" && <em> — gioca i 7 e le carte adiacenti</em>}</div>
        <FanHand
          cards={fanHand}
          renderCard={(c) => {
            if (s.myHandHidden) return <Card faceDown />;
            const playable = myTurn && !s.awaitingTrump && myValid.includes(c.id);
            return (
              <Card card={c} highlight={highlight(c)} dim={myTurn && !playable}
                onClick={playable ? () => guardedAct(s, () => onPlay(c.id)) : undefined} disabled={!playable} />
            );
          }}
        />
        {s.modeKey === "domino" && myTurn && myValid.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <button className="pass-btn" onClick={() => guardedAct(s, onPass)}>PASSA</button>
          </div>
        )}
      </div>
    </div>
  );
}

function makeHighlighter(modeKey) {
  const H = {
    noKingsJacks: (c) => c.rank === "K" || c.rank === "J",
    noQueens: (c) => c.rank === "Q",
    no8Diamonds: (c) => c.rank === "8" && c.suit === "diamonds",
    noKingHearts: (c) => c.rank === "K" && c.suit === "hearts",
    noHearts: (c) => c.suit === "hearts",
  };
  return H[modeKey] || (() => false);
}

/* ---------------- END SCREEN ---------------- */
function EndScreen({ s, isOwner, onNext, onLeave }) {
  const isOver = s.status === "gameOver";

  // ---- gioco a coppie: conta la squadra, i singoli sono di contorno ----
  if (s.gameType === "teams") {
    const bm = s.teamHandScores[0], rm = s.teamHandScores[1];
    const bt = s.teamScores[0], rt = s.teamScores[1];
    const membri = (t) => s.players.map((p, i) => ({ p, i })).filter((x) => s.teams[x.i] === t);
    const vinc = (a, b) => a === b ? "Pareggio" : (a > b ? "🔵 Vince la squadra BLU" : "🔴 Vince la squadra ROSSA");
    const card = (t, cls, lab, val, dettaglio) => (
      <div className={`rt ${cls}`}>
        <div className="lab">{lab}</div>
        <div className="big">{val > 0 ? "+" : ""}{val}</div>
        {dettaglio && <div className="who">{dettaglio}</div>}
      </div>
    );
    return (
      <div className="endscreen">
        {isOver ? <div className="trophy">🏆</div> : <div className="me-tag">{s.modeShort}</div>}
        <h2>{isOver ? "Partita finita" : "Fine mano"}</h2>
        <div className="crown">{vinc(isOver ? bt : bm, isOver ? rt : rm)}</div>
        <div className="result-teams">
          {card(0, "blu", "🔵 BLU", isOver ? bt : bm,
            !isOver && membri(0).map((x) => `${x.p.name} ${s.handScores[x.i] > 0 ? "+" : ""}${s.handScores[x.i]}`).join(" · "))}
          {card(1, "rossa", "🔴 ROSSA", isOver ? rt : rm,
            !isOver && membri(1).map((x) => `${x.p.name} ${s.handScores[x.i] > 0 ? "+" : ""}${s.handScores[x.i]}`).join(" · "))}
        </div>
        {!isOver && (
          <>
            <div className="side-title">Totale partita</div>
            <div className="result-teams">
              {card(0, "blu", "🔵 BLU", bt)}{card(1, "rossa", "🔴 ROSSA", rt)}
            </div>
            <div className="plan">
              {[0, 1].map((t) => (
                <div className={`q ${t === 0 ? "blu" : "rossa"}`} key={t}>
                  <div className="qt">{t === 0 ? "🔵 BLU" : "🔴 ROSSA"}</div>
                  <div className="qq"><span>negative</span><b>{s.negativeLeft[t]}<i>/4</i></b></div>
                  <div className="qq"><span>positive</span><b>{s.positiveLeft[t]}<i>/3</i></b></div>
                </div>
              ))}
            </div>
          </>
        )}
        {isOver ? (
          <button className="btn primary wide" onClick={onLeave}>TORNA AL MENU</button>
        ) : isOwner ? (
          <button className="btn primary wide" onClick={onNext}>MANO SUCCESSIVA →</button>
        ) : <div className="waiting">In attesa del proprietario…</div>}
        {!isOver && <button className="btn ghost wide" style={{ marginTop: 10 }} onClick={onLeave}>Esci</button>}
      </div>
    );
  }

  const ranked = s.players.map((p, i) => ({ ...p, score: s.totalScores[i] })).sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉", "  "];
  return (
    <div className="endscreen">
      {isOver ? (
        <>
          <div className="trophy">🏆</div>
          <h1>PARTITA TERMINATA</h1>
          <div className="winner">Vince {ranked[0].name}</div>
          <ol className="final-list">
            {ranked.map((p, i) => (
              <li key={i} className={i === 0 ? "first" : ""}>
                <span className="rank">{medals[i]}</span>
                <span className="pn">{p.bot ? "🤖" : "👤"} {p.name}</span>
                <b className={p.score < 0 ? "neg" : "pos"}>{p.score} punti</b>
              </li>
            ))}
          </ol>
          <button className="btn primary wide" onClick={onLeave}>TORNA AL MENU</button>
        </>
      ) : (
        <>
          <div className="me-tag">MANO {s.modeIndex + 1}/13 · {s.modeShort}</div>
          <h2>Risultato mano</h2>
          <table className="me-table">
            <thead><tr><th>Giocatore</th><th>Mano</th><th>Totale</th></tr></thead>
            <tbody>
              {s.players.map((p, i) => (
                <tr key={i}>
                  <td>{p.bot ? "🤖" : "👤"} {p.name}</td>
                  <td className={s.handScores[i] < 0 ? "neg" : s.handScores[i] > 0 ? "pos" : ""}>
                    {s.handScores[i] > 0 ? "+" : ""}{s.handScores[i]}
                  </td>
                  <td><b className={s.totalScores[i] < 0 ? "neg" : "pos"}>{s.totalScores[i]}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {isOwner ? (
            <button className="btn primary wide" onClick={onNext}>
              {s.modeIndex + 1 >= 13 ? "CLASSIFICA FINALE" : "MANO SUCCESSIVA →"}
            </button>
          ) : <div className="waiting">In attesa del proprietario…</div>}
          <button className="btn ghost wide" style={{ marginTop: 10 }} onClick={onLeave}>Esci</button>
        </>
      )}
    </div>
  );
}

/* ---------------- MANO A VENTAGLIO ---------------- */
// Le carte si sovrappongono e seguono un arco: gli estremi ruotano e scendono.
// Con più di 7 carte la mano si divide su due file, come nell'app mobile.
// misura larghezza disponibile e altezza della finestra: il ventaglio si
// dimensiona su entrambe, altrimenti su schermi bassi sborda sotto il bordo
function useBox() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  const [vh, setVh] = useState(() => (typeof window !== "undefined" ? window.innerHeight : 800));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener("resize", onResize);
    let ro;
    if (ref.current) {
      ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
      ro.observe(ref.current);
    }
    return () => { window.removeEventListener("resize", onResize); ro?.disconnect(); };
  }, []);
  return [ref, w, vh];
}

function FanHand({ cards, renderCard }) {
  const [ref, w, vh] = useBox();
  const n = cards.length;

  // oltre 7 carte la mano si divide su due file, come nell'app mobile
  const rows = n > 7
    ? [cards.slice(0, Math.ceil(n / 2)), cards.slice(Math.ceil(n / 2))]
    : [cards];
  const maxRow = Math.max(1, ...rows.map((r) => r.length));

  // geometria adattiva: le carte riempiono la larghezza restando sovrapposte,
  // ma senza mai superare l'altezza concessa alla mano (ROW_PAD = spazio per l'arco)
  const ROW_PAD = 20;
  const avail = Math.max(w || (typeof window !== "undefined" ? window.innerWidth : 360), 260) - 10;
  const budget = Math.min(vh * 0.36, 330);                    // altezza massima del ventaglio
  const maxCH = Math.max(58, budget / rows.length - ROW_PAD); // altezza carta consentita
  const CW = Math.round(Math.min(96, maxCH / 1.44, Math.max(52, avail / 4.6)));
  const CH = Math.round(CW * 1.44);
  const step = Math.min(CW * 0.62, (avail - CW) / Math.max(maxRow - 1, 1)); // < CW ⇒ sovrapposizione
  const curve = CW * 0.022;
  const ang = 4; // gradi per carta

  return (
    <div className="fan-hand" ref={ref} style={{ "--fan-cw": `${CW}px`, "--fan-ch": `${CH}px` }}>
      {n > 0 && rows.map((row, ri) => {
        const center = (row.length - 1) / 2;
        return (
          <div className="fan-row" key={ri}>
            {row.map((c, i) => {
              const off = i - center;        // distanza dal centro della fila
              const x = off * step;
              const y = off * off * curve;   // gli estremi scendono ⇒ arco
              return (
                <div className="fan-slot" key={c.id ?? i}
                  style={{ transform: `translateX(${x}px) translateY(${y}px) rotate(${off * ang}deg)`, zIndex: i }}>
                  {renderCard(c, i)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- CARD / DOMINO ---------------- */
function Card({ card, onClick, disabled, small, highlight, dim, faceDown }) {
  if (faceDown) return <div className={`ck-card back ${small ? "small" : ""}`} aria-hidden />;
  const red = SUIT_RED[card.suit];
  return (
    <button className={`ck-card ${small ? "small" : ""} ${red ? "red" : "black"} ${disabled ? "disabled" : ""} ${highlight ? "danger" : ""} ${dim ? "dim" : ""}`}
      onClick={onClick} disabled={disabled || !onClick}
      aria-label={`${RANK_LABEL[card.rank] || card.rank} di ${SUIT_NAME[card.suit]}`}>
      <span className="corner tl">{RANK_LABEL[card.rank] || card.rank}<br />{SUIT_SYMBOL[card.suit]}</span>
      <span className="pip">{SUIT_SYMBOL[card.suit]}</span>
      <span className="corner br">{RANK_LABEL[card.rank] || card.rank}<br />{SUIT_SYMBOL[card.suit]}</span>
    </button>
  );
}

function DominoBoard({ board }) {
  const sevenIdx = DOMINO_RANKS.indexOf("7");
  return (
    <div className="domino-board">
      {SUITS.map((s) => {
        const b = board[s];
        const started = !!b;
        // carta più bassa e più alta giocate (oltre al 7 centrale)
        const lowLabel = started && b.low < sevenIdx ? (RANK_LABEL[DOMINO_RANKS[b.low]] || DOMINO_RANKS[b.low]) : null;
        const highLabel = started && b.high > sevenIdx ? (RANK_LABEL[DOMINO_RANKS[b.high]] || DOMINO_RANKS[b.high]) : null;
        return (
          <div key={s} className={`domino-row ${SUIT_RED[s] ? "red" : "black"} ${started ? "" : "waiting"}`}>
            <span className="ds">{SUIT_SYMBOL[s]}</span>
            <div className="domino-track">
              {/* lato basso (2…6) */}
              <div className="dom-side low">
                {lowLabel ? <span className="dom-slot filled">{lowLabel}</span>
                          : <span className="dom-slot empty">·</span>}
              </div>
              {/* centro: il 7 */}
              <div className="dom-center">
                {started ? <span className="dom-slot seven">7</span>
                         : <span className="dom-slot empty7">7</span>}
              </div>
              {/* lato alto (8…A) */}
              <div className="dom-side high">
                {highLabel ? <span className="dom-slot filled">{highLabel}</span>
                           : <span className="dom-slot empty">·</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- SHELL + STYLE ---------------- */
function Shell({ children, notice, onCloseNotice }) {
  return (
    <div className="ck-root">
      <Style />
      {children}
      {notice && (
        <div className="notice-overlay" onClick={onCloseNotice}>
          <div className="notice-box" onClick={(e) => e.stopPropagation()}>
            <div className="notice-icon">ℹ️</div>
            <p>{notice}</p>
            <button className="btn primary" onClick={onCloseNotice}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Style() {
  return (
    <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Outfit:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; }
    .ck-root {
      --felt: #0f5132; --felt2: #0a3d26; --gold: #d9b25f; --gold2: #b8923f;
      --ink: #17140f; --paper: #f6f1e6; --danger: #c0392b; --muted:#8a8577;
      /* aree sicure iPhone: notch/Dynamic Island in alto, barra home in basso */
      --sat: env(safe-area-inset-top, 0px);  --sab: env(safe-area-inset-bottom, 0px);
      --sal: env(safe-area-inset-left, 0px); --sar: env(safe-area-inset-right, 0px);
      min-height: 100vh; min-height: 100dvh; /* dvh: su iOS esclude le barre di Safari */
      margin:0; font-family:'Outfit',system-ui,sans-serif;
      background: radial-gradient(120% 120% at 50% 0%, #14663f 0%, var(--felt) 45%, var(--felt2) 100%);
      color: var(--paper);
      /* niente rimbalzo elastico, pull-to-refresh, lampo grigio al tap o zoom al doppio tap */
      overscroll-behavior: none;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      touch-action: manipulation;
    }
    /* le carte non si selezionano col dito tenuto premuto */
    .ck-card, .seat, .hand-label, .ck-status { -webkit-user-select:none; user-select:none; }
    .ck-root.center { display:flex; align-items:center; justify-content:center; padding:24px; }
    button { font-family:inherit; cursor:pointer; }
    .neg { color:#ff9d8a; } .pos { color:#9fe0a8; }

    /* HOME */
    .home { text-align:center; max-width:440px; }
    .home-logo { font-size:64px; }
    .home-title { font-family:'Cormorant Garamond',serif; font-size:64px; letter-spacing:.06em;
      margin:.1em 0; color:var(--gold); text-shadow:0 2px 20px rgba(0,0,0,.4); }
    .home-sub { color:#d7e7dc; margin-top:-.2em; letter-spacing:.02em; }
    .home-actions { display:flex; flex-direction:column; gap:12px; margin:28px 0; }
    .btn { border:none; border-radius:12px; padding:16px 22px; font-size:16px; font-weight:600;
      letter-spacing:.04em; transition:transform .1s, box-shadow .2s; }
    .btn:active { transform:translateY(1px); }
    .btn.primary { background:linear-gradient(180deg,var(--gold),var(--gold2)); color:#2a1f06;
      box-shadow:0 6px 18px rgba(0,0,0,.35); }
    .btn.ghost { background:rgba(255,255,255,.08); color:var(--paper); border:1px solid rgba(255,255,255,.2); }
    .btn.wide { width:100%; }
    .home-facts { display:flex; justify-content:center; gap:26px; margin:8px 0 18px; }
    .home-facts div { display:flex; flex-direction:column; }
    .home-facts b { font-size:26px; color:var(--gold); font-family:'Cormorant Garamond',serif; }
    .home-facts span { font-size:12px; color:#bcd; letter-spacing:.05em; }
    .home-note { font-size:12px; color:#a9c4b3; line-height:1.5; }

    /* schermata di connessione */
    .connecting { text-align:center; padding:40px 22px; max-width:420px; margin:0 auto; }
    .conn-spinner { width:38px; height:38px; margin:0 auto 18px; border-radius:50%;
      border:3px solid rgba(217,178,95,.25); border-top-color:var(--gold); animation:spin 1s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }
    .conn-main { font-size:16px; margin:0 0 4px; }
    .conn-url { font-size:12px; color:var(--muted); margin:0; word-break:break-all; }
    .conn-slow { margin-top:24px; padding-top:20px; border-top:1px solid rgba(255,255,255,.12); }
    .conn-slow p { font-size:13px; line-height:1.55; color:#cde; }
    .conn-slow b { color:var(--gold); }
    .conn-slow .btn { margin-top:8px; }

    /* avviso "aggiungi alla home" */
    .install-hint { position:relative; margin:18px 0; padding:14px 16px; text-align:left;
      background:rgba(217,178,95,.12); border:1px solid rgba(217,178,95,.4); border-radius:14px; }
    .ih-title { font-size:14px; font-weight:700; color:var(--gold); margin-bottom:6px; }
    .ih-text { font-size:13px; line-height:1.5; color:#e2ece5; margin:0; }
    .ih-share { display:inline-block; vertical-align:-3px; margin:0 2px; color:var(--gold); }
    .ih-close { position:absolute; top:8px; right:8px; width:26px; height:26px; border-radius:7px;
      background:rgba(255,255,255,.1); border:none; color:#cde; font-size:13px; cursor:pointer; }
    .install-hint .btn { margin-top:10px; width:100%; padding:11px; font-size:14px; }

    /* ---------- GIOCO A COPPIE ---------- */
    .opt-list { display:flex; flex-direction:column; gap:9px; margin-top:8px; }
    .opt { display:flex; align-items:flex-start; gap:11px; padding:13px 14px; border-radius:14px;
      background:rgba(255,255,255,.05); border:2px solid rgba(255,255,255,.12); cursor:pointer;
      text-align:left; width:100%; color:var(--paper); font-family:inherit; text-transform:none;
      letter-spacing:0; transition:background .15s, border-color .15s; }
    .opt.sel { background:rgba(217,178,95,.16); border-color:var(--gold); }
    .opt .dot { width:18px; height:18px; border-radius:50%; flex:none; margin-top:2px;
      border:2px solid rgba(255,255,255,.35); }
    .opt.sel .dot { border-color:var(--gold); background:radial-gradient(circle,var(--gold) 45%,transparent 46%); }
    .opt .t { display:block; font-weight:700; font-size:14px; }
    .opt .d { display:block; font-size:11.5px; color:var(--muted); line-height:1.45; margin-top:2px; }

    .teams { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:8px 0 0; }
    .team { border-radius:16px; padding:12px 10px; border:2px solid transparent; }
    .team.blu   { background:rgba(74,144,226,.14); border-color:rgba(74,144,226,.5); }
    .team.rossa { background:rgba(224,90,90,.14);  border-color:rgba(224,90,90,.5); }
    .team-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; }
    .team-name { font-weight:800; font-size:12px; letter-spacing:.06em; }
    .team.blu .team-name { color:#9cc4f5; } .team.rossa .team-name { color:#f2a3a3; }
    .team-count { font-size:11px; color:#cde; opacity:.8; }
    .pill-player { display:flex; align-items:center; gap:7px; width:100%; text-align:left;
      padding:9px 10px; margin-bottom:6px; border-radius:11px; font:600 13px 'Outfit',sans-serif;
      background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); color:var(--paper); }
    .pill-player.me { border-color:var(--gold); background:rgba(217,178,95,.16); }
    .pill-player .tag { margin-left:auto; font-size:10px; color:var(--muted); font-weight:700; }
    .pill-player.vuoto { opacity:.6; border-style:dashed; }
    .slot-empty { padding:9px 10px; margin-bottom:6px; border-radius:11px; font-size:12px;
      border:1px dashed rgba(255,255,255,.2); color:var(--muted); text-align:center; }
    .valid-note { margin-top:12px; padding:10px 12px; border-radius:11px; font-size:13px;
      font-weight:600; text-align:center; }
    .valid-note.ok  { background:rgba(124,252,154,.14); border:1px solid rgba(124,252,154,.45); color:#9fe0a8; }
    .valid-note.bad { background:rgba(224,90,90,.14);  border:1px solid rgba(224,90,90,.5);  color:#f2a3a3; }

    /* fascia del punteggio di squadra: è il risultato ufficiale */
    .teambar { flex:none; display:flex; gap:8px; justify-content:center; padding:6px 8px 0; }
    .tscore { flex:1; max-width:190px; display:flex; align-items:center; justify-content:center; gap:8px;
      padding:7px 12px; border-radius:12px; font-size:11.5px; font-weight:800; letter-spacing:.05em;
      background:rgba(0,0,0,.3); border:1px solid transparent; }
    .tscore.blu   { border-color:rgba(74,144,226,.6); color:#9cc4f5; }
    .tscore.rossa { border-color:rgba(224,90,90,.6);  color:#f2a3a3; }
    .tscore .v { color:var(--paper); font-size:18px; }
    .seat.tblu   { border-color:rgba(74,144,226,.55); }
    .seat.trossa { border-color:rgba(224,90,90,.55); }
    .seat.tblu   .seat-name { color:#9cc4f5; }
    .seat.trossa .seat-name { color:#f2a3a3; }

    /* contrattazione */
    .mode-pane { width:min(460px,94vw); margin:0 auto; padding:14px 4px calc(20px + var(--sab));
      overflow-y:auto; max-height:100dvh; }
    .mc-title { font-family:'Cormorant Garamond',serif; font-size:30px; color:var(--gold);
      text-align:center; margin:8px 0 2px; }
    .mc-sub { text-align:center; color:#cde; font-size:13px; margin:0 0 16px; line-height:1.5; }
    .plan { display:flex; gap:8px; margin-bottom:14px; }
    .plan .q { flex:1; padding:9px 10px; border-radius:12px; background:rgba(0,0,0,.28);
      border:1px solid transparent; }
    .plan .q.blu { border-color:rgba(74,144,226,.55); } .plan .q.rossa { border-color:rgba(224,90,90,.55); }
    .plan .qt { font-size:10.5px; font-weight:800; letter-spacing:.08em; margin-bottom:5px; }
    .plan .q.blu .qt { color:#9cc4f5; } .plan .q.rossa .qt { color:#f2a3a3; }
    .plan .qq { display:flex; align-items:baseline; justify-content:space-between; font-size:11px; color:#cde; }
    .plan .qq b { font-size:16px; color:var(--paper); font-weight:800; }
    .plan .qq i { font-style:normal; font-size:10px; color:var(--muted); font-weight:600; }
    .mode-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .mode-btn { padding:12px 10px; border-radius:12px; font:600 13px 'Outfit',sans-serif; cursor:pointer;
      background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.16); color:var(--paper);
      text-align:left; transition:background .15s, border-color .15s; }
    .mode-btn.sel { background:rgba(217,178,95,.2); border-color:var(--gold); color:var(--gold); }
    .mode-btn.used { opacity:.32; cursor:not-allowed; }
    .mode-btn.suit { text-align:center; font-size:16px; }
    .mode-btn.suit.red { color:#ff9d8a; }
    .mode-btn small { display:block; font-weight:400; font-size:10.5px; color:var(--muted); margin-top:3px; }
    .flag { display:inline-block; font-size:9.5px; font-weight:800; letter-spacing:.06em;
      padding:1px 6px; border-radius:6px; margin-left:6px; vertical-align:1px; }
    .flag.pos { background:rgba(124,252,154,.2); color:#9fe0a8; }
    .flag.gia { background:rgba(255,255,255,.12); color:var(--muted); }
    .proposals { display:flex; flex-direction:column; gap:9px; margin-bottom:14px; }
    .prop { display:flex; align-items:center; gap:10px; padding:13px 14px; border-radius:13px;
      background:rgba(217,178,95,.12); border:1px solid rgba(217,178,95,.45); cursor:pointer;
      font:700 15px 'Outfit',sans-serif; color:var(--paper); text-align:left; width:100%; }
    .prop .n { width:24px; height:24px; border-radius:50%; background:var(--gold); color:#2a1f06;
      display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; flex:none; }
    .prop .red { color:#ff9d8a; }
    .waiting { text-align:center; color:#cde; font-size:14px; padding:16px 0; }
    .result-teams { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:12px 0; }
    .rt { border-radius:14px; padding:14px 10px; text-align:center; }
    .rt.blu   { background:rgba(74,144,226,.16); border:1px solid rgba(74,144,226,.5); }
    .rt.rossa { background:rgba(224,90,90,.16);  border:1px solid rgba(224,90,90,.5); }
    .rt .lab { font-size:11px; letter-spacing:.1em; font-weight:800; }
    .rt.blu .lab { color:#9cc4f5; } .rt.rossa .lab { color:#f2a3a3; }
    .rt .big { font-size:32px; font-weight:800; margin:4px 0; }
    .rt .who { font-size:11px; color:#cde; line-height:1.5; }
    .crown { text-align:center; font-size:15px; font-weight:800; color:var(--gold); margin-bottom:6px; }
    .btn.primary:disabled { background:rgba(255,255,255,.1); color:var(--muted); cursor:not-allowed; box-shadow:none; }
    @media (max-width:780px) { .mc-title { font-size:24px; } }

    /* LOBBY */
    .lobby { background:rgba(0,0,0,.22); border:1px solid rgba(217,178,95,.3); border-radius:18px;
      padding:26px; width:min(420px,92vw); }
    .link-back { background:none; border:none; color:#cfe; margin-bottom:10px; }
    .room-code { text-align:center; margin-bottom:18px; }
    .room-code span { display:block; font-size:12px; letter-spacing:.3em; color:#bcd; }
    .room-code b { font-family:'Cormorant Garamond',serif; font-size:48px; letter-spacing:.2em; color:var(--gold); }
    .field { display:block; font-size:12px; letter-spacing:.08em; color:#cde; margin-bottom:16px; text-transform:uppercase; }
    .field input { display:block; width:100%; margin-top:6px; padding:12px; border-radius:10px;
      border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.06); color:var(--paper); font-size:16px; }
    .seg { display:flex; gap:8px; margin-top:8px; }
    .seg button { flex:1; padding:10px; border-radius:10px; border:1px solid rgba(255,255,255,.2);
      background:rgba(255,255,255,.05); color:var(--paper); font-size:13px; }
    .seg button.on { background:var(--gold); color:#2a1f06; border-color:var(--gold); font-weight:600; }
    .seats { margin:8px 0 20px; }
    .seat-row { display:flex; justify-content:space-between; padding:10px 12px; border-radius:8px;
      background:rgba(255,255,255,.04); margin-bottom:6px; }
    .seat-row em { color:var(--gold); font-style:normal; font-size:13px; }

    /* TOPBAR */
    .ck-topbar { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;
      padding:calc(10px + var(--sat)) calc(18px + var(--sar)) 10px calc(18px + var(--sal));
      background:rgba(0,0,0,.25); border-bottom:1px solid rgba(217,178,95,.25); }
    .ck-brand { font-family:'Cormorant Garamond',serif; font-size:22px; color:var(--gold); letter-spacing:.08em; }
    .ck-status { display:flex; gap:18px; font-size:15px; flex-wrap:wrap; }
    .ck-status b { color:var(--gold); font-weight:600; margin-right:4px; font-size:13px; letter-spacing:.06em; }
    .trump.red { color:#ff9d8a; } .trump.hidden { color:var(--muted); }
    .ck-exit { background:rgba(255,255,255,.08); border:1px solid rgba(255,255,255,.2); color:var(--paper);
      border-radius:8px; padding:7px 14px; font-size:13px; font-weight:500; }
    .ck-exit:hover { background:rgba(192,57,43,.35); border-color:var(--danger); }
    .ck-modal-overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:100;
      display:flex; align-items:center; justify-content:center; padding:20px; backdrop-filter:blur(2px); }
    .ck-modal { background:#123f2a; border:1px solid rgba(217,178,95,.4); border-radius:16px;
      padding:26px; width:min(400px,92vw); box-shadow:0 20px 60px rgba(0,0,0,.5); text-align:center; }
    .ck-modal-title { font-family:'Cormorant Garamond',serif; font-size:26px; color:var(--gold); margin-bottom:8px; }
    .ck-modal-text { font-size:14px; color:#d7e7dc; line-height:1.5; margin-bottom:20px; }
    .ck-modal-actions { display:flex; gap:10px; }
    .ck-modal-actions .btn { flex:1; padding:12px; }
    .ck-progress { display:flex; gap:4px; justify-content:center; padding:6px; font-size:12px; color:var(--gold); background:rgba(0,0,0,.15); }
    .dot.cur { color:#fff; } .dot { opacity:.5; } .dot.done { opacity:.9; }

    /* LAYOUT */
    .ck-layout { display:flex; gap:0; min-height:calc(100vh - 92px); position:relative; }
    /* la barra ora è un pannello a scomparsa che scivola da sinistra */
    .side-overlay { position:fixed; inset:0; z-index:150; background:rgba(0,0,0,.5); backdrop-filter:blur(2px); }
    .ck-side { width:270px; max-width:82vw; padding:44px 16px 16px; background:#0c3320;
      border-right:1px solid rgba(217,178,95,.3); font-size:14px; height:100%;
      position:fixed; left:0; top:0; bottom:0; z-index:151; overflow-y:auto;
      box-shadow:8px 0 30px rgba(0,0,0,.5); animation:slideIn .25s ease; }
    @keyframes slideIn { from{ transform:translateX(-100%);} to{ transform:translateX(0);} }
    .side-close { position:absolute; top:12px; right:12px; background:rgba(255,255,255,.1); border:none;
      color:#cde; font-size:16px; width:32px; height:32px; border-radius:8px; cursor:pointer; }
    .side-close:hover { background:rgba(255,255,255,.18); }
    .side-title { font-size:12px; letter-spacing:.2em; color:var(--gold); margin:10px 0 8px; }
    .mode-list { list-style:none; padding:0; margin:0; }
    .mode-list li { padding:6px 0; color:#bcd; display:flex; gap:6px; font-size:14px; }
    .mode-list li.cur { color:#fff; font-weight:600; }
    .mode-list li.done { color:#7fae8c; }
    .tick { width:14px; }
    .side-scores { margin-top:18px; }
    .score-row { display:flex; justify-content:space-between; padding:5px 0; border-bottom:1px solid rgba(255,255,255,.06); }

    /* pulsante menu a tendina */
    .menu-toggle { background:rgba(255,255,255,.1); border:1px solid rgba(217,178,95,.3); color:var(--gold);
      font-size:18px; width:36px; height:36px; border-radius:9px; cursor:pointer; margin-right:10px; vertical-align:middle; }
    .menu-toggle:hover { background:rgba(217,178,95,.2); }

    /* TABLE */
    /* la schermata di gioco riempie esattamente lo schermo: tavolo elastico,
       mano sempre visibile in fondo senza dover scorrere (indispensabile su telefono) */
    .game { display:flex; flex-direction:column; height:100vh; height:100dvh; overflow:hidden; }
    .game .ck-table { flex:1 1 auto; min-height:0; margin:8px 8px 0; }
    .game .ck-hand { flex:0 0 auto; }
    .game .ck-topbar, .game .ck-progress { flex:0 0 auto; }

    .ck-table-wrap { flex:1; display:flex; flex-direction:column; padding:12px; }
    .ck-table { position:relative; flex:1; border-radius:20px; min-height:320px;
      /* panno pulito, senza cornice: la scena resta sul feltro come in un tavolo vero */
      background:radial-gradient(80% 80% at 50% 45%, #16794a 0%, #0e5a34 68%, #0a3d26 100%);
      border:none; box-shadow:inset 0 0 90px rgba(0,0,0,.34); }
    /* ---- TARGHETTE DEI GIOCATORI ----
       Sono ancorate ai bordi e centrate con margin:auto, MAI con transform.
       Prima si centravano con translateX(-50%) e l'animazione della presa applicava
       transform:scale(): il transform veniva sostituito e la targhetta saltava di lato.
       Ora l'evidenziazione cambia soltanto colori e alone, quindi non si muove nulla. */
    .seat { position:absolute; display:flex; align-items:center; gap:8px;
      padding:6px 11px; border-radius:999px; width:max-content; max-width:92%;
      font-size:12.5px; line-height:1.2; white-space:nowrap; flex:none;
      background:rgba(0,0,0,.34); border:1px solid rgba(255,255,255,.13);
      transition:background .25s ease, border-color .25s ease, box-shadow .25s ease; }
    /* il nome non si comprime mai: prima veniva schiacciato a zero dal flex */
    .seat .seat-name { font-weight:600; flex:0 0 auto; overflow:hidden; text-overflow:ellipsis; }
    /* turno in corso: oro */
    .seat.active { border-color:rgba(217,178,95,.75); background:rgba(217,178,95,.16);
      box-shadow:0 0 16px rgba(217,178,95,.25); }
    .seat.active .seat-name { color:var(--gold); }
    /* chi vince la presa: verde. Pulsa solo l'alone, la posizione resta ferma. */
    .seat.won { border-color:rgba(124,252,154,.8); background:rgba(124,252,154,.15);
      animation:seatWonGlow .7s ease infinite alternate; }
    .seat.won .seat-name { color:#7CFC9A; }
    @keyframes seatWonGlow {
      from { box-shadow:0 0 10px rgba(124,252,154,.25); }
      to   { box-shadow:0 0 26px rgba(124,252,154,.55); }
    }

    /* Cartellino del vincitore: sta IN ALTO, non al centro, altrimenti copre
       il mazzetto proprio mentre le carte si radunano e non si vede l'animazione. */
    .trick-winner { position:absolute; top:14%; left:50%; transform:translate(-50%,-50%);
      display:flex; flex-direction:column; align-items:center; gap:4px; z-index:40; pointer-events:none;
      animation:twPop .35s cubic-bezier(.2,1.4,.4,1); }
    .tw-name { font-size:22px; font-weight:800; color:#fff; text-shadow:0 2px 8px rgba(0,0,0,.7);
      background:rgba(12,51,32,.85); padding:6px 18px; border-radius:20px; border:1px solid rgba(124,252,154,.5); white-space:nowrap; }
    .tw-pts { font-size:26px; font-weight:800; }
    .tw-pts.pos { color:#7CFC9A; text-shadow:0 0 12px rgba(124,252,154,.7); }
    .tw-pts.neg { color:#ff7676; text-shadow:0 0 12px rgba(255,118,118,.7); }
    @keyframes twPop { 0%{ transform:translate(-50%,-50%) scale(.5); opacity:0; } 100%{ transform:translate(-50%,-50%) scale(1); opacity:1; } }
    /* max-width+overflow: i dorsi non sbordano mai dal bordo della pillola */
    .seat-meta { display:flex; align-items:center; gap:8px; font-size:11.5px; color:#cde;
      max-width:100%; overflow:hidden; }
    .seat-meta .tot { color:var(--muted); }
    /* centratura senza transform: i margini automatici fanno il lavoro */
    .seat.top    { top:10px;    left:0; right:0; margin-inline:auto; }
    .seat.bottom { bottom:10px; left:0; right:0; margin-inline:auto; }
    /* ai lati la targhetta è verticale e stretta, per non invadere il centro */
    .seat.left, .seat.right { top:0; bottom:0; height:max-content; margin-block:auto;
      flex-direction:column; gap:4px; padding:8px 7px; border-radius:14px;
      max-width:84px; text-align:center; }
    .seat.left  { left:8px; }
    .seat.right { right:8px; }
    .seat.left .seat-name, .seat.right .seat-name { max-width:66px; }
    .seat.left .seat-meta, .seat.right .seat-meta { flex-direction:column; gap:2px; }
    /* dorsi delle carte in mano agli avversari */
    .seat-cards { display:flex; align-items:center; justify-content:center; }
    .mini-back { width:11px; height:16px; margin-left:-3px; border-radius:2px; flex:none;
      background:repeating-linear-gradient(45deg,#7a1f2b,#7a1f2b 3px,#5c1520 3px,#5c1520 6px); border:1px solid rgba(0,0,0,.3); }
    .mini-back:first-child { margin-left:0; }
    .seat-cards .count { font-size:11px; margin-left:5px; color:#bcd; }

    .ck-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    /* area delle carte giocate: non esce dallo schermo e lascia libere
       le fasce laterali dove stanno le targhette dei due avversari */
    .played { position:relative; height:min(360px, 40vh);
      width:clamp(210px, calc(100% - 175px), 460px);
      --pc-w: 112px;     /* larghezza delle carte in tavola */
      --sx: 174px;       /* quanto le carte laterali stanno lontano dal centro */
      --sy: 92px; }      /* quanto stanno lontano quella sopra e quella sotto */
    .played-card { position:absolute; left:50%; top:50%; }
    .played-card .pc-name { display:block; font-size:11px; text-align:center; color:#cde; margin-top:4px; }
    /* le carte in tavola sono più grandi di quelle in mano: sono il centro della scena */
    .played-card .ck-card { width:var(--pc-w); height:calc(var(--pc-w) * 1.44);
      border-radius:calc(var(--pc-w) * .1); box-shadow:0 6px 16px rgba(0,0,0,.4); }
    .played-card .ck-card .pip    { font-size:calc(var(--pc-w) * .46); }
    .played-card .ck-card .corner { font-size:calc(var(--pc-w) * .19); }
    .played-card .ck-card .corner.tl { top:6%; left:6%; }
    .played-card .ck-card .corner.br { bottom:6%; right:6%; }
    /* Tutte le carte hanno lo STESSO ancoraggio (il centro) e si posizionano
       soltanto con transform. Prima cambiavano anche left/top/bottom, che non
       sono nella transizione: all'inizio del raduno la carta saltava di colpo
       di ~30px e poi scivolava — era quello lo scatto. Ora si muove solo il
       transform, quindi il movimento è continuo dall'inizio alla fine. */
    .played-card.seat-bottom { transform:translate(-50%, calc(-50% + var(--sy))); }
    .played-card.seat-top    { transform:translate(-50%, calc(-50% - var(--sy))); }
    .played-card.seat-left   { transform:translate(calc(-50% - var(--sx)), -50%); }
    .played-card.seat-right  { transform:translate(calc(-50% + var(--sx)), -50%); }
    .played-card.flash .ck-card { animation:cardIn .28s ease; }
    @keyframes cardIn { 0%{ opacity:0; } 100%{ opacity:1; } }

    /* --- RACCOLTA DELLA PRESA, IN DUE TEMPI ---
       Il server tiene le carte in tavola 900ms dopo aver annunciato il vincitore.
       380ms per radunarle al centro + 500ms per il volo = 880ms: ci sta dentro.
       (La vecchia transizione unica da 1s veniva troncata a metà.) */
    .played.collecting .pc-name { opacity:0; transition:opacity .2s; }
    .played.collecting .played-card { z-index:10; }
    .played.collecting .winner-card { z-index:30; }  /* la carta vincente resta sopra */

    /* TEMPO 1 — tutte e quattro convergono nello STESSO punto, perfettamente
       sovrapposte: solo traslazione, nessuna rotazione. L'andatura parte piano,
       accelera e si posa dolcemente (niente strappo iniziale). */
    .played.phase-gather .played-card {
      transform:translate(-50%,-50%);
      transition: transform .44s cubic-bezier(.4, 0, .2, 1); }

    /* TEMPO 2 — la pila compatta parte lenta e accelera via, verso chi ha preso */
    .played.phase-fly .played-card {
      transition: transform .44s cubic-bezier(.55, 0, .85, .6), opacity .38s ease .06s; }
    .played.phase-fly .fly-to-bottom { transform:translate(-50%, calc(-50% + 340px)) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-top    { transform:translate(-50%, calc(-50% - 340px)) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-left   { transform:translate(calc(-50% - 340px), -50%) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-right  { transform:translate(calc(-50% + 340px), -50%) scale(.55); opacity:0; }
    .ck-msg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:260px;
      text-align:center; font-size:15px; color:#dce; opacity:.85; }
    .your-turn { position:absolute; bottom:44px; left:50%; transform:translateX(-50%);
      background:var(--gold); color:#2a1f06; padding:8px 22px; border-radius:22px; font-weight:700;
      font-size:16px; letter-spacing:.05em; animation:glow 1.4s infinite; }
    @keyframes glow { 50%{ box-shadow:0 0 18px rgba(217,178,95,.8);} }

    /* --- pulsante ghost e finestra impostazioni mani --- */
    .btn.ghost { background:rgba(255,255,255,.08); color:#e8eef0; border:1px solid rgba(217,178,95,.35); }
    .btn.ghost:hover { background:rgba(255,255,255,.14); }
    .settings-overlay { position:fixed; inset:0; z-index:200; background:rgba(0,0,0,.6);
      display:flex; align-items:center; justify-content:center; padding:16px; backdrop-filter:blur(3px); }
    .settings-box { background:#0f3d28; border:1px solid rgba(217,178,95,.4); border-radius:18px;
      width:min(440px,96vw); max-height:88vh; display:flex; flex-direction:column; box-shadow:0 24px 70px rgba(0,0,0,.55); overflow:hidden; }
    .settings-head { display:flex; align-items:center; justify-content:space-between; padding:18px 20px 10px; }
    .settings-head h3 { margin:0; font-family:'Cormorant Garamond',serif; font-size:26px; color:var(--gold); }
    .settings-close { background:none; border:none; color:#cde; font-size:20px; cursor:pointer; padding:4px 8px; border-radius:8px; }
    .settings-close:hover { background:rgba(255,255,255,.1); }
    .settings-actions { display:flex; gap:8px; padding:0 20px 12px; }
    .settings-actions button { flex:1; background:rgba(255,255,255,.08); color:#e8eef0; border:1px solid rgba(255,255,255,.15);
      border-radius:9px; padding:8px; font-size:13px; cursor:pointer; }
    .settings-actions button:hover { background:rgba(255,255,255,.15); }
    .mode-list { overflow-y:auto; padding:4px 12px; display:flex; flex-direction:column; gap:4px; }
    .mode-item { display:flex; align-items:center; gap:10px; padding:11px 12px; border-radius:11px; cursor:pointer;
      background:rgba(255,255,255,.04); border:1px solid transparent; transition:.15s; }
    .mode-item:hover { background:rgba(255,255,255,.08); }
    .mode-item.on { background:rgba(217,178,95,.14); border-color:rgba(217,178,95,.4); }
    .mode-item input { width:20px; height:20px; accent-color:var(--gold); cursor:pointer; flex-shrink:0; }
    .mode-num { width:24px; height:24px; border-radius:50%; background:rgba(255,255,255,.1); color:#bcd;
      display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
    .mode-item.on .mode-num { background:var(--gold); color:#2a1f06; }
    .mode-name { flex:1; font-size:15px; color:#eef4f0; }
    .mode-check { color:var(--gold); font-weight:700; }
    .settings-foot { display:flex; align-items:center; justify-content:space-between; padding:14px 20px;
      border-top:1px solid rgba(255,255,255,.1); }
    .settings-foot span { font-size:13px; color:#bcd; }
    .settings-foot span.warn { color:#e8b23c; }
    .settings-foot .btn { min-width:110px; }

    /* CARDS */
    .ck-card { position:relative; width:64px; height:92px; border-radius:8px; background:var(--paper);
      border:1px solid #cbb; box-shadow:0 3px 8px rgba(0,0,0,.3); color:var(--ink);
      display:flex; align-items:center; justify-content:center; transition:transform .12s, box-shadow .2s; padding:0; }
    .ck-card.small { width:52px; height:74px; }
    .ck-card.red { color:var(--danger); }
    .ck-card .pip { font-size:30px; }
    .ck-card.small .pip { font-size:22px; }
    .ck-card .corner { position:absolute; font-size:11px; font-weight:700; line-height:1; text-align:center; }
    .ck-card .corner.tl { top:5px; left:5px; }
    .ck-card .corner.br { bottom:5px; right:5px; transform:rotate(180deg); }
    .ck-card.back { background:repeating-linear-gradient(45deg,#7a1f2b,#7a1f2b 6px,#5c1520 6px,#5c1520 12px);
      border:1px solid #4a1018; }
    /* il sollevamento solo dove esiste un vero puntatore: su iPhone :hover resta
       incollato dopo il tap e la carta rimarrebbe alzata */
    @media (hover:hover) and (pointer:fine) {
      .ck-card:not(.disabled):hover { transform:translateY(-10px); box-shadow:0 10px 20px rgba(0,0,0,.4); }
    }
    .ck-card.disabled { cursor:default; }
    .ck-card.dim { filter:grayscale(.4); }
    .ck-card.danger { outline:2px solid var(--danger); outline-offset:-2px; }
    .ck-card.danger::before { content:'!'; position:absolute; top:-8px; right:-6px; width:16px; height:16px;
      background:var(--danger); color:#fff; border-radius:50%; font-size:11px; display:flex; align-items:center; justify-content:center; }

    /* HAND */
    .ck-hand { margin-top:12px; text-align:center;
      padding:0 calc(6px + var(--sar)) calc(10px + var(--sab)) calc(6px + var(--sal)); }
    .hand-label { font-size:11px; letter-spacing:.2em; color:var(--gold); margin-bottom:8px; }
    .hand-label em { color:#bcd; font-style:normal; text-transform:none; letter-spacing:0; }
    /* mano a ventaglio: carte sovrapposte lungo un arco */
    .fan-hand { display:flex; flex-direction:column; align-items:center; gap:0; width:100%;
      --fan-cw:64px; --fan-ch:92px; }
    /* +20px: spazio per la discesa ad arco delle carte esterne, che altrimenti
       uscirebbero dalla riga e finirebbero sotto il bordo dello schermo */
    .fan-row { position:relative; width:100%; height:calc(var(--fan-ch) + 20px); }
    .fan-slot { position:absolute; top:0; left:50%; margin-left:calc(var(--fan-cw) / -2);
      transform-origin:50% 85%; transition:transform .18s ease; }
    /* dimensioni e testo della carta scalano col ventaglio */
    .fan-slot .ck-card { width:var(--fan-cw); height:var(--fan-ch); border-radius:calc(var(--fan-cw)*.11); }
    .fan-slot .ck-card .pip { font-size:calc(var(--fan-cw)*.46); }
    .fan-slot .ck-card .corner { font-size:calc(var(--fan-cw)*.19); }
    .fan-slot .ck-card .corner.tl { top:6%; left:6%; }
    .fan-slot .ck-card .corner.br { bottom:6%; right:6%; }
    .fan-slot .ck-card { display:block; transition:transform .18s ease, box-shadow .2s; }
    /* il sollevamento sta sulla carta, così non cancella la posa del ventaglio */
    @media (hover:hover) and (pointer:fine) {
      .fan-slot .ck-card:not(.disabled):hover { transform:translateY(-18px); box-shadow:0 12px 22px rgba(0,0,0,.45); }
      .fan-slot:has(.ck-card:not(.disabled):hover) { z-index:100 !important; }
    }
    /* al tocco: la carta si alza mentre il dito è premuto (feedback su iPhone) */
    .fan-slot .ck-card:not(.disabled):active { transform:translateY(-16px); box-shadow:0 12px 22px rgba(0,0,0,.45); }
    .fan-slot:has(.ck-card:not(.disabled):active) { z-index:100 !important; }
    .pass-btn { background:var(--gold); color:#2a1f06; border:none; border-radius:10px; padding:10px 20px; font-weight:700; }

    /* TRUMP PICKER */
    .trump-picker { text-align:center; margin:10px 0; }
    .tp-title { font-size:12px; letter-spacing:.2em; color:var(--gold); margin-bottom:10px; }
    .tp-sub { font-size:13px; color:#cde; margin:-4px auto 12px; max-width:320px; line-height:1.4; }
    .tp-suits { display:flex; gap:10px; justify-content:center; }
    .tp-suit { width:88px; padding:14px 0; border-radius:12px; border:1px solid rgba(217,178,95,.4);
      background:var(--paper); color:var(--ink); font-weight:600; display:flex; flex-direction:column; gap:4px; align-items:center; }
    .tp-suit.red { color:var(--danger); }
    .tp-suit span { font-size:30px; }
    .blind-choice { display:flex; gap:12px; justify-content:center; flex-wrap:wrap; }
    .blind-yes, .blind-no { padding:14px 22px; border-radius:12px; font-weight:700; font-size:15px; cursor:pointer; border:none; }
    .blind-yes { background:linear-gradient(135deg,#d9b25f,#c39b42); color:#2a1f06; box-shadow:0 4px 12px rgba(217,178,95,.4); }
    .blind-no { background:rgba(255,255,255,.1); color:#e8eef0; border:1px solid rgba(255,255,255,.25); }
    .blind-yes:hover { filter:brightness(1.08); }
    .blind-no:hover { background:rgba(255,255,255,.16); }

    /* DOMINO */
    .domino-board { background:rgba(0,0,0,.28); border-radius:16px; padding:18px 20px; width:min(500px,92vw);
      display:flex; flex-direction:column; gap:14px; }
    .domino-row { display:flex; align-items:center; gap:16px; }
    .domino-row.waiting { opacity:.55; }
    .domino-row.red .ds { color:#ff9d8a; }
    .ds { font-size:40px; width:46px; text-align:center; flex-shrink:0; }
    .domino-track { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; flex:1; align-items:center; }
    .dom-side, .dom-center { display:flex; justify-content:center; }
    .dom-slot { display:flex; align-items:center; justify-content:center; width:70px; height:96px; border-radius:12px;
      font-size:36px; font-weight:800; }
    .dom-slot.filled { background:linear-gradient(160deg,#fff,#eef1f6); color:#1a2233; box-shadow:0 3px 10px rgba(0,0,0,.3); }
    .domino-row.red .dom-slot.filled { color:#e02a3c; }
    .dom-slot.seven { background:linear-gradient(160deg,#d9b25f,#c39b42); color:#2a1f06; box-shadow:0 4px 14px rgba(217,178,95,.5); }
    .dom-slot.empty { background:rgba(255,255,255,.05); color:rgba(255,255,255,.25); border:1px dashed rgba(255,255,255,.15); font-size:26px; }
    .dom-slot.empty7 { background:rgba(217,178,95,.12); color:rgba(217,178,95,.5); border:1px dashed rgba(217,178,95,.4); }

    /* offerta rimescolamento (4 estremi) */
    .reshuffle-offer { margin-top:16px; background:rgba(0,0,0,.55); border:1px solid rgba(217,178,95,.5);
      border-radius:14px; padding:16px 20px; text-align:center; backdrop-filter:blur(2px); }
    .ro-title { font-size:16px; font-weight:800; color:var(--gold); margin-bottom:4px; }
    .ro-sub { font-size:13px; color:#cde; margin-bottom:14px; }
    .ro-actions { display:flex; gap:10px; justify-content:center; }
    .ro-yes, .ro-no { padding:11px 20px; border-radius:11px; font-weight:700; font-size:14px; cursor:pointer; border:none; }
    .ro-yes { background:linear-gradient(135deg,#d9b25f,#c39b42); color:#2a1f06; }
    .ro-no { background:rgba(255,255,255,.1); color:#e8eef0; border:1px solid rgba(255,255,255,.25); }
    .ro-yes:hover { filter:brightness(1.08); }
    .ro-no:hover { background:rgba(255,255,255,.16); }

    /* SORTEGGIO INIZIALE */
    .draw-box { background:rgba(0,0,0,.28); border:1px solid rgba(217,178,95,.35); border-radius:20px;
      padding:32px 28px; width:min(460px,94vw); text-align:center; }
    .draw-title { font-family:'Cormorant Garamond',serif; font-size:38px; color:var(--gold); margin:0 0 4px; }
    .draw-sub { color:#cde; font-size:15px; margin-bottom:24px; min-height:22px; }
    .draw-slots { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
    .draw-slot { display:flex; flex-direction:column; align-items:center; gap:8px; padding:22px 12px;
      border-radius:14px; background:rgba(255,255,255,.05); border:2px solid transparent; transition:.15s; }
    .draw-slot .draw-ava { font-size:34px; }
    .draw-slot .draw-name { font-size:16px; font-weight:600; color:#e8eef0; }
    .draw-slot.hot { background:rgba(217,178,95,.2); border-color:var(--gold); transform:scale(1.05);
      box-shadow:0 0 24px rgba(217,178,95,.4); }
    .draw-slot.won { background:linear-gradient(135deg,#d9b25f,#c39b42); border-color:#fff; transform:scale(1.1);
      box-shadow:0 0 40px rgba(217,178,95,.7); animation:wonPulse .6s ease infinite alternate; }
    .draw-slot.won .draw-name { color:#2a1f06; }
    @keyframes wonPulse { to { box-shadow:0 0 55px rgba(217,178,95,.9); } }

    /* MODE END + GAME OVER */
    .modeend, .gameover { background:rgba(0,0,0,.25); border:1px solid rgba(217,178,95,.3);
      border-radius:18px; padding:28px; width:min(460px,92vw); text-align:center; }
    .me-tag { font-size:11px; letter-spacing:.2em; color:var(--gold); }
    .modeend h2 { font-family:'Cormorant Garamond',serif; font-size:32px; margin:.2em 0 .6em; }
    .me-table { width:100%; border-collapse:collapse; }
    .me-table th { font-size:11px; letter-spacing:.1em; color:#bcd; padding:8px; text-align:left; }
    .me-table td { padding:10px 8px; border-top:1px solid rgba(255,255,255,.08); text-align:left; }
    .me-table td:not(:first-child) { text-align:right; }
    .trophy { font-size:56px; }
    .gameover h1 { font-family:'Cormorant Garamond',serif; font-size:36px; color:var(--gold); margin:.1em 0; }
    .winner { color:#9fe0a8; margin-bottom:16px; }
    .final-list { list-style:none; padding:0; margin:0 0 20px; }
    .final-list li { display:flex; align-items:center; gap:12px; padding:12px; border-radius:10px;
      background:rgba(255,255,255,.04); margin-bottom:8px; }
    .final-list li.first { background:linear-gradient(90deg,rgba(217,178,95,.25),transparent); }
    .final-list .rank { font-size:22px; width:30px; }
    .final-list .pn { flex:1; text-align:left; }

    /* stato connessione: pillola piccola in alto a destra, non ruba spazio al tavolo */
    .conn-banner { position:fixed; z-index:120; right:calc(8px + var(--sar)); top:calc(6px + var(--sat));
      padding:4px 10px; border-radius:999px; font-size:11px; font-weight:600; pointer-events:none;
      background:rgba(0,0,0,.45); border:1px solid rgba(255,255,255,.15); backdrop-filter:blur(3px); }
    .conn-banner.online { opacity:0; transition:opacity .4s ease .8s; }  /* sparisce quando è tutto ok */
    .conn-banner.lost { background:rgba(192,57,43,.85); border-color:#e07; }

    @media (max-width:780px) {
      .ck-card { width:44px; height:64px; } .ck-card .pip { font-size:20px; }
      .home-title { font-size:48px; }
      /* barra in alto compatta: su iPhone lo spazio verticale è tutto per il tavolo */
      .ck-topbar { padding:calc(6px + var(--sat)) 10px 6px; gap:4px 10px; }
      .ck-brand { font-size:17px; }
      .ck-status { gap:10px; font-size:12px; }
      .ck-status b { font-size:10px; }
      .ck-exit { padding:5px 10px; font-size:12px; }
      .menu-toggle { width:30px; height:30px; font-size:16px; margin-right:6px; }
      .ck-progress { padding:3px; font-size:10px; }
      .game .ck-table { margin:6px 6px 0; }
      .seat { font-size:11.5px; padding:5px 9px; gap:6px; }
      .seat-meta { gap:6px; font-size:10.5px; }
      .seat.top { top:7px; } .seat.bottom { bottom:7px; }
      .seat.left { left:5px; } .seat.right { right:5px; }
      .seat.left, .seat.right { max-width:74px; padding:7px 6px; }
      .seat.left .seat-name, .seat.right .seat-name { max-width:60px; }
      .mini-back { width:9px; height:13px; }
      .played { --pc-w: 96px; --sx: 57px; --sy: 102px; }
      /* con le carte grandi il mazzetto si sovrappone e coprirebbe le etichette:
         su telefono la posizione della carta dice già chi l'ha giocata */
      .played-card .pc-name { display:none; }
      .hand-label { font-size:10px; margin-bottom:4px; }
      .your-turn { bottom:40px; padding:5px 14px; font-size:12px; letter-spacing:.04em; }
      .ck-hand { margin-top:6px; }
      .tw-name { font-size:18px; padding:5px 14px; }
      .tw-pts { font-size:22px; }
      .tp-suit { width:70px; padding:10px 0; }
      .tp-suit span { font-size:24px; }
    }
    /* schermi bassi (iPhone in orizzontale o SE): comprimi ancora */
    @media (max-height:560px) {
      .ck-progress { display:none; }
      .hand-label { display:none; }
    }
    `}</style>
  );
}
