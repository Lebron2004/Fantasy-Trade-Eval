/* Trade calculator page */
(() => {
const {SPORTS, store, settings, el, adjusted, packageScore, injTag, metaText, splitText, toItem} = TS;
const $ = id => document.getElementById(id);
let meta = {}, moves = [], movesShown = 20;

const blank = () => ({send:[], get:[]});
let state = {sport:"nfl", trades:{nfl:blank(), nba:blank(), mlb:blank(), nhl:blank()}};
const saved0 = store.get("tradescale:v2");
if (saved0 && saved0.trades) state = {sport: saved0.sport || "nfl", trades: Object.assign(state.trades, saved0.trades)};
let saved = store.get("tradescale:saved:v2") || [];
const persist = () => store.set("tradescale:v2", state);
const trade = () => state.trades[state.sport];

// Keep players already in trades current: team, values, injury tag (a hand-edited value sticks).
function refreshTradeItems(sport){
  const pool = TS.pools[sport]; if (!pool) return;
  const fix = list => list.forEach(it => {
    if (it.custom) return;
    const p = pool.byId.get(String(it.id));
    if (!p){ it.gone = true; return; }
    Object.assign(it, {gone:false, name:p.name, team:p.team, pos:p.pos, born:p.born, inj:p.inj, prod:p.prod, outlook:p.outlook, elig:p.elig, x:p.x});
    if (!it.edited) it.value = p.value;
  });
  const t = state.trades[sport]; fix(t.send); fix(t.get);
}

function renderStatus(err){
  const s = $("status"); s.classList.remove("warn");
  if (err){ s.classList.add("warn"); s.textContent = "Player data didn't load. Open this page from your GitHub Pages link, or run the update script first."; return; }
  const pool = TS.pools[state.sport]; if (!pool){ s.textContent = "Loading players..."; return; }
  let txt = `${pool.length.toLocaleString()} players, updated ${TS.ago(pool.updated)}.`;
  if ((meta[state.sport] || {}).ok === false){ s.classList.add("warn"); txt += " Today's refresh for this sport failed, so you're seeing the last good data."; }
  s.textContent = txt;
}
function renderSports(){
  const nav = $("sports"); nav.innerHTML = "";
  SPORTS.forEach(([id,label]) => nav.append(el("button", {text:label, "aria-pressed": String(state.sport === id), onclick: () => switchSport(id)})));
}
function renderSide(side){
  const list = $("list-"+side); list.innerHTML = "";
  const items = trade()[side], sport = state.sport;
  $("empty-"+side).hidden = items.length > 0;
  items.forEach((p, i) => {
    const n = el("div", {class:"name", text:p.name}); const tg = injTag(p); if (tg) n.append(tg);
    const mt = TS.matchupTag(p); if (mt) n.append(mt);
    let m = metaText(p);
    if (p.gone) m += ", no longer on a roster";
    const adj = Math.round(adjusted(p, sport));
    if (p.edited) m += ", your value";
    const split = splitText(p);
    const ins = TS.insightText(p);
    const info = el("div", {}, n, el("div", {class:"meta", text:m}), split ? el("div", {class:"split", text:split}) : null,
      ins ? el("div", {class:"insight", text:ins}) : null);
    const v = el("input", {class:"val", type:"number", min:0, max:150, value:adj, "aria-label":`Value for ${p.name}`});
    v.onchange = () => { p.value = Math.max(0, Math.min(150, Number(v.value) || 0)); p.edited = true; persist(); renderSide(side); renderScale(); };
    const x = el("button", {class:"x", text:"×", "aria-label":`Remove ${p.name}`, onclick: () => { items.splice(i,1); persist(); renderSide(side); renderScale(); }});
    list.append(el("li", {class:"player"}, info, v, x));
  });
  $("tot-"+side).textContent = Math.round(packageScore(items, sport));
}
function renderScale(){
  const t = trade(), sport = state.sport, s = packageScore(t.send, sport), g = packageScore(t.get, sport);
  $("cntL").textContent = t.send.length; $("cntR").textContent = t.get.length;
  const verdict = $("verdict"), detail = $("detail");
  verdict.className = "verdict";
  let angle = 0;
  if (!t.send.length || !t.get.length){
    verdict.textContent = "Build a trade";
    detail.textContent = !t.send.length && !t.get.length ? "Add at least one player to each side." :
      (!t.send.length ? "Add who you'd give up." : "Add who you'd get back.");
    angle = t.get.length ? 8 : t.send.length ? -8 : 0;
  } else {
    const diff = (g - s) / Math.max(g, s, 1), pct = Math.round(Math.abs(diff) * 100);
    angle = Math.max(-13, Math.min(13, diff * 45));
    if (Math.abs(diff) < 0.07){ verdict.textContent = "Fair trade"; verdict.classList.add("fair"); detail.textContent = `Both sides are within ${Math.max(pct,1)}% of each other.`; }
    else if (diff > 0){ verdict.textContent = "You come out ahead"; verdict.classList.add("win"); detail.textContent = `You get about ${pct}% more value than you give.`; }
    else { verdict.textContent = "You're overpaying"; verdict.classList.add("lose"); detail.textContent = `You give up about ${pct}% more value than you get.`; }
    const spots = t.get.length - t.send.length;
    if (spots > 0) detail.textContent += ` You'll need ${spots} open roster spot${spots>1?"s":""}.`;
    if (spots < 0) detail.textContent += ` You free up ${-spots} roster spot${spots<-1?"s":""}.`;
  }
  $("beamGroup").style.transform = `rotate(${angle}deg)`;
  $("panL").style.transformOrigin = "44px 76px";  $("panL").style.transform = `rotate(${-angle}deg)`;
  $("panR").style.transformOrigin = "296px 76px"; $("panR").style.transform = `rotate(${-angle}deg)`;
  $("saveBtn").disabled = !(t.send.length && t.get.length);
}
function renderMoves(){
  $("movesH").textContent = `Recent ${TS.sportName(state.sport).toLowerCase()} team changes`;
  const list = moves.filter(m => m.sport === state.sport), ul = $("moves"); ul.innerHTML = "";
  $("movesEmpty").hidden = list.length > 0;
  list.slice(0, movesShown).forEach(m => ul.append(el("li", {},
    el("span", {class:"when", text:new Date(m.date).toLocaleDateString(undefined, {month:"short", day:"numeric"})}),
    el("span", {class:"who", text:m.name}),
    el("span", {class:"path"}, el("span", {text:(m.from || "FA") + " to "}), el("b", {text:m.to || "FA"})))));
  $("moreMoves").hidden = list.length <= movesShown;
}
function renderSaved(){
  const ul = $("saved"); ul.innerHTML = "";
  $("savedEmpty").hidden = saved.length > 0;
  saved.forEach((tr, i) => {
    const open = el("button", {class:"btn", text:"Open", onclick: async () => {
      state.trades[tr.sport] = {send: structuredClone(tr.send), get: structuredClone(tr.get)};
      await switchSport(tr.sport); window.scrollTo({top:0, behavior:"smooth"});
    }});
    const del = el("button", {class:"btn", text:"Delete", onclick: () => { saved.splice(i,1); store.set("tradescale:saved:v2", saved); renderSaved(); }});
    ul.append(el("li", {}, el("span", {class:"tag", text:tr.sport.toUpperCase()}),
      el("div", {class:"sum"}, el("div", {text:"Send: " + tr.send.map(p=>p.name).join(", ")}),
        el("div", {text:"Get: " + tr.get.map(p=>p.name).join(", ")}), el("span", {text:`${tr.verdict} when saved`})),
      el("div", {class:"row"}, open, del)));
  });
}
const searches = [];
function renderAll(){
  renderSports(); TS.settingsBar($("settings"), state.sport, renderAll); renderStatus();
  renderSide("send"); renderSide("get"); renderScale(); renderMoves(); searches.forEach(s => s.refreshPlaceholder());
}
async function switchSport(id){
  state.sport = id; movesShown = 20; persist(); renderAll();
  if (!TS.pools[id]){
    $("desk").classList.add("loading");
    try { await TS.loadSport(id); } catch(e){ $("desk").classList.remove("loading"); renderStatus(true); return; }
    $("desk").classList.remove("loading");
  }
  refreshTradeItems(id); persist(); renderAll();
}

document.querySelectorAll(".search").forEach(host => {
  const side = host.dataset.side;
  searches.push(TS.makeSearch(host, {
    sport: () => state.sport, allowCustom: true,
    label: side === "send" ? "Search players to send" : "Search players to receive",
    exclude: () => new Set([...trade().send, ...trade().get].map(p => String(p.id))),
    onPick: p => {
      trade()[side].push(p.custom ? {id:"c"+Date.now(), name:p.name, team:"", pos:"", born:"", value:50, inj:"", custom:true, edited:true} : toItem(p));
      persist(); renderSide(side); renderScale();
    }
  }));
});
$("clearBtn").onclick = () => { state.trades[state.sport] = blank(); persist(); renderAll(); };
$("swapBtn").onclick = () => { const t = trade(); [t.send, t.get] = [t.get, t.send]; persist(); renderAll(); };
$("saveBtn").onclick = () => {
  const t = trade();
  saved.unshift({sport: state.sport, send: structuredClone(t.send), get: structuredClone(t.get), verdict: $("verdict").textContent});
  saved = saved.slice(0, 30); store.set("tradescale:saved:v2", saved); renderSaved();
  $("saveBtn").textContent = "Saved"; setTimeout(() => $("saveBtn").textContent = "Save trade", 1400);
};
$("moreMoves").onclick = () => { movesShown += 30; renderMoves(); };

/* ---------- AI GM ---------- */
function tradePrompt(q){
  const t = trade(), sp = state.sport, name = TS.sportName(sp);
  const fmt = {ppr:"PPR", half:"half PPR", std:"standard"}[settings.scoring];
  const lg = `${settings.mode}${sp === "nfl" ? `, ${fmt} scoring, ${settings.qb === "sf" ? "superflex" : "1 QB"}` : ""}`;
  const lines = list => list.length ? list.map(p => "- " + (p.custom ? `${p.name} (custom player, value ${p.value})` : TS.aiLine(p, sp))).join("\n") : "- (nobody yet)";
  return `Sport: ${name}. League: ${lg}. The app weighs outlook ${settings.upside}% and track record ${100 - settings.upside}%.

I SEND:
${lines(t.send)}

I RECEIVE:
${lines(t.get)}

The app's verdict: ${$("verdict").textContent}. ${$("detail").textContent}

My question: ${q || "Should I make this trade?"}`;
}
AI.panel($("aiHost"), {
  intro: "A second opinion on the trade above, with today's injury news and depth charts checked.",
  presets: ["Should I make this trade?", "What would make this fair?", "Who wins this long-term?"],
  system: () => AI.system(TS.sportName(state.sport)),
  buildPrompt: tradePrompt
});

(async () => {
  renderAll(); renderSaved();
  try { meta = await TS.getJSON("data/meta.json"); } catch(e){ meta = {}; }
  try { moves = await TS.getJSON("data/moves.json"); } catch(e){ moves = []; }
  await switchSport(state.sport);
})();
})();
