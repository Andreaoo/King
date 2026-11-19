// Simulatore di una mano, con le stesse regole e gli stessi bot del server (room.js),
// senza timer né socket. Serve solo alla calibrazione/verifica dell'indice di fortuna.
import {
  CONFIG, SUITS, createDeck, shuffleDeck, dealCards, validTrickMoves, updateBrokenSuits,
  resolveTrick, dominoValidCards, dominoValue, botChooseCard, botChooseTrump,
} from "../engine.js";

export const deal = () => dealCards(shuffleDeck(createDeck()));

// gioca una mano a prese; restituisce i punti dei 4 giocatori
export function playTricks(modeKey, hands, starter, trump, difficulty = "hard") {
  const mode = CONFIG.modes[modeKey];
  hands = hands.map((h) => [...h]);
  const scores = [0, 0, 0, 0];
  const protectedSuit = modeKey === "chosenTrump" ? trump : (mode.protectedSuit || null);
  let broken = new Set(), lead = starter, seen = 0;
  for (let trick = 0; trick < 13; trick++) {
    const table = [];
    const ctx = { trickNumber: trick, totalTricks: 13 };
    for (let k = 0; k < 4; k++) {
      const seat = (lead + k) % 4;
      const valid = validTrickMoves(hands[seat], table, trump, protectedSuit, broken);
      const card = botChooseCard(hands[seat], [...valid], table, trump, modeKey, difficulty, ctx);
      hands[seat] = hands[seat].filter((c) => c.id !== card.id);
      table.push({ card, player: seat });
    }
    const winner = resolveTrick(table, trump);
    let pts = 0;
    for (const p of table) pts += mode.penalty ? mode.penalty(p.card) : 0;
    if (mode.trickPenalty) pts += mode.trickPenalty(ctx);
    scores[winner] += pts;
    broken = updateBrokenSuits(table, broken);
    if (mode.totalPenaltyCards) {
      seen += table.filter((p) => mode.penalty(p.card) !== 0).length;
      if (seen >= mode.totalPenaltyCards) break;          // fine anticipata come nel gioco
    }
    lead = winner;
  }
  return scores;
}

// scelta della carta nel domino: un giocatore ragionevole apre la strada alle proprie
// carte (più carte mie sbloccate = meglio) e tiene chiuse le altre il più a lungo possibile
function dominoPick(hand, valid) {
  let best = valid[0], bestScore = -Infinity;
  for (const c of valid) {
    const v = dominoValue(c.rank);
    const mine = hand.filter((x) => x.suit === c.suit).map((x) => dominoValue(x.rank));
    const ahead = v === 6 ? mine.filter((x) => x !== 6).length
      : v > 6 ? mine.filter((x) => x > v).length : mine.filter((x) => x < v).length;
    const score = ahead * 2 + Math.abs(v - 6) * 0.3 + Math.random() * 0.1;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}

// gioca una mano di domino (punteggio della partita classica)
export function playDomino(hands) {
  hands = hands.map((h) => [...h]);
  const board = {};
  const starter = hands.findIndex((h) => h.some((c) => c.rank === "7" && c.suit === "diamonds"));
  let turn = starter, endTurn = null;
  const finished = [];
  for (let guard = 0; guard < 400; guard++) {
    const valid = dominoValidCards(hands[turn], board);
    if (valid.length) {
      const card = dominoPick(hands[turn], valid);
      const v = dominoValue(card.rank), b = board[card.suit];
      board[card.suit] = b ? { low: Math.min(b.low, v), high: Math.max(b.high, v) } : { low: v, high: v };
      hands[turn] = hands[turn].filter((c) => c.id !== card.id);
      if (!hands[turn].length) { if (!finished.includes(turn)) finished.push(turn); if (endTurn === null) endTurn = starter; }
    }
    // stesso giro di chiusura di room.afterDomino
    if (endTurn !== null) {
      let next = null;
      for (let step = 1; step <= 4; step++) {
        const n = (turn + step) % 4;
        if (n === endTurn) break;
        if (hands[n].length) { next = n; break; }
      }
      if (next === null) break;
      turn = next;
    } else {
      let n = (turn + 1) % 4, g = 0;
      while (!hands[n].length && g++ < 4) n = (n + 1) % 4;
      turn = n;
    }
  }
  const scores = [0, 0, 0, 0];
  let pot = 0;
  hands.forEach((h, i) => { if (h.length) { scores[i] = -h.length; pot += h.length; } });
  if (finished.length) scores[finished[0]] += pot;
  return scores;
}

// una mano completa: come nel gioco, chi apre gira e (Seme scelto) sceglie la briscola
export function playHand(modeKey, hands, starter = Math.floor(Math.random() * 4)) {
  if (modeKey === "domino") return { scores: playDomino(hands), trump: null };
  const trump = modeKey === "chosenTrump" ? botChooseTrump(hands[starter], "hard") : null;
  return { scores: playTricks(modeKey, hands, starter, trump), trump };
}

export { SUITS };
