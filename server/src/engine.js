// ============================================================================
// CART KING — Motore di gioco autoritativo (server-side)
// Logica pura, nessuna dipendenza. Le regole vivono in CONFIG.
// ============================================================================

export const SUITS = ["hearts", "diamonds", "clubs", "spades"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
export const rankValue = (r) => RANKS.indexOf(r);

export const CONFIG = {
  modeOrder: [
    "noKingsJacks", "noQueens", "no8Diamonds", "noKingHearts", "noHearts",
    "lastTwoTricks", "noTricks", "domino",
    "chosenTrump", "chosenTrump", "chosenTrump", "chosenTrump",
    "hiddenTrump",
  ],
  modes: {
    noKingsJacks: { title: "No Re e Fanti", short: "NO RE E FANTI", trick: true,
      penalty: (c) => (c.rank === "K" || c.rank === "J" ? -1 : 0) },
    noQueens: { title: "No Donne", short: "NO DONNE", trick: true,
      penalty: (c) => (c.rank === "Q" ? -1 : 0) },
    no8Diamonds: { title: "No 8 di Quadri", short: "NO 8 DI QUADRI", trick: true,
      penalty: (c) => (c.rank === "8" && c.suit === "diamonds" ? -8 : 0) },
    noKingHearts: { title: "No K di Cuori", short: "NO K DI CUORI", trick: true,
      penalty: (c) => (c.rank === "K" && c.suit === "hearts" ? -8 : 0) },
    noHearts: { title: "No Cuori", short: "NO CUORI", trick: true,
      penalty: (c) => (c.suit === "hearts" ? -1 : 0) },
    lastTwoTricks: { title: "Ultime Due Prese", short: "ULTIME DUE PRESE", trick: true,
      penalty: () => 0, trickPenalty: (ctx) => (ctx.trickNumber >= ctx.totalTricks - 1 ? -4 : 0) },
    noTricks: { title: "No Prese", short: "NO PRESE", trick: true,
      penalty: () => 0, trickPenalty: () => -1 },
    domino: { title: "Domino", short: "DOMINO", trick: false },
    chosenTrump: { title: "Seme scelto", short: "SEME SCELTO", trick: true, positive: true,
      penalty: () => 0, trickPenalty: () => +1 },
    hiddenTrump: { title: "Briscola non dichiarata", short: "BRISCOLA NASCOSTA", trick: true,
      positive: true, hidden: true, penalty: () => 0, trickPenalty: () => +2 },
  },
};

export function createDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, id: `${r}-${s}` });
  return d;
}
export function shuffleDeck(deck) {
  const d = [...deck];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
export function dealCards(deck, n = 4) {
  const hands = Array.from({ length: n }, () => []);
  deck.forEach((c, i) => hands[i % n].push(c));
  return hands.map((h) => h.sort((a, b) =>
    a.suit === b.suit ? rankValue(a.rank) - rankValue(b.rank) : SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit)));
}
export function validTrickMoves(hand, table) {
  if (table.length === 0) return hand;
  const lead = table[0].card.suit;
  const same = hand.filter((c) => c.suit === lead);
  return same.length ? same : hand;
}
export function resolveTrick(table, trump) {
  const lead = table[0].card.suit;
  let best = table[0];
  for (const p of table) {
    const c = p.card, bc = best.card;
    const cT = trump && c.suit === trump, bT = trump && bc.suit === trump;
    if (cT && !bT) best = p;
    else if (cT && bT && rankValue(c.rank) > rankValue(bc.rank)) best = p;
    else if (!cT && !bT && c.suit === lead && bc.suit === lead && rankValue(c.rank) > rankValue(bc.rank)) best = p;
  }
  return best.player;
}
export function dominoValidCards(hand, board) {
  return hand.filter((c) => {
    const b = board[c.suit];
    if (!b) return c.rank === "7";
    const v = rankValue(c.rank);
    return v === b.high + 1 || v === b.low - 1;
  });
}

// ---- BOT ----
export function botChooseCard(hand, valid, table, trump, modeKey, difficulty, ctx) {
  const cfg = CONFIG.modes[modeKey];
  if (difficulty === "easy") return valid[Math.floor(Math.random() * valid.length)];
  const wouldWin = (card) => resolveTrick([...table, { card, player: -1 }], trump) === -1;
  const pen = (card) => (cfg.penalty ? cfg.penalty(card) : 0);
  const tp = cfg.trickPenalty ? cfg.trickPenalty(ctx) : 0;
  if (difficulty === "neutral") {
    if (cfg.positive) {
      const w = valid.filter(wouldWin);
      if (w.length) return w.sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
      return valid.sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0];
    }
    const safe = valid.filter((c) => !wouldWin(c));
    const pool = safe.length ? safe : valid;
    return pool.sort((a, b) => pen(a) - pen(b))[0];
  }
  let best = valid[0], bs = -Infinity;
  for (const card of valid) {
    const win = wouldWin(card);
    let s = 0;
    if (cfg.positive) s += win ? 8 + rankValue(card.rank) * 0.2 : -rankValue(card.rank) * 0.3;
    else {
      const taken = win ? [...table.map((t) => t.card), card].reduce((a, c) => a + pen(c), 0) + tp : 0;
      s += taken;
      if (!win) s += rankValue(card.rank) * 0.15; else s -= rankValue(card.rank) * 0.05;
    }
    if (s > bs) { bs = s; best = card; }
  }
  return best;
}
export function botChooseTrump(hand, difficulty) {
  if (difficulty === "easy") return SUITS[Math.floor(Math.random() * 4)];
  const st = {}; for (const s of SUITS) st[s] = 0;
  for (const c of hand) st[c.suit] += 1 + rankValue(c.rank) * 0.3;
  return SUITS.sort((a, b) => st[b] - st[a])[0];
}
