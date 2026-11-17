import React, { useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// Grafico di fine partita: andamento del punteggio di ogni giocatore mano per mano.
// Tre viste: "Andamento" (totale progressivo, una linea per giocatore),
// "Per mano" (barre con i punti di ogni singola mano) e "Tabella".
// Colori: uno per posto al tavolo (non per classifica), palette verificata per
// daltonici sul panno verde del gioco.
// ============================================================================
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];
const TEAM = ["BLU", "ROSSA"];

const signed = (v) => (v > 0 ? `+${v}` : `${v}`);

// tacche "tonde" per l'asse y
function ticks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

// barra con l'estremità dei dati arrotondata (4px) e la base piatta sullo zero
function barPath(x, w, y0, y1) {
  const h = Math.abs(y1 - y0);
  if (h < 0.5) return "";
  const r = Math.min(4, w / 2, h);
  if (y1 < y0) { // verso l'alto
    return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`;
  }
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`;
}

export default function ScoreChart({ history, players, teams, gameType }) {
  const view = "line";
  const [hover, setHover] = useState(null);       // indice del punto/mano evidenziato
  const [solo, setSolo] = useState(null);         // giocatore aperto nella finestra singola
  const boxRef = useRef(null);
  const [W, setW] = useState(600);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const n = history.length;
  // totale progressivo: punto 0 = inizio partita (tutti a zero)
  const cum = useMemo(() => players.map((_, i) => {
    let t = 0;
    return [0, ...history.map((h) => (t += h.scores[i]))];
  }), [history, players]);

  if (!n) return null;

  const narrow = W < 480;
  const H = Math.round(Math.min(340, Math.max(230, W * 0.52)));
  const M = { l: 40, r: view === "line" ? (narrow ? 64 : 84) : 10, t: 14, b: 30 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  const values = view === "line" ? cum.flat() : history.flatMap((h) => h.scores);
  const yt = ticks(Math.min(0, ...values), Math.max(0, ...values));
  const y = (v) => M.t + ih - ((v - yt[0]) / (yt[yt.length - 1] - yt[0])) * ih;

  // ---- vista linee ----
  const x = (k) => M.l + (n ? (k / n) * iw : 0);
  // etichette dirette a fine linea, distanziate per non sovrapporsi
  const ends = players.map((p, i) => ({ i, y: y(cum[i][n]), name: p.name })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 14) ends[k].y = ends[k - 1].y + 14;
  const overflow = ends.length ? ends[ends.length - 1].y - (M.t + ih + 4) : 0;
  if (overflow > 0) ends.forEach((e) => (e.y -= overflow));

  // ---- vista barre ----
  const gw = iw / n;
  const bw = Math.max(2, Math.min(14, (gw * 0.82 - 3 * 2) / 4));
  const gx = (k) => M.l + k * gw + (gw - (bw * 4 + 2 * 3)) / 2;

  // area sensibile al puntatore: colonne intere, più grandi dei segni
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const k = view === "line" ? Math.round(((px - M.l) / iw) * n) : Math.floor((px - M.l) / gw);
    const max = view === "line" ? n : n - 1;
    setHover(Math.min(Math.max(k, 0), max));
  };

  // contenuto del riquadro informativo
  const tipIndex = hover;
  let tip = null;
  if (tipIndex != null && view !== "table") {
    const handIdx = view === "line" ? tipIndex - 1 : tipIndex;
    const h = history[handIdx];
    const rows = players.map((p, i) => ({
      i, name: p.name,
      delta: h ? h.scores[i] : null,
      total: cum[i][handIdx + 1] ?? 0,
    })).sort((a, b) => b.total - a.total);
    const colX = view === "line" ? x(tipIndex) : M.l + tipIndex * gw + gw / 2;
    const side = view === "line" ? 10 : gw / 2 + 4;
    const right = colX < W / 2;     // a sinistra del centro: il riquadro va a destra della colonna
    tip = { title: h ? `Mano ${handIdx + 1} · ${h.title}` : "Inizio partita", rows,
      style: right ? { left: colX + side } : { left: colX - side, transform: "translateX(-100%)" } };
  }

  const xLabelEvery = n > 10 && narrow ? 2 : 1;

  return (
    <div className="sc">
      <style>{SC_CSS}</style>
      <div className="sc-head">
        <div className="sc-title">Andamento della partita</div>
      </div>

      <div className="sc-legend">
        {players.map((p, i) => (
          <span key={i} className="sc-key">
            <i style={{ background: SERIES[i] }} />
            {p.name}
            {gameType === "teams" && teams && <em>{TEAM[teams[i]]}</em>}
            <b>{cum[i][n]}</b>
            <button className="sc-open" onClick={() => setSolo(i)} title={`Grafico di ${p.name}`} aria-label={`Apri il grafico di ${p.name}`}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 13 L6 8 L9 10 L14 3" /><path d="M10 3h4v4" />
              </svg>
            </button>
          </span>
        ))}
      </div>

      {solo != null && <PlayerDetail i={solo} history={history} players={players} cum={cum}
        team={gameType === "teams" && teams ? TEAM[teams[solo]] : null} onPick={setSolo} onClose={() => setSolo(null)} />}

      {(
        <div className="sc-plot" ref={boxRef}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
            aria-label={view === "line" ? "Totale progressivo di ogni giocatore dopo ogni mano" : "Punti di ogni giocatore in ogni mano"}
            onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
            {/* griglia e asse y */}
            {yt.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} className={v === 0 ? "sc-zero" : "sc-grid"} />
                <text x={M.l - 8} y={y(v)} dy="0.32em" textAnchor="end" className="sc-ax">{v}</text>
              </g>
            ))}

            {view === "line" ? (
              <>
                {/* asse x: inizio + numero della mano */}
                {cum[0].map((_, k) => (k % xLabelEvery === 0 || k === n) && (
                  <text key={k} x={x(k)} y={H - 10} textAnchor="middle" className={`sc-ax ${hover === k ? "hot" : ""}`}>{k === 0 ? "0" : k}</text>
                ))}
                {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} className="sc-cross" />}
                {players.map((_, i) => (
                  <path key={i} d={cum[i].map((v, k) => `${k ? "L" : "M"}${x(k)},${y(v)}`).join(" ")}
                    fill="none" stroke={SERIES[i]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {players.map((_, i) => cum[i].map((v, k) => (k === n || hover === k) && (
                  <circle key={`${i}-${k}`} cx={x(k)} cy={y(v)} r={hover === k ? 5 : 4} fill={SERIES[i]} className="sc-dot" />
                )))}
                {/* etichette dirette: il nome accanto al punto finale della sua linea */}
                {ends.map((e) => (
                  <g key={e.i}>
                    <text x={W - M.r + 10} y={e.y} dy="0.32em" className="sc-lab">
                      {e.name.length > (narrow ? 7 : 11) ? e.name.slice(0, narrow ? 6 : 10) + "…" : e.name}
                    </text>
                  </g>
                ))}
              </>
            ) : null}
          </svg>

          {tip && (
            <div className="sc-tip" style={tip.style}>
              <div className="sc-tip-t">{tip.title}</div>
              {tip.rows.map((r) => (
                <div key={r.i} className="sc-tip-r">
                  <i style={{ background: SERIES[r.i] }} />
                  <span>{r.name}</span>
                  {r.delta != null && <em className={r.delta < 0 ? "neg" : r.delta > 0 ? "pos" : ""}>{signed(r.delta)}</em>}
                  <b>{r.total}</b>
                </div>
              ))}
            </div>
          )}
          <div className="sc-note">
            Totale dopo ogni mano · tocca o passa sopra per i dettagli · 📈 per il grafico del singolo giocatore
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Finestra grande con il grafico di un solo giocatore: totale progressivo
// (gli altri restano sullo sfondo in grigio, come riferimento) e punti mano per mano.
// ============================================================================
function PlayerDetail({ i, history, players, cum, team, onPick, onClose }) {
  const [hover, setHover] = useState(null);       // indice della mano (-1 = inizio, 0..n-1)
  const boxRef = useRef(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const n = history.length;
  const me = cum[i];
  const pts = history.map((h) => h.scores[i]);
  const total = me[n];
  const rank = 1 + cum.filter((c, j) => j !== i && c[n] > total).length;
  const best = pts.reduce((b, v, k) => (v > pts[b] ? k : b), 0);
  const worst = pts.reduce((b, v, k) => (v < pts[b] ? k : b), 0);
  const color = SERIES[i];

  const narrow = W < 480;
  const M = { l: 40, r: 12, t: 12, b: 26 };
  const iw = W - M.l - M.r;
  const gw = iw / n;

  // grafico 1: totale progressivo
  const H1 = Math.round(Math.min(300, Math.max(190, W * 0.42)));
  const ih1 = H1 - M.t - M.b;
  const all = cum.flat();
  const t1 = ticks(Math.min(0, ...all), Math.max(0, ...all));
  const y1 = (v) => M.t + ih1 - ((v - t1[0]) / (t1[t1.length - 1] - t1[0])) * ih1;
  const x1 = (k) => M.l + (k / n) * iw;

  // grafico 2: punti di ogni mano
  const H2 = Math.round(Math.min(220, Math.max(150, W * 0.3)));
  const ih2 = H2 - M.t - M.b;
  const t2 = ticks(Math.min(0, ...pts), Math.max(0, ...pts), 4);
  const y2 = (v) => M.t + ih2 - ((v - t2[0]) / (t2[t2.length - 1] - t2[0])) * ih2;
  const bw = Math.max(4, Math.min(28, gw * 0.6));

  const every = n > 10 && narrow ? 2 : 1;
  const move = (line) => (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const k = line ? Math.round(((px - M.l) / iw) * n) - 1 : Math.floor((px - M.l) / gw);
    setHover(Math.min(Math.max(k, line ? -1 : 0), n - 1));
  };
  const h = hover != null && hover >= 0 ? history[hover] : null;
  const cls = (v) => (v < 0 ? "neg" : v > 0 ? "pos" : "");

  return (
    <div className="sc-modal" onClick={onClose}>
      <div className="sc-win" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Grafico di ${players[i].name}`}>
        <div className="sc-win-head">
          <span className="sc-win-dot" style={{ background: color }} />
          <div className="sc-win-name">{players[i].name}{team && <em>{team}</em>}</div>
          <button className="sc-x" onClick={onClose} aria-label="Chiudi">✕</button>
        </div>
        <div className="sc-tabs">
          {players.map((p, j) => (
            <button key={j} className={j === i ? "on" : ""} onClick={() => { onPick(j); setHover(null); }}>
              <i style={{ background: SERIES[j] }} />{p.name}
            </button>
          ))}
        </div>

        <div className="sc-stats">
          <div><small>Totale</small><b>{signed(total)}</b></div>
          <div><small>Posizione</small><b>{rank}°</b></div>
          <div><small>Mano migliore</small><b>{signed(pts[best])}</b><span>{best + 1} · {history[best].title}</span></div>
          <div><small>Mano peggiore</small><b>{signed(pts[worst])}</b><span>{worst + 1} · {history[worst].title}</span></div>
          <div><small>Massimo / minimo</small><b>{Math.max(...me)} / {Math.min(...me)}</b></div>
        </div>

        <div className="sc-win-sub">Totale dopo ogni mano <span>· in grigio gli altri giocatori</span></div>
        <div className="sc-plot" ref={boxRef}>
          <svg width={W} height={H1} viewBox={`0 0 ${W} ${H1}`} role="img" aria-label={`Totale progressivo di ${players[i].name}`}
            onPointerMove={move(true)} onPointerDown={move(true)} onPointerLeave={() => setHover(null)}>
            {t1.map((v) => (
              <g key={v}>
                <line x1={M.l} x2={W - M.r} y1={y1(v)} y2={y1(v)} className={v === 0 ? "sc-zero" : "sc-grid"} />
                <text x={M.l - 8} y={y1(v)} dy="0.32em" textAnchor="end" className="sc-ax">{v}</text>
              </g>
            ))}
            {me.map((_, k) => (k % every === 0 || k === n) && (
              <text key={k} x={x1(k)} y={H1 - 8} textAnchor="middle" className={`sc-ax ${hover === k - 1 ? "hot" : ""}`}>{k}</text>
            ))}
            {hover != null && <line x1={x1(hover + 1)} x2={x1(hover + 1)} y1={M.t} y2={M.t + ih1} className="sc-cross" />}
            {cum.map((c, j) => j !== i && (
              <path key={j} d={c.map((v, k) => `${k ? "L" : "M"}${x1(k)},${y1(v)}`).join(" ")}
                fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="1.5" strokeLinejoin="round" />
            ))}
            <path d={me.map((v, k) => `${k ? "L" : "M"}${x1(k)},${y1(v)}`).join(" ")}
              fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {me.map((v, k) => (
              <circle key={k} cx={x1(k)} cy={y1(v)} r={hover === k - 1 ? 5.5 : 3.5} fill={color} className="sc-dot" />
            ))}
          </svg>
        </div>

        <div className="sc-win-info">
          {h ? (
            <><b>Mano {hover + 1} · {h.title}</b>
              <span className={cls(pts[hover])}>{signed(pts[hover])}</span>
              <span>totale {me[hover + 1]}</span></>
          ) : hover === -1 ? <b>Inizio partita · 0</b> : <span>Tocca o passa sopra a una mano per i dettagli</span>}
        </div>
      </div>
    </div>
  );
}

const SC_CSS = `
.sc { --sc-text:#eef3ee; --sc-muted:#a9bdb1; --sc-surface:#0d3524; --sc-line:rgba(255,255,255,.08);
  margin:18px 0 18px; padding:14px 14px 10px; border-radius:16px; text-align:left;
  background:rgba(0,0,0,.22); border:1px solid rgba(217,178,95,.22); }
.sc-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
.sc-title { font-family:'Cormorant Garamond',serif; font-size:22px; color:var(--gold); }
.sc-seg { display:flex; padding:2px; border-radius:10px; background:rgba(0,0,0,.3); }
.sc-seg button { border:none; background:none; color:var(--sc-muted); font:600 12.5px 'Outfit',sans-serif; padding:6px 11px; border-radius:8px; }
.sc-seg button.on { background:rgba(217,178,95,.18); color:var(--gold); }
.sc-legend { display:flex; flex-wrap:wrap; gap:6px 14px; margin-bottom:8px; }
.sc-key { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--sc-text); }
.sc-key i { width:10px; height:10px; border-radius:3px; flex:none; }
.sc-key em { font-style:normal; font-size:10px; font-weight:700; letter-spacing:.06em; color:var(--sc-muted); }
.sc-key b { font-weight:700; color:var(--sc-text); }
.sc-plot { position:relative; }
.sc-open { display:inline-grid; place-items:center; width:24px; height:24px; padding:0; border-radius:7px; cursor:pointer;
  border:1px solid rgba(217,178,95,.35); background:rgba(217,178,95,.1); color:var(--gold); }
.sc-open:hover { background:rgba(217,178,95,.25); }
.sc-modal { position:fixed; inset:0; z-index:9000; display:grid; place-items:center; padding:16px;
  background:rgba(0,0,0,.6); backdrop-filter:blur(3px); animation:scFade .15s ease; }
@keyframes scFade { from { opacity:0 } }
.sc-win { --sc-text:#eef3ee; --sc-muted:#a9bdb1; --sc-surface:#0d3524; --sc-line:rgba(255,255,255,.08);
  width:min(860px,100%); max-height:calc(100dvh - 32px); overflow-y:auto; text-align:left;
  padding:16px clamp(12px,3vw,22px) 14px; border-radius:18px; background:#0d3524;
  border:1px solid rgba(217,178,95,.4); box-shadow:0 24px 60px rgba(0,0,0,.6); }
.sc-win-head { display:flex; align-items:center; gap:10px; }
.sc-win-dot { width:14px; height:14px; border-radius:4px; flex:none; }
.sc-win-name { flex:1; font-family:'Cormorant Garamond',serif; font-size:26px; color:var(--gold); line-height:1.1; }
.sc-win-name em { font:700 11px 'Outfit',sans-serif; letter-spacing:.06em; color:var(--sc-muted); margin-left:8px; font-style:normal; }
.sc-x { width:34px; height:34px; border-radius:10px; border:1px solid rgba(255,255,255,.15); background:rgba(0,0,0,.25); color:var(--sc-text); font-size:15px; cursor:pointer; }
.sc-tabs { display:flex; flex-wrap:wrap; gap:6px; margin:10px 0 12px; }
.sc-tabs button { display:inline-flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; cursor:pointer;
  border:1px solid rgba(255,255,255,.12); background:rgba(0,0,0,.2); color:var(--sc-muted); font:600 12.5px 'Outfit',sans-serif; }
.sc-tabs button.on { color:var(--sc-text); border-color:rgba(217,178,95,.5); background:rgba(217,178,95,.14); }
.sc-tabs i { width:9px; height:9px; border-radius:3px; }
.sc-stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(118px,1fr)); gap:8px; margin-bottom:12px; }
.sc-stats > div { padding:8px 10px; border-radius:12px; background:rgba(0,0,0,.22); border:1px solid rgba(255,255,255,.06); min-width:0; }
.sc-stats small { display:block; font-size:10.5px; color:var(--sc-muted); text-transform:uppercase; letter-spacing:.05em; }
.sc-stats b { display:block; font-size:20px; color:var(--sc-text); }
.sc-stats span { display:block; font-size:11px; color:var(--sc-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sc-win-sub { font-size:12px; font-weight:600; color:var(--sc-text); margin:6px 0 2px; }
.sc-win-sub span { font-weight:500; color:var(--sc-muted); }
.sc-win-info { display:flex; flex-wrap:wrap; gap:6px 14px; align-items:baseline; min-height:22px; margin-top:8px; font-size:13px; color:var(--sc-muted); }
.sc-win-info b { color:var(--sc-text); }
.sc-win-info .pos { color:#9fe0a8; font-weight:700; } .sc-win-info .neg { color:#ff9d8a; font-weight:700; }
.sc-plot svg { display:block; touch-action:pan-y; }
.sc-grid { stroke:var(--sc-line); stroke-width:1; }
.sc-zero { stroke:rgba(255,255,255,.32); stroke-width:1; }
.sc-ax { fill:var(--sc-muted); font:500 11px 'Outfit',sans-serif; }
.sc-ax.hot { fill:var(--sc-text); font-weight:700; }
.sc-lab { fill:var(--sc-text); font:600 12px 'Outfit',sans-serif; }
.sc-cross { stroke:rgba(255,255,255,.35); stroke-width:1; stroke-dasharray:3 3; }
.sc-dot { stroke:var(--sc-surface); stroke-width:2; }
.sc-band { fill:rgba(255,255,255,.05); }
.sc-tip { position:absolute; top:6px; pointer-events:none; min-width:170px; z-index:2;
  padding:8px 10px; border-radius:12px; background:rgba(8,24,16,.94); border:1px solid rgba(217,178,95,.35);
  box-shadow:0 10px 26px rgba(0,0,0,.5); }
.sc-tip-t { font-size:12px; font-weight:700; color:var(--gold); margin-bottom:5px; white-space:nowrap; }
.sc-tip-r { display:flex; align-items:center; gap:7px; font-size:12.5px; color:var(--sc-text); padding:1px 0; }
.sc-tip-r i { width:9px; height:9px; border-radius:50%; flex:none; }
.sc-tip-r span { flex:1; white-space:nowrap; }
.sc-tip-r em { font-style:normal; font-size:11.5px; color:var(--sc-muted); min-width:28px; text-align:right; }
.sc-tip-r b { min-width:30px; text-align:right; }
.sc-tip-r em.pos, .sc-table td.pos { color:#9fe0a8; }
.sc-tip-r em.neg, .sc-table td.neg { color:#ff9d8a; }
.sc-note { font-size:11px; color:var(--sc-muted); margin-top:4px; }
.sc-tablewrap { overflow-x:auto; }
.sc-table { width:100%; border-collapse:collapse; font-size:12.5px; color:var(--sc-text); }
.sc-table th { font-size:11px; font-weight:600; color:var(--sc-muted); text-align:right; padding:6px; white-space:nowrap; }
.sc-table th:first-child, .sc-table td:first-child { text-align:left; }
.sc-table th i { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; }
.sc-table td { padding:6px; text-align:right; border-top:1px solid var(--sc-line); white-space:nowrap; }
.sc-table td.zero { color:var(--sc-muted); }
.sc-table td small { display:block; font-size:10px; color:var(--sc-muted); }
.sc-table tfoot td { border-top:1px solid rgba(217,178,95,.35); font-size:13.5px; }
.sc-n { display:inline-grid; place-items:center; width:18px; height:18px; border-radius:50%; margin-right:6px; font-size:10px;
  background:rgba(255,255,255,.08); color:var(--sc-muted); }
`;
