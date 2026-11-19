# Indice di fortuna (IF)

Misura quanto erano buone le carte ricevute all'inizio di ogni mano, rispetto alle regole di quella mano. Non misura né come sono state giocate né il risultato. I numeri della calibrazione sono in [indice-fortuna-calibrazione.md](indice-fortuna-calibrazione.md), rigenerato dallo script.

## 1. Idea matematica

Una mano è fortunata se, giocata bene, rende **più punti attesi** della mano tipica di quel gioco. Per ogni gioco *g* e mano *h*:

1. **Punti attesi.** E_g(h) è la media dei punti che la mano ottiene su tutte le possibili distribuzioni delle altre 39 carte e su tutti i possibili giocatori di mano. Si stima con la simulazione.
2. **Indice.** IF_g(h) = 100 · F_g(E_g(h)), dove F_g è la distribuzione di E_g su tutte le mani possibili di quel gioco. L'indice è quindi un **percentile**:
   - 50 = mano mediana;
   - 90 = meglio del 90% delle mani;
   - 0 e 100 sono gli estremi.

Calcolare E_g con un Monte Carlo a ogni mano costerebbe troppo al server, che è gratuito e lento. Per questo E_g si approssima con una formula per gioco:

```
E_g(h) ≈ β0 + Σ_k  β_k · (x_k(h) − μ_k) / σ_k
IF     = 100 · F_g(E_g(h))      (101 quantili salvati, interpolazione lineare)
```

- **x_k** sono le caratteristiche della mano (sezione 2).
- **μ_k e σ_k** sono la media e la deviazione standard di ciascuna caratteristica. Standardizzare rende i pesi confrontabili tra loro.
- **β_k** sono i pesi. **Non li ho scelti io:** li stima una regressione ridge su 120.000 mani per gioco (30.000 distribuzioni giocate dai bot "Difficile" con le regole del server). Ogni peso è quindi l'effetto reale di quella caratteristica, in punti, in quel gioco.

**Finestra di calcolo.** Si calcola a carte appena distribuite. Con «Seme scelto» si calcola **solo dopo la scelta della briscola**. Nel gioco a coppie si calcola dopo che la coppia ha scelto il gioco, perché prima non si sa quali regole valgono.

## 2. Formule per tipo di gioco

**Caratteristiche comuni ai giochi a prese.** Il rango va da 2 = 0 fino ad A = 12.

| Caratteristica | Cosa misura |
|---|---|
| `meanRank` | rango medio delle 13 carte |
| `highs`, `aces`, `kings` | carte alte (J o più), assi, re |
| `lows` | carte basse (2–5) |
| `voids`, `singletons` | semi assenti, semi con una sola carta |
| `longest`, `shape` | seme più lungo; Σ lunghezze² / 13 (quanto è sbilanciata la mano) |
| `exits` | semi che hanno una carta ≤ 5 per "uscire" senza prendere |
| `exposed` | Σ sui semi di max(0, alte − carte ≤ 7): alte senza carte basse a coprirle |

**Giochi negativi.** Comuni + regole del gioco:

| Gioco | Caratteristiche in più |
|---|---|
| No Re e Fanti / No Donne | carte penalizzanti in mano; quante in semi corti (≤ 2 carte); quante con almeno 3 carte più basse dello stesso seme |
| No 8 di Quadri / No K di Cuori | se hai la carta; lunghezza del seme protetto; carte sotto e sopra; (A♥ per No K di Cuori) |
| No Cuori | numero di cuori; cuori alti; cuori bassi |
| Ultime Due Prese, No Prese | solo le comuni (conta la struttura della mano) |

Semi assenti e singoli **aumentano** la fortuna in questi giochi: nella calibrazione i loro pesi escono positivi in tutti i giochi negativi. Il peso è diverso per ogni gioco: in No Re e Fanti, per esempio, `singletons` vale +0,54 e `voids` +0,46.

**Giochi positivi.**
- **Seme scelto:** comuni + caratteristiche misurate rispetto alla briscola scelta:
  - briscole in mano, briscole alte, K/A di briscola, somma dei ranghi di briscola;
  - assi e re negli altri semi;
  - semi assenti e singoli fuori briscola;
  - tagli possibili = min(briscole, carte mancanti nei semi corti).
- **Senza Briscola:** solo le comuni. Comanda il seme di chi apre, quindi contano le carte alte e i semi lunghi.

**Domino.** Nel nostro gioco si fa con le carte e non con le tessere: si parte dai 7 e si sale o scende per seme, con l'Asso più basso del 2. I criteri pensati per le tessere diventano:

| Caratteristica | Criterio di partenza (tessere) |
|---|---|
| `meanDist`: distanza media dal 7 | "vicinanza a 7" |
| `near` (6-7-8) e `far` (A, 2, Q, K) | tessere centrali / estreme |
| `sevens`: quanti 7 | punti di partenza |
| `gaps`: per ogni carta, quante carte intermedie (7 compreso) sono in mano ad altri | "facilità di concatenare" |
| `chained`: carte giocabili usando solo carte proprie | "tessere collegate" |
| `suitsHeld`: semi presenti | "estremi diversi" |

## 3. I pesi

Per ogni gioco la tabella completa è nel file di calibrazione. In sintesi:
- **No Re e Fanti:** il rango medio vale il 20% del peso; singoli, semi assenti, alte e re circa il 10% ciascuno.
- **Seme scelto:** briscole in mano 26%, assi fuori briscola 13%, valore delle briscole 12%.
- **Domino:** la distanza dal 7 vale il 70%. È davvero ciò che decide il domino, come avevi indicato tu.

Un singolo peso va letto **a parità delle altre caratteristiche**. Per esempio in No K di Cuori "avere il K♥" pesa +0,22 *a parità di lunghezza dei cuori*, perché chi ha il K♥ con molti cuori bassi può tenerlo fino a quando lo scarta. Le caratteristiche sono correlate, quindi va guardato il modello intero e non il segno di un peso isolato.

## 4. Confrontabilità fra giochi diversi

I punti di giochi diversi non sono confrontabili: in No Re e Fanti si va da −16 a 0, in Senza Briscola da 0 a +26. Per questo l'indice è il **percentile dentro il proprio gioco**: in ogni gioco l'IF è distribuito in modo uniforme fra 0 e 100. Le 13 mani pesano così tutte uguali nella media, e IF 70 vuol dire «mano migliore del 70% delle mani possibili» in qualunque gioco.

## 5. Errori e distorsioni individuati

1. **Domino con le tessere.** La richiesta descriveva il domino con le tessere, ma il gioco usa le carte. Ho adattato i criteri come spiegato sopra, senza inventare regole.
2. **Briscola e scelta del gioco sono decisioni.** Dopo la scelta l'indice include anche la bontà della scelta: lo chiedeva la specifica, ma va saputo. Lo stesso vale per il gioco scelto dalla coppia nella partita a coppie.
3. **Posizione al tavolo.** Chi apre e l'ordine di gioco non sono "carte". La simulazione le fa variare a caso, così si annullano.
4. **Gioco "al buio".** Raddoppia i punti, ma è una decisione e non viene contato.
5. **Pochi campioni.** Una partita ha 13–14 mani. La media di 13 percentili uniformi ha una deviazione standard di circa 29/√13 ≈ 8. Differenze di 10–15 punti fra due giocatori possono essere pura varianza della fortuna stessa: per questo mostro anche il minimo e il massimo.
6. **Mani della stessa distribuzione non indipendenti.** Le carte buone di uno mancano agli altri, quindi gli indici della stessa mano tendono a compensarsi. È corretto, non è un errore.
7. **Dipendenza dal modello di gioco.** I punti attesi sono quelli di giocatori di livello "Difficile". Con giocatori molto diversi i pesi cambierebbero un po', mentre l'ordine delle mani resta molto simile.
8. **Una caratteristica che domina.** Succede solo nel domino (70% alla distanza dal 7). Non l'ho limitata a mano: un tetto artificiale renderebbe l'indice **meno** fedele alla fortuna reale. Negli altri giochi nessuna caratteristica supera il 26%.
9. **Domino a coppie.** Il punteggio è diverso da quello classico, ma l'indice usa il modello della partita classica. Il fattore di fortuna è lo stesso: liberarsi presto delle carte.
10. **Bug trovato nel motore.** `botChooseTrump` riordinava la costante condivisa `SUITS`, cambiando l'ordine dei semi in tutto il server. Corretto.

## 6. Verifica con la simulazione

`node server/scripts/luck-calibrate.js` (parametri DEALS, VERIFY, ROLLOUTS) fa tre controlli:

- **R² su mani mai viste.** Va da 0,09 a 0,72. È basso nei giochi negativi con una sola carta penalizzante perché il risultato **di una singola mano** dipende molto dalle carte degli altri. È il rumore che la fortuna dei singoli non può spiegare, non un difetto della formula.
- **Verifica indipendente con Monte Carlo.** Per 200 mani si calcola il valore "vero" della mano: la mano resta fissa e le altre 39 carte vengono ridistribuite 150 volte. Poi si confronta l'ordine con quello della formula (correlazione di rango di Spearman). Risultati: tra **0,81** (No K di Cuori) e **0,98** (Seme scelto), quasi tutti sopra 0,88.
- **Calibrazione per fasce.** In tutti i 10 giochi i punti medi realmente ottenuti crescono con regolarità passando dalla fascia 0–20 a quella 80–100.

## 7. Struttura e nuovi giochi

| File | Cosa contiene |
|---|---|
| `server/src/luck/features.js` | le caratteristiche di ogni gioco (una funzione per gioco) |
| `server/src/luck/index.js` | formula, percentile, etichette, classifica |
| `server/src/luck/model.json` | pesi e quantili generati |
| `server/src/luck/sim.js` | simulatore con le regole e i bot del server |
| `server/src/room.js` | `computeLuck()`: calcola l'indice e lo salva in `scoreHistory[].luck` a fine mano (prima non va ai client: rivelerebbe com'è la mano degli altri) |
| `client/src/LuckBoard.jsx` | la classifica nella schermata finale |

**Per aggiungere un gioco:**
1. Aggiungi il gioco a `CONFIG.modes`.
2. Aggiungi una funzione in `FEATURES`.
3. Rilancia lo script di calibrazione.

Se un gioco non ha un modello calibrato, l'indice non viene calcolato: non viene inventato nessun numero.
