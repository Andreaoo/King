import { useCallback, useEffect, useRef, useState } from "react";

// Stato della chat collegato al socket già usato dal gioco.
// Gli invii hanno un clientId: se la connessione cade a metà, alla riconnessione
// vengono ritrasmessi con lo stesso clientId e il server non crea doppioni.

export const dmId = (a, b) => `dm:${[a, b].sort().join(":")}`;
export const peerOf = (conv, me) => (conv.startsWith("dm:") ? conv.slice(3).split(":").find((u) => u !== me) : null);

const emptyConv = () => ({ messages: [], hasMore: false, loaded: false, loading: false });
const newClientId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

// unisce messaggi nuovi a quelli presenti: niente doppioni, ordine del server (seq),
// i messaggi locali ancora in viaggio restano in fondo
function merge(list, incoming) {
  const byId = new Map(list.map((m) => [m.id, m]));
  for (const m of incoming) {
    if (m.clientId) for (const [k, v] of byId) if (v.local && v.clientId === m.clientId) byId.delete(k);
    byId.set(m.id, { ...m, local: false, status: "sent" });
  }
  const all = [...byId.values()];
  const server = all.filter((m) => !m.local).sort((a, b) => a.seq - b.seq);
  return [...server, ...all.filter((m) => m.local)];
}

export function useChat(socket, { onIncoming } = {}) {
  const [info, setInfo] = useState(null);           // { me, token, config }
  const [roster, setRoster] = useState([]);
  const [convs, setConvs] = useState({ room: emptyConv() });
  const [dmConvs, setDmConvs] = useState([]);        // privati da mostrare tra le schede
  const [typing, setTyping] = useState({});          // conv -> { uid: name }
  const pending = useRef(new Map());                 // clientId -> payload non ancora confermato
  const typingTimers = useRef({});
  const infoRef = useRef(null);
  const convsRef = useRef(convs);
  convsRef.current = convs;
  const onIncomingRef = useRef(onIncoming);
  onIncomingRef.current = onIncoming;

  const patchConv = useCallback((conv, fn) => {
    setConvs((all) => ({ ...all, [conv]: fn(all[conv] || emptyConv()) }));
  }, []);

  const addDm = useCallback((conv) => {
    if (conv.startsWith("dm:")) setDmConvs((l) => (l.includes(conv) ? l : [...l, conv]));
  }, []);

  const loadHistory = useCallback((conv, older = false) => {
    if (!socket) return;
    const cur = convsRef.current[conv] || emptyConv();
    if (older && cur.loading) return;
    const before = older ? cur.messages.find((m) => !m.local)?.seq : undefined;
    patchConv(conv, (c) => ({ ...c, loading: true }));
    socket.emit("chat:history", { conv, before }, (res) => {
      if (!res?.ok) return patchConv(conv, (c) => ({ ...c, loading: false }));
      patchConv(conv, (c) => ({
        ...c, loading: false, loaded: true,
        messages: merge(c.messages, res.messages),
        // la prima pagina decide se ce ne sono altre; le successive aggiornano
        hasMore: res.hasMore,
      }));
    });
  }, [socket, patchConv]);

  const transmit = useCallback((clientId) => {
    const p = pending.current.get(clientId);
    if (!p || !socket) return;
    socket.timeout(10000).emit("chat:send", p, (err, res) => {
      if (err) return;                       // nessuna risposta: si ritenta alla riconnessione
      if (res?.ok) {
        pending.current.delete(clientId);
        patchConv(res.message.conv, (c) => ({ ...c, messages: merge(c.messages, [res.message]) }));
      } else {
        pending.current.delete(clientId);
        patchConv(p.conv, (c) => ({
          ...c,
          messages: c.messages.map((m) => (m.local && m.clientId === clientId ? { ...m, status: "failed", error: res?.error } : m)),
        }));
      }
    });
  }, [socket, patchConv]);

  const hello = useCallback(() => {
    if (!socket) return;
    socket.emit("chat:hello", {}, (res) => {
      if (!res?.ok) return;                  // non ancora nella stanza: arriverà chat:ready
      infoRef.current = { me: res.me, token: res.token, config: res.config };
      setInfo(infoRef.current);
      setRoster(res.roster);
      for (const d of res.dms) {
        addDm(d.conv);
        patchConv(d.conv, (c) => ({ ...c, messages: merge(c.messages, [d.last]) }));
      }
      // storico fresco della stanza e dei privati già aperti (si unisce senza doppioni)
      loadHistory("room");
      for (const [conv, c] of Object.entries(convsRef.current)) if (conv !== "room" && c.loaded) loadHistory(conv);
      for (const id of pending.current.keys()) transmit(id);
    });
  }, [socket, addDm, patchConv, loadHistory, transmit]);

  useEffect(() => {
    if (!socket) return;
    const onMsg = (m) => {
      patchConv(m.conv, (c) => ({ ...c, messages: merge(c.messages, [m]) }));
      addDm(m.conv);
      // chi scrive ha smesso di scrivere
      setTyping((t) => {
        if (!t[m.conv]?.[m.from]) return t;
        const { [m.from]: _, ...rest } = t[m.conv];
        return { ...t, [m.conv]: rest };
      });
      onIncomingRef.current?.(m);
    };
    const onUpd = (m) => patchConv(m.conv, (c) => ({
      ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...m, local: false, status: "sent" } : x)),
    }));
    const onTyping = ({ conv, uid, name, on }) => {
      clearTimeout(typingTimers.current[conv + uid]);
      setTyping((t) => {
        const cur = { ...(t[conv] || {}) };
        if (on) cur[uid] = name; else delete cur[uid];
        return { ...t, [conv]: cur };
      });
      if (on) typingTimers.current[conv + uid] = setTimeout(() => onTyping({ conv, uid, name, on: false }), 5000);
    };
    socket.on("chat:ready", hello);
    socket.on("chat:msg", onMsg);
    socket.on("chat:upd", onUpd);
    socket.on("chat:typing", onTyping);
    socket.on("chat:roster", setRoster);
    if (socket.connected) hello();
    return () => {
      socket.off("chat:ready", hello);
      socket.off("chat:msg", onMsg);
      socket.off("chat:upd", onUpd);
      socket.off("chat:typing", onTyping);
      socket.off("chat:roster", setRoster);
    };
  }, [socket, hello, patchConv, addDm]);

  const send = useCallback(({ conv, text, replyTo, attachments, localAttachments, gif }) => {
    const me = infoRef.current?.me;
    if (!me) return;
    const clientId = newClientId();
    const payload = { conv, text, replyTo: replyTo?.id || null, attachments: attachments || [], gif: gif || null, clientId };
    pending.current.set(clientId, payload);
    const mine = roster.find((p) => p.uid === me);
    patchConv(conv, (c) => ({
      ...c,
      messages: [...c.messages, {
        id: "local-" + clientId, local: true, status: "sending", clientId, conv, from: me, name: mine?.name || "",
        ts: Date.now(), text: (text || "").trim(), attachments: localAttachments || [], gif: gif || null,
        replyTo: replyTo || null, reactions: [], deleted: false,
      }],
    }));
    transmit(clientId);
  }, [roster, patchConv, transmit]);

  const retry = useCallback((m) => {
    pending.current.set(m.clientId, {
      conv: m.conv, text: m.text, replyTo: m.replyTo?.id || null, gif: m.gif,
      attachments: (m.attachments || []).map((a) => a.id), clientId: m.clientId,
    });
    patchConv(m.conv, (c) => ({ ...c, messages: c.messages.map((x) => (x.id === m.id ? { ...x, status: "sending", error: null } : x)) }));
    transmit(m.clientId);
  }, [patchConv, transmit]);

  const discard = useCallback((m) => {
    pending.current.delete(m.clientId);
    patchConv(m.conv, (c) => ({ ...c, messages: c.messages.filter((x) => x.id !== m.id) }));
  }, [patchConv]);

  const call = useCallback((ev, payload) => new Promise((resolve) => {
    if (!socket) return resolve({ ok: false });
    socket.timeout(8000).emit(ev, payload, (err, res) => resolve(err ? { ok: false, error: "Nessuna risposta" } : res));
  }), [socket]);

  const setTypingOn = useCallback((conv, on) => socket?.emit("chat:typing", { conv, on }), [socket]);
  const closeDm = useCallback((conv) => setDmConvs((l) => l.filter((c) => c !== conv)), []);

  return { info, roster, convs, dmConvs, typing, loadHistory, send, retry, discard, call, setTypingOn, addDm, closeDm };
}
