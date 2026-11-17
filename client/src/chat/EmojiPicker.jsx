import React, { useMemo, useRef, useState } from "react";
import { EMOJI_CATEGORIES } from "./emojiData.js";

// emoji usate di recente e più usate: restano nel browser del giocatore
const STORE = "ck_chat_emoji";
function loadUsage() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { recent: [], freq: {} }; }
  catch { return { recent: [], freq: {} }; }
}
export function recordEmoji(e) {
  const u = loadUsage();
  u.recent = [e, ...u.recent.filter((x) => x !== e)].slice(0, 24);
  u.freq[e] = (u.freq[e] || 0) + 1;
  try { localStorage.setItem(STORE, JSON.stringify(u)); } catch { /* storage pieno o bloccato */ }
}

export default function EmojiPicker({ onPick }) {
  const [q, setQ] = useState("");
  const [usage] = useState(loadUsage);
  const gridRef = useRef(null);
  const sectionRefs = useRef({});

  const sections = useMemo(() => {
    const frequent = Object.entries(usage.freq).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([e]) => ({ e, k: "" }));
    const own = [
      usage.recent.length && { id: "recent", icon: "🕘", name: "Recenti", list: usage.recent.map((e) => ({ e, k: "" })) },
      frequent.length && { id: "frequent", icon: "⭐", name: "Più usate", list: frequent },
    ].filter(Boolean);
    return [...own, ...EMOJI_CATEGORIES];
  }, [usage]);

  const results = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return null;
    const seen = new Set(), out = [];
    for (const c of EMOJI_CATEGORIES)
      for (const x of c.list)
        if (!seen.has(x.e) && x.k.split(" ").some((w) => w.startsWith(t) || (t.length > 2 && w.includes(t)))) {
          seen.add(x.e); out.push(x);
        }
    return out;
  }, [q]);

  const pick = (e) => { recordEmoji(e); onPick(e); };
  const jump = (id) => {
    setQ("");
    requestAnimationFrame(() => {
      const el = sectionRefs.current[id];
      if (el && gridRef.current) gridRef.current.scrollTop = el.offsetTop - gridRef.current.offsetTop;
    });
  };

  const cell = (x) => (
    <button key={x.e} type="button" className="ep-cell" title={x.k.split(" ")[0] || x.e} onClick={() => pick(x.e)}>{x.e}</button>
  );

  return (
    <div className="ep">
      <div className="ep-tabs">
        {sections.map((s) => (
          <button key={s.id} type="button" className="ep-tab" title={s.name} onClick={() => jump(s.id)}>{s.icon}</button>
        ))}
      </div>
      <input className="ep-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca emoji… (es. cuore, risata)"
        autoFocus={window.matchMedia("(hover:hover)").matches /* su telefono non apre la tastiera */} />
      <div className="ep-grid" ref={gridRef}>
        {results ? (
          results.length ? <div className="ep-cells">{results.map(cell)}</div> : <div className="ep-empty">Nessuna emoji trovata</div>
        ) : (
          sections.map((s) => (
            <section key={s.id} ref={(el) => (sectionRefs.current[s.id] = el)}>
              <div className="ep-title">{s.name}</div>
              <div className="ep-cells">{s.list.map(cell)}</div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
