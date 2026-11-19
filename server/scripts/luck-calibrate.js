// ============================================================================
// Calibrazione e verifica dell'INDICE DI FORTUNA
//
//   node scripts/luck-calibrate.js            (DEALS=6000 VERIFY=150 ROLLOUTS=80)
//
// Per ogni gioco:
//   1. simula DEALS distribuzioni giocate dai bot "Difficile" con le regole del server;
//   2. per ogni mano registra caratteristiche iniziali e punti ottenuti;
//   3. stima i pesi con una regressione ridge sulle caratteristiche standardizzate
//      (80% delle mani), misura l'R² sul 20% tenuto da parte;
//   4. salva i 101 quantili del punteggio atteso → indice = percentile (0–100);
//   5. VERIFICA indipendente: per VERIFY mani prese a caso calcola il valore "vero"
//      con un Monte Carlo (stessa mano, ROLLOUTS ridistribuzioni delle altre 39 carte)
//      e lo confronta con la formula (correlazione di rango di Spearman).
// Scrive src/luck/model.json e docs/indice-fortuna-calibrazione.md.
// ============================================================================
import { writeFileSync, mkdirSync } from "fs";
import { CONFIG, createDeck, shuffleDeck, botChooseTrump } from "../src/engine.js";
import { featuresFor } from "../src/luck/features.js";
import { deal, playHand, playTricks, playDomino } from "../src/luck/sim.js";

const DEALS = +process.env.DEALS || 6000;
const VERIFY = +process.env.VERIFY || 150;
const ROLLOUTS = +process.env.ROLLOUTS || 80;
const LAMBDA = 1.0;
const MODES = [...new Set(CONFIG.modeOrder)];
const ONLY = process.env.MODES ? process.env.MODES.split(",") : MODES;

// ---------- algebra minima ----------
function solve(A, b) { // eliminazione di Gauss con pivot
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db); };
const ranks = (a) => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length);
  for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const spearman = (a, b) => corr(ranks(a), ranks(b));

function fitRidge(X, y, keys) {
  const mu = {}, sg = {};
  keys.forEach((k, j) => { const col = X.map((r) => r[j]); mu[k] = mean(col); sg[k] = sd(col) || 1; });
  const Z = X.map((r) => r.map((v, j) => (v - mu[keys[j]]) / sg[keys[j]]));
  const p = keys.length, ym = mean(y);
  const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0);
  for (let i = 0; i < Z.length; i++) for (let a = 0; a < p; a++) { b[a] += Z[i][a] * (y[i] - ym); for (let c = 0; c < p; c++) A[a][c] += Z[i][a] * Z[i][c]; }
  for (let a = 0; a < p; a++) A[a][a] += LAMBDA * Z.length / 100;
  const w = solve(A, b);
  return { intercept: ym, weights: Object.fromEntries(keys.map((k, j) => [k, w[j]])), mean: mu, std: sg };
}
const predict = (m, f) => { let y = m.intercept; for (const k in m.weights) y += m.weights[k] * ((f[k] - m.mean[k]) / m.std[k]); return y; };

// valore "vero" di una mano: la si tiene fissa e si ridistribuiscono le altre carte
function monteCarloEquity(modeKey, hand, trumpFixed) {
  const ids = new Set(hand.map((c) => c.id));
  const rest = createDeck().filter((c) => !ids.has(c.id));
  let tot = 0;
  for (let r = 0; r < ROLLOUTS; r++) {
    const d = shuffleDeck(rest);
    const hands = [hand, d.slice(0, 13), d.slice(13, 26), d.slice(26, 39)];
    const starter = Math.floor(Math.random() * 4);
    let s;
    if (modeKey === "domino") s = playDomino(hands);
    else if (modeKey === "chosenTrump") {
      // la briscola è già nota quando si valuta: la si tiene fissa
      s = playTricks(modeKey, hands, starter, trumpFixed);
    } else s = playTricks(modeKey, hands, starter, null);
    tot += s[0];
  }
  return tot / ROLLOUTS;
}

const model = { version: 1, created: new Date().toISOString(), deals: DEALS, modes: {} };
const report = [];
const t0 = Date.now();
for (const modeKey of ONLY) {
  const t1 = Date.now();
  const rows = [];
  for (let d = 0; d < DEALS; d++) {
    const hands = deal();
    const { scores, trump } = playHand(modeKey, hands);
    for (let s = 0; s < 4; s++) rows.push({ f: featuresFor(modeKey, hands[s], { trump }), y: scores[s], hand: hands[s], trump });
  }
  const keys = Object.keys(rows[0].f);
  const cut = Math.floor(rows.length * 0.8);
  const train = rows.slice(0, cut), test = rows.slice(cut);
  const m = fitRidge(train.map((r) => keys.map((k) => r.f[k])), train.map((r) => r.y), keys);
  const yhatTest = test.map((r) => predict(m, r.f));
  const r2 = corr(yhatTest, test.map((r) => r.y)) ** 2;
  // quantili sul campione completo
  const all = rows.map((r) => predict(m, r.f)).sort((a, b) => a - b);
  m.quantiles = Array.from({ length: 101 }, (_, i) => +all[Math.min(all.length - 1, Math.round(i / 100 * (all.length - 1)))].toFixed(4));
  for (const k of keys) { m.weights[k] = +m.weights[k].toFixed(4); m.mean[k] = +m.mean[k].toFixed(4); m.std[k] = +m.std[k].toFixed(4); }
  m.intercept = +m.intercept.toFixed(4);
  m.r2 = +r2.toFixed(3);
  model.modes[modeKey] = m;

  // verifica indipendente con Monte Carlo
  const sample = test.slice(0, VERIFY);
  const mc = sample.map((r) => monteCarloEquity(modeKey, r.hand, r.trump));
  const fx = sample.map((r) => predict(m, r.f));
  const rho = spearman(mc, fx);
  // calibrazione: le mani con indice alto devono davvero rendere di più
  const pct = (y) => { let i = 0; while (i < 100 && m.quantiles[i + 1] <= y) i++; return i; };
  const idx = rows.map((r) => pct(predict(m, r.f)));
  const bands = [0, 20, 40, 60, 80].map((lo) => {
    const ys = rows.filter((r, i) => idx[i] >= lo && idx[i] < lo + 20 + (lo === 80 ? 1 : 0)).map((r) => r.y);
    return { band: `${lo}-${lo + 20}`, n: ys.length, avg: ys.length ? +mean(ys).toFixed(2) : null };
  });
  const totW = Object.values(m.weights).reduce((a, w) => a + Math.abs(w), 0);
  const share = Object.entries(m.weights).map(([k, w]) => [k, w, Math.abs(w) / totW]).sort((a, b) => b[2] - a[2]);
  report.push({ modeKey, title: CONFIG.modes[modeKey].title, r2, rho, bands, share, sdY: sd(rows.map((r) => r.y)),
    spread: [m.quantiles[10], m.quantiles[50], m.quantiles[90]], secs: (Date.now() - t1) / 1000 });
  console.log(`${modeKey.padEnd(14)} R²=${r2.toFixed(3)}  Spearman MC=${rho.toFixed(3)}  ` +
    `fasce ${bands.map((b) => b.avg).join(" / ")}  (${((Date.now() - t1) / 1000).toFixed(1)}s)`);
}

if (ONLY.length === MODES.length) {
  writeFileSync(new URL("../src/luck/model.json", import.meta.url), JSON.stringify(model));
  // rapporto leggibile
  const md = [`# Indice di fortuna — calibrazione`, ``,
    `Generato da \`server/scripts/luck-calibrate.js\` il ${model.created.slice(0, 10)}: ${DEALS} distribuzioni per gioco ` +
    `(${DEALS * 4} mani), bot "Difficile", verifica Monte Carlo su ${VERIFY} mani × ${ROLLOUTS} ridistribuzioni.`, ``,
    `| Gioco | R² (mani nuove) | Spearman con Monte Carlo | Punti medi per fascia d'indice 0-20 / 20-40 / 40-60 / 60-80 / 80-100 |`,
    `|---|---|---|---|`,
    ...report.map((r) => `| ${r.title} | ${r.r2.toFixed(2)} | ${r.rho.toFixed(2)} | ${r.bands.map((b) => b.avg).join(" / ")} |`),
    ``, `## Pesi (caratteristiche standardizzate: punti attesi per 1 deviazione standard)`, ``,
    ...report.flatMap((r) => [`### ${r.title}`, ``, `| Caratteristica | Peso | Quota |`, `|---|---|---|`,
      ...r.share.map(([k, w, s]) => `| ${k} | ${w > 0 ? "+" : ""}${w.toFixed(3)} | ${(s * 100).toFixed(0)}% |`), ``]),
  ].join("\n");
  mkdirSync(new URL("../../docs/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../../docs/indice-fortuna-calibrazione.md", import.meta.url), md);
  console.log(`\nModello salvato (src/luck/model.json) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
