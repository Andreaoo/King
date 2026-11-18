import React, { useEffect, useState } from "react";

// Schermata di avvio: sfondo verde, icona grande dell'app e barra di caricamento.
// Resta sopra a tutto finché l'app non è pronta (evento "ck:ready" da App), poi sfuma.
// Gli stili stanno in index.html, così la stessa schermata c'è già prima che parta il JS.
export default function Splash() {
  const [t, setT] = useState(0);          // secondi trascorsi
  const [done, setDone] = useState(!!window.__ckReady);
  const [gone, setGone] = useState(!!window.__ckReady);

  useEffect(() => {
    if (done) return;
    const start = Date.now();
    const iv = setInterval(() => setT((Date.now() - start) / 1000), 250);
    const onReady = () => setDone(true);
    window.addEventListener("ck:ready", onReady);
    return () => { clearInterval(iv); window.removeEventListener("ck:ready", onReady); };
  }, [done]);

  useEffect(() => {
    if (!done) return;
    const tm = setTimeout(() => setGone(true), 450);
    return () => clearTimeout(tm);
  }, [done]);

  if (gone) return null;
  // avanza veloce all'inizio e rallenta: il server gratuito può metterci fino a un minuto a svegliarsi
  const pct = done ? 100 : Math.min(94, 8 + 86 * (1 - Math.exp(-t / 14)));
  const msg = t < 4 ? "Caricamento…"
    : t < 25 ? "Avvio del server in corso…"
    : "Il server si sta svegliando: al primo accesso può servire fino a un minuto.";

  return (
    <div className={`ck-splash${done ? " out" : ""}`} role="status" aria-label="Caricamento di King">
      <img className="ck-splash-icon" src="/icons/icon-512.png" alt="" />
      <div className="ck-splash-bar"><div className="ck-splash-fill" style={{ width: `${pct}%` }} /></div>
      <p className="ck-splash-msg">{msg}</p>
      {t > 75 && !done && (
        <button className="ck-splash-retry" onClick={() => window.location.reload()}>RIPROVA</button>
      )}
    </div>
  );
}
