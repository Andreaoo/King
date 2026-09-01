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
const rv = (r) => RANKS.indexOf(r);
const LAYOUT = ["bottom", "left", "top", "right"];

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
    emit("createRoom", { name: name || "Giocatore", difficulty, pid }, (res) => {
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
    return <Shell notice={notice} onCloseNotice={() => setNotice(null)}>{connBanner}<div className="ck-center-msg">Connessione al server…<br /><small>{SERVER_URL}</small></div></Shell>;

  if (view === "home" || view === "join")
    return (
      <Shell notice={notice} onCloseNotice={() => setNotice(null)}>
        {connBanner}
        <Home
          view={view} setView={setView} name={name} setName={setName}
          difficulty={difficulty} setDifficulty={setDifficulty}
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
          onLeave={leaveRoom}
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
function Home({ view, setView, name, setName, difficulty, setDifficulty, joinCode, setJoinCode, onCreate, onJoin, error, urlRoom }) {
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
      <p className="home-note">Condividi il codice stanza con gli amici. I posti liberi vengono riempiti da bot quando il proprietario avvia.</p>
    </div>
  );
}

/* ---------------- LOBBY ---------------- */
function Lobby({ state, pid, onStart, onConfig, onLeave }) {
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
      <p className="lobby-hint">{humans}/4 umani · i posti restanti diventano bot</p>
      {isOwner ? (
        <button className="btn primary wide" onClick={onStart}>AVVIA PARTITA</button>
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

const MODE_TITLES = {
  noKingsJacks: "No Re e Fanti", noQueens: "No Donne", no8Diamonds: "No 8 di Quadri",
  noKingHearts: "No K di Cuori", noHearts: "No Cuori", lastTwoTricks: "Ultime Due Prese",
  noTricks: "No Prese", domino: "Domino", chosenTrump: "Seme scelto", hiddenTrump: "Briscola non dichiarata",
};

/* ---------------- GAME ---------------- */
function Game({ state: s, pid, guardedAct, onPlay, onTrump, onBlind, onPass, onNext, onLeave }) {
  const [blindDecided, setBlindDecided] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  useEffect(() => { setBlindDecided(false); }, [s.modeIndex]); // reset a ogni mano
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
        const v = rv(c.rank);
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
          {s.trump && !s.hidden && (
            <span className={SUIT_RED[s.trump] ? "trump red" : "trump"}><b>Briscola</b> {SUIT_SYMBOL[s.trump]} {SUIT_NAME[s.trump]}</span>
          )}
          {s.hidden && <span className="trump hidden"><b>Briscola</b> ??</span>}
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

      <div className="ck-table">
        {s.players.map((p, i) => (
          <div key={i} className={`seat ${seatOf(i)} ${s.turn === i ? "active" : ""}`}>
            <div className="seat-name">{p.bot ? "🤖" : "👤"} {p.name}{i === seat ? " (tu)" : ""}{!p.connected && " 🔌"}</div>
            <div className="seat-meta">
              {s.isTrickMode && <span>Prese: {s.tricksWon[i]}</span>}
              <span className={s.handScores[i] < 0 ? "neg" : s.handScores[i] > 0 ? "pos" : ""}>{s.handScores[i]}</span>
              <span className="tot">tot {s.totalScores[i]}</span>
            </div>
            {i !== seat && (
              <div className="seat-cards">
                {Array.from({ length: Math.min(p.handCount, 8) }).map((_, k) => <div key={k} className="mini-back" />)}
                <span className="count">{p.handCount}</span>
              </div>
            )}
          </div>
        ))}

        <div className="ck-center">
          {s.modeKey === "domino" ? (
            <DominoBoard board={s.dominoBoard} />
          ) : (
            <div className={`played ${s.collecting != null ? "collecting phase-fly" : ""}`}>
              {s.table.length === 0 && <div className="ck-msg">{s.message}</div>}
              {s.table.map((t, i) => (
                <div key={i}
                  className={`played-card seat-${seatOf(t.player)} ${s.collecting != null ? `fly-to-${seatOf(s.collecting)}` : ""} ${s.collecting === t.player ? "winner-card" : ""}`}>
                  <Card card={t.card} small highlight={highlight(t.card)} />
                  <span className="pc-name">{s.players[t.player].name}</span>
                </div>
              ))}
            </div>
          )}
          {myTurn && !s.awaitingTrump && <div className="your-turn">È IL TUO TURNO</div>}
        </div>
      </div>

      {s.awaitingTrump && myTurn && s.modeKey === "chosenTrump" && !blindDecided && (
        <div className="trump-picker">
          <div className="tp-title">VUOI GIOCARE AL BUIO?</div>
          <div className="tp-sub">Scegli il seme senza vedere le carte e guadagni punti doppi (+2 a presa)</div>
          <div className="blind-choice">
            <button className="blind-yes" onClick={() => { onBlind(true); setBlindDecided(true); }}>SÌ, AL BUIO</button>
            <button className="blind-no" onClick={() => { onBlind(false); setBlindDecided(true); }}>NO, VEDO LE CARTE</button>
          </div>
        </div>
      )}

      {s.awaitingTrump && myTurn && (s.modeKey !== "chosenTrump" || blindDecided) && (
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
        <div className="hand-cards">
          {s.myHandHidden ? (
            (s.myHand || []).map((c) => <Card key={c.id} faceDown />)
          ) : (
            (s.myHand || []).map((c) => {
              const playable = myTurn && !s.awaitingTrump && myValid.includes(c.id);
              return (
                <Card key={c.id} card={c} highlight={highlight(c)} dim={myTurn && !playable}
                  onClick={playable ? () => guardedAct(s, () => onPlay(c.id)) : undefined} disabled={!playable} />
              );
            })
          )}
          {s.modeKey === "domino" && myTurn && myValid.length === 0 && (
            <button className="pass-btn" onClick={() => guardedAct(s, onPass)}>PASSA</button>
          )}
        </div>
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
  const sevenIdx = RANKS.indexOf("7");
  return (
    <div className="domino-board">
      {SUITS.map((s) => {
        const b = board[s];
        const started = !!b;
        // carta più bassa e più alta giocate (oltre al 7 centrale)
        const lowLabel = started && b.low < sevenIdx ? (RANK_LABEL[RANKS[b.low]] || RANKS[b.low]) : null;
        const highLabel = started && b.high > sevenIdx ? (RANK_LABEL[RANKS[b.high]] || RANKS[b.high]) : null;
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
      min-height: 100vh; margin:0; font-family:'Outfit',system-ui,sans-serif;
      background: radial-gradient(120% 120% at 50% 0%, #14663f 0%, var(--felt) 45%, var(--felt2) 100%);
      color: var(--paper);
    }
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
    .ck-topbar { display:flex; justify-content:space-between; align-items:center; padding:10px 18px;
      background:rgba(0,0,0,.25); border-bottom:1px solid rgba(217,178,95,.25); flex-wrap:wrap; gap:8px; }
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
    .ck-table-wrap { flex:1; display:flex; flex-direction:column; padding:12px; }
    .ck-table { position:relative; flex:1; border-radius:20px; min-height:620px;
      background:radial-gradient(80% 80% at 50% 45%, #157a49 0%, #0e5a34 70%, #0a3d26 100%);
      border:2px solid rgba(217,178,95,.4); box-shadow:inset 0 0 60px rgba(0,0,0,.4); }
    .seat { position:absolute; text-align:center; font-size:15px; transition:.2s; }
    .seat .seat-name { font-weight:600; }
    .seat.active .seat-name { color:var(--gold); text-shadow:0 0 12px rgba(217,178,95,.6); }
    .seat.active::after { content:''; position:absolute; inset:-6px -10px; border:1px solid var(--gold);
      border-radius:12px; opacity:.6; }
    .seat-meta { display:flex; gap:12px; justify-content:center; font-size:13px; color:#cde; }
    .seat.top { top:14px; left:50%; transform:translateX(-50%); }
    .seat.bottom { bottom:10px; left:50%; transform:translateX(-50%); }
    .seat.left { left:16px; top:50%; transform:translateY(-50%); }
    .seat.right { right:16px; top:50%; transform:translateY(-50%); }
    .seat-cards { display:flex; gap:-6px; justify-content:center; margin-top:5px; position:relative; }
    .mini-back { width:15px; height:22px; margin-left:-4px; border-radius:2px;
      background:repeating-linear-gradient(45deg,#7a1f2b,#7a1f2b 3px,#5c1520 3px,#5c1520 6px); border:1px solid rgba(0,0,0,.3); }
    .seat-cards .count { font-size:12px; margin-left:6px; color:#bcd; }

    .ck-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .played { position:relative; width:440px; height:350px; }
    .played-card { position:absolute; }
    .played-card .pc-name { display:block; font-size:12px; text-align:center; color:#cde; margin-top:3px; }
    .played-card.seat-bottom { bottom:0; left:50%; transform:translateX(-50%); }
    .played-card.seat-top { top:0; left:50%; transform:translateX(-50%); }
    .played-card.seat-left { left:0; top:50%; transform:translateY(-50%); }
    .played-card.seat-right { right:0; top:50%; transform:translateY(-50%); }
    .played-card.flash .ck-card { animation:cardIn .28s ease; }
    @keyframes cardIn { 0%{ opacity:0; } 100%{ opacity:1; } }

    /* --- animazione raccolta presa (lenta e morbida) --- */
    .played.collecting .played-card { transition: transform 1s cubic-bezier(.25,.1,.25,1), opacity .6s ease; }
    .played.collecting .pc-name { opacity:0; transition:opacity .3s; }
    /* la carta di chi ha vinto resta SOPRA il mazzetto */
    .played.collecting .played-card { z-index:10; }
    .played.collecting .winner-card { z-index:30; }

    /* FASE 1 (gather): le carte si impilano al centro perfettamente allineate (solo traslazione) */
    .played.phase-gather .played-card.seat-bottom,
    .played.phase-gather .played-card.seat-top,
    .played.phase-gather .played-card.seat-left,
    .played.phase-gather .played-card.seat-right { left:50%; top:50%; bottom:auto; transform:translate(-50%,-50%); }

    /* FASE 2 (fly): il mazzetto compatto scivola verso il bordo del vincitore */
    .played.phase-fly .played-card { left:50%; top:50%; bottom:auto; }
    .played.phase-fly .fly-to-bottom { transform:translate(-50%, 320px) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-top    { transform:translate(-50%, -320px) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-left   { transform:translate(-400px, -50%) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-right  { transform:translate(400px, -50%) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-left   { transform:translate(-400px, -50%) scale(.55); opacity:0; }
    .played.phase-fly .fly-to-right  { transform:translate(400px, -50%) scale(.55); opacity:0; }
    .ck-msg { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); width:260px;
      text-align:center; font-size:15px; color:#dce; opacity:.85; }
    .your-turn { position:absolute; bottom:16px; left:50%; transform:translateX(-50%);
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
    .ck-card { position:relative; width:132px; height:190px; border-radius:16px;
      background:linear-gradient(160deg, #ffffff 0%, #f2f4f8 100%);
      border:none; box-shadow:0 6px 16px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.9), inset 0 0 0 2px rgba(20,30,50,.06);
      color:#1a2233;
      display:flex; align-items:center; justify-content:center; transition:transform .14s cubic-bezier(.2,.8,.3,1), box-shadow .2s; padding:0;
      -webkit-tap-highlight-color:transparent; }
    .ck-card.small { width:106px; height:152px; border-radius:13px; }
    .ck-card.red { color:#e02a3c; }
    .ck-card.black { color:#1a2233; }
    .ck-card .pip { font-size:84px; line-height:1; filter:drop-shadow(0 1px 1px rgba(0,0,0,.12)); }
    .ck-card.small .pip { font-size:64px; }
    .ck-card .corner { position:absolute; font-size:31px; font-weight:800; line-height:.95; text-align:center; letter-spacing:-.02em; }
    .ck-card.small .corner { font-size:25px; }
    .ck-card .corner.tl { top:8px; left:10px; }
    .ck-card .corner.br { bottom:8px; right:10px; transform:rotate(180deg); }
    .ck-card.back {
      background:
        radial-gradient(circle at 50% 50%, rgba(217,178,95,.25) 0%, transparent 60%),
        repeating-linear-gradient(45deg,#12432c,#12432c 7px,#0d3623 7px,#0d3623 14px);
      box-shadow:0 6px 16px rgba(0,0,0,.4), inset 0 0 0 2px rgba(217,178,95,.55), inset 0 0 0 4px rgba(13,54,35,1); }
    .ck-card:not(.disabled):not(.back):hover { transform:translateY(-16px) scale(1.03);
      box-shadow:0 20px 34px rgba(0,0,0,.5), inset 0 0 0 1px rgba(255,255,255,.9), inset 0 0 0 2px rgba(20,30,50,.06); }
    .ck-card.disabled { cursor:default; }
    .ck-card.dim { opacity:.45; filter:grayscale(.5) brightness(.92); }
    .ck-card.danger { box-shadow:0 6px 16px rgba(0,0,0,.35), inset 0 0 0 3px #e02a3c; }
    .ck-card.danger::before { content:'!'; position:absolute; top:-10px; right:-8px; width:24px; height:24px;
      background:#e02a3c; color:#fff; border-radius:50%; font-size:15px; font-weight:800; display:flex; align-items:center; justify-content:center;
      box-shadow:0 2px 6px rgba(224,42,60,.5); }

    /* HAND */
    .ck-hand { margin-top:16px; text-align:center; }
    .hand-label { font-size:15px; letter-spacing:.2em; color:var(--gold); margin-bottom:12px; }
    .hand-label em { color:#bcd; font-style:normal; text-transform:none; letter-spacing:0; }
    .hand-cards { display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
    .pass-btn { background:var(--gold); color:#2a1f06; border:none; border-radius:10px; padding:0 28px; font-weight:700; font-size:18px; }

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

    @media (max-width:780px) {
      .ck-card { width:92px; height:132px; } .ck-card .pip { font-size:48px; }
      .ck-card.small { width:78px; height:112px; } .ck-card.small .pip { font-size:38px; }
      .ck-card .corner { font-size:18px; }
      .ck-table { min-height:520px; }
      .played { width:320px; height:260px; }
      .home-title { font-size:48px; }
    }
    @media (max-width:400px) {
      .ck-card { width:64px; height:92px; } .ck-card .pip { font-size:32px; }
      .hand-cards { gap:6px; }
    }
    `}</style>
  );
}
