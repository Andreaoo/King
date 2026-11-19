// ============================================================================
// INDICE DI FORTUNA — caratteristiche di una mano
// Ogni famiglia di gioco descrive la mano con poche grandezze misurabili.
// I PESI non sono scelti a mano: li stima la simulazione (scripts/luck-calibrate.js)
// giocando migliaia di mani con i bot e misurando quanto ogni caratteristica
// sposta davvero il punteggio in QUEL gioco. Per aggiungere un gioco basta
// registrare qui la sua famiglia di caratteristiche e rilanciare la calibrazione.
// ============================================================================
import { SUITS, rankValue, dominoValue } from "../engine.js";

// rankValue: 2→0 … 10→8, J→9, Q→10, K→11, A→12
const HIGH = 9;   // J, Q, K, A
const LOW = 3;    // 2, 3, 4, 5
const MID_LOW = 5; // fino al 7: carte che "coprono" le alte di un seme

function bySuit(hand) {
  const m = Object.fromEntries(SUITS.map((s) => [s, []]));
  for (const c of hand) m[c.suit].push(rankValue(c.rank));
  for (const s of SUITS) m[s].sort((a, b) => a - b);
  return m;
}

// distribuzione dei semi e valore delle carte: comune a tutti i giochi a prese
function common(hand) {
  const m = bySuit(hand);
  const lens = SUITS.map((s) => m[s].length);
  const ranks = hand.map((c) => rankValue(c.rank));
  let exits = 0, exposed = 0;
  for (const s of SUITS) {
    const r = m[s];
    if (r.length && r[0] <= LOW) exits++;                      // seme con una carta bassa per "uscire"
    const hi = r.filter((v) => v >= HIGH).length, lo = r.filter((v) => v <= MID_LOW).length;
    exposed += Math.max(0, hi - lo);                            // alte senza carte basse a coprirle
  }
  return {
    highs: ranks.filter((v) => v >= HIGH).length,
    aces: ranks.filter((v) => v === 12).length,
    kings: ranks.filter((v) => v === 11).length,
    lows: ranks.filter((v) => v <= LOW).length,
    meanRank: ranks.reduce((a, b) => a + b, 0) / ranks.length,
    voids: lens.filter((l) => l === 0).length,
    singletons: lens.filter((l) => l === 1).length,
    longest: Math.max(...lens),
    shape: lens.reduce((a, l) => a + l * l, 0) / 13,            // 13/13≈3.3 piatta … più alta = sbilanciata
    exits,
    exposed,
  };
}

const has = (hand, rank, suit) => hand.some((c) => c.rank === rank && c.suit === suit);
const ofSuit = (hand, suit) => hand.filter((c) => c.suit === suit).map((c) => rankValue(c.rank));

// carte penalizzanti di un certo valore: quante, e quante in semi corti/lunghi
function penaltyRanks(hand, ranks) {
  const m = bySuit(hand);
  let n = 0, short = 0, guarded = 0;
  for (const c of hand) {
    if (!ranks.includes(c.rank)) continue;
    n++;
    const r = m[c.suit];
    if (r.length <= 2) short++;
    const v = rankValue(c.rank);
    if (r.filter((x) => x < v).length >= 3) guarded++;         // almeno 3 carte sotto: si può stare sotto a lungo
  }
  return { penCards: n, penShort: short, penGuarded: guarded };
}

// una carta penalizzante singola (8♦, K♥): averla, quante del seme, quante sotto e sopra
function penaltyCard(hand, rank, suit) {
  const r = ofSuit(hand, suit), v = rankValue(rank);
  return {
    holds: has(hand, rank, suit) ? 1 : 0,
    suitLen: r.length,
    below: r.filter((x) => x < v).length,
    above: r.filter((x) => x > v).length,
  };
}

// giochi positivi con briscola: tutto si misura rispetto al seme scelto
function trumpFeatures(hand, trump) {
  const t = ofSuit(hand, trump);
  const m = bySuit(hand);
  const side = SUITS.filter((s) => s !== trump);
  const sideLens = side.map((s) => m[s].length);
  return {
    trumpLen: t.length,
    trumpHigh: t.filter((v) => v >= HIGH).length,
    trumpTop: t.filter((v) => v >= 11).length,                 // K, A di briscola
    trumpRankSum: t.reduce((a, v) => a + v, 0) / 12,
    sideAces: side.reduce((a, s) => a + m[s].filter((v) => v === 12).length, 0),
    sideKings: side.reduce((a, s) => a + m[s].filter((v) => v === 11).length, 0),
    sideVoids: sideLens.filter((l) => l === 0).length,
    sideSingletons: sideLens.filter((l) => l === 1).length,
    ruffs: Math.min(t.length, sideLens.reduce((a, l) => a + Math.max(0, 2 - l), 0)), // tagli possibili
  };
}

// Domino con le carte: si parte dai 7 e si sale/scende per seme (A è la più bassa).
// Contano la distanza dal 7, le catene di carte proprie collegate e le "lacune"
// (carte che servono agli altri prima che io possa giocare le mie).
function dominoFeatures(hand) {
  const vs = Object.fromEntries(SUITS.map((s) => [s, new Set()]));
  for (const c of hand) vs[c.suit].add(dominoValue(c.rank));
  let dist = 0, far = 0, near = 0, sevens = 0, gaps = 0, chained = 0, suitsHeld = 0;
  for (const s of SUITS) {
    const set = vs[s];
    if (set.size) suitsHeld++;
    if (set.has(6)) sevens++;
    for (const v of set) {
      const d = Math.abs(v - 6);
      dist += d;
      if (d >= 5) far++;                                         // A, 2, Q, K
      if (d <= 1) near++;                                        // 6, 7, 8
      // per giocare v servono tutte le carte fra il 7 e v: quante NON sono mie?
      let missing = 0;
      if (v !== 6) {
        const step = v > 6 ? -1 : 1;
        for (let x = v + step; x !== 6; x += step) if (!set.has(x)) missing++;
        if (!set.has(6)) missing++;                              // anche il 7 di quel seme è di un altro
      }
      gaps += missing;
      if (missing === 0) chained++;                              // giocabile solo con carte mie
    }
  }
  const n = hand.length;
  return { meanDist: dist / n, far, near, sevens, gaps: gaps / n, chained, suitsHeld };
}

// famiglia di caratteristiche per ogni gioco
export const FEATURES = {
  noKingsJacks: (h) => ({ ...common(h), ...penaltyRanks(h, ["K", "J"]) }),
  noQueens: (h) => ({ ...common(h), ...penaltyRanks(h, ["Q"]) }),
  no8Diamonds: (h) => ({ ...common(h), ...penaltyCard(h, "8", "diamonds") }),
  noKingHearts: (h) => {
    const p = penaltyCard(h, "K", "hearts");
    return { ...common(h), ...p, aceHearts: has(h, "A", "hearts") ? 1 : 0 };
  },
  noHearts: (h) => {
    const r = ofSuit(h, "hearts");
    return { ...common(h), hearts: r.length, heartsHigh: r.filter((v) => v >= HIGH).length,
      heartsLow: r.filter((v) => v <= LOW).length };
  },
  lastTwoTricks: (h) => common(h),
  noTricks: (h) => common(h),
  domino: (h) => dominoFeatures(h),
  chosenTrump: (h, ctx) => ({ ...common(h), ...trumpFeatures(h, ctx.trump) }),
  hiddenTrump: (h) => common(h),
};

// quando la mano si può valutare: le mani con briscola solo dopo la scelta del seme
export const needsTrump = (modeKey) => modeKey === "chosenTrump";

export function featuresFor(modeKey, hand, ctx = {}) {
  const f = FEATURES[modeKey];
  if (!f) return null;
  if (needsTrump(modeKey) && !ctx.trump) return null;
  return f(hand, ctx);
}
