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
  SPORTS.forEach(([id,label]) => nav.append(el("button", {text:label, "data-sport":id, "aria-pressed": String(state.sport === id), onclick: () => switchSport(id)})));
}
function renderSide(side){
  const list = $("list-"+side); list.innerHTML = "";
  const items = trade()[side], sport = state.sport;
  $("empty-"+side).hidden = items.length > 0;
  items.forEach((p, i) => {
    const n = el("div", {class:"name", text:p.name}); const tg = injTag(p); if (tg) n.append(tg);
    const mt = TS.matchupTag(p); if (mt) n.append(mt);
    const st = TS.signalTag(p, sport); if (st) n.append(st);
    let m = metaText(p);
    if (p.gone) m += ", no longer on a roster";
    const adj = Math.round(adjusted(p, sport));
    if (p.edited) m += ", your value";
    const split = splitText(p);
    const ins = TS.insightText(p);
    const sig = TS.signalText(p, sport), nw = TS.newsFor(sport, p.id)[0];
    const info = el("div", {}, n, el("div", {class:"meta", text:m}), split ? el("div", {class:"split", text:split}) : null,
      ins ? el("div", {class:"insight", text:ins}) : null, sig ? el("div", {class:"insight", text:sig}) : null,
      nw ? el("div", {class:"insight news-mini", text:`${TS.newsWhen(nw)}: ${TS.newsLine(nw)}`}) : null);
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
    // the trained prop model's lean: does it like the players you get more than their trade value does?
    const lean = list => { const g = list.map(p => TS.signalOf(p, sport)).filter(Boolean); return g.length ? g.reduce((a, x) => a + x.s, 0) / g.length : null; };
    const lg = lean(t.get), ls = lean(t.send);
    if (lg != null || ls != null){
      const edge = (lg || 0) - (ls || 0);
      if (edge >= 0.3) detail.textContent += " The trained model leans your way: it rates the players you get above their trade value.";
      else if (edge <= -0.3) detail.textContent += " The trained model leans the other way: it rates the players you send above their trade value.";
    }
    const hurt = t.get.filter(p => TS.HURT.has(p.inj));
    if (hurt.length) detail.textContent += ` Heads up: ${hurt.map(p => `${p.name} is ${p.inj === "IR" ? "on IR" : p.inj.toLowerCase()}`).join(", ")}.`;
    const spots = t.get.length - t.send.length;
    if (spots > 0) detail.textContent += ` You'll need ${spots} open roster spot${spots>1?"s":""}.`;
    if (spots < 0) detail.textContent += ` You free up ${-spots} roster spot${spots<-1?"s":""}.`;
  }
  $("beamGroup").style.transform = `rotate(${angle}deg)`;
  $("panL").style.transformOrigin = "44px 76px";  $("panL").style.transform = `rotate(${-angle}deg)`;
  $("panR").style.transformOrigin = "296px 76px"; $("panR").style.transform = `rotate(${-angle}deg)`;
  $("saveBtn").disabled = !(t.send.length && t.get.length);
  renderReport();
}
/* ---------- Trade report: a letter grade, a plain ruling, and what the deal does to your lineup ---------- */
// The synced or hand-built league for this sport (from My league), with your team and the partner holding the players you get.
function leagueContext(sport, t){
  const pool = TS.pools[sport]; if (!pool) return null;
  const leagues = (store.get("tradescale:leagues") || []).filter(l => l.sport === sport);
  const L = leagues.find(l => l.id === (store.get("tradescale:active-league") || {})[sport]) || leagues[0];
  if (!L || !L.slots || !L.teams) return null;
  const me = L.teams.find(x => x.id === L.myTeamId); if (!me) return null;
  const resolve = ids => ids.map(id => pool.byId.get(String(id))).filter(Boolean);
  const mineIds = new Set(me.players.map(String));
  if (!t.send.some(p => mineIds.has(String(p.id)))) return null;   // this trade isn't from your synced team
  const getIds = new Set(t.get.map(p => String(p.id)));
  const partner = L.teams.find(x => x.id !== me.id && x.players.some(id => getIds.has(String(id)))) || null;
  return {L, me, roster: resolve(me.players), partner, partnerRoster: partner ? resolve(partner.players) : null};
}
function lineupSwap(sport, slots, roster, out, inc){
  const val = p => adjusted(p, sport), outIds = new Set(out.map(p => String(p.id)));
  const before = TS.LINEUP.bestLineup(sport, slots, roster, val);
  const after = TS.LINEUP.bestLineup(sport, slots, roster.filter(p => !outIds.has(String(p.id))).concat(inc), val);
  const b = new Set(before.starters.filter(Boolean).map(p => String(p.id))), a = new Set(after.starters.filter(Boolean).map(p => String(p.id)));
  return {before, after, gain: after.total - before.total,
          ins: after.starters.map((p, i) => p && !b.has(String(p.id)) ? {p, slot: slots[i]} : null).filter(Boolean),
          outs: before.starters.map((p, i) => p && !a.has(String(p.id)) ? {p, slot: slots[i]} : null).filter(Boolean)};
}
const GRADES = [[14,"A+","Massive win for you"],[9,"A","Clear win for you"],[5,"A-","Solid win for you"],[2,"B+","Slight win for you"],
  [-2,"B","Even trade"],[-5,"B-","Slight overpay"],[-9,"C","You're overpaying"],[-14,"D","Big overpay"],[-Infinity,"F","Lopsided against you"]];
function tradeReport(){
  const t = trade(), sport = state.sport;
  if (!t.send.length || !t.get.length) return null;
  const s = packageScore(t.send, sport), g = packageScore(t.get, sport);
  const valuePct = (g - s) / Math.max(g, s, 1) * 100;
  const factors = [];
  let score = valuePct;
  factors.push({tone: valuePct >= 3 ? "good" : valuePct <= -3 ? "bad" : "even", label: "Trade value",
    text: Math.abs(valuePct) < 3 ? "Close to even on value." : `You ${valuePct > 0 ? "get" : "give"} about ${Math.round(Math.abs(valuePct))}% more value.`});

  const ctx = leagueContext(sport, t);
  let lineup = null;
  if (ctx){
    lineup = lineupSwap(sport, ctx.L.slots, ctx.roster, t.send, t.get);
    const pct = lineup.gain / Math.max(lineup.before.total, 1) * 100;
    // with real rosters, the starting lineup counts for more than raw value: bench depth rarely scores
    score = valuePct * 0.6 + Math.max(-15, Math.min(15, pct * 5));
    factors.push({tone: pct >= 0.5 ? "good" : pct <= -0.5 ? "bad" : "even", label: "Your lineup",
      text: Math.abs(lineup.gain) < 0.5 ? "Your starting lineup stays about the same." :
        `Your starting lineup gets ${Math.abs(Math.round(pct * 10) / 10)}% ${lineup.gain > 0 ? "stronger" : "weaker"}.`});
    if (ctx.partner){
      lineup.partner = ctx.partner.name;
      lineup.theirs = lineupSwap(sport, ctx.L.slots, ctx.partnerRoster, t.get, t.send);
      const theirPct = lineup.theirs.gain / Math.max(lineup.theirs.before.total, 1) * 100;
      if (theirPct <= -4) factors.push({tone:"even", label:"Will they say yes?", text:`${ctx.partner.name}'s starting lineup gets ${Math.round(-theirPct)}% weaker, so expect pushback.`});
      else if (theirPct >= 1) factors.push({tone:"good", label:"Will they say yes?", text:`It helps ${ctx.partner.name}'s lineup too, so it's an easy sell.`});
    }
  }

  const lean = list => { const x = list.map(p => TS.signalOf(p, sport)).filter(Boolean); return x.length ? x.reduce((a, y) => a + y.s, 0) / x.length : null; };
  const lg = lean(t.get), ls = lean(t.send);
  if (lg != null || ls != null){
    const edge = (lg || 0) - (ls || 0);
    score += Math.max(-4, Math.min(4, edge * 6));
    if (Math.abs(edge) >= 0.2) factors.push({tone: edge > 0 ? "good" : "bad", label: "Trained model",
      text: edge > 0 ? "Rates the players you get above their trade value: you're buying low." : "Rates the players you send above their trade value: you're selling low."});
  }
  const hurt = t.get.filter(p => TS.HURT.has(p.inj)), hurtOut = t.send.filter(p => TS.HURT.has(p.inj));
  if (hurt.length){ score -= 3 * hurt.length; factors.push({tone:"bad", label:"Health", text: `${hurt.map(p => p.name).join(", ")} ${hurt.length > 1 ? "are" : "is"} hurt right now.`}); }
  else if (hurtOut.length) factors.push({tone:"good", label:"Health", text: `You move ${hurtOut.map(p => p.name).join(", ")} while ${hurtOut.length > 1 ? "they're" : "he's"} hurt.`});
  if (settings.mode === "dynasty"){
    const age = list => { const a = list.map(p => TS.ageOf(p.born)).filter(x => x != null); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; };
    const ag = age(t.get), as = age(t.send);
    if (ag != null && as != null && Math.abs(ag - as) >= 2)
      factors.push({tone: ag < as ? "good" : "bad", label:"Age", text: `You get ${ag < as ? "younger" : "older"} by about ${Math.round(Math.abs(ag - as))} years on average.`});
  }
  const spots = t.get.length - t.send.length;
  if (spots > 0) factors.push({tone:"even", label:"Roster", text:`You'll need ${spots} open roster spot${spots > 1 ? "s" : ""}.`});
  if (spots < 0 && valuePct < -2) factors.push({tone:"good", label:"Roster", text:`Consolidating ${t.send.length} for ${t.get.length} frees ${-spots} spot${spots < -1 ? "s" : ""} for a waiver pickup.`});

  const [, grade, ruling] = GRADES.find(([cut]) => score >= cut);
  const near = Math.abs(score) < 2 && Math.abs(valuePct) >= 0.5 ? (score > 0 ? ", leans your way" : ", leans their way") : "";
  return {grade, ruling: ruling + near, score, valuePct, lineup, factors, tone: grade[0] === "A" || grade === "B+" ? "good" : grade === "B" ? "even" : "bad"};
}
function breakdown(list, sport, total){
  const bar = el("div", {class:"vb-bar"});
  list.forEach(p => {
    const v = packageScore([p], sport), w = total > 0 ? v / total * 100 : 0;
    bar.append(el("span", {style:`flex:${Math.max(w, 0.5)}`, title:`${p.name}: ${Math.round(v)}`}, w >= 18 ? p.name.split(" ").slice(-1)[0] : ""));
  });
  return bar;
}
function renderReport(){
  const host = $("report"), r = tradeReport(), t = trade(), sport = state.sport;
  host.hidden = !r; host.innerHTML = "";
  const chip = $("gradeChip"); chip.hidden = !r;
  if (!r) return;
  chip.className = "grade-chip g-" + r.tone; chip.textContent = ""; chip.append(el("b", {text:r.grade}), ` ${r.ruling} · see why`);
  const s = packageScore(t.send, sport), g = packageScore(t.get, sport), max = Math.max(s, g, 1);
  const vrow = (lbl, list, tot, cls) => el("div", {class:"vb-row " + cls}, el("span", {class:"vb-l", text:lbl}),
    el("div", {class:"vb-track"}, el("div", {style:`width:${tot / max * 100}%`}, breakdown(list, sport, tot))), el("b", {text: Math.round(tot)}));
  const head = el("div", {class:"rep-head"},
    el("div", {class:"grade g-" + r.tone, "aria-label":`Grade ${r.grade}`, text:r.grade}),
    el("div", {}, el("div", {class:"rep-kicker", text:"Trade grade for your side"}), el("div", {class:"rep-ruling", text:r.ruling}),
      el("p", {class:"split", text: r.lineup ? `Graded on value, what it does to your starting lineup in ${r.lineup.partner ? "your league" : "your synced team"}, the trained model, and health.` :
        "Graded on value, the trained model, and health. Sync your league on My league to grade it against your actual lineup too."})));
  const values = el("div", {class:"vb"}, vrow("You send", t.send, s, "send"), vrow("You get", t.get, g, "get"));
  const facts = el("ul", {class:"rep-f"});
  r.factors.forEach(f => facts.append(el("li", {class:"f-" + f.tone}, el("b", {text:f.label}), " ", f.text)));
  host.append(head, values, facts);
  if (r.lineup && (r.lineup.ins.length || r.lineup.outs.length)){
    const L = r.lineup, fmt = n => (n > 0 ? "+" : "") + Math.round(n);
    const side = (title, sw) => el("div", {class:"lu-chg"}, el("h3", {}, title, el("span", {class: sw.gain >= 0 ? "up" : "down", text:` ${fmt(sw.gain)}`})),
      el("ul", {}, ...sw.ins.map(x => el("li", {class:"in"}, `${x.slot}: ${x.p.name} starts`)),
        ...sw.outs.map(x => el("li", {class:"out"}, `${x.slot}: ${x.p.name} ${t.send.some(p => String(p.id) === String(x.p.id)) || t.get.some(p => String(p.id) === String(x.p.id)) ? "leaves" : "goes to the bench"}`))));
    const wrap = el("div", {class:"lu-chgs"}, side("Your starting lineup", L));
    if (L.theirs) wrap.append(side(`${L.partner}'s starting lineup`, L.theirs));
    host.append(wrap);
  }
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
function renderNews(){
  $("newsH").textContent = `Latest ${TS.sportName(state.sport).toLowerCase()} news`;
  const ul = $("news"); ul.innerHTML = "";
  const cut = new Date(Date.now() - 4 * 864e5).toISOString();
  // the most valuable players first, so the news that moves trades is on top
  const list = TS.allNews(state.sport).filter(i => i.d >= cut && i.kind !== "team").sort((a, b) => (b.v || 0) - (a.v || 0) || b.d.localeCompare(a.d));
  const seen = new Set(), shown = [];
  for (const i of list){ if (seen.has(i.id)) continue; seen.add(i.id); shown.push(i); if (shown.length === 12) break; }
  $("newsEmpty").hidden = shown.length > 0;
  shown.forEach(i => {
    const p = (TS.pools[state.sport] || {byId:new Map()}).byId.get(i.id);
    const lvl = p && TS.HURT.has(p.inj) ? "bad" : p && p.inj ? "warn" : i.kind === "injury" && !i.to ? "good" : "";
    ul.append(el("li", {class:lvl}, el("div", {class:"body"},
      el("div", {class:"nm"}, el("b", {text:i.name}), p ? injTag(p) || "" : "", p ? TS.signalTag(p, state.sport) || "" : "", el("small", {text:` ${i.team || ""}`})),
      el("p", {class:"line"}, el("span", {class:"when", text:TS.newsWhen(i) + " "}), TS.newsLine(i),
        i.url ? el("a", {href:i.url, target:"_blank", rel:"noopener", text:" Read"}) : ""))));
  });
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
  renderSide("send"); renderSide("get"); renderScale(); renderNews(); renderMoves(); searches.forEach(s => s.refreshPlaceholder());
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
  const r = tradeReport(), ctx = leagueContext(sp, t);
  const short = p => `${p.name} (${p.pos}${TS.posRank(p, sp) ? " " + TS.posRank(p, sp) : ""}, ${Math.round(adjusted(p, sp))}${p.inj ? ", " + p.inj : ""})`;
  const roster = (title, players) => {
    const lu = TS.LINEUP.bestLineup(sp, ctx.L.slots, players, p => adjusted(p, sp));
    return `${title} starters: ${lu.starters.map((p, i) => `${ctx.L.slots[i]} ${p ? short(p) : "(empty)"}`).join("; ")}
${title} bench: ${lu.bench.slice(0, 12).map(short).join("; ") || "(none)"}`;
  };
  let extra = "";
  if (r){
    extra += `\nThe app's trade grade for my side: ${r.grade} (${r.ruling}). Package values: I send ${Math.round(packageScore(t.send, sp))}, I get ${Math.round(packageScore(t.get, sp))}.
Factors: ${r.factors.map(f => `${f.label}: ${f.text}`).join(" ")}`;
    if (r.lineup){
      const L = r.lineup, ch = sw => [...sw.ins.map(x => `${x.p.name} starts at ${x.slot}`), ...sw.outs.map(x => `${x.p.name} out of ${x.slot}`)].join(", ") || "no change";
      extra += `\nMy starting lineup value goes from ${Math.round(L.before.total)} to ${Math.round(L.after.total)} (${ch(L)}).`;
      if (L.theirs) extra += ` ${L.partner}'s goes from ${Math.round(L.theirs.before.total)} to ${Math.round(L.theirs.after.total)} (${ch(L.theirs)}).`;
    }
  }
  if (ctx){
    extra += `\n\nMY LEAGUE: ${ctx.L.name || "my league"}, ${ctx.L.size || ctx.L.teams.length} teams, lineup ${ctx.L.slots.join(", ")}.\n${roster("My", ctx.roster)}`;
    if (ctx.partner) extra += `\n${roster(ctx.partner.name + "'s", ctx.partnerRoster)}`;
  }
  return `Sport: ${name}. League: ${lg}. The app weighs outlook ${settings.upside}% and track record ${100 - settings.upside}%.

I SEND:
${lines(t.send)}

I RECEIVE:
${lines(t.get)}

The app's scale: ${$("verdict").textContent}. ${$("detail").textContent}${extra}

My question: ${q || "Should I make this trade?"}`;
}
AI.panel($("aiHost"), {
  intro: "A second opinion on the trade above: a grade, the reasons, a counteroffer, and the risk, with today's injury news and depth charts checked.",
  presets: ["Should I make this trade?", "What counteroffer makes this a win?", "Who wins rest of season?", "Who wins this long-term?"],
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
