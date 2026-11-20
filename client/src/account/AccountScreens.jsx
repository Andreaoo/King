import React, { useEffect, useMemo, useState } from "react";
import { supabase, setRemember, getRemember, authError, getGuest } from "./supabase.js";

const USERNAME_RE = /^[A-Za-z0-9_.]{3,24}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const fmtDate = (d) => new Date(d).toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" });
const fmtShort = (d) => new Date(d).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtDur = (s) => (s == null ? "—" : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.max(1, Math.round(s / 60))} min`);

/* ===================== ACCESSO / REGISTRAZIONE / RECUPERO ===================== */
// mode: "login" | "register" | "forgot" | "newpw"
export function AuthForms({ mode, setMode, invite, onDone, onBack }) {
  const [f, setF] = useState({ email: "", password: "", password2: "", username: "", nickname: "", remember: getRemember() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  useEffect(() => { setErr(""); setInfo(""); }, [mode]);
  // dopo la conferma via email si torna all'invito (se c'era), così si entra subito nella stanza
  const back = `${window.location.origin}${invite ? `/invite/${invite}` : "/"}`;

  async function submit(e) {
    e.preventDefault();
    setErr(""); setInfo("");
    const email = f.email.trim().toLowerCase();
    try {
      if (mode === "login") {
        if (!EMAIL_RE.test(email) || !f.password) return setErr("Inserisci email e password.");
        setBusy(true);
        setRemember(f.remember);
        const { error } = await supabase.auth.signInWithPassword({ email, password: f.password });
        if (error) return setErr(authError(error));
        onDone?.("login");
      } else if (mode === "register") {
        if (!USERNAME_RE.test(f.username)) return setErr("Nome utente: 3–24 caratteri, solo lettere, numeri, punto e trattino basso.");
        if (!f.nickname.trim()) return setErr("Scegli il nickname che vedranno gli altri giocatori.");
        if (!EMAIL_RE.test(email)) return setErr("Indirizzo email non valido.");
        if (f.password.length < 8) return setErr("La password deve avere almeno 8 caratteri.");
        if (f.password !== f.password2) return setErr("Le due password non coincidono.");
        setBusy(true);
        setRemember(true);
        const { data, error } = await supabase.auth.signUp({
          email, password: f.password,
          options: { data: { username: f.username, nickname: f.nickname.trim().slice(0, 14) }, emailRedirectTo: back },
        });
        if (error) return setErr(authError(error));
        // Supabase non rivela se l'email esiste già: in quel caso non c'è nessuna identità nuova
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
          return setErr("Esiste già un account con questa email. Prova ad accedere.");
        if (data.session) return onDone?.("register");
        setInfo(`Ti abbiamo mandato un’email a ${email}. Tocca il link di conferma per attivare l’account`
          + (invite ? ": dopo la conferma entrerai direttamente nella stanza del tuo amico." : "."));
      } else if (mode === "forgot") {
        if (!EMAIL_RE.test(email)) return setErr("Inserisci l’email del tuo account.");
        setBusy(true);
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` });
        if (error) return setErr(authError(error));
        setInfo("Se l’email corrisponde a un account, riceverai un link per scegliere una nuova password.");
      } else if (mode === "newpw") {
        if (f.password.length < 8) return setErr("La password deve avere almeno 8 caratteri.");
        if (f.password !== f.password2) return setErr("Le due password non coincidono.");
        setBusy(true);
        const { error } = await supabase.auth.updateUser({ password: f.password });
        if (error) return setErr(authError(error));
        onDone?.("newpw");
      }
    } catch (x) { setErr(authError(x)); }
    finally { setBusy(false); }
  }

  const titles = { login: "Accedi", register: "Registrati", forgot: "Recupera password", newpw: "Nuova password" };
  return (
    <form className="acc-form" onSubmit={submit} noValidate>
      <div className="acc-title">{titles[mode]}</div>
      {mode === "register" && (
        <>
          <label className="field">Nome utente
            <input value={f.username} onChange={set("username")} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} placeholder="es. mario_rossi" />
          </label>
          <label className="field">Nickname (visibile in partita)
            <input value={f.nickname} onChange={set("nickname")} maxLength={14} autoComplete="nickname" placeholder="es. Mario" />
          </label>
        </>
      )}
      {mode !== "newpw" && (
        <label className="field">Email
          <input type="email" value={f.email} onChange={set("email")} autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false} />
        </label>
      )}
      {mode !== "forgot" && (
        <label className="field">{mode === "newpw" ? "Nuova password" : "Password"}
          <input type="password" value={f.password} onChange={set("password")} autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </label>
      )}
      {(mode === "register" || mode === "newpw") && (
        <label className="field">Conferma password
          <input type="password" value={f.password2} onChange={set("password2")} autoComplete="new-password" />
        </label>
      )}
      {mode === "login" && (
        <label className="acc-check">
          <input type="checkbox" checked={f.remember} onChange={set("remember")} />
          <span>Ricordami su questo dispositivo</span>
        </label>
      )}
      {err && <p className="err" role="alert">{err}</p>}
      {info && <p className="acc-info" role="status">{info}</p>}
      {!info && (
        <button className="btn primary wide" type="submit" disabled={busy}>
          {busy ? "Attendere…" : mode === "login" ? "ACCEDI" : mode === "register" ? "CREA ACCOUNT" : mode === "forgot" ? "INVIA LINK" : "SALVA PASSWORD"}
        </button>
      )}
      <div className="acc-links">
        {mode === "login" && <>
          <button type="button" onClick={() => setMode("forgot")}>Password dimenticata?</button>
          <button type="button" onClick={() => setMode("register")}>Non hai un account? <b>Registrati</b></button>
        </>}
        {mode === "register" && <button type="button" onClick={() => setMode("login")}>Hai già un account? <b>Accedi</b></button>}
        {mode === "forgot" && <button type="button" onClick={() => setMode("login")}>← Torna all’accesso</button>}
        {mode !== "newpw" && onBack && <button type="button" onClick={onBack}>← Indietro</button>}
      </div>
    </form>
  );
}

/* ===================== PROFILO ===================== */
export function ProfileScreen({ account, onBack, onStats, onLoggedOut, serverUrl }) {
  const { user, profile } = account;
  const [nick, setNick] = useState(profile?.nickname || "");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [pw, setPw] = useState(null);       // null | { a, b }
  const [busy, setBusy] = useState(false);
  useEffect(() => setNick(profile?.nickname || ""), [profile?.nickname]);
  const flash = (m) => { setMsg(m); setErr(""); setTimeout(() => setMsg(""), 2500); };

  async function saveNick() {
    const v = nick.trim().slice(0, 14);
    if (!v) return setErr("Il nickname non può essere vuoto.");
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ nickname: v }).eq("id", user.id);
    setBusy(false);
    if (error) return setErr(authError(error));
    account.setProfile((p) => ({ ...p, nickname: v }));
    flash("Nickname salvato.");
  }
  async function savePw() {
    if (pw.a.length < 8) return setErr("La password deve avere almeno 8 caratteri.");
    if (pw.a !== pw.b) return setErr("Le due password non coincidono.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setBusy(false);
    if (error) return setErr(authError(error));
    setPw(null); flash("Password cambiata.");
  }
  async function logout() {
    if (!confirm("Vuoi uscire dall’account? Le tue statistiche restano salvate.")) return;
    await supabase.auth.signOut({ scope: "local" });
    onLoggedOut?.();
  }
  async function del() {
    const v = prompt("Eliminare l’account è definitivo: profilo e statistiche verranno cancellati.\nScrivi ELIMINA per confermare.");
    if (v !== "ELIMINA") return;
    setBusy(true);
    try {
      const r = await fetch(`${serverUrl}/api/account/delete`, { method: "POST", headers: { Authorization: `Bearer ${account.accessToken}` } }).then((x) => x.json());
      if (!r.ok) { setBusy(false); return setErr(r.error || "Eliminazione non riuscita."); }
      await supabase.auth.signOut({ scope: "local" });
      onLoggedOut?.("deleted");
    } catch { setBusy(false); setErr("Server non raggiungibile. Riprova."); }
  }

  return (
    <div className="acc-page">
      <button className="link-back" onClick={onBack}>← Indietro</button>
      <div className="acc-head">
        <Avatar name={profile?.nickname} big />
        <div className="acc-who"><b>{profile?.nickname}</b>{profile?.username && <span>@{profile.username}</span>}</div>
      </div>
      <div className="acc-card">
        <label className="field">Nickname
          <div className="acc-inline">
            <input value={nick} maxLength={14} onChange={(e) => setNick(e.target.value)} />
            <button className="btn ghost" disabled={busy || nick.trim() === profile?.nickname} onClick={saveNick}>MODIFICA</button>
          </div>
        </label>
        <div className="acc-row"><span>Email</span><b>{user?.email}</b></div>
        <div className="acc-row"><span>Registrato il</span><b>{profile?.created_at ? fmtDate(profile.created_at) : "—"}</b></div>
      </div>
      {msg && <p className="acc-info">{msg}</p>}
      {err && <p className="err" role="alert">{err}</p>}
      <button className="btn primary wide" onClick={onStats}>📊 STATISTICHE</button>
      {pw ? (
        <div className="acc-card">
          <label className="field">Nuova password<input type="password" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></label>
          <label className="field">Conferma password<input type="password" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></label>
          <div className="acc-inline"><button className="btn primary" disabled={busy} onClick={savePw}>SALVA</button><button className="btn ghost" onClick={() => setPw(null)}>Annulla</button></div>
        </div>
      ) : <button className="btn ghost wide" onClick={() => setPw({ a: "", b: "" })}>🔑 CAMBIA PASSWORD</button>}
      <button className="btn ghost wide" onClick={logout}>ESCI DALL’ACCOUNT</button>
      <button className="btn danger-ghost wide" disabled={busy} onClick={del}>ELIMINA ACCOUNT</button>
    </div>
  );
}

export function Avatar({ name, big }) {
  const ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return <span className={`acc-avatar ${big ? "big" : ""}`} aria-hidden>{ch}</span>;
}

/* ===================== STATISTICHE E STORICO ===================== */
// righe: partite con tutti i giocatori; "io" = riga con user_id (account) o me=true (ospite)
export function computeStats(games, isMe) {
  const mine = games.map((g) => ({ g, me: g.game_players.find(isMe) })).filter((x) => x.me);
  const played = mine.filter((x) => x.me.result !== "abandoned" && x.g.completed);
  const wins = mine.filter((x) => x.me.result === "win").length;
  const pos = [1, 2, 3, 4].map((k) => played.filter((x) => x.me.position === k).length);
  return {
    total: mine.length, wins, losses: mine.filter((x) => x.me.result === "loss").length,
    completed: mine.filter((x) => x.g.completed).length,
    abandoned: mine.filter((x) => x.me.result === "abandoned").length,
    winPct: played.length ? Math.round((wins / played.length) * 1000) / 10 : null,
    avgPos: played.length ? Math.round((played.reduce((s, x) => s + x.me.position, 0) / played.length) * 100) / 100 : null,
    bestPos: played.length ? Math.min(...played.map((x) => x.me.position)) : null,
    pos, mine,
  };
}

export function StatsScreen({ account, serverUrl, onBack }) {
  const [games, setGames] = useState(null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(null);
  const uid = account.user?.id;
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (uid) {
          const { data, error } = await supabase.from("games").select("*, game_players(*)").order("ended_at", { ascending: false }).limit(200);
          if (error) throw error;
          alive && setGames(data || []);
        } else {
          const r = await fetch(`${serverUrl}/api/guest/history`, { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ guest: getGuest() }) }).then((x) => x.json());
          if (!r.ok) throw new Error(r.error);
          alive && setGames(r.games || []);
        }
      } catch (e) { alive && setErr(authError(e)); }
    })();
    return () => { alive = false; };
  }, [uid, serverUrl]);
  const isMe = useMemo(() => (uid ? (p) => p.user_id === uid : (p) => p.me), [uid]);
  const st = useMemo(() => (games ? computeStats(games, isMe) : null), [games, isMe]);

  return (
    <div className="acc-page wide">
      <button className="link-back" onClick={onBack}>← Indietro</button>
      <div className="acc-title big">📊 Statistiche</div>
      {!uid && <p className="acc-note">Statistiche da ospite, legate a questo dispositivo. Registrati per conservarle per sempre: verranno trasferite al tuo account.</p>}
      {err && <p className="err">{err}</p>}
      {!games && !err && <div className="acc-card center"><div className="conn-spinner small" /> Caricamento…</div>}
      {st && st.total === 0 && <div className="acc-card center">Nessuna partita conclusa per ora. Gioca una partita completa e i risultati compariranno qui.</div>}
      {st && st.total > 0 && (
        <>
          <div className="st-grid">
            <Tile n={st.total} l="Partite giocate" />
            <Tile n={st.wins} l="Vittorie" />
            <Tile n={st.losses} l="Sconfitte" />
            <Tile n={st.winPct == null ? "—" : `${st.winPct}%`} l="Vittorie %" gold />
            <Tile n={st.completed} l="Terminate" />
            <Tile n={st.abandoned} l="Abbandonate" />
            <Tile n={st.avgPos ?? "—"} l="Posizione media" />
            <Tile n={st.bestPos ? `${st.bestPos}°` : "—"} l="Miglior posizione" />
          </div>
          <div className="acc-card">
            <div className="st-h">Posizioni ottenute</div>
            <PosBars pos={st.pos} />
          </div>
          <div className="acc-card">
            <div className="st-h">Andamento (ultime partite)</div>
            <Trend mine={st.mine} />
          </div>
          <div className="st-h out">Storico partite</div>
          <ul className="hist">
            {st.mine.map(({ g, me }) => (
              <li key={g.id}>
                <button className="hist-row" onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
                  <span className={`hist-res ${me.result}`}>{me.result === "win" ? "V" : me.result === "loss" ? "S" : "A"}</span>
                  <span className="hist-main">
                    <b>{me.result === "win" ? "Vittoria" : me.result === "loss" ? "Sconfitta" : "Abbandonata"} · {me.position}° posto · {me.final_score} pt</b>
                    <small>{fmtShort(g.ended_at)} · contro {g.game_players.filter((p) => p !== me).map((p) => p.nickname + (p.is_bot ? " 🤖" : "")).join(", ")}</small>
                  </span>
                  <span className="hist-chev">{open === g.id ? "▴" : "▾"}</span>
                </button>
                {open === g.id && (
                  <div className="hist-det">
                    <div className="hist-meta">{fmtDate(g.ended_at)} · {g.game_type === "teams" ? "A coppie" : "Classica"} · {g.hands_played} mani · durata {fmtDur(g.duration_s)}</div>
                    <table>
                      <thead><tr><th>Pos.</th><th>Giocatore</th><th>Punti</th><th>Fortuna</th></tr></thead>
                      <tbody>{[...g.game_players].sort((a, b) => a.position - b.position || b.final_score - a.final_score).map((p) => (
                        <tr key={p.seat} className={p === me ? "me" : ""}>
                          <td>{p.position}°</td><td>{p.nickname}{p.is_bot ? " 🤖" : ""}{p.team != null ? <i> · {p.team === 0 ? "Blu" : "Rossa"}</i> : null}</td>
                          <td>{p.final_score}</td><td>{p.luck_avg ?? "—"}</td>
                        </tr>))}</tbody>
                    </table>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Tile({ n, l, gold }) {
  return <div className={`st-tile ${gold ? "gold" : ""}`}><b>{n}</b><span>{l}</span></div>;
}

// distribuzione delle posizioni: barre orizzontali con etichetta diretta
function PosBars({ pos }) {
  const max = Math.max(1, ...pos);
  const tot = pos.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="pos-bars">
      {pos.map((v, i) => (
        <div className="pos-row" key={i} title={`${i + 1}° posto: ${v} partite`}>
          <span className="pos-l">{i + 1}°</span>
          <span className="pos-track"><i style={{ width: `${(v / max) * 100}%` }} className={i === 0 ? "first" : ""} /></span>
          <span className="pos-v">{v} <small>({Math.round((v / tot) * 100)}%)</small></span>
        </div>
      ))}
    </div>
  );
}

// andamento: posizione partita per partita (1° in alto) sulle ultime 20 partite concluse
function Trend({ mine }) {
  const pts = mine.filter((x) => x.me.result !== "abandoned").slice(0, 20).reverse();
  const [hover, setHover] = useState(null);
  if (pts.length < 2) return <p className="acc-note">Servono almeno due partite concluse per il grafico.</p>;
  const W = 320, H = 130, L = 26, R = 10, T = 10, B = 22;
  const x = (i) => L + (i * (W - L - R)) / (pts.length - 1);
  const y = (p) => T + ((p - 1) * (H - T - B)) / 3;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.me.position).toFixed(1)}`).join(" ");
  const h = hover != null ? pts[hover] : null;
  return (
    <div className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Posizione nelle ultime partite"
        onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4].map((k) => (
          <g key={k}><line x1={L} x2={W - R} y1={y(k)} y2={y(k)} className="tr-grid" /><text x={L - 6} y={y(k) + 4} className="tr-ax">{k}°</text></g>
        ))}
        <path d={d} className="tr-line" />
        {pts.map((p, i) => (
          <g key={p.g.id} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
            <circle cx={x(i)} cy={y(p.me.position)} r="10" fill="transparent" />
            <circle cx={x(i)} cy={y(p.me.position)} r={hover === i ? 5 : 3.5} className={`tr-dot ${p.me.result}`} />
          </g>
        ))}
        <text x={L} y={H - 4} className="tr-ax start">meno recente</text>
        <text x={W - R} y={H - 4} className="tr-ax end">più recente</text>
      </svg>
      <div className="tr-info">{h ? `${fmtShort(h.g.ended_at)} · ${h.me.position}° posto · ${h.me.final_score} punti` : "Tocca un punto per i dettagli"}</div>
    </div>
  );
}

export const ACCOUNT_CSS = `
.acc-form { display:flex; flex-direction:column; }
.acc-title { font-size:12px; font-weight:700; letter-spacing:.16em; color:var(--gold); margin:0 0 12px; text-transform:uppercase; }
.acc-title.big { font-size:20px; letter-spacing:.04em; text-transform:none; text-align:center; margin:4px 0 12px; }
.acc-check { display:flex; align-items:center; gap:10px; font-size:14px; margin:2px 0 14px; cursor:pointer; }
.acc-check input { width:20px; height:20px; accent-color:var(--gold); }
.acc-info { margin:0 0 12px; padding:10px 12px; border-radius:10px; background:rgba(76,210,126,.12); border:1px solid rgba(76,210,126,.4); font-size:13.5px; line-height:1.45; }
.acc-note { font-size:12.5px; color:#cfe0d4; line-height:1.45; margin:0 0 12px; text-align:center; }
.acc-links { display:flex; flex-direction:column; align-items:center; gap:4px; margin-top:12px; }
.acc-links button { background:none; border:none; color:#cfe0d4; font-size:13.5px; padding:6px; -webkit-appearance:none; }
.acc-links b { color:var(--gold); }
.entry-btns { display:grid; gap:10px; }
.entry-btns .btn { width:100%; }
.acc-bar { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
.acc-bar .acc-who { flex:1; min-width:0; }
.acc-avatar { width:38px; height:38px; flex:none; border-radius:50%; display:grid; place-items:center; font-weight:800; font-size:17px;
  background:linear-gradient(160deg,#e8c675,#a8822f); color:#1b1206; box-shadow:0 0 0 2px rgba(0,0,0,.3); }
.acc-avatar.big { width:64px; height:64px; font-size:28px; }
.acc-who { display:flex; flex-direction:column; min-width:0; }
.acc-who b { font-size:17px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-who span { font-size:12.5px; color:#cfe0d4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acc-menu { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px; }
.acc-menu .btn { padding:12px 8px; font-size:13.5px; }
.acc-page { width:min(460px,100%); margin:0 auto; padding:calc(14px + var(--sat)) 16px calc(90px + var(--sab)); display:flex; flex-direction:column; gap:10px; }
.acc-page.wide { width:min(620px,100%); }
.acc-head { display:flex; align-items:center; gap:14px; margin:4px 0 6px; }
.acc-card { padding:14px; border-radius:14px; background:rgba(0,0,0,.22); border:1px solid rgba(217,178,95,.28); }
.acc-card.center { text-align:center; display:flex; gap:10px; align-items:center; justify-content:center; font-size:14px; line-height:1.45; }
.acc-card .field:last-child { margin-bottom:0; }
.acc-inline { display:flex; gap:8px; margin-top:6px; }
.acc-inline input { flex:1; margin-top:0 !important; }
.acc-inline .btn { padding:10px 14px; font-size:13px; flex:none; }
.acc-row { display:flex; justify-content:space-between; gap:10px; padding:9px 0; border-top:1px solid rgba(255,255,255,.08); font-size:14px; }
.acc-row span { color:#cfe0d4; } .acc-row b { font-weight:600; overflow:hidden; text-overflow:ellipsis; }
.st-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
@media (min-width:560px) { .st-grid { grid-template-columns:repeat(4,1fr); } }
.st-tile { padding:12px 10px; border-radius:12px; background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.1); text-align:center; }
.st-tile b { display:block; font-size:24px; font-variant-numeric:tabular-nums; }
.st-tile span { font-size:11.5px; color:#cfe0d4; }
.st-tile.gold { border-color:rgba(217,178,95,.5); background:rgba(217,178,95,.1); } .st-tile.gold b { color:var(--gold); }
.st-h { font-size:11px; font-weight:700; letter-spacing:.14em; color:#cfe0d4; text-transform:uppercase; margin-bottom:10px; }
.st-h.out { margin:8px 0 0; }
.pos-bars { display:grid; gap:8px; }
.pos-row { display:grid; grid-template-columns:28px 1fr 76px; align-items:center; gap:8px; font-size:13px; }
.pos-l { font-weight:700; }
.pos-track { height:12px; border-radius:6px; background:rgba(255,255,255,.07); overflow:hidden; }
.pos-track i { display:block; height:100%; border-radius:6px; background:rgba(217,178,95,.55); min-width:2px; }
.pos-track i.first { background:var(--gold); }
.pos-v { text-align:right; font-variant-numeric:tabular-nums; } .pos-v small { color:#cfe0d4; }
.trend svg { width:100%; height:auto; display:block; overflow:visible; }
.tr-grid { stroke:rgba(255,255,255,.09); stroke-width:1; }
.tr-ax { fill:#cfe0d4; font-size:10px; text-anchor:end; } .tr-ax.start { text-anchor:start; } .tr-ax.end { text-anchor:end; }
.tr-line { fill:none; stroke:var(--gold); stroke-width:2; stroke-linejoin:round; }
.tr-dot { fill:var(--gold); stroke:#0d3b25; stroke-width:2; } .tr-dot.loss { fill:#cfe0d4; }
.tr-info { font-size:12px; color:#cfe0d4; text-align:center; margin-top:4px; min-height:16px; }
.hist { list-style:none; margin:0; padding:0; display:grid; gap:6px; }
.hist-row { width:100%; display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:12px; text-align:left;
  background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.1); color:var(--paper); -webkit-appearance:none; }
.hist-res { width:28px; height:28px; flex:none; border-radius:8px; display:grid; place-items:center; font-weight:800; font-size:13px; }
.hist-res.win { background:var(--gold); color:#1b1206; } .hist-res.loss { background:rgba(255,255,255,.12); } .hist-res.abandoned { background:rgba(192,57,43,.35); }
.hist-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.hist-main b { font-size:14px; font-weight:600; }
.hist-main small { font-size:12px; color:#cfe0d4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.hist-chev { color:#cfe0d4; }
.hist-det { padding:10px 12px 12px; margin-top:-4px; border-radius:0 0 12px 12px; background:rgba(0,0,0,.18); font-size:13px; }
.hist-meta { color:#cfe0d4; font-size:12px; margin-bottom:8px; }
.hist-det table { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.hist-det th { text-align:left; font-size:11px; color:#cfe0d4; font-weight:600; padding:4px; }
.hist-det td { padding:6px 4px; border-top:1px solid rgba(255,255,255,.07); }
.hist-det tr.me td { color:var(--gold); font-weight:700; }
.hist-det i { color:#cfe0d4; font-style:normal; font-size:11px; }
`;
