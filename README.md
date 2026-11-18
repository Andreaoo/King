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

## 5. Come installare l'app KING sul telefono
Aprendo il link dal browser il gioco funziona subito. Per averlo come app sulla schermata Home:
- **Android (Chrome):** nella home del gioco compare il riquadro **📲 Installa KING** → **INSTALLA**.
  In alternativa: menu ⋮ → “Installa app” (o “Aggiungi a schermata Home”).
- **iPhone / iPad (Safari):** tasto **Condividi** (quadrato con la freccia) → **Aggiungi alla schermata Home**
  → **Aggiungi**. Il riquadro nella home del gioco ricorda questi passaggi.
Si apre a schermo intero, senza barre del browser, con icona e nome “KING”. L'installazione è opzionale;
se l'app è già installata il riquadro non compare.

**Come funziona (file):** `client/public/manifest.webmanifest` (nome, colori, icone),
`client/public/sw.js` (service worker), `client/public/icons/` (icone 48–512 px, maskable, Apple),
`client/public/splash/` (schermate di avvio iOS, verticali e orizzontali), meta tag in `client/index.html`.
Il service worker salva solo il guscio dell'app (pagina, JS/CSS, carte, icone): **non** tocca mai
`/socket.io` né `/api/`, quindi partite, chat, allegati e sessioni restano sempre live.
Gli aggiornamenti: la pagina viene sempre chiesta prima alla rete, quindi una nuova versione arriva
alla riapertura dell'app; la partita in corso non si perde perché la sessione si riprende da sola.

**Provarla in locale:** `npm run build`, poi `cd server && npm start` e apri `http://localhost:3001`
(il service worker funziona su `localhost` anche senza HTTPS). In Chrome: DevTools → Application →
Manifest / Service workers; per l'offline spunta “Offline” e ricarica: si apre il guscio dell'app.
Da telefono serve HTTPS (sull'IP di casa il service worker non parte): usa il deploy su Render.

## Connessione stabile (telefono in background, rete che cade)
- Ogni giocatore riceve dal server un **token di sessione** segreto (salvato nel telefono). Con quello,
  dopo una caduta, una ricarica o la chiusura della scheda, rientra **da solo** al suo posto con carte,
  turno e punti; senza token nessuno può prendere il posto di un altro.
- Il server se ne accorge dopo ~30 s senza risposta (battito ogni 10 s); poi tiene il posto per
  altri **90 s**. Solo dopo il posto passa a un bot (il proprietario che non torna chiude la stanza, come prima).
- Quando l'app torna in primo piano (WhatsApp, schermo sbloccato, rete tornata) verifica subito il
  collegamento e, se serve, si ricollega senza aspettare.
- Se la stessa partita viene aperta in un'altra scheda, quella vecchia si ferma con “Gioca qui”.

## 6. Variabili / configurazioni per il deploy
- `PORT` — porta del server (Render la imposta da sola).
- `CLIENT_ORIGIN` — opzionale: limita il CORS a un dominio. Se assente accetta tutti.
- `VITE_SERVER_URL` — solo se tieni frontend e backend **separati** (vedi `client/.env.example`).
  Con il deploy consigliato (un unico servizio) **non serve impostare nulla**.
- `CHAT_MAX_FILE_MB` — dimensione massima di ogni allegato in chat (predefinito 20).
- `CHAT_ROOM_QUOTA_MB` — spazio totale per gli allegati di una stanza (predefinito 200).
- `RECONNECT_GRACE_S` — secondi in cui il posto resta a chi è caduto (predefinito 90).
- `PING_INTERVAL_S` / `PING_TIMEOUT_S` — battito e tolleranza della connessione (predefiniti 10 e 20).
- `GIPHY_API_KEY` — opzionale: attiva la ricerca di GIF online. Senza chiave si possono
  comunque inviare GIF dal proprio dispositivo.

---

## Chat
Pulsante dorato in basso a destra (si trascina dove si vuole), presente dalla lobby a fine partita.
Chat del tavolo e privati 1-a-1, allegati (PNG, JPG, WEBP, GIF, PDF, DOCX, XLSX, TXT), emoji,
GIF, risposte, reazioni, "sta scrivendo", notifiche. Tre modalità: laterale, metà schermo,
schermo intero; il bordo sinistro si trascina per ridimensionare.

- Codice: `server/src/chat.js` (messaggi e permessi), `server/src/chatFiles.js` (allegati),
  `client/src/chat/` (interfaccia). Usa lo stesso Socket.IO del gioco.
- I messaggi e i file vivono in memoria / in una cartella temporanea del server e spariscono
  quando la stanza si chiude o il server si riavvia (come le partite).
- Il server decide sempre chi è il mittente; i privati e i loro allegati li vedono solo i due
  interessati; il tipo dei file si controlla sul contenuto, non solo sull'estensione.

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
