// ============================================================================
// GameRoom — stato autoritativo di una partita. Il server è l'unica fonte di
// verità: i client inviano intenzioni, il server valida ed emette lo stato.
// ============================================================================
import {
    CONFIG, SUITS, RANKS, rankValue, dominoValue, DOMINO_RANKS, createDeck, shuffleDeck, dealCards,
    validTrickMoves, updateBrokenSuits, resolveTrick, dominoValidCards,
    botChooseCard, botChooseTrump, botDecidesReshuffle,
} from "./engine.js";

const BOT_NAMES = ["Bot 1", "Bot 2", "Bot 3", "Bot 4"];
const DIFF_LABEL = { easy: "Facile", neutral: "Neutro", hard: "Difficile", extreme: "Estremo" };

export class GameRoom {
    constructor(code, io) {
        this.code = code;
        this.io = io;
        this.players = []; // {id, name, bot, difficulty, connected, socketId, seat}
        this.ownerId = null;
        this.status = "lobby"; // lobby | draw | playing | modeEnd | gameOver
        this.difficulty = "neutral";

        this.modeIndex = 0;
        this.playOrder = CONFIG.modeOrder.map((_, i) => i); // mani selezionate (indici in modeOrder)
        this.startSeat = 0;           // sorteggiato che inizia la partita
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
        this.dominoEndTurn = null;    // turno di chiusura del giro domino
        this.brokenSuits = new Set(); // semi spezzati (regola dello spezzare)
        this.penaltyCardsSeen = 0;    // carte penalizzanti raccolte (fine anticipata)
        this.protectedSuit = null;    // seme non apribile finché non spezzato
        this.blindBy = null;          // seat che gioca "al buio" (punti doppi)
        this.blindDecision = null;    // null=deve decidere, true=al buio, false=vede le carte
        this.message = "";
        this.botTimer = null;

        // ---- GIOCO A COPPIE ----------------------------------------------------
        // Tutto ciò che segue è additivo: con gameType "classic" il comportamento
        // resta identico a prima. Le regole delle modalità NON vengono toccate.
        this.gameType = "classic";        // "classic" | "teams"
        // Squadra per POSTO. Alternata di proposito: il giro dei turni è seat+1,
        // quindi così i compagni si fronteggiano e le squadre giocano a turno
        // alterno, come in ogni gioco a coppie.
        this.teams = [0, 1, 0, 1];        // 0 = blu, 1 = rossa
        this.negotiatedKey = null;        // modalità contrattata dalla coppia
        this.negotiatedTrump = null;      // seme dichiarato per "Seme scelto"
        this.usedNegatives = [];          // negative già giocate: una sola volta a partita
        this.positiveLeft = [3, 3];       // ogni squadra chiama 3 positive
        this.negativeLeft = [4, 4];       // ...e 4 negative
        this.phase = null;                // "propose" | "decide"
        this.proposer = 0;                // chi propone le due modalità
        this.decider = 0;                 // il COMPAGNO, che sceglie
        this.proposals = [];              // [{key, trump}]
        this.handsPlayed = 0;
        this.negTimer = null;
    }

    // ---- utilità delle coppie ----
    teamOf(seat) { return this.teams[seat] ?? 0; }
    partnerOf(seat) { return [0, 1, 2, 3].find((s) => s !== seat && this.teamOf(s) === this.teamOf(seat)); }
    teamsValid() {
        const b = this.teams.filter((t) => t === 0).length;
        return this.gameType !== "teams" || b === 2;
    }
    teamScore(t) {
        return this.totalScores.reduce((sum, v, i) => sum + (this.teamOf(i) === t ? v : 0), 0);
    }
    teamHandScore(t) {
        return this.handScores.reduce((sum, v, i) => sum + (this.teamOf(i) === t ? v : 0), 0);
    }
    // modalità che la squadra t può ancora chiamare
    availableFor(t) {
        return Object.keys(CONFIG.modes).filter((k) =>
            CONFIG.modes[k].positive
                ? this.positiveLeft[t] > 0
                : this.negativeLeft[t] > 0 && !this.usedNegatives.includes(k));
    }
    consumeMode(key, t) {
        if (CONFIG.modes[key].positive) this.positiveLeft[t] = Math.max(0, this.positiveLeft[t] - 1);
        else { this.usedNegatives.push(key); this.negativeLeft[t] = Math.max(0, this.negativeLeft[t] - 1); }
    }
    matchOver() { return !this.availableFor(0).length && !this.availableFor(1).length; }

    get realModeIndex() { return this.playOrder[this.modeIndex] ?? 0; }
    // nel gioco a coppie la mano NON segue l'ordine fisso: è quella contrattata
    get modeKey() {
        return this.gameType === "teams" ? this.negotiatedKey : CONFIG.modeOrder[this.realModeIndex];
    }
    // guscio innocuo durante la contrattazione, quando la modalità non è ancora decisa
    get mode() {
        return CONFIG.modes[this.modeKey] || { title: "—", short: "—", trick: true, penalty: () => 0 };
    }
    get totalModes() { return this.gameType === "teams" ? 14 : this.playOrder.length; }

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

    setConfig({ difficulty, enabledModes, gameType }) {
        if (gameType === "teams" || gameType === "classic") this.gameType = gameType;
        if (difficulty) this.difficulty = difficulty;
        if (enabledModes) {
            const order = CONFIG.modeOrder.map((_, i) => i).filter((i) => enabledModes[i]);
            this.playOrder = order.length ? order : CONFIG.modeOrder.map((_, i) => i);
        }
    }

    // cambio squadra in lobby: chiunque può spostare chiunque, la validazione
    // 2 contro 2 blocca l'avvio finché la configurazione non è corretta
    setTeam(playerId, seat, team) {
        if (this.status !== "lobby") return;
        if (!(seat >= 0 && seat < 4) || (team !== 0 && team !== 1)) return;
        if (!this.players.find((p) => p.id === playerId)) return;
        this.teams[seat] = team;
        this.emit();
    }

    fillWithBots() {
        let bi = 0;
        while (this.players.length < 4) {
            const seat = this.players.length;
            this.players.push({
                id: `bot-${this.code}-s${seat}`, name: BOT_NAMES[bi], bot: true,
                difficulty: this.difficulty,
                // ---- gioco a coppie ----
                gameType: this.gameType,
                teams: this.teams,
                teamsValid: this.teamsValid(),
                teamScores: [this.teamScore(0), this.teamScore(1)],
                teamHandScores: [this.teamHandScore(0), this.teamHandScore(1)],
                positiveLeft: this.positiveLeft,
                negativeLeft: this.negativeLeft,
                usedNegatives: this.usedNegatives,
                phase: this.phase,                 // "propose" | "decide" | null
                proposer: this.proposer,
                decider: this.decider,
                proposals: this.proposals,
                availableToMe: seat >= 0 && this.gameType === "teams" ? this.availableFor(this.teamOf(seat)) : [],
                handsPlayed: this.handsPlayed, diffLabel: DIFF_LABEL[this.difficulty],
                connected: true, seat,
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

    // Un giocatore lascia volontariamente (preme Esci).
    // Master -> chiude la partita per tutti. Altro -> avviso + sostituito da bot.
    playerLeaves(playerId) {
        const p = this.players.find((x) => x.id === playerId);
        if (!p || p.bot) return { closed: false };

        if (playerId === this.ownerId) {
            // il proprietario esce: chiude tutto
            this.status = "closed";
            this.closedByMaster = true;
            this.stopWatchdog();
            this.emit();
            return { closed: true };
        }

        // giocatore normale: diventa un bot, la partita continua
        const originalName = p.name;
        this.replacePlayerWithBot(p);
        this.notice = `${originalName} ha lasciato la partita — sostituito da un bot.`;
        this.emit();
        return { closed: false };
    }

    // Come sopra ma per disconnessione involontaria che non rientra in tempo.
    convertToBotIfStillOffline(playerId) {
        const p = this.players.find((x) => x.id === playerId);
        if (!p || p.bot || p.connected) return;
        if (playerId === this.ownerId) {
            this.status = "closed";
            this.closedByMaster = true;
            this.stopWatchdog();
            this.emit();
            return;
        }
        const originalName = p.name;
        this.replacePlayerWithBot(p);
        this.notice = `${originalName} si è disconnesso — sostituito da un bot.`;
        this.emit();
    }

    replacePlayerWithBot(p) {
        // trova un nome bot libero
        const used = new Set(this.players.filter((x) => x.bot).map((x) => x.name));
        const name = BOT_NAMES.find((n) => !used.has(n)) || "Bot";
        p.bot = true;
        p.name = name;
        p.difficulty = this.difficulty;
        p.diffLabel = { easy: "Facile", neutral: "Neutro", hard: "Difficile" }[this.difficulty];
        p.connected = true;
        p.socketId = null;
        p.id = `bot-${this.code}-s${p.seat}`;
        // riavvia il driver: se il turno (o l'attesa briscola) tocca a un bot, prosegue da solo.
        // Chiamata incondizionata perché scheduleBot verifica internamente di chi è il turno.
        if (this.status === "playing") this.scheduleBot();
    }

    // -------- avvio partita --------
    start() {
        if (!this.teamsValid()) return;          // 2 contro 2 obbligatorio
        this.fillWithBots();
        this.totalScores = [0, 0, 0, 0];
        this.modeIndex = 0;
        this.usedNegatives = []; this.positiveLeft = [3, 3]; this.negativeLeft = [4, 4];
        this.handsPlayed = 0; this.negotiatedKey = null;
        // sorteggio iniziale: estrai a caso chi comincia
        this.startSeat = Math.floor(Math.random() * 4);
        this.status = "draw";
        this.message = `Sorteggio: inizia ${this.players[this.startSeat].name}`;
        this.emit();
        // dopo una breve pausa (per mostrare il sorteggio ai client) parte la prima mano
        setTimeout(() => {
            if (this.status !== "draw") return;
            this.startWatchdog();
            if (this.gameType === "teams") return this.startNegotiation(this.startSeat);
            this.status = "playing";
            this.startMode();
        }, 3200);
    }

    /* ================= CONTRATTAZIONE (solo gioco a coppie) =================
       Avviene DENTRO la coppia: chi propone manda due modalità al compagno,
       che ne accetta una oppure ne sceglie una terza. Il seme di "Seme scelto"
       si dichiara già al momento della proposta.                              */
    startNegotiation(seat) {
        clearTimeout(this.negTimer);
        this.negotiatedKey = null; this.negotiatedTrump = null; this.proposals = [];
        // se la squadra di chi tocca proporre ha esaurito le chiamate, passa oltre
        let guard = 0, s = seat;
        while (!this.availableFor(this.teamOf(s)).length && guard++ < 4) s = (s + 1) % 4;
        if (this.matchOver()) { this.status = "gameOver"; this.stopWatchdog(); this.emit(); return; }
        this.proposer = s;
        this.decider = this.partnerOf(s);
        this.phase = "propose";
        this.status = "choosing";
        this.message = `${this.players[s].name} propone due modalità al compagno`;
        this.emit();
        this.scheduleNegotiationBot();
    }

    proposeModes(playerId, list) {
        if (this.status !== "choosing" || this.phase !== "propose") return;
        const seat = this.players.findIndex((p) => p.id === playerId);
        if (seat !== this.proposer) return;
        const t = this.teamOf(seat);
        const disp = this.availableFor(t);
        const clean = (list || [])
            .filter((x) => x && disp.includes(x.key))
            .slice(0, 2)
            .map((x) => ({ key: x.key, trump: x.key === "chosenTrump" ? x.trump : null }));
        // due modalità distinte e, se c'è "Seme scelto", il seme dichiarato
        if (clean.length !== Math.min(2, disp.length)) return;
        if (new Set(clean.map((x) => x.key)).size !== clean.length) return;
        if (clean.some((x) => x.key === "chosenTrump" && !SUITS.includes(x.trump))) return;
        this.proposals = clean;
        this.phase = "decide";
        this.message = `${this.players[this.decider].name} sceglie fra le due proposte`;
        this.emit();
        this.scheduleNegotiationBot();
    }

    decideMode(playerId, key, trump) {
        if (this.status !== "choosing" || this.phase !== "decide") return;
        const seat = this.players.findIndex((p) => p.id === playerId);
        if (seat !== this.decider) return;
        this.applyDecision(key, trump);
    }

    applyDecision(key, trump) {
        if (this.status !== "choosing") return;              // già decisa: non si cambia
        const t = this.teamOf(this.proposer);                // contratta la coppia del proponente
        const proposta = this.proposals.find((x) => x.key === key);
        const ammessa = proposta || this.availableFor(t).includes(key);
        if (!ammessa) return;
        const seme = proposta ? proposta.trump : trump;
        if (key === "chosenTrump" && !SUITS.includes(seme)) return;   // seme obbligatorio
        clearTimeout(this.negTimer);
        this.negotiatedKey = key;
        this.negotiatedTrump = key === "chosenTrump" ? seme : null;
        this.consumeMode(key, t);
        this.phase = null;
        this.status = "playing";
        this.startMode();
    }

    // i bot propongono e decidono da soli, con la stessa pausa delle giocate
    scheduleNegotiationBot() {
        clearTimeout(this.negTimer);
        const seat = this.phase === "propose" ? this.proposer : this.decider;
        if (!this.players[seat] || !this.players[seat].bot) return;
        this.negTimer = setTimeout(() => {
            if (this.status !== "choosing") return;
            if (this.phase === "propose") {
                const disp = this.availableFor(this.teamOf(this.proposer));
                const pool = [...disp].sort(() => Math.random() - 0.5).slice(0, 2);
                this.proposeModes(this.players[this.proposer].id, pool.map((k) => ({
                    key: k, trump: k === "chosenTrump" ? SUITS[Math.floor(Math.random() * 4)] : null,
                })));
            } else {
                const alt = this.availableFor(this.teamOf(this.decider))
                    .filter((k) => !this.proposals.some((x) => x.key === k));
                if (Math.random() < 0.66 || !alt.length) {
                    const x = this.proposals[Math.floor(Math.random() * this.proposals.length)];
                    this.applyDecision(x.key, x.trump);
                } else {
                    const k = alt[Math.floor(Math.random() * alt.length)];
                    this.applyDecision(k, k === "chosenTrump" ? SUITS[Math.floor(Math.random() * 4)] : null);
                }
            }
        }, 1600 + Math.random() * 500);
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
        this.dominoEndTurn = null;
        this.brokenSuits = new Set();
        this.penaltyCardsSeen = 0;
        this.blindBy = null;
        this.blindDecision = null;
        const key = this.modeKey;
        // seme protetto (spezzare): dal CONFIG, o la briscola per le mani positive
        this.protectedSuit = this.mode.protectedSuit || null;
        // chi inizia: nelle coppie è chi ha contrattato la mano (il sorteggiato
        // alla prima, poi la rotazione); in classica la rotazione dal sorteggiato
        const starter = this.gameType === "teams"
            ? this.proposer
            : (this.startSeat + this.modeIndex) % 4;
        this.trickStarter = starter;
        this.turn = starter;
        this.awaitingTrump = false;

        if (key === "chosenTrump" && this.gameType === "teams") {
            // il seme è stato dichiarato durante la contrattazione: nessuna attesa
            this.trump = this.negotiatedTrump;
            this.protectedSuit = this.trump;
            this.message = `Briscola dichiarata: ${this.trump}`;
        } else if (key === "chosenTrump") {
            if (this.players[starter].bot) {
                this.trump = botChooseTrump(dealt[starter], this.players[starter].difficulty);
                this.protectedSuit = this.trump; // la briscola non si apre finché non spezzata
                this.message = `${this.players[starter].name} sceglie briscola: ${this.trump}`;
            } else {
                this.awaitingTrump = true;
                this.message = "In attesa della scelta della briscola";
            }
        } else if (key === "hiddenTrump") {
            this.trump = null;           // senza briscola: comanda solo il seme di chi apre
            this.protectedSuit = null;   // niente spezzare
            this.message = "Senza briscola: comanda il seme di chi apre";
        } else if (key === "domino") {
            // domino: inizia chi ha il 7 di denari (eccezione, non rompe la rotazione)
            const s = dealt.findIndex((h) => h.some((c) => c.rank === "7" && c.suit === "diamonds"));
            this.trickStarter = s; this.turn = s;
            this.message = "Domino: parti dai 7";
            // regola dei 4 estremi: un bot con 4+ tra Assi e Re può rimescolare
            const extremesOf = (h) => h.filter((c) => c.rank === "A" || c.rank === "K").length;
            const botReshuffle = this.players.findIndex((p, i) => p.bot && botDecidesReshuffle(extremesOf(dealt[i]), p.difficulty));
            if (botReshuffle !== -1 && (this._reshuffleCount || 0) < 3) {
                this._reshuffleCount = (this._reshuffleCount || 0) + 1;
                this.message = `${this.players[botReshuffle].name} ha 4 estremi: rimescola`;
                this.emit();
                setTimeout(() => this.startMode(), 1200);
                return;
            }
            this._reshuffleCount = 0;
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
        this.protectedSuit = suit; // spezzare: la briscola scelta è protetta
        this.awaitingTrump = false;
        this.message = `Briscola: ${suit}`;
        this.emit();
        this.scheduleBot();
    }

    // il giocatore di turno sceglie di giocare "al buio" (punti doppi solo per lui)
    chooseBlind(playerId, yes) {
        if (!this.awaitingTrump) return;
        const p = this.players[this.turn];
        if (p.id !== playerId) return;
        this.blindDecision = !!yes;
        if (yes) this.blindBy = this.turn;
        this.message = yes ? "Al buio! Scegli il seme" : "Scegli il seme";
        this.emit();
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
        const valid = validTrickMoves(hand, this.table, this.trump, this.protectedSuit, this.brokenSuits);
        if (!valid.some((c) => c.id === cardId)) return; // mossa illegale: rifiutata

        this.hands[seat] = hand.filter((c) => c.id !== cardId);
        this.table.push({ card, player: seat });

        if (this.table.length < 4) {
            this.turn = (this.trickStarter + this.table.length) % 4;
            this.emit();
            this.scheduleBot();
        } else {
            // presa completa: prima mostro le 4 carte, poi animo la raccolta verso il vincitore
            this.emit();
            const winner = resolveTrick(this.table, this.trump);
            // calcolo i punti che questa presa assegna (per mostrarli sul vincitore)
            const ctx = { trickNumber: this.trickNumber, totalTricks: 13 };
            let pts = 0;
            for (const p of this.table) pts += this.mode.penalty ? this.mode.penalty(p.card) : 0;
            if (this.mode.trickPenalty) pts += this.mode.trickPenalty(ctx);
            if (this.blindBy !== null && winner === this.blindBy && this.mode.positive) pts *= 2;
            setTimeout(() => {
                if (this.status !== "playing" || this.table.length < 4) return;
                this.collecting = winner;   // il client illumina il vincitore e anima le carte
                this.collectingPts = pts;   // punti incassati in questa presa
                this.emit();
            }, 700);
            setTimeout(() => this.resolveCurrentTrick(), 1600);
        }
    }

    resolveCurrentTrick() {
        // guardia: risolvi solo se la presa è davvero completa (4 carte).
        if (this.status !== "playing" || this.table.length < 4) return;
        const winner = resolveTrick(this.table, this.trump);
        const ctx = { trickNumber: this.trickNumber, totalTricks: 13 };
        let pts = 0;
        for (const p of this.table) pts += this.mode.penalty ? this.mode.penalty(p.card) : 0;
        if (this.mode.trickPenalty) pts += this.mode.trickPenalty(ctx);
        // "al buio": chi ha scelto il buio prende punti doppi sulle prese che vince
        if (this.blindBy !== null && winner === this.blindBy && this.mode.positive) pts *= 2;

        // aggiorna i semi spezzati (chi ha scartato fuori-seme spezza quel seme)
        this.brokenSuits = updateBrokenSuits(this.table, this.brokenSuits);
        // conta le carte penalizzanti raccolte (per la fine anticipata)
        const penInTrick = this.mode.totalPenaltyCards
            ? this.table.filter((p) => this.mode.penalty && this.mode.penalty(p.card) !== 0).length
            : 0;
        this.penaltyCardsSeen += penInTrick;

        this.handScores[winner] += pts;
        this.tricksWon[winner] += 1;
        this.message = `${this.players[winner].name} vince la presa${pts ? ` (${pts > 0 ? "+" : ""}${pts})` : ""}`;
        this.table = [];
        this.collecting = null;
        this.collectingPts = 0;
        this.trickNumber += 1;

        // fine anticipata: se tutte le penalità sono state raccolte, la mano finisce
        const allPenaltiesGone = this.mode.totalPenaltyCards && this.penaltyCardsSeen >= this.mode.totalPenaltyCards;
        if (this.trickNumber >= 13 || allPenaltiesGone) { this.finishMode(); return; }
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
        const v = dominoValue(card.rank);
        this.dominoBoard[card.suit] = b ? { low: Math.min(b.low, v), high: Math.max(b.high, v) } : { low: v, high: v };
        this.hands[seat] = hand.filter((c) => c.id !== cardId);
        if (this.hands[seat].length === 0) {
            if (!this.dominoFinished.includes(seat)) this.dominoFinished.push(seat);
            // REGOLA DI COPPIA: appena uno dei due finisce le carte, la coppia ha
            // chiuso e la mano termina subito; le carte rimaste al compagno non
            // vengono conteggiate. Vale solo nel gioco a coppie.
            if (this.gameType === "teams") return this.finishDominoTeams(seat);
            // il primo che svuota la mano: si completa il giro fino a chi ha iniziato
            if (this.dominoEndTurn === null) this.dominoEndTurn = this.trickStarter;
        }
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
        // se qualcuno ha finito, completa il giro fino all'iniziale, poi chiudi
        if (this.dominoEndTurn !== null) {
            for (let step = 1; step <= 4; step++) {
                const n = (seat + step) % 4;
                if (n === this.dominoEndTurn) { return this.finishDomino(); } // giro completato
                if (this.hands[n].length > 0) { this.turn = n; this.emit(); this.scheduleBot(); return; }
            }
            return this.finishDomino();
        }
        // gioco normale: passa al prossimo con carte
        let n = (seat + 1) % 4, guard = 0;
        while (this.hands[n].length === 0 && guard < 4) { n = (n + 1) % 4; guard++; }
        this.turn = n;
        this.emit();
        this.scheduleBot();
    }

    // punteggio Domino a coppie: la coppia che chiude non paga nulla, nemmeno le
    // carte del compagno; l'altra paga tutte le sue e il bottino va a chi ha chiuso
    finishDominoTeams(seatChiuso) {
        const tChiusa = this.teamOf(seatChiuso);
        const hs = [0, 0, 0, 0];
        let bottino = 0;
        for (let i = 0; i < 4; i++) {
            if (this.teamOf(i) === tChiusa) continue;          // coppia chiusa: carte ignorate
            hs[i] = -this.hands[i].length;
            bottino += this.hands[i].length;
        }
        hs[seatChiuso] += bottino;
        this.handScores = hs;
        const nome = tChiusa === 0 ? "Blu" : "Rossa";
        this.message = `La squadra ${nome} ha chiuso: le carte del compagno non contano`;
        this.finishMode();
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
        if (this.gameType === "teams") {
            this.handsPlayed += 1;
            if (this.matchOver()) { this.status = "gameOver"; this.stopWatchdog(); this.emit(); return; }
            // la mano successiva la contratta la coppia avversaria: si ruota di un posto
            return this.startNegotiation((this.proposer + 1) % 4);
        }
        if (this.modeIndex + 1 >= this.totalModes) { this.status = "gameOver"; this.stopWatchdog(); this.emit(); return; }
        this.modeIndex += 1;
        this.status = "playing";
        this.startMode();
    }

    // -------- bot driver --------
    scheduleBot() {
        clearTimeout(this.botTimer);
        this.botPending = false;
        if (this.status !== "playing") return;
        if (!this.players[this.turn] || !this.players[this.turn].bot) return;

        this.botPending = true;
        this.botTimer = setTimeout(() => {
            this.botPending = false;
            // rileggo SEMPRE il giocatore di turno al momento dell'esecuzione:
            // il turno può essere cambiato tra la schedulazione e lo scatto del timer
            // (es. dopo che un giocatore uscito è diventato bot).
            if (this.status !== "playing") return;
            const seat = this.turn;
            const p = this.players[seat];
            if (!p || !p.bot) return;

            if (this.awaitingTrump && this.modeKey === "chosenTrump") {
                this.trump = botChooseTrump(this.hands[seat], p.difficulty);
                this.awaitingTrump = false;
                this.message = `${p.name} sceglie briscola`;
                this.emit();
                return this.scheduleBot();
            }
            if (this.modeKey === "domino") {
                const valid = dominoValidCards(this.hands[seat], this.dominoBoard);
                if (valid.length) {
                    const seven = valid.find((c) => c.rank === "7");
                    this.dominoPlay(seat, (seven || valid[Math.floor(Math.random() * valid.length)]).id);
                } else this.afterDomino(seat);
                return;
            }
            const valid = validTrickMoves(this.hands[seat], this.table, this.trump, this.protectedSuit, this.brokenSuits);
            if (!valid.length) return;
            const ctx = { trickNumber: this.trickNumber, totalTricks: 13 };
            const card = botChooseCard(this.hands[seat], valid, this.table, this.trump, this.modeKey, p.difficulty, ctx);
            this.playCard(p.id, card.id);
            // pausa con una piccola variazione: a intervalli identici i bot
            // sembrano un metronomo invece che giocatori
        }, 1400 + Math.random() * 350);
    }

    // Watchdog anti-stallo: rilancia il driver SOLO se il turno è di un bot fermo
    // e non c'è già un'azione bot in volo (così non resetta all'infinito il timer).
    startWatchdog() {
        clearInterval(this.watchdog);
        this.watchdog = setInterval(() => {
            if (this.status !== "playing") return;
            if (this.botPending) return;                        // c'è già un'azione schedulata
            const p = this.players[this.turn];
            if (!p || !p.bot) return;                           // turno umano: si aspetta
            if (this.table.some((t) => t.player === this.turn)) return;
            this.scheduleBot();                                 // bot fermo: rilancia
        }, 1500);
    }
    stopWatchdog() { clearInterval(this.watchdog); }

    // -------- viste per giocatore (nascondono le carte altrui e la briscola nascosta) --------
    stateFor(playerId) {
        const seat = this.players.findIndex((p) => p.id === playerId);
        return {
            code: this.code,
            status: this.status,
            ownerId: this.ownerId,
            youSeat: seat,
            difficulty: this.difficulty,
            // ---- gioco a coppie ----
            gameType: this.gameType,
            teams: this.teams,
            teamsValid: this.teamsValid(),
            teamScores: [this.teamScore(0), this.teamScore(1)],
            teamHandScores: [this.teamHandScore(0), this.teamHandScore(1)],
            positiveLeft: this.positiveLeft,
            negativeLeft: this.negativeLeft,
            usedNegatives: this.usedNegatives,
            phase: this.phase,                 // "propose" | "decide" | null
            proposer: this.proposer,
            decider: this.decider,
            proposals: this.proposals,
            availableToMe: seat >= 0 && this.gameType === "teams" ? this.availableFor(this.teamOf(seat)) : [],
            handsPlayed: this.handsPlayed,
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
            playOrder: this.playOrder,          // mani effettivamente in gioco
            totalModes: this.totalModes,
            startSeat: this.startSeat,          // sorteggiato che ha iniziato
            hidden: !!this.mode.hidden,
            isTrickMode: this.mode.trick !== false,
            trump: this.mode.hidden ? null : this.trump, // briscola nascosta non inviata
            table: this.table,
            collecting: this.collecting ?? null, // seat vincitore mentre le carte si raccolgono
            collectingPts: this.collectingPts ?? 0, // punti incassati nella presa
            turn: this.turn,
            trickNumber: this.trickNumber,
            handScores: this.handScores,
            totalScores: this.totalScores,
            tricksWon: this.tricksWon,
            awaitingTrump: this.awaitingTrump,
            blindBy: this.blindBy,              // chi gioca al buio
            blindDecision: this.blindDecision,  // null=deve decidere, true=al buio, false=vede
            protectedSuit: this.mode.hidden ? null : this.protectedSuit, // seme non apribile (nascosto se briscola hidden)
            brokenSuits: [...this.brokenSuits], // semi già spezzati (array per serializzazione)
            dominoBoard: this.dominoBoard,
            message: this.message,
            notice: this.notice || null,
            closedByMaster: !!this.closedByMaster,
            // al buio: la mia mano è coperta finché non ho scelto il seme
            myHandHidden: (this.modeKey === "chosenTrump" && this.awaitingTrump && this.turn === seat && this.blindDecision !== false),
            myHand: seat >= 0 ? this.hands[seat] : [],
        };
    }

    emit() {
        for (const p of this.players) {
            if (!p.bot && p.socketId) this.io.to(p.socketId).emit("state", this.stateFor(p.id));
        }
    }
}
