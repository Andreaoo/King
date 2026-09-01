// ============================================================================
// CART KING — Motore di gioco autoritativo (server-side)
// Logica pura, nessuna dipendenza. Allineato alla versione locale.
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
      totalPenaltyCards: 8,
      penalty: (c) => (c.rank === "K" || c.rank === "J" ? -2 : 0) },
    noQueens: { title: "No Donne", short: "NO DONNE", trick: true,
      totalPenaltyCards: 4,
      penalty: (c) => (c.rank === "Q" ? -3 : 0) },
    no8Diamonds: { title: "No 8 di Quadri", short: "NO 8 DI QUADRI", trick: true,
      protectedSuit: "diamonds", totalPenaltyCards: 1,
      penalty: (c) => (c.rank === "8" && c.suit === "diamonds" ? -8 : 0) },
    noKingHearts: { title: "No K di Cuori", short: "NO K DI CUORI", trick: true,
      protectedSuit: "hearts", totalPenaltyCards: 1,
      penalty: (c) => (c.rank === "K" && c.suit === "hearts" ? -8 : 0) },
    noHearts: { title: "No Cuori", short: "NO CUORI", trick: true,
      protectedSuit: "hearts", totalPenaltyCards: 13,
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

// Mosse valide con regola dello "spezzare" (protectedSuit / brokenSuits)
export function validTrickMoves(hand, table, trump, protectedSuit, brokenSuits) {
  if (table.length === 0) {
    if (protectedSuit && brokenSuits && !brokenSuits.has(protectedSuit)) {
      const nonProtected = hand.filter((c) => c.suit !== protectedSuit);
      return nonProtected.length > 0 ? nonProtected : hand;
    }
    return hand;
  }
  const lead = table[0].card.suit;
  const sameSuit = hand.filter((c) => c.suit === lead);
  return sameSuit.length > 0 ? sameSuit : hand;
}
export function updateBrokenSuits(table, brokenSuits) {
  if (table.length === 0) return brokenSuits;
  const lead = table[0].card.suit;
  const next = new Set(brokenSuits);
  for (const play of table) {
    if (play.card.suit !== lead) next.add(play.card.suit);
  }
  return next;
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
export function extremeChoose(hand, valid, table, trump, cfg, ctx, positive) {
  const cardPenalty = (c) => (cfg.penalty ? cfg.penalty(c) : 0);
  const trickPen = cfg.trickPenalty ? cfg.trickPenalty(ctx) : 0;
  const isLast = table.length === 3;
  const lead = table.length ? table[0].card.suit : null;
  const penaltyOnTable = table.reduce((s, t) => s + cardPenalty(t.card), 0);

  const wouldWin = (card) => resolveTrick([...table, { card, player: -1 }], trump) === -1;
  const sortAsc = (a, b) => rankValue(a.rank) - rankValue(b.rank);
  const sortDesc = (a, b) => rankValue(b.rank) - rankValue(a.rank);

  // Carte non ancora viste (per capire se una mia carta è imbattibile nel suo seme)
  const seen = new Set([...hand.map((c) => c.id), ...table.map((t) => t.card.id)]);
  const higherUnseen = (card) => {
    // quante carte più alte dello stesso seme sono ancora in giro
    let n = 0;
    for (const r of RANKS) {
      if (rankValue(r) > rankValue(card.rank)) {
        const id = `${r}-${card.suit}`;
        if (!seen.has(id)) n++;
      }
    }
    return n;
  };
  // una carta è "padrona" se nessuna più alta del suo seme è ancora fuori
  const isBoss = (card) => higherUnseen(card) === 0;

  // ---------- MANI POSITIVE (voglio vincere) ----------
  if (positive) {
    const winners = valid.filter(wouldWin);
    if (isLast) {
      if (winners.length) return winners.sort(sortAsc)[0]; // vinci con la più bassa che basta
      return valid.sort(sortAsc)[0];
    }
    if (winners.length) {
      // se ho una carta "padrona" la uso per assicurare la presa senza sprecare l'asso
      const bossWinners = winners.filter(isBoss);
      if (bossWinners.length) return bossWinners.sort(sortAsc)[0];
      return winners.sort(sortAsc)[0];
    }
    return valid.sort(sortAsc)[0]; // non posso vincere: conservo le forti, gioco la più bassa
  }

  // ---------- MANI NEGATIVE (evito penalità) ----------
  const penaltyIfWin = (card) => penaltyOnTable + cardPenalty(card) + trickPen;

  if (isLast) {
    // esito certo: se posso non prendere, scarico la carta più pericolosa per il futuro
    const notWin = valid.filter((c) => !wouldWin(c));
    if (notWin.length) {
      return notWin.sort((a, b) => {
        const pa = cardPenalty(a), pb = cardPenalty(b);
        if (pa !== pb) return pa - pb;                 // prima le penalizzanti
        return rankValue(b.rank) - rankValue(a.rank);  // poi le più alte
      })[0];
    }
    // costretto a prendere: minimizzo la penalità incassata
    return valid.sort((a, b) => penaltyIfWin(b) - penaltyIfWin(a))[0];
  }

  // Non sono ultimo: valuto ogni carta con un punteggio affinato.
  let best = valid[0], bestScore = -Infinity;
  for (const card of valid) {
    const win = wouldWin(card);
    let score = 0;
    if (win) {
      // prendere è male: peso la penalità che incasserei
      score += penaltyIfWin(card) * 1.5;
      score -= rankValue(card.rank) * 0.1;
    } else {
      // non prendo ora: momento ideale per liberarsi delle carte pericolose.
      // Priorità massima a scaricare le penalizzanti e le carte "padrone" alte,
      // che altrimenti mi costringerebbero a vincere prese future.
      score += rankValue(card.rank) * 0.6;
      score += (-cardPenalty(card)) * 2.5;
      if (isBoss(card) && rankValue(card.rank) >= rankValue("J")) score += 1.5; // sbarazzati delle alte imbattibili
      if (lead && card.suit !== lead) score += (-cardPenalty(card)) * 1.5 + rankValue(card.rank) * 0.4; // scarto libero
      if (lead && card.suit === lead) score += 0.3;
    }
    if (score > bestScore) { bestScore = score; best = card; }
  }
  return best;
}
export function botChooseCard(hand, valid, table, trump, mode, difficulty, ctx) {
  const cfg = CONFIG.modes[mode];
  const positive = cfg.positive;

  if (difficulty === "easy") {
    return valid[Math.floor(Math.random() * valid.length)];
  }

  // Stima se giocando una carta si VINCE la presa corrente (tavola parziale)
  const wouldWin = (card) => {
    const sim = [...table, { card, player: -1 }];
    return resolveTrick(sim, trump) === -1;
  };
  const cardPenalty = (card) => (cfg.penalty ? cfg.penalty(card) : 0);
  const trickPen = cfg.trickPenalty ? cfg.trickPenalty(ctx) : 0;
  const isLast = table.length === 3;           // sono l'ultimo a giocare nella presa
  const lead = table.length ? table[0].card.suit : null;
  const penaltyOnTable = table.reduce((s, t) => s + cardPenalty(t.card), 0);

  if (difficulty === "neutral") {
    if (positive) {
      const winners = valid.filter(wouldWin);
      if (winners.length) return winners.sort((a, b) => rankValue(b.rank) - rankValue(a.rank))[0];
      return valid.sort((a, b) => rankValue(a.rank) - rankValue(b.rank))[0];
    }
    const safe = valid.filter((c) => !wouldWin(c));
    const pool = safe.length ? safe : valid;
    return pool.sort((a, b) => cardPenalty(a) - cardPenalty(b))[0];
  }

  // ===================== ESTREMO: ricerca del caso peggiore =====================
  // Onesto (non vede le carte altrui), ma valuta ogni mossa simulando il
  // completamento della presa contro le risposte peggiori possibili degli
  // avversari (minimax sul worst-case) e stima il rischio residuo della mano.
  if (difficulty === "extreme") {
    return extremeChoose(hand, valid, table, trump, cfg, ctx, positive);
  }

  // ===================== HARD: quasi ottimale =====================
  // Idee chiave:
  // - Se sono ULTIMO conosco l'esito con certezza: evito la presa dannosa o la
  //   vinco se conviene (mani positive), scegliendo la carta migliore possibile.
  // - Se NON sono ultimo, stimo il rischio: le carte alte "costrette a vincere"
  //   sono un pericolo → me ne libero quando posso farlo senza vincere.
  // - Seguo il seme quando devo; se sono libero, scarto le carte più pericolose.

  const sortAsc = (a, b) => rankValue(a.rank) - rankValue(b.rank);
  const sortDesc = (a, b) => rankValue(b.rank) - rankValue(a.rank);

  // ---- MANI POSITIVE (voglio vincere le prese) ----
  if (positive) {
    const winners = valid.filter(wouldWin);
    const losers = valid.filter((c) => !wouldWin(c));
    if (isLast) {
      // ultimo: se posso vincere, vinco con la carta più BASSA che basta (risparmio le alte)
      if (winners.length) return winners.sort(sortAsc)[0];
      return losers.sort(sortAsc)[0] || valid.sort(sortAsc)[0];
    }
    // non ultimo: se ho una presa molto probabile con una carta forte, la gioco,
    // ma preferisco vincere con briscole/carte medie e conservare gli assi per dopo.
    if (winners.length) {
      // vinci con la più bassa che vince, per tenere le dominanti
      return winners.sort(sortAsc)[0];
    }
    // non posso vincere ora: scarto la più bassa per conservare le forti
    return valid.sort(sortAsc)[0];
  }

  // ---- MANI NEGATIVE (evito di prendere penalità) ----
  // valore atteso se prendo la presa giocando "card"
  const penaltyIfWin = (card) => penaltyOnTable + cardPenalty(card) + trickPen;

  if (isLast) {
    // conosco l'esito con certezza
    const notWin = valid.filter((c) => !wouldWin(c));
    if (notWin.length) {
      // non prendo: scarico la carta più PERICOLOSA per il futuro (alta e/o penalizzante)
      // priorità: liberarsi di penalità alte e ranghi alti
      return notWin.sort((a, b) => {
        const pa = cardPenalty(a), pb = cardPenalty(b);
        if (pa !== pb) return pa - pb;            // scarico prima le penalizzanti (più negative)
        return rankValue(b.rank) - rankValue(a.rank); // poi le più alte
      })[0];
    }
    // sono costretto a vincere: minimizzo il danno preso
    return valid.sort((a, b) => penaltyIfWin(b) - penaltyIfWin(a))[0]; // meno negativo possibile
  }

  // NON sono ultimo: valuto ogni carta con un punteggio di rischio
  let best = valid[0], bestScore = -Infinity;
  for (const card of valid) {
    const win = wouldWin(card);
    let score = 0;
    if (win) {
      // prendere è male: sottraggo la penalità che incasserei (con margine perché
      // altri devono ancora giocare e potrebbero aggiungere penalità)
      score += penaltyIfWin(card) * 1.4;
      // vincere con una carta alta è doppiamente male (spreco una carta e prendo)
      score -= rankValue(card.rank) * 0.1;
    } else {
      // non prendo ora: è un'occasione per liberarmi di carte pericolose.
      // premio scaricare carte ALTE (rischiose in futuro) e PENALIZZANTI su altri.
      score += rankValue(card.rank) * 0.5;       // meglio liberarsi delle alte
      score += (-cardPenalty(card)) * 2.0;        // meglio scaricare le penalizzanti
      // se sto seguendo il seme e non vinco, tanto meglio giocare la più alta safe
      if (lead && card.suit === lead) score += 0.5;
      // se sono libero dal seme (scarto), è il momento ideale per mollare penalità
      if (lead && card.suit !== lead) score += (-cardPenalty(card)) * 1.5 + rankValue(card.rank) * 0.3;
    }
    if (score > bestScore) { bestScore = score; best = card; }
  }
  return best;
}
export function botChooseTrump(hand, difficulty) {
  if (difficulty === "easy") return SUITS[Math.floor(Math.random() * 4)];
  const strength = {};
  const count = {};
  for (const s of SUITS) { strength[s] = 0; count[s] = 0; }
  for (const c of hand) { strength[c.suit] += 1 + rankValue(c.rank) * 0.3; count[c.suit]++; }
  if (difficulty === "extreme") {
    // extreme: privilegia il seme lungo E forte (una briscola lunga domina la mano)
    for (const s of SUITS) strength[s] += count[s] * count[s] * 0.4;
  }
  return SUITS.sort((a, b) => strength[b] - strength[a])[0];
}
export function botDecidesReshuffle(extremes, difficulty) {
  if (extremes < 4) return false; // regola: serve un minimo di 4 estremi
  switch (difficulty) {
    case "easy": return Math.random() < 0.35;   // spesso non se ne accorge
    case "neutral": return Math.random() < 0.7; // di solito rimescola
    case "hard": return true;                    // rimescola sempre: mano sfavorevole
    case "extreme": return true;                 // idem
    default: return true;
  }
}
