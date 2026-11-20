# King online: cosa è pronto e come completare la configurazione

## Già funzionante (provato)

| Funzione | Come funziona |
|---|---|
| Schermata iniziale | Copertina King, poi **Gioca come ospite** con nickname. |
| Stanze solo private | Non esiste nessun elenco pubblico. Si entra **solo** con il link d'invito o con il codice partita, e il server li verifica. Conoscere l'indirizzo `/room/…` di una partita non basta per entrare. |
| Invito automatico | `https://…/invite/SEGRETO` (96 bit). Chi apre il link vede chi lo invita, sceglie il nickname e finisce **direttamente nella sala d'attesa**. Il link resta salvato anche se ricarica la pagina. |
| Codice partita | 6 caratteri (≈ 1 miliardo di combinazioni). Dopo 12 tentativi sbagliati l'indirizzo IP viene bloccato per 10 minuti. |
| Sala d'attesa | Nome della stanza, codice, COPIA CODICE, CONDIVIDI INVITO, link completo, giocatori con 👑 proprietario, pallino di connessione, «pronto», posti liberi, INIZIA PARTITA. |
| Proprietario | Rimuove un giocatore (che non può più rientrare), chiude la stanza, rigenera link e codice (i vecchi smettono di funzionare). |
| Proprietario che se ne va | Il ruolo passa automaticamente a un altro giocatore. Se è offline, chiunque al tavolo può avviare la mano successiva. |
| Disconnessioni | Il posto viene tenuto per 90 s, poi gioca un bot. Al rientro la persona riprende il proprio posto. |
| Errori chiari | Invito non valido, invito revocato o scaduto (24 h), stanza piena, partita già iniziata, partita terminata, stanza chiusa dal proprietario, rimosso dal proprietario, troppi tentativi, server che non risponde. |

## Account (Supabase): cosa è già fatto e cosa manca

**Fatto e provato** contro il tuo progetto Supabase:
- schermata iniziale con **Gioca come ospite**, **Accedi** e **Registrati**;
- accesso con **Ricordami su questo dispositivo**;
- registrazione, recupero password e messaggi d'errore in italiano.

Indirizzo e chiave pubblica del progetto sono già nel codice: non sono segreti.

**Fatto ma da provare** appena c'è la chiave segreta:
- profilo, cambio password, uscita ed eliminazione dell'account;
- statistiche e storico;
- statistiche degli ospiti e loro trasferimento all'account;
- ingresso automatico nella stanza dopo l'accesso o la conferma email.

**Cosa devi fare tu (una volta sola):**

1. **Permessi del database.** Supabase → SQL Editor → New query: incolla [`supabase/grants.sql`](../supabase/grants.sql) e premi **Run**.
2. **Indirizzi consentiti.** Authentication → URL Configuration:
   - **Site URL:** `https://cart-king.onrender.com`
   - **Redirect URLs:** aggiungi `https://cart-king.onrender.com/**` e `http://localhost:3001/**`
3. **Chiave segreta.** Project Settings → API Keys → *Secret keys*: copia la chiave `sb_secret_…`. **Non incollarla in chat.** Mettila in due posti:
   - **sul PC**, nel file `server/.env`, come nell'esempio [`server/.env.example`](../server/.env.example): `SUPABASE_SECRET_KEY=sb_secret_…`. Il file non va su GitHub.
   - **su Render**, in servizio → Environment: variabile `SUPABASE_SECRET_KEY` con lo stesso valore.
4. **Email.** Il servizio email incluso in Supabase invia solo agli indirizzi dei membri del progetto e ha un limite orario molto basso. Per far registrare gli amici configura un provider: Authentication → Emails → SMTP Settings (Resend o Brevo, gratuiti per piccoli volumi).

## Indirizzo permanente e dominio

- **Indirizzo attuale.** Il gioco è su Render, all'indirizzo `https://cart-king.onrender.com`, che è già permanente. Ogni `git push` sul ramo `main` aggiorna il sito.
- **Dominio tuo.** Per un indirizzo come `kingonline.it`:
  1. Compralo da un registrar, per esempio Aruba, Register.it o Cloudflare.
  2. Su Render apri **Settings → Custom Domains → Add** e inserisci il dominio.
  3. Dal registrar crea il record DNS che Render ti indica (CNAME, oppure A per il dominio senza www).
  4. Su Render imposta `PUBLIC_URL=https://kingonline.it`, così le anteprime dei link su WhatsApp usano il dominio giusto.
- **Piano gratuito.** Su Render il server si addormenta dopo 15 minuti senza giocatori: al primo accesso ci vogliono 30–60 secondi (c'è la schermata di caricamento) e **le stanze in corso si perdono se il server si riavvia**. Per un servizio sempre attivo serve il piano a pagamento più economico, oggi **Starter**.
