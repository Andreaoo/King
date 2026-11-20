// ============================================================================
// Account (Supabase) lato server
//  - verifica dell'utente: il client manda il suo token di accesso, il server lo
//    controlla con Supabase (nessuno può spacciarsi per un altro account);
//  - registrazione delle partite concluse: SOLO qui, con la chiave segreta, una volta
//    per partita (id univoco) → nessun giocatore può modificarsi statistiche o punteggi;
//  - ospiti: identità con segreto (salvato solo come hash), statistiche temporanee e
//    trasferimento all'account quando si registra;
//  - eliminazione dell'account.
// Senza SUPABASE_SECRET_KEY il gioco funziona lo stesso: semplicemente non salva statistiche.
// ============================================================================
import { createHash, randomUUID, timingSafeEqual } from "crypto";
import { readFileSync, existsSync } from "fs";

// server/.env (facoltativo, ignorato da git): utile in locale per la chiave segreta
const ENV_FILE = new URL("../.env", import.meta.url);
if (existsSync(ENV_FILE)) {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
}

// URL e chiave pubblica non sono segreti (sono gli stessi del browser)
export const SB_URL = (process.env.SUPABASE_URL || "https://ceycjtxfsjcjehaazvbk.supabase.co").replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_PUBLIC = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "sb_publishable_Tr93bHKpDFrJcyoDPxH8eg_hMM5MQu4";
const SB_SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
export const statsEnabled = !!SB_SECRET;
if (!statsEnabled) console.log("ℹ️  SUPABASE_SECRET_KEY non impostata: account attivi, ma statistiche e eliminazione account disattivate.");

// le chiavi nuove (sb_secret_…) vanno solo in "apikey"; le vecchie (JWT) anche in Authorization
const secretHeaders = () => SB_SECRET.startsWith("sb_")
    ? { apikey: SB_SECRET }
    : { apikey: SB_SECRET, Authorization: `Bearer ${SB_SECRET}` };

async function rest(path, { method = "GET", body, prefer } = {}) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
        method,
        headers: { ...secretHeaders(), "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
}

// ---------- utente dal token di accesso (con una piccola cache) ----------
const userCache = new Map(); // token → { user, until }
export async function verifyUser(token) {
    if (typeof token !== "string" || token.length < 20 || token.length > 4096) return null;
    const hit = userCache.get(token);
    if (hit && hit.until > Date.now()) return hit.user;
    try {
        const res = await fetch(`${SB_URL}/auth/v1/user`, {
            headers: { apikey: SB_PUBLIC, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return null;
        const u = await res.json();
        const user = u && u.id ? { id: u.id, email: u.email } : null;
        if (user) {
            userCache.set(token, { user, until: Date.now() + 5 * 60 * 1000 });
            if (userCache.size > 2000) userCache.delete(userCache.keys().next().value);
        }
        return user;
    } catch { return null; }
}

// ---------- ospiti ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha = (s) => createHash("sha256").update(String(s)).digest("hex");
// identità ospite mandata dal client: { id: uuid, secret } → { id, hash } oppure null
export function guestFrom(g) {
    if (!g || !UUID.test(String(g.id)) || typeof g.secret !== "string" || g.secret.length < 16 || g.secret.length > 128) return null;
    return { id: g.id.toLowerCase(), hash: sha(g.secret) };
}
const sameHash = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// verifica che l'ospite sia davvero lui; se l'id è nuovo lo registra (il primo che lo usa lo "possiede")
async function ensureGuest(guest, nickname) {
    const r = await rest(`guest_identities?id=eq.${guest.id}&select=id,secret_hash,claimed_by`);
    if (!r.ok) return false;
    if (r.data.length) return sameHash(r.data[0].secret_hash, guest.hash);
    const ins = await rest("guest_identities", { method: "POST", body: { id: guest.id, secret_hash: guest.hash, nickname }, prefer: "return=minimal" });
    return ins.ok;
}

// ---------- registrazione della partita conclusa ----------
// partecipanti: [{ seat, nickname, isBot, team, userId, guest, abandoned }]
export async function recordGame({ gameId, gameType, startedAt, endedAt, handsPlayed, completed, totals, teams, participants, luck }) {
    if (!statsEnabled) return { ok: false, skipped: true };
    // posizione: 1 + quanti hanno fatto meglio (a pari punti la stessa posizione)
    let pos;
    if (gameType === "teams") {
        const t = [0, 1].map((k) => totals.reduce((s, v, i) => s + (teams[i] === k ? v : 0), 0));
        pos = totals.map((_, i) => 1 + (t[1 - teams[i]] > t[teams[i]] ? 1 : 0));
    } else {
        pos = totals.map((v) => 1 + totals.filter((x) => x > v).length);
    }
    const g = await rest("games", { method: "POST", prefer: "return=minimal", body: {
        id: gameId, game_type: gameType, started_at: new Date(startedAt).toISOString(), ended_at: new Date(endedAt).toISOString(),
        hands_played: handsPlayed, completed,
    } });
    if (!g.ok) return { ok: false, status: g.status, error: g.data };   // 409 = già registrata: non si conta due volte
    const rows = [];
    for (const p of participants) {
        let guestId = null;
        if (!p.userId && p.guest && await ensureGuest(p.guest, p.nickname)) guestId = p.guest.id;
        rows.push({
            game_id: gameId, seat: p.seat, user_id: p.userId || null, guest_id: guestId,
            nickname: String(p.nickname || "").slice(0, 14) || "Giocatore", is_bot: !!p.isBot,
            team: gameType === "teams" ? teams[p.seat] : null, final_score: totals[p.seat], position: pos[p.seat],
            result: p.abandoned ? "abandoned" : pos[p.seat] === 1 ? "win" : "loss",
            luck_avg: luck[p.seat] ?? null,
        });
    }
    const gp = await rest("game_players", { method: "POST", body: rows, prefer: "return=minimal" });
    return { ok: gp.ok, status: gp.status, error: gp.ok ? null : gp.data };
}
export const newGameId = () => randomUUID();

// ---------- storico di un ospite (statistiche temporanee) ----------
export async function guestHistory(guestRaw) {
    const guest = guestFrom(guestRaw);
    if (!statsEnabled || !guest) return { ok: false, error: "Statistiche non disponibili." };
    const r = await rest(`guest_identities?id=eq.${guest.id}&select=secret_hash,claimed_by`);
    if (!r.ok || !r.data.length) return { ok: true, games: [] };
    if (!sameHash(r.data[0].secret_hash, guest.hash)) return { ok: false, error: "Identità ospite non valida." };
    const mine = await rest(`game_players?guest_id=eq.${guest.id}&select=game_id`);
    if (!mine.ok) return { ok: false, error: "Errore del database." };
    const ids = mine.data.map((x) => x.game_id);
    if (!ids.length) return { ok: true, games: [] };
    const games = await rest(`games?id=in.(${ids.join(",")})&select=*,game_players(*)&order=ended_at.desc&limit=200`);
    if (!games.ok) return { ok: false, error: "Errore del database." };
    // per l'ospite "io" è la riga con il suo guest_id: gli id degli altri non escono
    return { ok: true, games: games.data.map((g) => ({ ...g, game_players: g.game_players.map((p) => ({
        seat: p.seat, nickname: p.nickname, is_bot: p.is_bot, team: p.team, final_score: p.final_score,
        position: p.position, result: p.result, luck_avg: p.luck_avg, me: p.guest_id === guest.id })) })) };
}

// ---------- trasferimento ospite → account ----------
export async function claimGuest(user, guestRaw) {
    const guest = guestFrom(guestRaw);
    if (!statsEnabled) return { ok: false, error: "Statistiche non attive sul server." };
    if (!guest) return { ok: false, error: "Identità ospite non valida." };
    const r = await rest(`guest_identities?id=eq.${guest.id}&select=secret_hash,claimed_by`);
    if (!r.ok) return { ok: false, error: "Errore del database." };
    if (!r.data.length) return { ok: true, moved: 0 };                         // nessuna partita da ospite
    const row = r.data[0];
    if (!sameHash(row.secret_hash, guest.hash)) return { ok: false, error: "Identità ospite non valida." };
    if (row.claimed_by && row.claimed_by !== user.id) return { ok: false, error: "Queste statistiche sono già state trasferite a un altro account." };
    // partite in cui l'account era GIÀ presente: non si duplicano (resta la riga da ospite, senza account)
    const already = await rest(`game_players?user_id=eq.${user.id}&select=game_id`);
    const skip = already.ok ? already.data.map((x) => x.game_id) : [];
    const filter = `guest_id=eq.${guest.id}&user_id=is.null` + (skip.length ? `&game_id=not.in.(${skip.join(",")})` : "");
    const up = await rest(`game_players?${filter}`, { method: "PATCH", body: { user_id: user.id }, prefer: "return=representation" });
    if (!up.ok) return { ok: false, error: "Errore del database." };
    await rest(`guest_identities?id=eq.${guest.id}`, { method: "PATCH", body: { claimed_by: user.id, claimed_at: new Date().toISOString() }, prefer: "return=minimal" });
    return { ok: true, moved: up.data.length };
}

// ---------- eliminazione dell'account ----------
// il profilo si cancella a cascata; nelle partite passate resta il nickname, senza collegamento all'account
export async function deleteUser(user) {
    if (!statsEnabled) return { ok: false, error: "Eliminazione non disponibile: manca la configurazione del server." };
    const res = await fetch(`${SB_URL}/auth/v1/admin/users/${user.id}`, { method: "DELETE", headers: secretHeaders(), signal: AbortSignal.timeout(10000) });
    userCache.forEach((v, k) => { if (v.user.id === user.id) userCache.delete(k); });
    return res.ok ? { ok: true } : { ok: false, error: "Eliminazione non riuscita. Riprova più tardi." };
}
