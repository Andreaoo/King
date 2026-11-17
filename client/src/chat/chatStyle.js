// Stile della chat: scuro, accenti oro come il resto di KING; i privati in viola
// per non confonderli mai con la chat del tavolo.
export const CHAT_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap');
.ck-chat {
  --c-bg:#0d1a14; --c-bg2:#12241b; --c-line:rgba(217,178,95,.18); --c-gold:#d9b25f; --c-gold2:#b8923f;
  --c-text:#eef3ee; --c-muted:#93a89b; --c-mine:#2a3f2f; --c-their:#1a2c22; --c-priv:#a78bfa;
  --c-emoji:"Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji","Segoe UI Symbol",sans-serif;
  --c-fs:14px;
  font-family:'Outfit',system-ui,var(--c-emoji); color:var(--c-text);
}
.ck-chat.ts-s { --c-fs:12.5px; } .ck-chat.ts-l { --c-fs:16.5px; }
.ck-chat button { font-family:inherit; cursor:pointer; color:inherit; }
body.ch-resizing { cursor:ew-resize; user-select:none; }

/* ---- pulsante flottante, badge, notifiche ---- */
.ch-fab { position:fixed; z-index:290; width:54px; height:54px; border-radius:50%; border:none; touch-action:none;
  display:grid; place-items:center; color:#2a1f06;
  background:radial-gradient(circle at 35% 30%,#f6dfa0,var(--c-gold) 55%,var(--c-gold2));
  box-shadow:0 6px 18px rgba(0,0,0,.45), 0 0 0 3px rgba(0,0,0,.18); transition:transform .15s; }
.ch-fab:hover { transform:scale(1.06); }
.ch-badge { min-width:19px; height:19px; padding:0 5px; border-radius:10px; background:#e5484d; color:#fff;
  font:700 11px/19px 'Outfit',sans-serif; text-align:center; box-shadow:0 0 0 2px var(--c-bg); }
.ch-fab .ch-badge { position:absolute; top:-3px; right:-3px; }
.ch-toasts { position:fixed; z-index:295; display:flex; flex-direction:column; gap:8px; align-items:flex-end; pointer-events:none; }
.ch-toast { pointer-events:auto; max-width:min(300px,80vw); text-align:left; border:1px solid var(--c-line);
  background:rgba(13,26,20,.95); backdrop-filter:blur(6px); border-radius:14px; padding:9px 13px;
  box-shadow:0 10px 26px rgba(0,0,0,.45); display:flex; flex-direction:column; gap:2px; animation:chIn .25s ease; }
.ch-toast b { font-size:12.5px; color:var(--c-gold); }
.ch-toast.priv b { color:var(--c-priv); }
.ch-toast span { font-size:13px; color:var(--c-text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
@keyframes chIn { from { transform:translateY(8px); opacity:0; } }
.ch-minibar { position:fixed; z-index:290; right:14px; bottom:calc(14px + env(safe-area-inset-bottom)); display:flex; align-items:center; gap:8px;
  padding:9px 12px 9px 15px; border-radius:999px; border:1px solid var(--c-line); background:var(--c-bg2);
  box-shadow:0 8px 22px rgba(0,0,0,.45); font-weight:600; font-size:14px; }
.ch-x { opacity:.6; font-size:12px; padding:2px 4px; border-radius:6px; background:none; border:none; }
.ch-x:hover { opacity:1; background:rgba(255,255,255,.1); }

/* ---- pannello ---- */
.ch-panel { position:fixed; z-index:300; top:0; right:0; bottom:0; max-width:100vw; display:flex; flex-direction:column;
  background:linear-gradient(180deg,rgba(14,28,21,.98),rgba(9,19,14,.98)); border-left:1px solid var(--c-line);
  box-shadow:-18px 0 40px rgba(0,0,0,.45); backdrop-filter:blur(8px);
  padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) 0;
  transform:translateX(105%); visibility:hidden;
  transition:transform .3s cubic-bezier(.2,.8,.2,1), width .25s ease, visibility 0s .3s; }
.ch-panel.shown { transform:none; visibility:visible; transition:transform .3s cubic-bezier(.2,.8,.2,1), width .25s ease, visibility 0s; }
.ch-panel.full { border-left:none; }
body.ch-resizing .ch-panel { transition:none; }
.ch-resize { position:absolute; left:-4px; top:0; bottom:0; width:9px; cursor:ew-resize; z-index:5; touch-action:none; }
.ch-resize::after { content:""; position:absolute; left:3px; top:50%; height:46px; margin-top:-23px; width:3px; border-radius:2px;
  background:var(--c-line); transition:background .2s; }
.ch-resize:hover::after { background:var(--c-gold); }

.ch-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 10px 8px 14px;
  border-bottom:1px solid var(--c-line); }
.ch-title { display:flex; align-items:center; gap:10px; min-width:0; }
.ch-title > div { display:flex; flex-direction:column; min-width:0; }
.ch-title b { font-size:15px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ch-title small { font-size:11.5px; color:var(--c-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ch-hash { width:30px; height:30px; border-radius:9px; display:grid; place-items:center; font-weight:800; color:var(--c-gold);
  background:rgba(217,178,95,.12); border:1px solid var(--c-line); }
.ch-tools { display:flex; align-items:center; gap:2px; flex:none; }
.ch-tools > button, .ch-modes button { width:30px; height:30px; border-radius:8px; border:none; background:none; font-size:14px;
  display:grid; place-items:center; color:var(--c-muted); }
.ch-tools > button:hover, .ch-modes button:hover { background:rgba(255,255,255,.08); color:var(--c-text); }
.ch-tools button.on { background:rgba(217,178,95,.16); color:var(--c-gold); }
.ch-modes { display:flex; gap:1px; padding:2px; border-radius:9px; background:rgba(0,0,0,.25); margin:0 3px; }
.ch-modes button { width:26px; height:24px; }
.ch-modes i { display:block; width:14px; height:11px; border:1.5px solid currentColor; border-radius:2px; position:relative; }
.ch-modes i::after { content:""; position:absolute; top:0; bottom:0; right:0; background:currentColor; }
.ch-modes .m1::after { width:30%; } .ch-modes .m2::after { width:50%; } .ch-modes .m3::after { width:100%; }

.ch-tabs { display:flex; gap:6px; padding:8px 10px; overflow-x:auto; border-bottom:1px solid rgba(255,255,255,.05); scrollbar-width:none; }
.ch-tabs::-webkit-scrollbar { display:none; }
.ch-tab { flex:none; display:flex; align-items:center; gap:6px; padding:5px 10px; border-radius:999px; font-size:12.5px; font-weight:600;
  background:rgba(255,255,255,.05); border:1px solid transparent; color:var(--c-muted); }
.ch-tab.on { color:var(--c-gold); border-color:rgba(217,178,95,.5); background:rgba(217,178,95,.1); }
.ch-tab.priv.on { color:var(--c-priv); border-color:rgba(167,139,250,.55); background:rgba(167,139,250,.1); }
.ch-tab .mut { font-size:10px; }
.dot { width:7px; height:7px; border-radius:50%; background:#5d6b63; display:inline-block; flex:none; }
.dot.on { background:#3ddc84; box-shadow:0 0 6px rgba(61,220,132,.7); }

.ch-body { flex:1; min-height:0; display:flex; position:relative; }
.ch-side { width:240px; flex:none; border-right:1px solid var(--c-line); overflow-y:auto; }
.ch-drawer { position:absolute; z-index:6; top:0; left:0; right:0; max-height:70%; overflow-y:auto; background:var(--c-bg2);
  border-bottom:1px solid var(--c-line); box-shadow:0 14px 30px rgba(0,0,0,.45); animation:chIn .2s ease; }
.ch-main { flex:1; min-width:0; display:flex; flex-direction:column; position:relative; }

/* ---- giocatori ---- */
.ch-players { padding:6px 8px 10px; }
.ch-sec { display:flex; align-items:center; justify-content:space-between; font-size:10.5px; font-weight:700; letter-spacing:.14em;
  text-transform:uppercase; color:var(--c-gold); padding:8px 6px 6px; }
.ch-player { display:flex; align-items:center; gap:10px; padding:7px 6px; border-radius:10px; }
.ch-player:hover { background:rgba(255,255,255,.04); }
.ch-player.left { opacity:.5; }
.ch-pava { position:relative; flex:none; }
.ch-pava .dot { position:absolute; right:-1px; bottom:-1px; box-shadow:0 0 0 2px var(--c-bg2); }
.ch-pname { flex:1; min-width:0; display:flex; flex-direction:column; font-size:13.5px; font-weight:600; }
.ch-pname em { font-style:normal; color:var(--c-muted); font-weight:400; }
.ch-pname small { font-size:11px; color:var(--c-muted); font-weight:400; }
.ch-pm { border:1px solid rgba(167,139,250,.35); background:rgba(167,139,250,.1); border-radius:8px; padding:4px 8px; font-size:13px; }
.ch-ava { display:inline-grid; place-items:center; border-radius:50%; color:#fff; font-weight:700; flex:none;
  box-shadow:inset 0 -2px 4px rgba(0,0,0,.25); }
.ch-ava.bot { width:30px; height:30px; background:rgba(255,255,255,.08); font-size:15px; }

/* ---- impostazioni ---- */
.ch-settings { position:absolute; z-index:10; top:56px; right:10px; width:min(300px,calc(100% - 20px)); padding:4px 12px 12px;
  background:var(--c-bg2); border:1px solid var(--c-line); border-radius:14px; box-shadow:0 18px 40px rgba(0,0,0,.5); animation:chIn .18s ease; }
.ch-set { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:8px 2px; font-size:13px;
  border-bottom:1px solid rgba(255,255,255,.05); }
.ch-set input { width:18px; height:18px; accent-color:var(--c-gold); }
.ch-seg { display:flex; border-radius:8px; overflow:hidden; border:1px solid var(--c-line); }
.ch-seg button { border:none; background:none; padding:4px 9px; font-size:12px; }
.ch-seg button.on { background:var(--c-gold); color:#2a1f06; font-weight:700; }
.ch-note { font-size:11px; color:var(--c-muted); margin:8px 2px 0; line-height:1.45; }
.ch-btn { border:1px solid var(--c-line); background:rgba(255,255,255,.06); border-radius:9px; padding:6px 10px; font-size:12.5px; }
.ch-btn:hover { background:rgba(255,255,255,.12); }
.ch-btn.gold { background:linear-gradient(180deg,#eccb7d,var(--c-gold2)); color:#2a1f06; border:none; font-weight:700; }
.ch-btn.wide { width:100%; margin-top:8px; padding:9px; }

/* ---- messaggi ---- */
.ch-list { flex:1; min-height:0; overflow-y:auto; padding:10px 10px 4px; display:flex; flex-direction:column; gap:2px;
  font-size:var(--c-fs); overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:rgba(217,178,95,.3) transparent; }
/* nessun elemento della lista si schiaccia: si scorre, non si comprime */
.ch-list > * { flex-shrink:0; }
.ch-older { align-self:center; margin:4px 0 8px; }
.ch-older, .ch-newbelow { border:1px solid var(--c-line); background:var(--c-bg2); border-radius:999px; padding:5px 12px; font-size:12px; color:var(--c-muted); }
.ch-newbelow { position:sticky; bottom:6px; align-self:center; color:var(--c-gold); box-shadow:0 6px 16px rgba(0,0,0,.45); z-index:3; }
.ch-empty { margin:auto; color:var(--c-muted); font-size:13.5px; text-align:center; padding:20px; }
.ch-day { display:flex; justify-content:center; margin:10px 0 6px; }
.ch-day span { font-size:11px; color:var(--c-muted); background:rgba(255,255,255,.05); padding:3px 10px; border-radius:999px; text-transform:capitalize; }

.ch-msg { position:relative; display:flex; gap:8px; align-items:flex-end; margin-top:8px; max-width:100%; }
.ch-msg.grouped { margin-top:1px; }
.ch-msg.mine { justify-content:flex-end; }
.ch-avaslot { width:30px; flex:none; }
.ch-col { display:flex; flex-direction:column; min-width:0; max-width:min(78%, 520px); }
.ch-msg.mine .ch-col { align-items:flex-end; }
.ch-name { font-size:.82em; font-weight:700; margin:0 0 3px 10px; }
.ch-bubble { position:relative; padding:7px 11px 6px; border-radius:16px 16px 16px 5px; background:var(--c-their);
  border:1px solid rgba(255,255,255,.06); box-shadow:0 2px 6px rgba(0,0,0,.2); line-height:1.42; overflow-wrap:anywhere;
  transition:box-shadow .3s; }
.ch-msg.grouped .ch-bubble { border-radius:5px 16px 16px 5px; }
.ch-msg.mine .ch-bubble { background:linear-gradient(160deg,#36502f,#26402c); border-color:rgba(217,178,95,.25); border-radius:16px 16px 5px 16px; }
.ch-msg.mine.grouped .ch-bubble { border-radius:16px 5px 5px 16px; }
.ch-msg.flash .ch-bubble { box-shadow:0 0 0 2px var(--c-gold), 0 0 22px rgba(217,178,95,.5); }
.ch-bubble.big { background:none; border:none; box-shadow:none; padding:0 2px; }
.ch-bubble.big .ch-text { font-size:2.4em; line-height:1.15; }
.ch-bubble.deleted { color:var(--c-muted); }
.ch-text { white-space:pre-wrap; font-family:'Outfit',system-ui,var(--c-emoji); }
.ch-text a { color:#9fd3ff; }
.ch-meta { display:block; text-align:right; font-size:.72em; color:var(--c-muted); margin-top:2px; user-select:none; }
.ch-quote { display:flex; flex-direction:column; text-align:left; width:100%; margin:1px 0 6px; padding:5px 9px; border:none;
  border-left:3px solid var(--c-gold); border-radius:6px; background:rgba(0,0,0,.25); font-size:.88em; }
.ch-quote b { color:var(--c-gold); font-size:.92em; }
.ch-quote span { color:var(--c-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:260px; }
.ch-imgs { display:grid; gap:4px; margin:2px 0 4px; border-radius:11px; overflow:hidden; max-width:300px; }
.ch-imgs.n2, .ch-imgs.n3, .ch-imgs.n4 { grid-template-columns:1fr 1fr; }
.ch-img { padding:0; border:none; background:#0005; display:block; }
.ch-img img { display:block; width:100%; max-height:260px; object-fit:cover; min-height:60px; }
.ch-imgs.n2 .ch-img img, .ch-imgs.n3 .ch-img img, .ch-imgs.n4 .ch-img img { height:130px; }
.ch-gif { position:relative; max-width:260px; margin:2px 0 4px; border-radius:11px; overflow:hidden; }
.ch-gif img { display:block; width:100%; }
.ch-giftag { position:absolute; left:6px; bottom:6px; font-size:10px; font-weight:800; padding:1px 5px; border-radius:4px; background:rgba(0,0,0,.6); }
.ch-file { display:flex; align-items:center; gap:10px; padding:8px 10px; margin:2px 0 4px; border-radius:11px; text-decoration:none;
  color:var(--c-text); background:rgba(0,0,0,.25); border:1px solid rgba(255,255,255,.07); min-width:200px; }
.ch-file:hover { border-color:var(--c-line); }
.ch-ficon { font-size:24px; font-family:var(--c-emoji); }
.ch-fname { flex:1; min-width:0; font-size:.9em; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:flex; flex-direction:column; }
.ch-fname small { font-weight:400; color:var(--c-muted); font-size:.85em; }
.ch-fdl { width:28px; height:28px; border-radius:50%; display:grid; place-items:center; background:rgba(217,178,95,.15); color:var(--c-gold); flex:none; }
.ch-failed { font-size:.78em; color:#ff9d8a; margin-top:3px; }
.ch-failed button { background:none; border:none; color:var(--c-gold); text-decoration:underline; padding:0; font-size:inherit; }
.ch-reacts { display:flex; flex-wrap:wrap; gap:4px; margin-top:4px; }
.ch-reacts button { border:1px solid rgba(255,255,255,.1); background:rgba(255,255,255,.05); border-radius:999px; padding:1px 8px;
  font-size:.86em; font-family:'Outfit',var(--c-emoji); }
.ch-reacts button.on { border-color:rgba(217,178,95,.6); background:rgba(217,178,95,.15); }
.ch-reacts b { font-weight:700; font-size:.9em; }

/* barra azioni del messaggio: al passaggio del mouse, o tocco sul messaggio da telefono */
.ch-mtools { position:absolute; top:-16px; display:flex; gap:1px; padding:3px; border-radius:10px; z-index:4;
  background:var(--c-bg2); border:1px solid var(--c-line); box-shadow:0 8px 20px rgba(0,0,0,.45);
  opacity:0; pointer-events:none; transform:translateY(4px); transition:opacity .15s, transform .15s; }
.ch-msg:not(.mine) .ch-mtools { left:40px; }
.ch-msg.mine .ch-mtools { right:4px; }
.ch-mtools button, .ch-mtools a { width:28px; height:28px; border:none; background:none; border-radius:7px; display:grid; place-items:center;
  font-size:14px; text-decoration:none; color:var(--c-text); font-family:'Outfit',var(--c-emoji); }
.ch-mtools button:hover, .ch-mtools a:hover { background:rgba(255,255,255,.1); }
.ch-msg.show-tools .ch-mtools { opacity:1; pointer-events:auto; transform:none; }
@media (hover:hover) { .ch-msg:hover .ch-mtools { opacity:1; pointer-events:auto; transform:none; } }

.ch-typing { min-height:18px; padding:0 14px; font-size:11.5px; color:var(--c-muted); font-style:italic; }
.ch-readonly { margin:8px 10px 12px; padding:10px; border-radius:10px; font-size:12.5px; color:var(--c-muted); text-align:center; background:rgba(255,255,255,.04); }

/* ---- composer ---- */
.ch-composer { position:relative; padding:6px 10px calc(10px + env(safe-area-inset-bottom)); border-top:1px solid var(--c-line); }
.ch-replybar { display:flex; align-items:center; gap:8px; justify-content:space-between; font-size:12.5px; color:var(--c-muted);
  padding:6px 10px; margin-bottom:6px; border-left:3px solid var(--c-gold); border-radius:6px; background:rgba(0,0,0,.25); }
.ch-replybar span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ch-replybar b { color:var(--c-gold); }
.ch-replybar button { border:none; background:none; color:var(--c-muted); }
.ch-queue { display:flex; gap:6px; overflow-x:auto; padding-bottom:6px; }
.ch-qitem { position:relative; flex:none; width:150px; display:flex; align-items:center; gap:7px; padding:5px 26px 5px 5px;
  border-radius:10px; background:rgba(0,0,0,.3); border:1px solid rgba(255,255,255,.08); overflow:hidden; }
.ch-qitem.error { border-color:rgba(229,72,77,.6); }
.ch-qitem img { width:38px; height:38px; object-fit:cover; border-radius:7px; flex:none; }
.ch-qicon { width:38px; height:38px; display:grid; place-items:center; font-size:22px; flex:none; font-family:var(--c-emoji); }
.ch-qinfo { min-width:0; display:flex; flex-direction:column; font-size:11.5px; }
.ch-qinfo b { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; }
.ch-qinfo small { color:var(--c-muted); font-size:10.5px; }
.ch-prog { position:absolute; left:0; right:0; bottom:0; height:3px; background:rgba(255,255,255,.08); }
.ch-prog i { display:block; height:100%; background:var(--c-gold); transition:width .15s; }
.ch-qerr { position:absolute; left:48px; right:24px; bottom:2px; font-size:9.5px; color:#ff9d8a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ch-qx { position:absolute; top:4px; right:4px; width:20px; height:20px; border-radius:50%; border:none; background:rgba(0,0,0,.5); font-size:10px; }
.ch-warn { font-size:12px; color:#ffb48a; padding:0 4px 6px; }
.ch-inputrow { display:flex; align-items:flex-end; gap:4px; padding:4px; border-radius:16px; background:rgba(255,255,255,.05);
  border:1px solid rgba(255,255,255,.1); transition:border-color .2s; }
.ch-inputrow:focus-within { border-color:rgba(217,178,95,.55); }
.ch-ib { width:34px; height:34px; flex:none; border:none; background:none; border-radius:10px; font-size:18px; font-family:var(--c-emoji); }
.ch-ib:hover { background:rgba(255,255,255,.08); }
.ch-ib.gif { font:800 10.5px 'Outfit',sans-serif; color:var(--c-muted); }
.ch-inputrow textarea { flex:1; min-width:0; resize:none; border:none; outline:none; background:none; color:var(--c-text);
  font:400 var(--c-fs)/1.4 'Outfit',system-ui,var(--c-emoji); padding:7px 4px; max-height:140px; }
.ch-inputrow textarea::placeholder { color:var(--c-muted); }
.ch-send { width:36px; height:36px; flex:none; border-radius:12px; border:none; display:grid; place-items:center; color:#2a1f06;
  background:linear-gradient(180deg,#eccb7d,var(--c-gold2)); transition:opacity .2s, transform .1s; }
.ch-send:disabled { opacity:.35; cursor:default; }
.ch-send:not(:disabled):active { transform:scale(.92); }

/* ---- emoji e GIF ---- */
.ch-popbox { position:absolute; left:10px; right:10px; bottom:calc(100% - 4px); z-index:8; max-width:380px;
  background:var(--c-bg2); border:1px solid var(--c-line); border-radius:16px; box-shadow:0 -12px 34px rgba(0,0,0,.5);
  overflow:hidden; animation:chIn .18s ease; }
.ch-poptabs { display:flex; gap:4px; padding:6px 6px 0; }
.ch-poptabs button { border:none; background:none; padding:5px 10px; border-radius:8px; font-size:12.5px; font-weight:600; color:var(--c-muted); }
.ch-poptabs button.on { background:rgba(217,178,95,.15); color:var(--c-gold); }
.ch-poptabs .ch-x { margin-left:auto; }
.ep { display:flex; flex-direction:column; height:300px; }
.ep-tabs { display:flex; gap:1px; padding:4px 6px; overflow-x:auto; scrollbar-width:none; }
.ep-tab { flex:none; width:30px; height:30px; border:none; background:none; border-radius:8px; font-size:17px; font-family:var(--c-emoji); }
.ep-tab:hover { background:rgba(255,255,255,.08); }
.ep-search { margin:2px 8px 6px; padding:7px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.12); outline:none;
  background:rgba(0,0,0,.25); color:var(--c-text); font:400 13px 'Outfit',sans-serif; }
.ep-search:focus { border-color:rgba(217,178,95,.5); }
.ep-grid { flex:1; overflow-y:auto; padding:0 6px 8px; scrollbar-width:thin; }
.ep-title { font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--c-muted); padding:6px 4px 3px; }
.ep-cells { display:grid; grid-template-columns:repeat(auto-fill,minmax(36px,1fr)); }
.ep-cell { height:36px; border:none; background:none; border-radius:8px; font-size:22px; font-family:var(--c-emoji); line-height:1; }
.ep-cell:hover { background:rgba(255,255,255,.1); transform:scale(1.12); }
.ep-empty { padding:30px; text-align:center; color:var(--c-muted); font-size:13px; }
.ch-pop-overlay { position:fixed; inset:0; z-index:20; display:grid; place-items:center; background:rgba(0,0,0,.35); }
.ch-pop { width:min(360px,92%); background:var(--c-bg2); border:1px solid var(--c-line); border-radius:16px; overflow:hidden;
  box-shadow:0 20px 50px rgba(0,0,0,.6); }
.ch-gifs { padding:6px 8px 10px; display:flex; flex-direction:column; height:300px; }
.ch-gifs.off { justify-content:center; text-align:center; color:var(--c-muted); font-size:13px; height:auto; padding:18px 14px; }
.ch-gifgrid { flex:1; overflow-y:auto; display:grid; grid-template-columns:1fr 1fr; gap:4px; align-content:start; }
.ch-gifgrid button { padding:0; border:none; border-radius:8px; overflow:hidden; background:#0004; height:90px; }
.ch-gifgrid img { width:100%; height:100%; object-fit:cover; }
.ch-gifprev { flex:1; display:grid; place-items:center; min-height:0; }
.ch-gifprev img { max-width:100%; max-height:210px; border-radius:10px; }
.ch-gifact { display:flex; justify-content:space-between; gap:8px; }
.ch-powered { text-align:right; color:var(--c-muted); font-size:10px; margin-top:4px; }

/* ---- trascina file, lightbox ---- */
.ch-drop { position:absolute; inset:8px; z-index:30; display:grid; place-items:center; border:2px dashed var(--c-gold); border-radius:16px;
  background:rgba(13,26,20,.88); font-size:16px; font-weight:700; color:var(--c-gold); pointer-events:none; }
.ch-lightbox { position:fixed; inset:0; z-index:400; background:rgba(0,0,0,.88); display:flex; flex-direction:column;
  align-items:center; justify-content:center; padding:20px; animation:chIn .2s ease; }
.ch-lightbox img { max-width:100%; max-height:calc(100% - 70px); border-radius:8px; box-shadow:0 20px 60px rgba(0,0,0,.6); }
.ch-lbbar { display:flex; align-items:center; gap:10px; margin-top:14px; padding:7px 10px; border-radius:999px; background:rgba(255,255,255,.08);
  font-size:13px; max-width:100%; }
.ch-lbbar span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ch-lbbar button, .ch-lbbar a { border:none; background:rgba(255,255,255,.1); color:var(--c-text); border-radius:999px; padding:5px 11px;
  text-decoration:none; font-size:13px; flex:none; }
.ch-lbbar button:disabled { opacity:.3; }

@media (max-width:700px) {
  .ch-col { max-width:84%; }
  .ch-head { padding:8px 6px 6px 10px; }
  .ch-tools > button { width:28px; }
}
`;
