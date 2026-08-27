# 🃏 Cart King — Multiplayer online (PWA)

Barbu a 13 mani, mazzo francese 52 carte. Multiplayer online in tempo reale:
si gioca da **telefono, tablet o PC aprendo un link**, senza installare nulla.

> La logica di gioco (regole, 13 modalità, turni, bot, punteggi, Domino, briscola)
> è quella già esistente e **non è stata modificata**. È stato aggiunto solo il
> layer per giocarci online da più dispositivi: link stanza, condivisione, PWA,
> responsive, indicatore di connessione e configurazione di deploy.

```
cart-king-mp/
├── client/   → interfaccia (React + Vite + PWA)
├── server/   → backend autoritativo (Node.js + Socket.IO), serve anche il gioco
├── render.yaml    → deploy gratuito con un click
└── package.json   → comandi di build/avvio
```

---

## 1. URL per giocare online
Dopo il deploy (sezione sotto) ottieni un indirizzo pubblico, per esempio:
`https://cart-king.onrender.com`
È il link che apri tu e che mandi agli amici. In locale invece è `http://localhost:5173` (sviluppo) o `http://localhost:3001` (produzione locale).

## 2. Come avviare il server

**In locale, per sviluppo (due terminali):**
```bash
# terminale 1 — backend
cd server && npm install && npm run dev      # http://localhost:3001
# terminale 2 — frontend
cd client && npm install && npm run dev      # http://localhost:5173
```

**In locale, come in produzione (un solo processo):**
```bash
npm run build      # builda il gioco dentro client/dist
cd server && npm start     # il server serve gioco + multiplayer su :3001
```

## 3. Come creare una stanza
Apri il link → scrivi il tuo nome → **CREA STANZA**. Appare un codice (es. `K7P2`)
e l'URL diventa `.../room/K7P2`. Sei il proprietario: solo tu premi **AVVIA PARTITA**.
I posti liberi vengono riempiti da bot (Facile / Neutro / Difficile).

## 4. Come invitare gli amici
Nella lobby premi **📤 Condividi stanza**:
- su smartphone si apre il menu di condivisione di iOS/Android;
- altrimenti il messaggio viene copiato negli appunti:
  ```
  🃏 Vieni a giocare a Cart King!
  Link: https://.../room/K7P2
  Codice stanza: K7P2
  ```
L'amico apre il link: l'app riconosce la stanza, gli chiede solo il nome ed entra.
In alternativa può aprire il sito e digitare il codice in **ENTRA IN UNA STANZA**.

## 5. Come installare la PWA sul telefono
Aprendo il link dal browser il gioco funziona subito. Per aggiungerlo alla schermata Home:
- **iPhone (Safari):** tasto Condividi → “Aggiungi alla schermata Home”.
- **Android (Chrome):** menu ⋮ → “Installa app” / “Aggiungi a schermata Home”.
Si apre a schermo intero con icona e nome “Cart King”. L'installazione è opzionale.

## 6. Variabili / configurazioni per il deploy
- `PORT` — porta del server (Render la imposta da sola).
- `CLIENT_ORIGIN` — opzionale: limita il CORS a un dominio. Se assente accetta tutti.
- `VITE_SERVER_URL` — solo se tieni frontend e backend **separati** (vedi `client/.env.example`).
  Con il deploy consigliato (un unico servizio) **non serve impostare nulla**.

---

## Deploy gratuito (consigliato: Render)
1. Crea un account su render.com e carica questo progetto su un repo GitHub.
2. Su Render: **New → Blueprint**, seleziona il repo. Il file `render.yaml` configura tutto:
   builda il client e avvia il server sul piano **free**.
3. Attendi il deploy: ottieni l'URL pubblico. È già pronto per giocare e installabile come PWA.

Un unico servizio serve sia il gioco sia il multiplayer, quindi frontend e backend
stanno sullo stesso indirizzo e non c'è nulla da collegare a mano.
Nota sul piano free: dopo qualche minuto di inattività il server “si addormenta”; la
prima apertura dopo una pausa può metterci ~30 secondi a svegliarsi. Poi è immediato.

## Giocare in casa senza deploy (stessa rete Wi-Fi)
```bash
cd server && npm install && npm run dev
cd client && npm install && npm run dev -- --host
```
Metti l'IP del tuo PC in `client/.env` (`VITE_SERVER_URL=http://TUO-IP:3001`) e fai
aprire agli amici `http://TUO-IP:5173`.

---

## Regole e punteggi (invariati, in un solo file)
Tutte le penalità sono in `server/src/engine.js`, oggetto `CONFIG`:

| Mano | Regola | Punti |
|---|---|---|
| 1 | No Re e Fanti | −1 a carta |
| 2 | No Donne | −1 a carta |
| 3 | No 8 di Quadri | −8 |
| 4 | No Re di Cuori | −8 |
| 5 | No Cuori | −1 a carta |
| 6 | Ultime due prese | −4 a presa |
| 7 | No prese | −1 a presa |
| 8 | Domino | chi resta con carte −1/carta; il primo che finisce incassa il totale |
| 9–12 | Seme scelto (briscola) | +1 a presa |
| 13 | Briscola nascosta | +2 a presa |

## Test superato (scenario del brief, punto 13)
Verificato con test automatici: PC crea, due telefoni entrano (uno via codice, uno
via link), un tablet/PC entra; tutti vedono gli stessi giocatori, turni e modalità
sincronizzati, carte propagate in tempo reale, **punteggi finali identici su tutti i
dispositivi** al termine delle 13 mani. Riconnessione automatica dopo caduta di rete.
