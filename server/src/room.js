// ============================================================================
// GameRoom — stato autoritativo di una partita. Il server è l'unica fonte di
// verità: i client inviano intenzioni, il server valida ed emette lo stato.
// ============================================================================
import {
  CONFIG, SUITS, RANKS, createDeck, shuffleDeck, dealCards,
  validTrickMoves, resolveTrick, dominoValidCards, botChooseCard, botChooseTrump,
} from "./engine.js";

const BOT_NAMES = ["Bot Aria", "Bot Nova", "Bot Zeno", "Bot Iris"];
const DIFF_LABEL = { easy: "Facile", neutral: "Neutro", hard: "Difficile" };

export class GameRoom {
  constructor(code, io) {
    this.code = code;
    this.io = io;
    this.players = []; // {id, name, bot, difficulty, connected, socketId, seat}
    this.ownerId = null;
    this.status = "lobby"; // lobby | playing | modeEnd | gameOver
    this.difficulty = "neutral";

    this.modeIndex = 0;
    this.hands = [[], [], [], []];
    this.table = [];
    this.turn = 0;
    this.trickStarter = 0;
    this.trump = null;
    this.trickNumber = 0;
    this.handScores = [0, 0, 0, 0];
    this.totalScores = [0, 0, 0, 0];
    this.tricksWon = [0, 0, 0, 0];
    this.awaitingTrump = false;
    this.dominoBoard = {};
    this.dominoFinished = [];
    this.message = "";
    this.botTimer = null;
  }

  get modeKey() { return CONFIG.modeOrder[this.modeIndex]; }
  get mode() { return CONFIG.modes[this.modeKey]; }

  // -------- lobby --------
  addHuman(playerId, name, socketId) {
    let p = this.players.find((x) => x.id === playerId);
    if (p) { p.connected = true; p.socketId = socketId; return p; } // riconnessione
    if (this.players.filter((x) => !x.bot).length >= 4) return null;
    p = { id: playerId, name: name || "Giocatore", bot: false, connected: true, socketId, seat: this.players.length };
    this.players.push(p);
    if (!this.ownerId) this.ownerId = playerId;
    return p;
  }

  setConfig({ difficulty }) {
    if (difficulty) this.difficulty = difficulty;
  }

  fillWithBots() {
    let bi = 0;
    while (this.players.length < 4) {
      this.players.push({
        id: `bot-${this.code}-${bi}`, name: BOT_NAMES[bi], bot: true,
        difficulty: this.difficulty, diffLabel: DIFF_LABEL[this.difficulty],
        connected: true, seat: this.players.length,
      });
      bi++;
    }
    this.players.forEach((p, i) => (p.seat = i));
  }

  markDisconnected(socketId) {
    const p = this.players.find((x) => x.socketId === socketId);
    if (p) p.connected = false;
    return p;
  }

  // -------- avvio partita --------
  start() {
    this.fillWithBots();
    this.status = "playing";
    this.totalScores = [0, 0, 0, 0];
    this.modeIndex = 0;
    this.startMode();
  }

  startMode() {
    const dealt = dealCards(shuffleDeck(createDeck()));
    this.hands = dealt;
    this.table = [];
    this.handScores = [0, 0, 0, 0];
    this.tricksWon = [0, 0, 0, 0];
    this.trickNumber = 0;
    this.trump = null;
    this.dominoBoard = {};
    this.dominoFinished = [];
    const key = this.modeKey;
    const starter = this.modeIndex % 4;
    this.trickStarter = starter;
    this.turn = starter;
    this.awaitingTrump = false;

    if (key === "chosenTrump") {
      if (this.players[starter].bot) {
        this.trump = botChooseTrump(dealt[starter], this.players[starter].difficulty);
        this.message = `${this.players[starter].name} sceglie briscola: ${this.trump}`;
      } else {
        this.awaitingTrump = true;
        this.message = "In attesa della scelta della briscola";
      }
    } else if (key === "hiddenTrump") {
      this.trump = SUITS[Math.floor(Math.random() * 4)]; // nascosta ai client
      this.message = "Briscola nascosta";
    } else if (key === "domino") {
      const s = dealt.findIndex((h) => h.some((c) => c.rank === "7" && c.suit === "hearts"));
      this.trickStarter = s; this.turn = s;
      this.message = "Domino: parti dai 7";
    } else {
      this.message = this.mode.title;
    }
    this.emit();
    this.scheduleBot();
  }

  chooseTrump(playerId, suit) {
    if (!this.awaitingTrump) return;
    const p = this.players[this.turn];
    if (p.id !== playerId || !SUITS.includes(suit)) return;
    this.trump = suit;
    this.awaitingTrump = false;
    this.message = `Briscola: ${suit}`;
    this.emit();
    this.scheduleBot();
  }

  // -------- mossa a prese --------
  playCard(playerId, cardId) {
    if (this.status !== "playing" || this.awaitingTrump) return;
    const seat = this.players.findIndex((p) => p.id === playerId);
    if (seat !== this.turn) return; // fuori turno: rifiutato
    if (this.modeKey === "domino") return this.dominoPlay(seat, cardId);
    if (!this.mode.trick) return;
    if (this.table.some((t) => t.player === seat)) return; // ha già giocato in questa presa

    const hand = this.hands[seat];
    const card = hand.find((c) => c.id === cardId);
    if (!card) return;
    const valid = validTrickMoves(hand, this.table);
    if (!valid.some((c) => c.id === cardId)) return; // mossa illegale: rifiutata

    this.hands[seat] = hand.filter((c) => c.id !== cardId);
    this.table.push({ card, player: seat });

    if (this.table.length < 4) {
      this.turn = (this.trickStarter + this.table.length) % 4;
      this.emit();
      this.scheduleBot();
    } else {
      this.emit();
      setTimeout(() => this.resolveCurrentTrick(), 900);
    }
  }

  resolveCurrentTrick() {
    const winner = resolveTrick(this.table, this.trump);
    const ctx = { trickNumber: this.trickNumber, totalTricks: 13 };
    let pts = 0;
    for (const p of this.table) pts += this.mode.penalty ? this.mode.penalty(p.card) : 0;
    if (this.mode.trickPenalty) pts += this.mode.trickPenalty(ctx);
    this.handScores[winner] += pts;
    this.tricksWon[winner] += 1;
    this.message = `${this.players[winner].name} vince la presa${pts ? ` (${pts > 0 ? "+" : ""}${pts})` : ""}`;
    this.table = [];
    this.trickNumber += 1;

    if (this.trickNumber >= 13) { this.finishMode(); return; }
    this.trickStarter = winner;
    this.turn = winner;
    this.emit();
    this.scheduleBot();
  }

  // -------- domino --------
  dominoPlay(seat, cardId) {
    const hand = this.hands[seat];
    const valid = dominoValidCards(hand, this.dominoBoard);
    const card = hand.find((c) => c.id === cardId);
    if (!card || !valid.some((c) => c.id === cardId)) return;
    const b = this.dominoBoard[card.suit];
    const v = RANKS.indexOf(card.rank);
    this.dominoBoard[card.suit] = b ? { low: Math.min(b.low, v), high: Math.max(b.high, v) } : { low: v, high: v };
    this.hands[seat] = hand.filter((c) => c.id !== cardId);
    if (this.hands[seat].length === 0 && !this.dominoFinished.includes(seat)) this.dominoFinished.push(seat);
    this.afterDomino(seat);
  }

  dominoPass(playerId) {
    const seat = this.players.findIndex((p) => p.id === playerId);
    if (seat !== this.turn) return;
    if (dominoValidCards(this.hands[seat], this.dominoBoard).length > 0) return; // non puoi passare se hai mosse
    this.message = `${this.players[seat].name} passa`;
    this.afterDomino(seat);
  }

  afterDomino(seat) {
    const empties = this.hands.filter((h) => h.length === 0).length;
    if (empties >= 3) return this.finishDomino();
    let n = (seat + 1) % 4, guard = 0;
    while (this.hands[n].length === 0 && guard < 4) { n = (n + 1) % 4; guard++; }
    this.turn = n;
    this.emit();
    this.scheduleBot();
  }

  finishDomino() {
    const hs = [0, 0, 0, 0];
    let pot = 0;
    this.hands.forEach((h, i) => { if (h.length > 0) { hs[i] = -h.length; pot += h.length; } });
    const winner = this.dominoFinished[0];
    if (winner != null) hs[winner] += pot;
    this.handScores = hs;
    this.finishMode();
  }

  // -------- fine mano / partita --------
  finishMode() {
    this.totalScores = this.totalScores.map((v, i) => v + this.handScores[i]);
    this.status = "modeEnd";
    clearTimeout(this.botTimer);
    this.emit();
  }

  nextMode(playerId) {
    if (playerId !== this.ownerId) return;
    if (this.modeIndex + 1 >= 13) { this.status = "gameOver"; this.emit(); return; }
    this.modeIndex += 1;
    this.status = "playing";
    this.startMode();
  }

  // -------- bot driver --------
  scheduleBot() {
    clearTimeout(this.botTimer);
    if (this.status !== "playing") return;
    const p = this.players[this.turn];
    if (!p || !p.bot) return;

    this.botTimer = setTimeout(() => {
      if (this.awaitingTrump && this.modeKey === "chosenTrump") {
        this.trump = botChooseTrump(this.hands[this.turn], p.difficulty);
        this.awaitingTrump = false;
        this.message = `${p.name} sceglie briscola`;
        this.emit();
        return this.scheduleBot();
      }
      if (this.modeKey === "domino") {
        const valid = dominoValidCards(this.hands[this.turn], this.dominoBoard);
        if (valid.length) {
          const seven = valid.find((c) => c.rank === "7");
          this.dominoPlay(this.turn, (seven || valid[Math.floor(Math.random() * valid.length)]).id);
        } else this.afterDomino(this.turn);
        return;
      }
      const valid = validTrickMoves(this.hands[this.turn], this.table);
      if (!valid.length) return;
      const ctx = { trickNumber: this.trickNumber, totalTricks: 13 };
      const card = botChooseCard(this.hands[this.turn], valid, this.table, this.trump, this.modeKey, p.difficulty, ctx);
      this.playCard(p.id, card.id);
    }, 700);
  }

  // -------- viste per giocatore (nascondono le carte altrui e la briscola nascosta) --------
  stateFor(playerId) {
    const seat = this.players.findIndex((p) => p.id === playerId);
    return {
      code: this.code,
      status: this.status,
      ownerId: this.ownerId,
      youSeat: seat,
      difficulty: this.difficulty,
      players: this.players.map((p) => ({
        name: p.name, bot: p.bot, seat: p.seat,
        diffLabel: p.diffLabel, connected: p.connected,
        handCount: this.hands[p.seat] ? this.hands[p.seat].length : 0,
      })),
      modeIndex: this.modeIndex,
      modeKey: this.modeKey,
      modeTitle: this.mode.title,
      modeShort: this.mode.short,
      modeOrder: CONFIG.modeOrder,
      hidden: !!this.mode.hidden,
      isTrickMode: this.mode.trick !== false,
      trump: this.mode.hidden ? null : this.trump, // briscola nascosta non inviata
      table: this.table,
      turn: this.turn,
      trickNumber: this.trickNumber,
      handScores: this.handScores,
      totalScores: this.totalScores,
      tricksWon: this.tricksWon,
      awaitingTrump: this.awaitingTrump,
      dominoBoard: this.dominoBoard,
      message: this.message,
      myHand: seat >= 0 ? this.hands[seat] : [],
    };
  }

  emit() {
    for (const p of this.players) {
      if (!p.bot && p.socketId) this.io.to(p.socketId).emit("state", this.stateFor(p.id));
    }
  }
}
