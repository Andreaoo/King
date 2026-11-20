// Collegamento a Supabase (solo chiave PUBBLICA: la chiave segreta sta soltanto sul server).
import { createClient } from "@supabase/supabase-js";

const URL_ = (import.meta.env.VITE_SUPABASE_URL || "https://ceycjtxfsjcjehaazvbk.supabase.co").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_Tr93bHKpDFrJcyoDPxH8eg_hMM5MQu4";

// RICORDAMI: con la spunta la sessione sta in localStorage (resta dopo la chiusura del
// browser e il riavvio); senza, in sessionStorage (finisce quando si chiude il browser).
// La password non viene MAI salvata: Supabase conserva solo i token di sessione.
const REMEMBER = "ck_remember";
export function setRemember(on) { try { localStorage.setItem(REMEMBER, on ? "1" : "0"); } catch { /* ignora */ } }
export function getRemember() { try { return localStorage.getItem(REMEMBER) !== "0"; } catch { return true; } }
const storage = {
  getItem: (k) => { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  setItem: (k, v) => {
    try {
      if (getRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
      else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
    } catch { /* ignora */ }
  },
  removeItem: (k) => { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* ignora */ } },
};

export const supabase = createClient(URL_, KEY, {
  auth: {
    storage, storageKey: "ck_auth", persistSession: true, autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "implicit",   // il link di conferma funziona anche se aperto su un altro dispositivo
  },
});

// Identità OSPITE: id + segreto casuali, sul dispositivo. Il server salva solo l'hash del
// segreto: serve per le statistiche da ospite e per trasferirle all'account registrandosi.
const GUEST = "ck_guest";
function rand(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return Array.from(a, (x) => x.toString(16).padStart(2, "0")).join(""); }
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const h = rand(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function getGuest() {
  try {
    const g = JSON.parse(localStorage.getItem(GUEST) || "null");
    if (g && g.id && g.secret) return g;
  } catch { /* ignora */ }
  const g = { id: uuid(), secret: rand(24) };
  try { localStorage.setItem(GUEST, JSON.stringify(g)); } catch { /* ignora */ }
  return g;
}
// dopo il trasferimento all'account si riparte con una nuova identità ospite
export function resetGuest() { try { localStorage.removeItem(GUEST); } catch { /* ignora */ } }

// messaggi di Supabase tradotti in italiano chiaro
export function authError(e) {
  const m = String(e?.message || e || "");
  if (/invalid login credentials/i.test(m)) return "Email o password non corretti.";
  if (/email not confirmed/i.test(m)) return "Devi prima confermare l’email: apri il messaggio che ti abbiamo mandato e tocca il link.";
  if (/already registered|already been registered|user already exists/i.test(m)) return "Esiste già un account con questa email. Prova ad accedere.";
  if (/database error saving new user/i.test(m)) return "Nome utente già in uso: scegline un altro.";
  if (/rate limit|too many/i.test(m)) return "Troppi tentativi o troppe email inviate. Riprova tra qualche minuto.";
  if (/password should be at least|weak password/i.test(m)) return "Password troppo debole: usa almeno 8 caratteri.";
  if (/same password|different from the old/i.test(m)) return "La nuova password deve essere diversa da quella attuale.";
  if (/invalid email|unable to validate email/i.test(m)) return "Indirizzo email non valido.";
  if (/fetch|network|failed to/i.test(m)) return "Connessione assente o servizio non raggiungibile. Riprova.";
  return m || "Si è verificato un errore. Riprova.";
}
