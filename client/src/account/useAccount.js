import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, getGuest, resetGuest } from "./supabase.js";

// Stato dell'account: sessione Supabase + profilo. Dopo l'accesso trasferisce
// all'account le partite giocate da ospite su questo dispositivo (verificato dal server).
export function useAccount(serverUrl) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [ready, setReady] = useState(false);
  const [recovery, setRecovery] = useState(false);   // arrivo dal link "recupera password"
  const [notice, setNotice] = useState("");
  const claimed = useRef(new Set());

  const loadProfile = useCallback(async (user) => {
    if (!user) { setProfile(null); return; }
    const { data } = await supabase.from("profiles").select("id,username,nickname,avatar_url,created_at").eq("id", user.id).maybeSingle();
    const meta = user.user_metadata || {};
    setProfile(data || { id: user.id, username: meta.username || null, nickname: meta.nickname || (user.email || "").split("@")[0].slice(0, 14) || "Giocatore", created_at: user.created_at });
  }, []);

  const claimGuest = useCallback(async (s) => {
    if (!s || claimed.current.has(s.user.id)) return;
    claimed.current.add(s.user.id);
    try {
      const r = await fetch(`${serverUrl}/api/account/claim-guest`, {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.access_token}` },
        body: JSON.stringify({ guest: getGuest() }),
      }).then((x) => x.json());
      if (r.ok) {
        if (r.moved > 0) setNotice(r.moved === 1 ? "La partita che hai giocato da ospite è stata aggiunta al tuo account." : `Le ${r.moved} partite che hai giocato da ospite sono state aggiunte al tuo account.`);
        resetGuest();
      }
    } catch { /* riprova al prossimo accesso */ claimed.current.delete(s.user.id); }
  }, [serverUrl]);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session || null);
      loadProfile(data.session?.user || null).finally(() => alive && setReady(true));
      if (data.session) claimGuest(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s || null);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_IN" || event === "USER_UPDATED" || event === "SIGNED_OUT") loadProfile(s?.user || null);
      if (event === "SIGNED_IN" && s) claimGuest(s);
    });
    // link di conferma/recupero: dopo averlo letto si pulisce l'indirizzo dai token
    // (i token li legge e li toglie Supabase stesso; qui si gestisce solo il link scaduto)
    if (/error_description=/.test(window.location.hash)) {
      const err = new URLSearchParams(window.location.hash.slice(1)).get("error_description");
      if (err) setNotice(/expired|invalid/i.test(err) ? "Il link è scaduto o è già stato usato. Richiedine uno nuovo." : err);
      window.history.replaceState(null, "", window.location.pathname);
    }
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadProfile, claimGuest]);

  return {
    ready, session, user: session?.user || null, profile, setProfile, recovery, setRecovery,
    notice, setNotice, accessToken: session?.access_token || null,
    reloadProfile: () => loadProfile(session?.user || null),
  };
}
