// ============================================================================
// INDICE DI FORTUNA (0–100) di una mano iniziale
//
//   1. caratteristiche della mano (features.js), diverse per ogni gioco
//   2. punteggio atteso = intercetta + Σ peso·(caratteristica standardizzata)
//      pesi stimati con migliaia di mani simulate (scripts/luck-calibrate.js)
//   3. indice = percentile di quel punteggio atteso fra tutte le mani possibili
//      dello STESSO gioco: 50 = mano mediana, 90 = meglio del 90% delle mani.
//
// Misura solo le carte ricevute (e, nei giochi con briscola, il seme scelto):
// mai le giocate, mai il risultato della mano.
// ============================================================================
import { readFileSync } from "fs";
import { featuresFor } from "./features.js";

let MODEL = null;
try {
  MODEL = JSON.parse(readFileSync(new URL("./model.json", import.meta.url), "utf8"));
} catch {
  MODEL = null; // senza calibrazione l'indice non viene calcolato (nessun numero inventato)
}
export const setModel = (m) => { MODEL = m; };

// punteggio atteso della mano nel gioco indicato (punti di quel gioco)
export function expectedScore(modeKey, hand, ctx = {}) {
  const m = MODEL?.modes?.[modeKey];
  const f = featuresFor(modeKey, hand, ctx);
  if (!m || !f) return null;
  let y = m.intercept;
  for (const [k, w] of Object.entries(m.weights)) y += w * ((f[k] - m.mean[k]) / (m.std[k] || 1));
  return y;
}

// percentile (0–100) con interpolazione lineare sui 101 quantili salvati
function percentile(q, y) {
  if (y <= q[0]) return 0;
  if (y >= q[q.length - 1]) return 100;
  let lo = 0, hi = q.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (q[mid] <= y) lo = mid; else hi = mid; }
  // valori uguali ripetuti (mani "pari"): si prende il centro del tratto
  let a = lo; while (a > 0 && q[a - 1] === q[lo]) a--;
  if (q[lo] === y) return ((a + lo) / 2) * 100 / (q.length - 1);
  const t = (y - q[lo]) / (q[hi] - q[lo]);
  return (lo + t) * 100 / (q.length - 1);
}

export function luckIndex(modeKey, hand, ctx = {}) {
  const y = expectedScore(modeKey, hand, ctx);
  if (y === null) return null;
  return Math.round(percentile(MODEL.modes[modeKey].quantiles, y));
}

// indice dei 4 giocatori di una mano (stesso criterio per tutti)
export const luckOfDeal = (modeKey, hands, ctx = {}) => hands.map((h) => luckIndex(modeKey, h, ctx));

export function luckLabel(v) {
  if (v <= 20) return "estremamente sfortunato";
  if (v <= 40) return "poco fortunato";
  if (v <= 60) return "fortuna nella media";
  if (v <= 80) return "fortunato";
  return "estremamente fortunato";
}

// classifica finale: media aritmetica degli indici delle mani giocate
export function luckRanking(history, players) {
  const rows = players.map((p, i) => {
    const v = history.map((h) => h.luck?.[i]).filter((x) => typeof x === "number");
    const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    return { seat: i, name: p.name, hands: v.length, avg, min: v.length ? Math.min(...v) : null,
      max: v.length ? Math.max(...v) : null };
  }).filter((r) => r.hands > 0);
  rows.sort((a, b) => b.avg - a.avg);
  rows.forEach((r, k) => { r.pos = k + 1; r.avg = Math.round(r.avg * 10) / 10; r.label = luckLabel(r.avg); });
  return rows;
}
