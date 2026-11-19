import React, { useMemo, useState } from "react";

// Classifica della fortuna a fine partita: per ogni giocatore la media degli indici
// (0–100) delle mani giocate. L'indice di ogni mano lo calcola il server a carte
// appena distribuite (o appena scelta la briscola): misura le carte ricevute, non il gioco.
export function luckLabel(v) {
  if (v <= 20) return "estremamente sfortunato";
  if (v <= 40) return "poco fortunato";
  if (v <= 60) return "fortuna nella media";
  if (v <= 80) return "fortunato";
  return "estremamente fortunato";
}

export default function LuckBoard({ history, players }) {
  const [info, setInfo] = useState(false);
  const rows = useMemo(() => {
    const r = players.map((p, i) => {
      const v = history.map((h) => h.luck?.[i]).filter((x) => typeof x === "number");
      return { i, name: p.name, bot: p.bot, n: v.length,
        avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0,
        min: v.length ? Math.min(...v) : 0, max: v.length ? Math.max(...v) : 0 };
    }).filter((x) => x.n > 0);
    r.sort((a, b) => b.avg - a.avg);
    return r;
  }, [history, players]);
  if (!rows.length) return null;

  return (
    <section className="lk">
      <style>{CSS}</style>
      <div className="lk-head">
        <h3>🍀 Classifica della fortuna</h3>
        <button className="lk-info" onClick={() => setInfo((x) => !x)} aria-expanded={info}>{info ? "chiudi" : "come si calcola?"}</button>
      </div>
      {info && (
        <p className="lk-explain">
          Ogni mano riceve un indice da 0 a 100 appena distribuite le carte (con briscola: appena scelto il seme).
          È il percentile della mano fra tutte quelle possibili nello stesso gioco: 50 è una mano nella media, 90 è
          migliore del 90% delle mani. Il valore di ogni carta e di ogni seme è stato stimato giocando migliaia di mani
          simulate. Conta solo la qualità delle carte ricevute, non come sono state giocate. La classifica usa la media delle mani.
        </p>
      )}
      <ol className="lk-list">
        {rows.map((r, k) => (
          <li key={r.i}>
            <div className="lk-top">
              <span className="lk-pos">{k + 1}</span>
              <span className="lk-name">{r.bot ? "🤖" : "👤"} {r.name}</span>
              <b className="lk-avg">{r.avg.toFixed(1)}</b>
            </div>
            <div className="lk-bar" aria-hidden>
              <i style={{ left: `${r.min}%`, width: `${Math.max(1, r.max - r.min)}%` }} className="lk-range" />
              <i style={{ left: `${r.avg}%` }} className="lk-dot" />
            </div>
            <div className="lk-sub">
              <span className="lk-label">{luckLabel(r.avg)}</span>
              <span>{r.n} {r.n === 1 ? "mano" : "mani"} · min {r.min} · max {r.max}</span>
            </div>
          </li>
        ))}
      </ol>
      <div className="lk-scale"><span>0 sfortuna</span><span>50 media</span><span>100 fortuna</span></div>
    </section>
  );
}

const CSS = `
.lk { margin:18px 0 16px; padding:14px 14px 10px; border-radius:14px; text-align:left;
  background:rgba(0,0,0,.22); border:1px solid rgba(217,178,95,.28); }
.lk-head { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:8px; }
.lk-head h3 { margin:0; font-size:15.5px; line-height:1.25; color:var(--gold,#d9b25f); letter-spacing:.02em; }
.lk-info { white-space:nowrap; flex:none; background:none; border:none; color:#cfe0d4; font-size:12.5px; text-decoration:underline; padding:4px 0; cursor:pointer; -webkit-appearance:none; }
.lk-explain { margin:0 0 10px; font-size:13px; line-height:1.5; color:#dfe9e2; }
.lk-list { list-style:none; margin:0; padding:0; display:grid; gap:10px; }
.lk-list li { padding:10px 12px; border-radius:10px; background:rgba(255,255,255,.05); }
.lk-list li:first-child { background:rgba(217,178,95,.12); box-shadow:inset 0 0 0 1px rgba(217,178,95,.35); }
.lk-top { display:flex; align-items:center; gap:10px; }
.lk-pos { width:22px; height:22px; flex:none; display:grid; place-items:center; border-radius:50%; font-size:12px; font-weight:700;
  background:rgba(255,255,255,.12); }
.lk-list li:first-child .lk-pos { background:var(--gold,#d9b25f); color:#1b1206; }
.lk-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.lk-avg { font-size:20px; font-variant-numeric:tabular-nums; }
.lk-bar { position:relative; height:8px; margin:8px 0 6px; border-radius:8px;
  background:linear-gradient(90deg,rgba(255,120,100,.28),rgba(255,255,255,.12) 50%,rgba(120,220,150,.3)); }
.lk-range { position:absolute; top:2px; height:4px; border-radius:4px; background:rgba(255,255,255,.45); }
.lk-dot { position:absolute; top:-3px; width:14px; height:14px; margin-left:-7px; border-radius:50%;
  background:var(--gold,#d9b25f); box-shadow:0 0 0 2px rgba(0,0,0,.45); }
.lk-sub { display:flex; justify-content:space-between; gap:8px; flex-wrap:wrap; font-size:12px; color:#cfe0d4; }
.lk-label { font-weight:600; color:#f3e7c4; }
.lk-scale { display:flex; justify-content:space-between; margin-top:8px; font-size:10.5px; color:rgba(207,224,212,.7); }
`;
