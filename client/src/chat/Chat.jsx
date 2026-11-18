import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChat, dmId, peerOf } from "./useChat.js";
import EmojiPicker, { recordEmoji } from "./EmojiPicker.jsx";
import { QUICK_REACTIONS } from "./emojiData.js";
import { CHAT_CSS } from "./chatStyle.js";

// ============================================================================
// Chat della stanza: pannello a scomparsa sopra il gioco (non lo ridimensiona),
// in tre modalità (laterale, metà schermo, schermo intero) e ridimensionabile.
// È un componente a sé: i messaggi aggiornano solo la chat, mai il tavolo.
// ============================================================================

const SETTINGS_KEY = "ck_chat_settings";
const LAYOUT_KEY = "ck_chat_layout";
const DEFAULT_SETTINGS = { sound: true, previews: true, muted: false, mutedConvs: [], textSize: "m", remember: true };
const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp"];
const FILE_EXT = ["pdf", "docx", "xlsx", "txt"];
const ACCEPT = [...IMAGE_EXT, ...FILE_EXT].map((e) => "." + e).join(",");

const readJson = (k, d) => { try { return { ...d, ...JSON.parse(localStorage.getItem(k)) }; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage bloccato */ } };

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtTime = (ts) => new Date(ts).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ts) => {
  const d = new Date(ts), today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Oggi";
  if (d.toDateString() === y.toDateString()) return "Ieri";
  return d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
};
const hue = (s) => [...(s || "?")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
const FILE_ICON = { "application/pdf": "📕", "text/plain": "📃" };
const fileIcon = (a) => FILE_ICON[a.mime] || (a.name?.endsWith(".xlsx") ? "📊" : a.name?.endsWith(".docx") ? "📝" : "📄");
const ONLY_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Component}|‍|️|\s)+$/u;
const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;

// suono di notifica sintetizzato: nessun file audio da scaricare
let audioCtx;
function ding() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
    const t = audioCtx.currentTime;
    [880, 1320].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "sine"; o.frequency.value = f;
      const s = t + i * 0.09;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
      o.connect(g).connect(audioCtx.destination);
      o.start(s); o.stop(s + 0.3);
    });
  } catch { /* audio non disponibile */ }
}

function Avatar({ uid, name, size = 30 }) {
  return (
    <span className="ch-ava" style={{ width: size, height: size, fontSize: size * 0.42, background: `hsl(${hue(uid || name)} 45% 38%)` }}>
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

function RichText({ text }) {
  const parts = text.split(URL_RE);
  return parts.map((p, i) => (i % 2 ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a> : p));
}

// ---------------------------------------------------------------------------
export default memo(function Chat({ socket, serverUrl }) {
  const [settings, setSettings] = useState(() => readJson(SETTINGS_KEY, DEFAULT_SETTINGS));
  const [layout, setLayout] = useState(() => {
    const l = readJson(LAYOUT_KEY, { mode: "side", width: null, fab: { r: 14, b: 96 } });
    return settings.remember ? l : { ...l, mode: "side", width: null };
  });
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [active, setActive] = useState("room");
  const [unread, setUnread] = useState({});
  const [toasts, setToasts] = useState([]);
  const [lightbox, setLightbox] = useState(null);       // { items:[{url,name,dl}], i }
  const [narrow, setNarrow] = useState(() => window.innerWidth < 700);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");

  const viewingRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => writeJson(SETTINGS_KEY, settings), [settings]);
  useEffect(() => { if (settings.remember) writeJson(LAYOUT_KEY, layout); }, [layout, settings.remember]);
  useEffect(() => {
    const r = () => setNarrow(window.innerWidth < 700);
    const v = () => setVisible(document.visibilityState === "visible");
    window.addEventListener("resize", r);
    document.addEventListener("visibilitychange", v);
    return () => { window.removeEventListener("resize", r); document.removeEventListener("visibilitychange", v); };
  }, []);

  const viewing = open && !minimized && visible ? active : null;
  viewingRef.current = viewing;

  const chat = useChat(socket, {
    onIncoming: (m) => {
      const me = chatRef.current?.info?.me;
      if (!me || m.from === me) return;
      if (viewingRef.current === m.conv) return;            // la sto già leggendo
      setUnread((u) => ({ ...u, [m.conv]: (u[m.conv] || 0) + 1 }));
      const st = settingsRef.current;
      if (st.muted || st.mutedConvs.includes(m.conv)) return;
      if (st.sound) ding();
      if (st.previews) {
        const id = m.id;
        const preview = m.deleted ? "" : m.text || (m.gif ? "GIF" : m.attachments.length ? `📎 ${m.attachments.length} allegat${m.attachments.length > 1 ? "i" : "o"}` : "");
        setToasts((t) => [...t.slice(-2), { id, conv: m.conv, name: m.name, text: preview, priv: m.conv !== "room" }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
      }
    },
  });
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const { info, roster } = chat;

  // la conversazione che sto guardando non ha messaggi non letti
  useEffect(() => {
    if (viewing && unread[viewing]) setUnread((u) => ({ ...u, [viewing]: 0 }));
  }, [viewing, unread]);
  // apro un privato: carica lo storico la prima volta
  useEffect(() => {
    if (info && active !== "room" && !chat.convs[active]?.loaded) chat.loadHistory(active);
  }, [active, info]); // eslint-disable-line

  const fileUrl = useCallback((id, dl) => `${serverUrl}/api/chat/file/${id}?t=${info?.token}${dl ? "&dl=1" : ""}`, [serverUrl, info]);

  const totalUnread = Object.entries(unread)
    .filter(([c]) => !settings.mutedConvs.includes(c))
    .reduce((n, [, v]) => n + v, 0);

  const openConv = (conv) => {
    if (conv !== "room") chat.addDm(conv);
    setActive(conv); setOpen(true); setMinimized(false);
    setToasts((t) => t.filter((x) => x.conv !== conv));
  };

  if (!info) return null;   // non ancora nella stanza

  return (
    <div className={`ck-chat ts-${settings.textSize}`}>
      <style>{CHAT_CSS}</style>

      {!open && <Fab layout={layout} setLayout={setLayout} count={totalUnread} onOpen={() => openConv(active)} />}

      {toasts.length > 0 && (!open || minimized) && (
        <div className="ch-toasts" style={{ right: layout.fab.r, bottom: layout.fab.b + 64 }}>
          {toasts.map((t) => (
            <button key={t.id} className={`ch-toast ${t.priv ? "priv" : ""}`} onClick={() => openConv(t.conv)}>
              <b>{t.priv ? "🔒 " : ""}{t.name}</b><span>{t.text}</span>
            </button>
          ))}
        </div>
      )}

      {open && minimized && (
        <button className="ch-minibar" onClick={() => setMinimized(false)}>
          💬 Chat {totalUnread > 0 && <span className="ch-badge">{totalUnread}</span>}
          <span className="ch-x" onClick={(e) => { e.stopPropagation(); setOpen(false); setMinimized(false); }}>✕</span>
        </button>
      )}

      <Panel
        shown={open && !minimized}
        chat={chat} settings={settings} setSettings={setSettings}
        layout={layout} setLayout={setLayout} narrow={narrow}
        active={active} setActive={openConv} unread={unread} clearUnread={() => setUnread({})}
        onMinimize={() => setMinimized(true)} onClose={() => setOpen(false)}
        fileUrl={fileUrl} serverUrl={serverUrl} openLightbox={setLightbox}
      />

      {lightbox && <Lightbox {...lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Pulsante flottante: si trascina per spostarlo, la posizione viene ricordata
function Fab({ layout, setLayout, count, onOpen }) {
  const drag = useRef(null);
  const onDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, r: layout.fab.r, b: layout.fab.b, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    const r = Math.min(Math.max(d.r - dx, 6), window.innerWidth - 60);
    const b = Math.min(Math.max(d.b - dy, 6), window.innerHeight - 60);
    setLayout((l) => ({ ...l, fab: { r, b } }));
  };
  // dopo un trascinamento il clic che segue non deve aprire la chat
  const dragged = useRef(false);
  const onUp = () => { dragged.current = !!drag.current?.moved; drag.current = null; };
  const onClick = () => { if (dragged.current) dragged.current = false; else onOpen(); };
  return (
    <button className="ch-fab" style={{ right: layout.fab.r, bottom: layout.fab.b }} aria-label="Apri la chat"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      {count > 0 && <span className="ch-badge">{count > 99 ? "99+" : count}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
function Panel({ shown, chat, settings, setSettings, layout, setLayout, narrow, active, setActive, unread, clearUnread,
  onMinimize, onClose, fileUrl, serverUrl, openLightbox }) {
  const { info, roster, convs, dmConvs, typing } = chat;
  const me = info.me;
  // animazioni attive solo poco dopo il montaggio: al cambio schermata il pannello nascosto non deve vedersi scorrere
  const [armed, setArmed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setArmed(true), 500); return () => clearTimeout(t); }, []);
  const [showPlayers, setShowPlayers] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [dropping, setDropping] = useState(false);
  const composerRef = useRef(null);
  const resizing = useRef(false);

  const byUid = useMemo(() => Object.fromEntries(roster.filter((p) => p.uid).map((p) => [p.uid, p])), [roster]);
  const mode = layout.mode;
  const full = mode === "full";
  const width = full ? "100vw"
    : layout.width ? `min(${layout.width}px, 100vw)`
    : mode === "half" ? (narrow ? "100vw" : "50vw")
    : narrow ? "min(90vw, 420px)" : "max(340px, 30vw)";
  const wide = full && !narrow;    // a schermo intero l'elenco giocatori sta fisso a sinistra

  const peer = peerOf(active, me);
  const peerInfo = peer ? byUid[peer] : null;
  const canWrite = active === "room" || (peerInfo && !peerInfo.left);
  const humans = roster.filter((p) => !p.bot && !p.left);
  const online = humans.filter((p) => p.online).length;
  const conv = convs[active] || { messages: [], hasMore: false };
  const typingNames = Object.entries(typing[active] || {}).filter(([u]) => u !== me).map(([, n]) => n);
  const mutedHere = settings.mutedConvs.includes(active);

  useEffect(() => { setReplyTo(null); }, [active]);

  const setMode = (m) => setLayout((l) => ({ ...l, mode: m, width: null }));
  const onResizeDown = (e) => {
    resizing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add("ch-resizing");
  };
  const onResizeMove = (e) => {
    if (!resizing.current) return;
    const w = Math.min(Math.max(window.innerWidth - e.clientX, 300), window.innerWidth);
    setLayout((l) => ({ ...l, mode: w > window.innerWidth * 0.92 ? "full" : w > window.innerWidth * 0.4 ? "half" : "side", width: w }));
  };
  const onResizeUp = () => { resizing.current = false; document.body.classList.remove("ch-resizing"); };

  const openDm = (uid) => { setActive(dmId(me, uid)); setShowPlayers(false); };
  const convTitle = (c) => (c === "room" ? "Tavolo" : byUid[peerOf(c, me)]?.name || "Privato");

  // trascinare file sopra il pannello
  const onDragOver = (e) => { if (canWrite && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); setDropping(true); } };
  const onDrop = (e) => {
    e.preventDefault(); setDropping(false);
    if (canWrite && e.dataTransfer.files?.length) composerRef.current?.addFiles(e.dataTransfer.files);
  };

  const players = (
    <PlayersList roster={roster} me={me} onDm={openDm} />
  );

  return (
    <aside className={`ch-panel ${shown ? "shown" : ""} ${full ? "full" : ""} ${armed ? "armed" : ""}`} style={{ width }} aria-hidden={!shown}
      onDragOver={onDragOver} onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }} onDrop={onDrop}>
      {!full && !narrow && (
        <div className="ch-resize" title="Trascina per ridimensionare"
          onPointerDown={onResizeDown} onPointerMove={onResizeMove} onPointerUp={onResizeUp} onPointerCancel={onResizeUp} />
      )}

      <header className="ch-head">
        <div className="ch-title">
          {active === "room" ? <span className="ch-hash">#</span> : <Avatar uid={peer} name={peerInfo?.name} size={30} />}
          <div>
            <b>{active === "room" ? "Tavolo" : peerInfo?.name || "Privato"}</b>
            <small>
              {active === "room"
                ? `${online} online · ${humans.length} giocator${humans.length === 1 ? "e" : "i"}`
                : peerInfo?.left ? "ha lasciato la stanza" : peerInfo?.online ? "🔒 privato · online" : "🔒 privato · offline"}
            </small>
          </div>
        </div>
        <div className="ch-tools">
          {!wide && <button className={showPlayers ? "on" : ""} title="Giocatori" onClick={() => setShowPlayers((v) => !v)}>👥</button>}
          <span className="ch-modes">
            <button className={mode === "side" ? "on" : ""} title="Laterale" onClick={() => setMode("side")}><i className="m1" /></button>
            {!narrow && <button className={mode === "half" ? "on" : ""} title="Metà schermo" onClick={() => setMode("half")}><i className="m2" /></button>}
            <button className={mode === "full" ? "on" : ""} title="Schermo intero" onClick={() => setMode("full")}><i className="m3" /></button>
          </span>
          <button className={showSettings ? "on" : ""} title="Impostazioni" onClick={() => setShowSettings((v) => !v)}>⚙</button>
          <button title="Riduci" onClick={onMinimize}>–</button>
          <button title="Chiudi" onClick={onClose}>✕</button>
        </div>
      </header>

      <nav className="ch-tabs">
        {["room", ...dmConvs].map((c) => {
          const p = c === "room" ? null : byUid[peerOf(c, me)];
          return (
            <button key={c} className={`ch-tab ${c === active ? "on" : ""} ${c !== "room" ? "priv" : ""}`} onClick={() => setActive(c)}>
              {c === "room" ? "# Tavolo" : <>{p && <i className={`dot ${p.online && !p.left ? "on" : ""}`} />}{convTitle(c)}</>}
              {settings.mutedConvs.includes(c) && <span className="mut">🔕</span>}
              {unread[c] > 0 && <span className="ch-badge">{unread[c]}</span>}
              {c !== "room" && (
                <span className="ch-x" title="Chiudi conversazione"
                  onClick={(e) => { e.stopPropagation(); chat.closeDm(c); if (c === active) setActive("room"); }}>✕</span>
              )}
            </button>
          );
        })}
      </nav>

      {showSettings && (
        <Settings settings={settings} setSettings={setSettings} conv={active} convName={convTitle(active)} mutedHere={mutedHere}
          maxFileMB={info.config.maxFileMB} clearUnread={clearUnread} onClose={() => setShowSettings(false)} />
      )}

      <div className="ch-body">
        {wide && <div className="ch-side">{players}</div>}
        {!wide && showPlayers && <div className="ch-drawer">{players}</div>}
        <div className="ch-main">
          <MessageList key={"list-" + active} conv={conv} convId={active} me={me} chat={chat} fileUrl={fileUrl}
            onReply={setReplyTo} openLightbox={openLightbox} canWrite={canWrite} />
          <div className="ch-typing">{typingNames.length ? `${typingNames.join(", ")} sta${typingNames.length > 1 ? "nno" : ""} scrivendo…` : ""}</div>
          {canWrite ? (
            <Composer ref={composerRef} key={"input-" + active} conv={active} chat={chat} info={info} serverUrl={serverUrl}
              replyTo={replyTo} clearReply={() => setReplyTo(null)} />
          ) : (
            <div className="ch-readonly">{peerInfo?.name || "Il giocatore"} ha lasciato la stanza: la conversazione è in sola lettura.</div>
          )}
        </div>
      </div>

      {dropping && <div className="ch-drop">📎 Rilascia qui i file da inviare</div>}
    </aside>
  );
}

// ---------------------------------------------------------------------------
function PlayersList({ roster, me, onDm }) {
  const list = [...roster].sort((a, b) => (a.left ? 1 : 0) - (b.left ? 1 : 0) || (a.seat ?? 9) - (b.seat ?? 9));
  return (
    <div className="ch-players">
      <div className="ch-sec">Giocatori</div>
      {list.map((p, i) => (
        <div key={p.uid || "bot" + i} className={`ch-player ${p.left ? "left" : ""}`}>
          <span className="ch-pava">
            {p.bot ? <span className="ch-ava bot">🤖</span> : <Avatar uid={p.uid} name={p.name} size={30} />}
            {!p.bot && <i className={`dot ${p.online && !p.left ? "on" : ""}`} />}
          </span>
          <span className="ch-pname">
            {p.name}{p.uid === me && <em> (tu)</em>}
            <small>{p.bot ? "bot" : p.left ? "ha lasciato" : p.online ? "online" : "offline"}</small>
          </span>
          {!p.bot && p.uid !== me && (
            <button className="ch-pm" title={`Messaggio privato a ${p.name}`} onClick={() => onDm(p.uid)}>💬</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Settings({ settings, setSettings, conv, convName, mutedHere, maxFileMB, clearUnread, onClose }) {
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const toggleConv = () => setSettings((s) => ({
    ...s, mutedConvs: mutedHere ? s.mutedConvs.filter((c) => c !== conv) : [...s.mutedConvs, conv],
  }));
  const Row = ({ k, label }) => (
    <label className="ch-set"><span>{label}</span><input type="checkbox" checked={!!settings[k]} onChange={(e) => set(k, e.target.checked)} /></label>
  );
  return (
    <div className="ch-settings">
      <div className="ch-sec">Impostazioni chat <button className="ch-x" onClick={onClose}>✕</button></div>
      <Row k="sound" label="Suono delle notifiche" />
      <Row k="previews" label="Anteprima dei messaggi" />
      <Row k="muted" label="Silenzia tutta la chat" />
      <label className="ch-set"><span>Silenzia «{convName}»</span><input type="checkbox" checked={mutedHere} onChange={toggleConv} /></label>
      <Row k="remember" label="Ricorda dimensione e posizione" />
      <div className="ch-set"><span>Dimensione testo</span>
        <span className="ch-seg">
          {[["s", "A-"], ["m", "A"], ["l", "A+"]].map(([k, l]) => (
            <button key={k} className={settings.textSize === k ? "on" : ""} onClick={() => set("textSize", k)}>{l}</button>
          ))}
        </span>
      </div>
      <div className="ch-set"><span>Notifiche</span><button className="ch-btn" onClick={clearUnread}>Segna tutto come letto</button></div>
      <p className="ch-note">Allegati fino a {maxFileMB} MB per file. Il limite si cambia sul server (variabile CHAT_MAX_FILE_MB).</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
function MessageList({ conv, convId, me, chat, fileUrl, onReply, openLightbox, canWrite }) {
  const listRef = useRef(null);
  const atBottom = useRef(true);
  const restore = useRef(null);
  const [newBelow, setNewBelow] = useState(0);
  const [toolsFor, setToolsFor] = useState(null);
  const [pickFor, setPickFor] = useState(null);       // messaggio a cui reagire col selettore completo
  const [flash, setFlash] = useState(null);
  const msgs = conv.messages;
  const lastId = msgs[msgs.length - 1]?.id;
  const firstId = msgs[0]?.id;

  // nuovi messaggi in fondo: si scende solo se ero già in fondo (o il messaggio è mio)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const last = msgs[msgs.length - 1];
    if (atBottom.current || last?.from === me) { el.scrollTop = el.scrollHeight; setNewBelow(0); }
    else if (last) setNewBelow((n) => n + 1);
  }, [lastId]); // eslint-disable-line
  // pagina più vecchia caricata in cima: la vista resta ferma dov'era
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && restore.current != null) { el.scrollTop = el.scrollHeight - restore.current; restore.current = null; }
  }, [firstId]);
  // le immagini che finiscono di caricare non devono staccare la vista dal fondo
  const onMediaLoad = () => { const el = listRef.current; if (el && atBottom.current) el.scrollTop = el.scrollHeight; };

  const loadOlder = () => {
    const el = listRef.current;
    if (!conv.hasMore || conv.loading || !el) return;
    restore.current = el.scrollHeight - el.scrollTop;
    chat.loadHistory(convId, true);
  };
  const onScroll = () => {
    const el = listRef.current;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom.current) setNewBelow(0);
    if (el.scrollTop < 60) loadOlder();
  };
  const toBottom = () => { const el = listRef.current; el.scrollTop = el.scrollHeight; setNewBelow(0); };

  // clic su una citazione: va al messaggio originale (caricando lo storico se serve)
  const goTo = useCallback(async (id, tries = 0) => {
    const el = listRef.current?.querySelector(`[data-mid="${id}"]`);
    if (el) {
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setFlash(id); setTimeout(() => setFlash(null), 1600);
    } else if (conv.hasMore && tries < 10) {
      loadOlder();
      setTimeout(() => goTo(id, tries + 1), 450);
    }
  }, [conv.hasMore]); // eslint-disable-line

  const react = (m, e) => { recordEmoji(e); chat.call("chat:react", { id: m.id, emoji: e }); setToolsFor(null); };

  let prev = null;
  return (
    <div className="ch-list" ref={listRef} onScroll={onScroll}>
      {conv.hasMore && <button className="ch-older" onClick={loadOlder}>{conv.loading ? "Caricamento…" : "Messaggi precedenti"}</button>}
      {!msgs.length && conv.loaded && (
        <div className="ch-empty">{convId === "room" ? "Nessun messaggio. Saluta il tavolo! 👋" : "Inizia la conversazione privata 🔒"}</div>
      )}
      {msgs.map((m) => {
        const day = !prev || new Date(prev.ts).toDateString() !== new Date(m.ts).toDateString();
        const grouped = !day && prev && prev.from === m.from && m.ts - prev.ts < 5 * 60 * 1000 && !m.replyTo;
        prev = m;
        return (
          <React.Fragment key={m.id}>
            {day && <div className="ch-day"><span>{fmtDay(m.ts)}</span></div>}
            <Message m={m} mine={m.from === me} me={me} grouped={grouped} fileUrl={fileUrl}
              flash={flash === m.id} tools={toolsFor === m.id} canWrite={canWrite}
              onTap={() => setToolsFor((t) => (t === m.id ? null : m.id))}
              onReply={() => { onReply(m); setToolsFor(null); }}
              onReact={(e) => react(m, e)} onMore={() => setPickFor(m)}
              onGoTo={goTo} onLightbox={openLightbox} onMediaLoad={onMediaLoad}
              onDelete={() => { if (confirm("Eliminare il messaggio per tutti?")) chat.call("chat:delete", { id: m.id }); setToolsFor(null); }}
              onRetry={() => chat.retry(m)} onDiscard={() => chat.discard(m)} />
          </React.Fragment>
        );
      })}
      {newBelow > 0 && <button className="ch-newbelow" onClick={toBottom}>↓ {newBelow} nuov{newBelow > 1 ? "i" : "o"}</button>}
      {pickFor && (
        <div className="ch-pop-overlay" onClick={() => setPickFor(null)}>
          <div className="ch-pop" onClick={(e) => e.stopPropagation()}>
            <EmojiPicker onPick={(e) => { react(pickFor, e); setPickFor(null); }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const Message = memo(function Message({ m, mine, me, grouped, fileUrl, flash, tools, canWrite, onTap, onReply, onReact, onMore,
  onGoTo, onLightbox, onMediaLoad, onDelete, onRetry, onDiscard }) {
  const images = (m.attachments || []).filter((a) => a.kind === "image");
  const docs = (m.attachments || []).filter((a) => a.kind !== "image");
  const src = (a, dl) => a.localUrl || fileUrl(a.id, dl);
  const big = m.text && !m.attachments?.length && !m.gif && [...m.text].length <= 8 && ONLY_EMOJI.test(m.text);
  const copy = async () => {
    try { await navigator.clipboard.writeText(m.text); }
    catch {
      const ta = document.createElement("textarea"); ta.value = m.text; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
    }
  };
  const gallery = (i) => onLightbox({ items: images.map((a) => ({ url: src(a), dl: src(a, true), name: a.name })), i });

  return (
    <div className={`ch-msg ${mine ? "mine" : ""} ${grouped ? "grouped" : ""} ${flash ? "flash" : ""} ${tools ? "show-tools" : ""}`} data-mid={m.id}>
      {!mine && <span className="ch-avaslot">{!grouped && <Avatar uid={m.from} name={m.name} />}</span>}
      <div className="ch-col">
        {!grouped && !mine && <div className="ch-name" style={{ color: `hsl(${hue(m.from)} 65% 72%)` }}>{m.name}</div>}
        <div className={`ch-bubble ${big ? "big" : ""} ${m.deleted ? "deleted" : ""}`} onClick={(e) => { if (!e.target.closest("a,button,img")) onTap(); }}>
          {m.replyTo && (
            <button className="ch-quote" onClick={() => onGoTo(m.replyTo.id)}>
              <b>{m.replyTo.name || "Messaggio"}</b>
              <span>{m.replyTo.deleted ? "Messaggio eliminato" : m.replyTo.text || (m.replyTo.media === "image" ? "📷 Foto" : m.replyTo.media === "gif" ? "GIF" : "📎 Allegato")}</span>
            </button>
          )}
          {m.deleted ? <i>Messaggio eliminato</i> : (
            <>
              {images.length > 0 && (
                <div className={`ch-imgs n${Math.min(images.length, 4)}`}>
                  {images.map((a, i) => (
                    <button key={a.id || i} className="ch-img" onClick={() => gallery(i)} title={a.name}>
                      <img src={src(a)} alt={a.name} loading="lazy" onLoad={onMediaLoad} />
                    </button>
                  ))}
                </div>
              )}
              {m.gif && (
                <div className="ch-gif">
                  <img src={m.gif.url} alt={m.gif.title || "GIF"} loading="lazy" onLoad={onMediaLoad}
                    style={{ aspectRatio: `${m.gif.w} / ${m.gif.h}` }} />
                  <span className="ch-giftag">GIF</span>
                </div>
              )}
              {docs.map((a, i) => (
                <a key={a.id || i} className="ch-file" href={src(a, true)} download={a.name} target="_blank" rel="noopener noreferrer">
                  <span className="ch-ficon">{fileIcon(a)}</span>
                  <span className="ch-fname">{a.name}<small>{(a.name.split(".").pop() || "").toUpperCase()} · {fmtSize(a.size)}</small></span>
                  <span className="ch-fdl">⬇</span>
                </a>
              ))}
              {m.text && <div className="ch-text"><RichText text={m.text} /></div>}
            </>
          )}
          <span className="ch-meta" title={new Date(m.ts).toLocaleString("it-IT")}>
            {fmtTime(m.ts)}
            {mine && (m.status === "sending" ? " 🕓" : m.status === "failed" ? " ⚠" : " ✓")}
          </span>
        </div>
        {m.status === "failed" && (
          <div className="ch-failed">
            {m.error || "Non inviato"} · <button onClick={onRetry}>Riprova</button> · <button onClick={onDiscard}>Elimina</button>
          </div>
        )}
        {m.reactions?.length > 0 && (
          <div className="ch-reacts">
            {m.reactions.map((r) => (
              <button key={r.e} className={r.uids.includes(me) ? "on" : ""} onClick={() => canWrite && onReact(r.e)}>
                {r.e} <b>{r.uids.length}</b>
              </button>
            ))}
          </div>
        )}
      </div>
      {!m.deleted && !m.local && (
        <div className="ch-mtools">
          {canWrite && QUICK_REACTIONS.slice(0, 4).map((e) => <button key={e} onClick={() => onReact(e)}>{e}</button>)}
          {canWrite && <button title="Altre reazioni" onClick={onMore}>＋</button>}
          {canWrite && <button title="Rispondi" onClick={onReply}>↩</button>}
          {m.text && <button title="Copia testo" onClick={copy}>⧉</button>}
          {(images.length > 0 || docs.length > 0) && (
            <a title="Scarica allegati" href={src((images[0] || docs[0]), true)} download>⬇</a>
          )}
          {mine && <button title="Elimina" onClick={onDelete}>🗑</button>}
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Composer: testo, emoji, GIF, allegati (clip, trascina, incolla) e risposta
const Composer = React.forwardRef(function Composer({ conv, chat, info, serverUrl, replyTo, clearReply }, ref) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]);       // { key, file, name, size, kind, url, status, progress, id, error, xhr }
  const [pop, setPop] = useState(null);         // "emoji" | "gif" | null
  const [warn, setWarn] = useState("");
  const taRef = useRef(null);
  const inputRef = useRef(null);
  const gifInputRef = useRef(null);
  const typingOn = useRef(false);
  const typingTimer = useRef(null);
  const filesRef = useRef(files);
  filesRef.current = files;
  const { maxFileMB, maxFiles, maxText, gifSearch } = info.config;

  const patch = (key, p) => setFiles((l) => l.map((f) => (f.key === key ? { ...f, ...p } : f)));

  // caricamento subito alla scelta: si vede l'avanzamento e si può annullare
  const upload = (item) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${serverUrl}/api/chat/upload?t=${info.token}&name=${encodeURIComponent(item.name)}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && patch(item.key, { progress: e.loaded / e.total });
    xhr.onload = () => {
      let body = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* risposta non JSON */ }
      if (xhr.status === 200) patch(item.key, { status: "done", id: body.id, progress: 1, xhr: null });
      else patch(item.key, { status: "error", error: body.error || "Caricamento non riuscito", xhr: null });
    };
    xhr.onerror = () => patch(item.key, { status: "error", error: "Connessione interrotta", xhr: null });
    xhr.send(item.file);
    return xhr;
  };

  const addFiles = (list) => {
    setWarn("");
    const incoming = [...list];
    const room = maxFiles - filesRef.current.length;
    if (incoming.length > room) setWarn(`Massimo ${maxFiles} allegati per messaggio`);
    const items = [];
    for (const file of incoming.slice(0, Math.max(room, 0))) {
      const name = file.name || `immagine-${Date.now()}.png`;
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (![...IMAGE_EXT, ...FILE_EXT].includes(ext)) { setWarn(`«${name}»: formato non ammesso`); continue; }
      if (file.size > maxFileMB * 1048576) { setWarn(`«${name}» supera ${maxFileMB} MB`); continue; }
      const kind = IMAGE_EXT.includes(ext) ? "image" : "file";
      const item = { key: Math.random().toString(36).slice(2), file, name, size: file.size, kind,
        mime: file.type, url: kind === "image" ? URL.createObjectURL(file) : null, status: "uploading", progress: 0 };
      item.xhr = upload(item);
      items.push(item);
    }
    if (items.length) setFiles((l) => [...l, ...items]);
  };
  React.useImperativeHandle(ref, () => ({ addFiles }));

  const removeFile = (f) => {
    f.xhr?.abort();
    if (f.url) URL.revokeObjectURL(f.url);
    setFiles((l) => l.filter((x) => x.key !== f.key));
  };
  // chiusura del composer (cambio conversazione): nessun upload resta appeso
  useEffect(() => () => filesRef.current.forEach((f) => f.xhr?.abort()), []);

  const stopTyping = () => {
    clearTimeout(typingTimer.current);
    if (typingOn.current) { typingOn.current = false; chat.setTypingOn(conv, false); }
  };
  const onChange = (e) => {
    setText(e.target.value);
    if (!typingOn.current) { typingOn.current = true; chat.setTypingOn(conv, true); }
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2500);
  };
  useEffect(() => () => stopTyping(), []); // eslint-disable-line

  // altezza automatica del campo di testo
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [text]);

  const uploading = files.some((f) => f.status === "uploading");
  const ready = files.filter((f) => f.status === "done");
  const canSend = !uploading && (text.trim() || ready.length) && text.length <= maxText;

  const send = () => {
    if (!canSend) return;
    chat.send({
      conv, text, replyTo: replyTo ? { id: replyTo.id, name: replyTo.name, text: replyTo.text, deleted: false } : null,
      attachments: ready.map((f) => f.id),
      localAttachments: ready.map((f) => ({ id: f.id, name: f.name, kind: f.kind, size: f.size, mime: f.mime, localUrl: f.url })),
    });
    // le anteprime locali servono ancora finché il messaggio è in viaggio
    const urls = ready.map((f) => f.url).filter(Boolean);
    setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 60000);
    setFiles((l) => l.filter((f) => f.status !== "done"));
    setText(""); clearReply(); stopTyping(); setPop(null);
    taRef.current?.focus();
  };

  const sendGif = (g) => {
    chat.send({ conv, text: "", gif: g, replyTo: replyTo ? { id: replyTo.id, name: replyTo.name, text: replyTo.text } : null });
    clearReply(); setPop(null);
  };

  const insertEmoji = (e) => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length, end = ta?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + e + text.slice(end);
    setText(next);
    requestAnimationFrame(() => { if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = start + e.length; } });
  };

  const onKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
    if (e.key === "Escape") { setPop(null); clearReply(); }
  };
  // incolla screenshot e immagini dagli appunti
  const onPaste = (e) => {
    const list = [...(e.clipboardData?.items || [])].filter((i) => i.kind === "file").map((i) => i.getAsFile()).filter(Boolean)
      .map((f) => (f.name && f.name !== "image.png" ? f : new File([f], `screenshot-${Date.now()}.png`, { type: f.type })));
    if (list.length) { e.preventDefault(); addFiles(list); }
  };

  return (
    <div className="ch-composer">
      {replyTo && (
        <div className="ch-replybar">
          <span>↩ Rispondi a <b>{replyTo.name}</b>: {replyTo.text || "allegato"}</span>
          <button onClick={clearReply} aria-label="Annulla risposta">✕</button>
        </div>
      )}
      {files.length > 0 && (
        <div className="ch-queue">
          {files.map((f) => (
            <div key={f.key} className={`ch-qitem ${f.status}`} title={f.error || f.name}>
              {f.url ? <img src={f.url} alt="" /> : <span className="ch-qicon">{fileIcon({ name: f.name, mime: f.mime })}</span>}
              <span className="ch-qinfo"><b>{f.name}</b><small>{(f.name.split(".").pop() || "").toUpperCase()} · {fmtSize(f.size)}</small></span>
              {f.status === "uploading" && <span className="ch-prog"><i style={{ width: `${Math.round(f.progress * 100)}%` }} /></span>}
              {f.status === "error" && <span className="ch-qerr">{f.error}</span>}
              <button className="ch-qx" onClick={() => removeFile(f)} title={f.status === "uploading" ? "Annulla caricamento" : "Rimuovi"}>✕</button>
            </div>
          ))}
        </div>
      )}
      {warn && <div className="ch-warn">{warn}</div>}
      {pop && (
        <div className="ch-popbox">
          <div className="ch-poptabs">
            <button className={pop === "emoji" ? "on" : ""} onClick={() => setPop("emoji")}>😊 Emoji</button>
            <button className={pop === "gif" ? "on" : ""} onClick={() => setPop("gif")}>GIF</button>
            <button className="ch-x" onClick={() => setPop(null)}>✕</button>
          </div>
          {pop === "emoji"
            ? <EmojiPicker onPick={insertEmoji} />
            : <GifPanel enabled={gifSearch} serverUrl={serverUrl} token={info.token} onSend={sendGif}
                onLocal={() => gifInputRef.current?.click()} />}
        </div>
      )}
      <div className="ch-inputrow">
        <button className="ch-ib" title="Emoji" onClick={() => setPop((p) => (p === "emoji" ? null : "emoji"))}>😊</button>
        <button className="ch-ib gif" title="GIF" onClick={() => setPop((p) => (p === "gif" ? null : "gif"))}>GIF</button>
        <button className="ch-ib" title="Allega file" onClick={() => inputRef.current?.click()}>📎</button>
        <textarea ref={taRef} rows={1} value={text} onChange={onChange} onKeyDown={onKey} onPaste={onPaste}
          maxLength={maxText} placeholder={conv === "room" ? "Scrivi al tavolo…" : "Messaggio privato…"} />
        <button className="ch-send" disabled={!canSend} onClick={send} title={uploading ? "Attendi la fine del caricamento" : "Invia"}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden><path d="M3 20.5 21 12 3 3.5v6.6l12 1.9-12 1.9z" /></svg>
        </button>
      </div>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      <input ref={gifInputRef} type="file" accept=".gif" hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; setPop(null); }} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// GIF: ricerca online solo se il server ha una chiave configurata; sempre
// possibile caricare una GIF dal proprio dispositivo (diventa un allegato).
function GifPanel({ enabled, serverUrl, token, onSend, onLocal }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState([]);
  const [state, setState] = useState("idle");
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setState("loading");
      try {
        const r = await fetch(`${serverUrl}/api/chat/gifs?t=${token}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setList(j); setState("ok");
      } catch (e) { if (e.name !== "AbortError") setState("error"); }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, enabled, serverUrl, token]);

  const local = <button className="ch-btn wide" onClick={onLocal}>📁 Carica una GIF dal dispositivo</button>;
  if (!enabled) return <div className="ch-gifs off"><p>La ricerca di GIF online non è attiva su questo server.</p>{local}</div>;
  if (chosen) {
    return (
      <div className="ch-gifs">
        <div className="ch-gifprev"><img src={chosen.url} alt={chosen.title} /></div>
        <div className="ch-gifact">
          <button className="ch-btn" onClick={() => setChosen(null)}>← Indietro</button>
          <button className="ch-btn gold" onClick={() => onSend(chosen)}>Invia GIF</button>
        </div>
      </div>
    );
  }
  return (
    <div className="ch-gifs">
      <input className="ep-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca GIF…" />
      <div className="ch-gifgrid">
        {state === "error" && <p>Servizio GIF non raggiungibile.</p>}
        {list.map((g) => (
          <button key={g.id} onClick={() => setChosen(g)} title={g.title}><img src={g.preview} alt={g.title} loading="lazy" /></button>
        ))}
      </div>
      {local}
      <small className="ch-powered">Ricerca via GIPHY</small>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Lightbox({ items, i: start, onClose }) {
  const [i, setI] = useState(start);
  const it = items[i];
  useEffect(() => {
    const k = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, items.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [items.length, onClose]);
  return (
    <div className="ch-lightbox" onClick={onClose}>
      <img src={it.url} alt={it.name} onClick={(e) => e.stopPropagation()} />
      <div className="ch-lbbar" onClick={(e) => e.stopPropagation()}>
        {items.length > 1 && <button disabled={i === 0} onClick={() => setI(i - 1)}>‹</button>}
        <span>{it.name}{items.length > 1 ? ` · ${i + 1}/${items.length}` : ""}</span>
        {items.length > 1 && <button disabled={i === items.length - 1} onClick={() => setI(i + 1)}>›</button>}
        <a href={it.dl} download={it.name}>⬇ Scarica</a>
        <button onClick={onClose}>✕</button>
      </div>
    </div>
  );
}
