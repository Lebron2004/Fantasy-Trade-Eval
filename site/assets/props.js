/* Props page (NFL): hit-rate history, situational and scheme splits, and a transparent projection. */
(() => {
const {el, norm, getJSON, store} = TS;
const $ = id => document.getElementById(id);
const SPORTS = [["nfl","Football"],["nba","Basketball"],["nhl","Hockey"],["mlb","Baseball"]];
const CFG = {
  nfl: {
    props: {
      QB: [["pyd","Passing yards"],["ptd","Passing TDs"],["cmp","Completions"],["att","Pass attempts"],["int","Interceptions"],
           ["ruyd","Rushing yards"],["pyd+ruyd","Pass + rush yards"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]],
      RB: [["ruyd","Rushing yards"],["car","Carries"],["ruyd+reyd","Rush + rec yards"],["rec","Receptions"],["reyd","Receiving yards"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]],
      WR: [["reyd","Receiving yards"],["rec","Receptions"],["tgt","Targets"],["ruyd+reyd","Rush + rec yards"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]],
      TE: [["reyd","Receiving yards"],["rec","Receptions"],["tgt","Targets"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]]},
    label: {pyd:"pass yds", ptd:"pass TDs", cmp:"completions", att:"attempts", int:"INTs", car:"carries", ruyd:"rush yds", rutd:"rush TDs",
            rec:"receptions", tgt:"targets", reyd:"rec yds", retd:"rec TDs", ppr:"PPR pts", td:"TDs"},
    count: ["ptd","int","td","rutd","retd","rec","tgt"],
    cv: {pyd:.32, att:.2, cmp:.24, ruyd:.5, reyd:.62, rec:.45, tgt:.4, car:.3, ppr:.45},
    groups: {QB:"QBs", RB:"RBs", WR:"WRs", TE:"TEs"}, defKeys: {QB:["pyd","ptd","int","ruyd"], RB:["ruyd","rutd","rec","reyd"], WR:["rec","reyd","retd","tgt"], TE:["rec","reyd","retd","tgt"]},
    search: "Search any NFL player or team", rest: null},
  nba: {
    props: {G: null, F: null, C: null},
    all: [["pts","Points"],["reb","Rebounds"],["ast","Assists"],["pts+reb+ast","Pts + reb + ast"],["pts+reb","Pts + reb"],["pts+ast","Pts + ast"],
          ["reb+ast","Reb + ast"],["fg3","3-pointers made"],["stl","Steals"],["blk","Blocks"],["stl+blk","Steals + blocks"],["tov","Turnovers"],["min","Minutes"]],
    label: {pts:"pts", reb:"reb", ast:"ast", fg3:"threes", stl:"steals", blk:"blocks", tov:"turnovers", min:"minutes"},
    count: ["fg3","stl","blk","tov"],
    cv: {pts:.32, reb:.4, ast:.45, min:.18, "pts+reb+ast":.27, "pts+reb":.29, "pts+ast":.3, "reb+ast":.35},
    groups: {G:"guards", F:"forwards", C:"centers"}, defKeys: {G:["pts","ast","fg3","reb"], F:["pts","reb","ast","fg3"], C:["pts","reb","blk","ast"]},
    search: "Search any NBA player or team", rest: {b2b: 0.96, keys: ["pts","reb","ast","fg3","min","stl","blk","tov"]}},
  nhl: {
    props: {F: [["sog","Shots on goal"],["pts","Points"],["g","Goals (anytime)"],["a","Assists"],["hit","Hits"],["blk","Blocked shots"],["ppg","Power-play goals"],["toi","Time on ice"]],
            D: [["sog","Shots on goal"],["blk","Blocked shots"],["pts","Points"],["a","Assists"],["hit","Hits"],["toi","Time on ice"]],
            G: [["sv","Saves"],["ga","Goals against"],["sa","Shots faced"]]},
    label: {g:"goals", a:"assists", pts:"points", sog:"shots", hit:"hits", blk:"blocks", ppg:"PP goals", toi:"minutes", sv:"saves", ga:"goals against", sa:"shots faced"},
    count: ["g","a","pts","sog","hit","blk","ppg","ga"],
    cv: {sv:.22, sa:.2, toi:.15},
    groups: {F:"forwards", D:"defensemen", G:"goalies"}, defKeys: {F:["sog","g","a","hit"], D:["sog","blk","pts","hit"], G:["sa","sv","ga"]},
    search: "Search any NHL player or team", rest: {b2b: 0.97, keys: ["sog","pts","g","a","hit","blk","toi"]}},
  mlb: {
    props: {H: [["h","Hits"],["tb","Total bases"],["h+r+rbi","Hits + runs + RBIs"],["hr","Home runs"],["rbi","RBIs"],["r","Runs"],["bb","Walks"],["so","Strikeouts"],["sb","Stolen bases"]],
            SP: [["k","Strikeouts"],["outs","Outs recorded"],["er","Earned runs allowed"],["ha","Hits allowed"],["bba","Walks allowed"],["pc","Pitch count"]],
            RP: [["k","Strikeouts"],["outs","Outs recorded"],["ha","Hits allowed"]]},
    label: {h:"hits", tb:"total bases", hr:"HR", rbi:"RBI", r:"runs", bb:"walks", so:"strikeouts", sb:"steals", k:"strikeouts", outs:"outs", er:"earned runs", ha:"hits allowed", bba:"walks allowed", pc:"pitches"},
    count: ["h","tb","hr","rbi","r","bb","so","sb","k","er","ha","bba"],
    cv: {outs:.22, pc:.14},
    disp: {tb:1.9, "h+r+rbi":1.5, rbi:1.4, r:1.2, er:1.4, ha:1.2, k:1.15},
    groups: {H:"hitters", SP:"starting pitchers", RP:"relievers"}, defKeys: {H:["h","tb","hr","rbi"], SP:["k","outs","er","ha"], RP:["k","outs","ha"]},
    search: "Search any MLB player or team", rest: null}
};
CFG.nba.props = {G: CFG.nba.all, F: CFG.nba.all, C: CFG.nba.all};
let sport = "nfl";
const C = () => CFG[sport];
const BASE = () => `data/props/${sport}/`;
const grpOf = p => p.grp || p.pos;
const labelOf = key => key === "td" ? "TDs" : key.split("+").map(k => C().label[k] || k).join(" + ");
const isCount = key => key.split("+").every(k => C().count.includes(k)) || key === "td";
const components = key => key === "td" ? ["rutd","retd"] : key.split("+");

/* ---------- State ---------- */
let index = null, defense = null, player = null, injuries = null;
let ui = {stat:null, line:null, side:"over", range:"10", mate:"", oddsO:"", oddsU:""};

/* ---------- Math ---------- */
const statOf = (g, key) => components(key).reduce((s, c) => s + (g.x[c] || 0), 0);
// negative binomial (Poisson when there's no extra spread): fits streaky counts like total bases and shots
function countCdf(k, mu, disp){
  if (k < 0) return 0;
  if (disp <= 1.02) return poissonCdf(k, mu);
  const r = mu / (disp - 1), q = mu / (r + mu);
  let p = Math.pow(r / (r + mu), r), s = p;
  for (let i = 0; i < k; i++){ p *= (i + r) / (i + 1) * q; s += p; }
  return Math.min(1, s);
}
function erf(x){ // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
function poissonCdf(k, mu){ if (k < 0) return 0; let term = Math.exp(-mu), s = term; for (let i = 1; i <= k; i++){ term *= mu / i; s += term; } return Math.min(1, s); }
function probOver(mu, sd, line, count, disp = 1){
  if (count){ const k = Math.floor(line); const pOver = 1 - countCdf(k, mu, disp); const pPush = Number.isInteger(line) ? countCdf(k, mu, disp) - countCdf(k - 1, mu, disp) : 0; return {over:pOver, push:pPush, under:1 - pOver - pPush}; }
  const hi = Math.floor(line) + 0.5, lo = Math.ceil(line) - 0.5;    // continuity correction for whole-number stats
  const over = 1 - Phi((hi - mu) / sd), under = Phi((lo - mu) / sd);
  return {over, under, push: Math.max(0, 1 - over - under)};
}
const implied = o => { const n = Number(o); if (!n || Math.abs(n) < 100) return null; return n < 0 ? -n / (-n + 100) : 100 / (n + 100); };
const toAmerican = p => p <= 0 || p >= 1 ? "–" : p >= 0.5 ? String(Math.round(-100 * p / (1 - p))) : "+" + Math.round(100 * (1 - p) / p);
const pct = p => Math.round(p * 100) + "%";
const signPct = f => { const d = Math.round((f - 1) * 100); return (d > 0 ? "+" : "") + d + "%"; };
const fmt1 = v => (Math.round(v * 10) / 10).toString();
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

/* ---------- Player helpers ---------- */
const nextGame = () => player && index.next[player.team];
const games = () => player.log.filter(g => g.x);
const season = () => index.season;
const seasonName = sz => (index.season_names && index.season_names[sz]) || String(sz);
const shortDate = d => d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, {month:"short", day:"numeric"}) : "";
const grpName = () => C().groups[grpOf(player)] || (grpOf(player) + "s");
function recencyWeights(list){
  const n = list.length;
  return list.map((g, i) => Math.pow(0.88, n - 1 - i) * Math.pow(0.6, season() - g.s));
}
function hit(v, line, side){ if (v === line) return "push"; return (side === "over" ? v > line : v < line) ? "hit" : "miss"; }
function hitRate(list, key, line, side){
  if (!list.length) return null;
  let h = 0, p = 0; list.forEach(g => { const r = hit(statOf(g, key), line, side); if (r === "hit") h++; if (r === "push") p++; });
  return {h, n:list.length, p, rate: h / Math.max(1, list.length - p)};
}
function defaultLine(key){
  if (key === "td") return 0.5;
  const sample = games().slice(-10).map(x => statOf(x, key));   // last 10 games, across seasons if needed
  const m = median(sample);
  return Math.max(0.5, Math.floor(m) + 0.5);
}

/* ---------- Projection ---------- */
function project(key){
  const g = games(); if (g.length < 3) return null;
  const w = recencyWeights(g), W = w.reduce((a, b) => a + b, 0);
  const ng = nextGame(), opp = ng && defense.teams[ng.opp], lg = defense.league;
  const pos = grpOf(player), sch = player.scheme || {};
  const parts = components(key).map(c => {
    const base = g.reduce((s, x, i) => s + w[i] * (x.x[c] || 0), 0) / W;
    // opponent: what this defense allows to the position vs league average
    let fOpp = 1;
    if (opp && opp.pos[pos] && lg.pos[pos] && lg.pos[pos][c]){
      const raw = (opp.pos[pos].allow[c] ?? lg.pos[pos][c]) / lg.pos[pos][c];
      const [damp, cap] = {nfl:[0.6, 0.3], nba:[0.4, 0.15], nhl:[0.5, 0.2], mlb:[0.5, 0.2]}[sport];   // trust in position-level defense data
      fOpp = Math.min(1 + cap, Math.max(1 - cap, 1 + (raw - 1) * damp));
    }
    // scheme: his splits weighted by how often this defense does each thing
    let fSch = 1; const notes = [];
    if (opp){
      const s = opp.scheme || {}, L = lg.scheme || {};
      const mix = (dim, a, b, oppA, lgA, label) => {
        if (!sch[dim] || oppA == null || lgA == null) return;
        const ra = sch[dim][a] && sch[dim][a][c], rb = sch[dim][b] && sch[dim][b][c];
        if (ra == null || rb == null) return;
        const den = lgA * ra + (1 - lgA) * rb; if (!den) return;
        const f = (oppA * ra + (1 - oppA) * rb) / den; fSch *= f; notes.push([label, f]);
      };
      if (["cmp","att","pyd","ptd","int","tgt","rec","reyd","retd"].includes(c)){
        mix("blitz", "yes", "no", s.blitz, L.blitz, "blitz rate");
        mix("cov", "man", "zone", s.man, L.man, "man coverage");
      }
      if ((c === "ruyd" || c === "rutd") && sch.box){
        const buckets = ["light","base","stacked"];
        const num = buckets.reduce((a, b) => a + (s[b] ?? 0) * (sch.box[b] ? sch.box[b][c] : 0), 0);
        const den = buckets.reduce((a, b) => a + (L[b] ?? 0) * (sch.box[b] ? sch.box[b][c] : 0), 0);
        if (num && den){ const f = num / den; fSch *= f; notes.push(["box counts", f]); }
      }
      fSch = Math.min(1.25, Math.max(0.8, 1 + (fSch - 1) * 0.7));
    }
    // game script (football: spread and implied total) or schedule (back-to-backs)
    let fScr = 1;
    const rest = C().rest;
    if (rest && ng && ng.rest === 0 && rest.keys.includes(c)) fScr = rest.b2b;
    if (sport === "nfl" && ng && ng.imp && defense.avg_team_total){
      const R = ng.imp / defense.avg_team_total, sp = ng.sp || 0;
      if (["ptd","rutd","retd"].includes(c)) fScr = Math.pow(R, 0.8);
      else if (c === "car" || c === "ruyd") fScr = 1 + 0.012 * sp;
      else if (["att","cmp","pyd","rec","reyd","tgt"].includes(c)) fScr = (1 - 0.006 * sp) * Math.pow(R, 0.35);
      else if (c === "ppr") fScr = Math.pow(R, 0.5);
      fScr = Math.min(1.2, Math.max(0.85, fScr));
    }
    return {c, base, fOpp, fSch, fScr, notes};
  });
  const sum = f => parts.reduce((s, p) => s + f(p), 0);
  const mu0 = sum(p => p.base), mu1 = sum(p => p.base * p.fOpp), mu2 = sum(p => p.base * p.fOpp * p.fSch), mu = sum(p => p.base * p.fOpp * p.fSch * p.fScr);
  // spread: his own weighted game-to-game variation, shrunk toward what's typical for this stat
  const vals = g.map(x => statOf(x, key)); const mean = vals.reduce((s, v, i) => s + w[i] * v, 0) / W;
  const varEmp = vals.reduce((s, v, i) => s + w[i] * (v - mean) ** 2, 0) / W;
  const cv = C().cv[key] || (key.includes("+") ? 0.42 : 0.5);
  const n = g.length, sd = Math.max(0.5, Math.sqrt((n * varEmp + 6 * (cv * mu) ** 2) / (n + 6)));
  // counts: how much more spread his games have than a pure Poisson, shrunk toward what's typical for the stat
  const dEmp = mean > 0 ? varEmp / mean : 1, d0 = (C().disp || {})[key] || 1.15;
  const disp = Math.max(1, (n * dEmp + 10 * d0) / (n + 10));
  return {mu0, mu1, mu2, mu, sd, parts, count: isCount(key), disp};
}

/* ---------- Rendering ---------- */
function renderPicker(){
  const host = $("picker"); host.innerHTML = "";
  if (!index) return;
  const wrap = el("div", {class:"search", style:"max-width:520px"});
  const input = el("input", {type:"text", placeholder:C().search, autocomplete:"off", role:"combobox", "aria-label":"Search players", "aria-expanded":"false"});
  const ul = el("ul", {class:"results", role:"listbox", id:"prop-res"}); ul.hidden = true; input.setAttribute("aria-controls", "prop-res");
  wrap.append(input, ul);
  let opts = [], active = 0;
  const close = () => { ul.hidden = true; input.setAttribute("aria-expanded","false"); };
  const show = () => {
    const q = norm(input.value.trim()); if (!q){ close(); return; }
    opts = index.players.filter(p => norm(p[1]).includes(q) || (q.length <= 3 && norm(p[2]) === q)).slice(0, 8);
    ul.innerHTML = "";
    opts.forEach((p, i) => { const li = el("li", {role:"option", id:`pr-${i}`}, el("span", {text:p[1]}), el("span", {class:"meta", text:`${p[3]}, ${p[2]}`})); li.onmousedown = e => { e.preventDefault(); input.value = ""; close(); openPlayer(p[0]); }; ul.append(li); });
    if (!opts.length){ close(); return; }
    active = 0; mark(); ul.hidden = false; input.setAttribute("aria-expanded","true");
  };
  const mark = () => [...ul.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  input.oninput = show; input.onfocus = show; input.onblur = () => setTimeout(close, 100);
  input.onkeydown = e => {
    if (ul.hidden) return;
    if (e.key === "ArrowDown"){ e.preventDefault(); active = (active + 1) % opts.length; mark(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); active = (active - 1 + opts.length) % opts.length; mark(); }
    else if (e.key === "Enter" && opts[active]){ e.preventDefault(); input.value = ""; close(); openPlayer(opts[active][0]); }
    else if (e.key === "Escape") close();
  };
  host.append(wrap);
}

function renderLanding(){
  const app = $("app"); app.innerHTML = "";
  const box = el("section", {class:"panel"}, el("h2", {text:"Popular this week"}),
    el("p", {class:"sub", text:"The most productive players this season. Pick one, or search above for anyone."}));
  const grid = el("div", {class:"chips"});
  index.players.slice(0, 30).forEach(p => grid.append(el("button", {class:"pchip", onclick: () => openPlayer(p[0])},
    el("strong", {text:p[1]}), el("small", {text:`${p[3]}, ${p[2]}`}))));
  box.append(grid);
  app.append(box);
}

async function openPlayer(id, fromHash){
  $("app").innerHTML = ""; $("app").append(el("section", {class:"panel"}, el("p", {class:"empty", style:"margin:0", text:"Loading player..."})));
  try { player = await getJSON(BASE() + "p/" + id + ".json"); }
  catch(e){ $("app").innerHTML = ""; $("app").append(el("section", {class:"panel"}, el("p", {class:"err", text:"Couldn't load that player. He may have been removed in today's update."}))); return; }
  const props = C().props[grpOf(player)] || Object.values(C().props)[0];
  if (!fromHash || !props.some(p => p[0] === ui.stat)){ ui.stat = props[0][0]; ui.line = null; ui.oddsO = ""; ui.oddsU = ""; }
  if (ui.line == null) ui.line = defaultLine(ui.stat);
  ui.mate = "";
  store.set("tradescale:props-last", id);
  if (!fromHash) window.scrollTo({top:0, behavior:"smooth"});
  writeHash(); render();
}
function writeHash(){
  if (!player) return;
  history.replaceState(null, "", `#sp=${sport}&p=${player.id}&s=${encodeURIComponent(ui.stat)}&l=${ui.line}&side=${ui.side}`);
}

function render(){
  if (!player){ renderLanding(); return; }
  const app = $("app"); app.innerHTML = "";
  const key = ui.stat, line = Number(ui.line), side = ui.side;
  const ng = nextGame(), opp = ng && defense.teams[ng.opp];
  const all = games();

  /* header */
  const head = el("section", {class:"panel prop-head"});
  const who = el("div", {class:"who"});
  const initials = el("span", {class:"initials", text: player.name.split(" ").map(w => w[0]).join("").slice(0, 2)});
  if (player.headshot){
    const img = el("img", {src:player.headshot, alt:"", width:72, height:72, loading:"lazy", referrerpolicy:"no-referrer"});
    img.onerror = () => img.replaceWith(initials);
    who.append(img);
  } else who.append(initials);
  const nm = el("div", {}, el("h2", {text:player.name}));
  const inj = injuries && injuries.get(norm(player.name) + (sport === "nfl" ? "|" + player.team : ""));
  const sub = el("p", {class:"sub", style:"margin:0", text:`${player.pos}, ${player.team}. ${all.length} games since ${all.length ? seasonName(all[0].s) : seasonName(season())}.`});
  if (inj) sub.append(" ", el("span", {class:"inj", text:inj}));
  if ((sport === "nhl" && grpOf(player) === "G") || (sport === "mlb" && grpOf(player) === "SP"))
    sub.append(el("br"), el("small", {text:"Uses only games he started, and assumes he starts the next one. Confirm the starter before betting."}));
  nm.append(sub);
  who.append(nm);
  head.append(who);
  if (ng){
    const bits = [new Date(ng.date + "T12:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"})];
    if (sport === "nfl") bits.push(ng.sp == null ? "no line yet" : ng.sp > 0 ? `favored by ${ng.sp}` : ng.sp < 0 ? `${-ng.sp}-point underdog` : "pick'em");
    if (ng.t) bits.push(`total ${ng.t}`);
    if (ng.imp) bits.push(`team expected to score ${fmt1(ng.imp)}`);
    if (ng.rest === 0) bits.push("second night of a back-to-back");
    else if (ng.rest != null && ng.rest <= 4) bits.push(`${ng.rest} day${ng.rest === 1 ? "" : "s"} of rest`);
    if (ng.opp_sp) bits.push(`facing ${ng.opp_sp}`);
    head.append(el("div", {class:"next"}, el("span", {class:"lbl", text: ng.week ? `Week ${ng.week}` : "Next game"}),
      el("strong", {text:`${ng.home ? "vs" : "at"} ${ng.opp}`}), el("span", {text: bits.join(", ")})));
  } else head.append(el("div", {class:"next"}, el("span", {text:"No upcoming game on the schedule."})));
  app.append(head);
  liveHost = el("div", {id:"live-card"});
  app.append(liveHost);
  refreshPlayerLive();

  /* controls */
  const ctl = el("section", {class:"panel"});
  const statSel = el("select", {class:"inline", "aria-label":"Prop"});
  (C().props[grpOf(player)] || Object.values(C().props)[0]).forEach(([k, l]) => statSel.append(el("option", {value:k, text:l, selected: k === key ? "" : false})));
  statSel.onchange = () => { ui.stat = statSel.value; ui.line = defaultLine(ui.stat); writeHash(); render(); };
  const lineIn = el("input", {type:"number", step:"0.5", min:"0", value:line, class:"line-in", "aria-label":"Line"});
  lineIn.onchange = () => { const v = Number(lineIn.value); if (!isNaN(v) && v >= 0){ ui.line = v; writeHash(); render(); } };
  const sideSeg = el("span", {class:"seg"}, ...["over","under"].map(s => el("button", {text: s === "over" ? "Over" : "Under", "aria-pressed": String(side === s), onclick: () => { ui.side = s; writeHash(); render(); }})));
  const oO = el("input", {type:"text", inputmode:"numeric", placeholder:"-110", value:ui.oddsO, class:"odds-in", "aria-label":"Over odds"});
  const oU = el("input", {type:"text", inputmode:"numeric", placeholder:"-110", value:ui.oddsU, class:"odds-in", "aria-label":"Under odds"});
  oO.onchange = () => { ui.oddsO = oO.value.trim(); render(); }; oU.onchange = () => { ui.oddsU = oU.value.trim(); render(); };
  ctl.append(el("div", {class:"bar-row ctl-row"},
    el("label", {class:"field"}, "Prop", statSel),
    el("label", {class:"field"}, "Line", lineIn),
    el("div", {class:"field"}, "Side", sideSeg),
    el("label", {class:"field"}, "Over odds", oO),
    el("label", {class:"field"}, "Under odds", oU),
    el("div", {class:"field"}, "\u00a0", el("button", {class:"btn primary", text:"Track this prop", onclick: () => trackCurrent()}))));

  /* verdict */
  const pr = project(key);
  const verdict = el("div", {class:"verdict-row"});
  if (pr){
    const P = probOver(pr.mu, pr.sd, line, pr.count, pr.disp);
    const pSide = side === "over" ? P.over : P.under;
    const ipO = implied(ui.oddsO), ipU = implied(ui.oddsU);
    let book = null, bookTxt = "";
    if (ipO && ipU){ const fair = (side === "over" ? ipO : ipU) / (ipO + ipU); book = fair; bookTxt = `Book's fair chance (vig removed): ${pct(fair)}`; }
    else if (side === "over" && ipO){ book = ipO; bookTxt = `Book implies ${pct(ipO)}`; }
    else if (side === "under" && ipU){ book = ipU; bookTxt = `Book implies ${pct(ipU)}`; }
    const big = el("div", {class:"big"}, el("span", {class:"num", text:pct(pSide)}),
      el("span", {class:"cap", text:`model chance of ${side === "over" ? "Over" : "Under"} ${line} ${labelOf(key)}`}));
    verdict.append(big);
    const facts = el("div", {class:"facts"},
      el("div", {}, el("span", {class:"lbl", text:"Projection"}), el("strong", {text: pr.count ? fmt1(pr.mu) : String(Math.round(pr.mu))}), el("small", {text: pr.count ? " expected" : ` ± ${Math.round(pr.sd)}`})),
      el("div", {}, el("span", {class:"lbl", text:"Fair odds"}), el("strong", {text:toAmerican(pSide)})));
    if (book != null){
      const edge = pSide - book;
      facts.append(el("div", {}, el("span", {class:"lbl", text:"Edge"}),
        el("strong", {class: edge >= 0.05 ? "pos" : edge <= -0.05 ? "neg" : "", text:(edge >= 0 ? "+" : "") + Math.round(edge * 100) + " pts"}), el("small", {text:" " + bookTxt})));
    } else facts.append(el("div", {}, el("span", {class:"lbl", text:"Edge"}), el("small", {text:"Enter the book's odds to compare"})));
    if (P.push > 0.02) facts.append(el("div", {}, el("span", {class:"lbl", text:"Push"}), el("strong", {text:pct(P.push)})));
    verdict.append(facts);
  } else verdict.append(el("p", {class:"empty", style:"margin:0", text:"Not enough games yet to project this player."}));
  ctl.append(verdict);

  // hit-rate strip
  const strip = el("div", {class:"strip"});
  const cur = all.filter(g => g.s === season()), last = all.filter(g => g.s === season() - 1);
  [["Last 5", all.slice(-5)], ["Last 10", all.slice(-10)], [seasonName(season()), cur], [seasonName(season() - 1), last],
   ng ? [`vs ${ng.opp}`, all.filter(g => g.o === ng.opp)] : null].filter(Boolean).forEach(([lbl, list]) => {
    const r = hitRate(list, key, line, side);
    strip.append(el("div", {class:"hr"}, el("span", {class:"lbl", text:lbl}),
      r ? el("strong", {text:`${r.h}/${r.n - r.p}`}) : el("strong", {text:"–"}), r ? el("small", {text:pct(r.rate)}) : null));
  });
  ctl.append(strip);
  app.append(ctl);

  /* chart */
  app.append(chartPanel(all, key, line, side));

  /* why */
  if (pr) app.append(whyPanel(pr, key, ng, opp));

  /* splits */
  app.append(splitsPanel(all, key, line, side, ng, opp));

  /* opponent + scheme */
  const dp = defensePanel(ng, opp);
  if (dp) app.append(dp);
  const sp = schemePanel(ng, opp);
  if (sp) app.append(sp);

  /* teammates */
  if (player.mates && player.mates.length) app.append(matesPanel(all, key, line, side));
}

function chartPanel(all, key, line, side){
  const panel = el("section", {class:"panel"});
  const ranges = [["5","Last 5"],["10","Last 10"],["20","Last 20"],["season",seasonName(season())],["all","All"]];
  const seg = el("span", {class:"seg"}, ...ranges.map(([v, l]) => el("button", {text:l, "aria-pressed": String(ui.range === v), onclick: () => { ui.range = v; render(); }})));
  panel.append(el("div", {class:"bar-row", style:"justify-content:space-between"}, el("h2", {text:"Game by game"}), seg));
  let list = ui.range === "5" ? all.slice(-5) : ui.range === "10" ? all.slice(-10) : ui.range === "20" ? all.slice(-20) : ui.range === "season" ? all.filter(g => g.s === season()) : all;
  if (!list.length){ panel.append(el("p", {class:"empty", text:"No games in this range."})); return panel; }
  const vals = list.map(g => statOf(g, key));
  const maxV = Math.max(line * 1.25, ...vals, 1);
  const gut = 44, bw = 46, gap = 10, H = 220, top = 22, bottom = 44, W = gut + list.length * (bw + gap) + gap;
  const y = v => top + (H - top - bottom) * (1 - v / maxV);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${Math.max(W, 320)} ${H}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${player.name} ${labelOf(key)} by game against a line of ${line}`);
  svg.style.minWidth = Math.max(W, 320) * 0.85 + "px";
  svg.style.maxWidth = Math.max(W, 320) * 1.3 + "px";
  const detail = el("p", {class:"chart-detail", text:"Tap a bar for game details."});
  list.forEach((g, i) => {
    const v = vals[i], x = gut + gap + i * (bw + gap), r = hit(v, line, side);
    const rect = document.createElementNS(ns, "rect");
    const yy = y(v), h = Math.max(2, (H - bottom) - yy);
    rect.setAttribute("x", x); rect.setAttribute("y", (H - bottom) - h); rect.setAttribute("width", bw); rect.setAttribute("height", h);
    rect.setAttribute("rx", 5); rect.setAttribute("class", "b-" + r); rect.setAttribute("tabindex", "0");
    const when = g.w ? `${seasonName(g.s)} week ${g.w}` : `${shortDate(g.d)}, ${String(g.d).slice(0, 4)}`;
    const result = g.ts != null ? `, ${g.ts > g.os ? "won" : g.ts < g.os ? "lost" : "tied"} ${g.ts}–${g.os}` : g.wn != null ? (g.wn ? ", won" : ", lost") : "";
    const info = `${when}${g.post ? " (playoffs)" : ""}: ${g.h ? "vs" : "at"} ${g.o}${result}${g.sp != null ? `, ${g.sp > 0 ? "favored by " + g.sp : g.sp < 0 ? "underdog by " + (-g.sp) : "pick'em"}` : ""}${g.t ? `, total ${g.t}` : ""}${g.rs === 0 ? ", back-to-back" : ""}${g.st === 0 && sport === "nba" ? ", off the bench" : ""}${g.dr ? `, ${ordinal(g.dr)}-toughest matchup for ${grpName()}` : ""}. ${labelOf(key)}: ${fmt1(v)}. ${Object.entries(g.x).filter(([k]) => k !== "ppr").map(([k, val]) => `${val} ${C().label[k] || k}`).join(", ")}.`;
    const t = document.createElementNS(ns, "title"); t.textContent = info; rect.append(t);
    const pick = () => { detail.textContent = info; svg.querySelectorAll("rect").forEach(r2 => r2.classList.remove("sel")); rect.classList.add("sel"); };
    rect.addEventListener("click", pick); rect.addEventListener("focus", pick);
    svg.append(rect);
    const tv = document.createElementNS(ns, "text"); tv.setAttribute("x", x + bw / 2); tv.setAttribute("y", (H - bottom) - h - 6); tv.setAttribute("class", "tv"); tv.textContent = fmt1(v); svg.append(tv);
    const tl = document.createElementNS(ns, "text"); tl.setAttribute("x", x + bw / 2); tl.setAttribute("y", H - bottom + 17); tl.setAttribute("class", "tl"); tl.textContent = (g.h ? "" : "@") + g.o; svg.append(tl);
    const tw = document.createElementNS(ns, "text"); tw.setAttribute("x", x + bw / 2); tw.setAttribute("y", H - bottom + 32); tw.setAttribute("class", "tw"); tw.textContent = g.w ? `W${g.w}${g.s !== season() ? " '" + String(g.s).slice(2) : ""}` : `${shortDate(g.d)}${String(g.d).slice(0, 4) !== String(new Date().getFullYear()) ? " '" + String(g.d).slice(2, 4) : ""}`; svg.append(tw);
  });
  const ly = y(line);
  const ln = document.createElementNS(ns, "line"); ln.setAttribute("x1", gut - 4); ln.setAttribute("x2", Math.max(W, 320)); ln.setAttribute("y1", ly); ln.setAttribute("y2", ly); ln.setAttribute("class", "ln"); svg.append(ln);
  const lt = document.createElementNS(ns, "text"); lt.setAttribute("x", gut - 8); lt.setAttribute("y", ly + 4); lt.setAttribute("text-anchor", "end"); lt.setAttribute("class", "lt"); lt.textContent = `${line}`; svg.append(lt);
  const r = hitRate(list, key, line, side);
  panel.append(el("p", {class:"sub", text:`${side === "over" ? "Over" : "Under"} ${line} hit in ${r.h} of ${r.n - r.p} games (${pct(r.rate)})${r.p ? `, ${r.p} push${r.p > 1 ? "es" : ""}` : ""}. Average ${fmt1(vals.reduce((a, b) => a + b, 0) / vals.length)}, median ${fmt1(median(vals))}.`}),
    el("div", {class:"chartwrap"}, svg), detail);
  return panel;
}
const ordinal = n => n + (["th","st","nd","rd"][(n % 100 - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");

function whyPanel(pr, key, ng, opp){
  const panel = el("section", {class:"panel"}, el("h2", {text:"How the projection is built"}));
  const rows = [
    ["Recent form", `Weighted average of his games, newest weighted most`, pr.mu0, null],
    ["Opponent", ng ? `What ${ng.opp} allows to ${grpName()} vs league average` : "No game scheduled", pr.mu1, pr.mu0 ? pr.mu1 / pr.mu0 : 1],
    sport === "nfl" ? ["Scheme fit", schemeNote(pr), pr.mu2, pr.mu1 ? pr.mu2 / pr.mu1 : 1] : null,
    sport === "nfl"
      ? ["Game script", ng && ng.imp ? `${player.team} ${ng.sp > 0 ? "favored by " + ng.sp : ng.sp < 0 ? "underdog by " + (-ng.sp) : "even"}, expected to score ${fmt1(ng.imp)} (league average ${fmt1(defense.avg_team_total)})` : "No betting line yet", pr.mu, pr.mu2 ? pr.mu / pr.mu2 : 1]
      : ["Schedule", C().rest ? (ng && ng.rest === 0 ? "Second night of a back-to-back, which trims minutes and production" : "Not on a back-to-back, so no adjustment") : "No schedule adjustment for this sport", pr.mu, pr.mu2 ? pr.mu / pr.mu2 : 1]
  ].filter(Boolean);
  const ul = el("ul", {class:"why-list"});
  rows.forEach(([t, d, v, f]) => ul.append(el("li", {},
    el("div", {}, el("strong", {text:t}), el("small", {text:d})),
    f == null ? el("span", {class:"chip", text:"base"}) : el("span", {class:`chip ${f > 1.005 ? "up" : f < 0.995 ? "down" : ""}`, text:signPct(f)}),
    el("span", {class:"v", text: pr.count ? fmt1(v) : String(Math.round(v))}))));
  panel.append(ul, el("p", {class:"why", style:"margin-top:10px", text: pr.count
    ? `This stat is modeled as a count. His games swing ${pr.disp > 1.15 ? "more than a steady rate would explain, so the odds are spread wider to match" : "about as much as a steady rate would, so it's priced like one"}.`
    : `This stat uses a bell curve centered on the projection, with a spread of about ${fmt1(pr.sd)} based on how much his games actually swing.`}));
  return panel;
}
function schemeNote(pr){
  const notes = pr.parts.flatMap(p => p.notes);
  if (!notes.length) return "No scheme data that applies to this stat";
  if (Math.abs(pr.mu2 / (pr.mu1 || 1) - 1) < 0.005) return "His splits barely change against what this defense does";
  const byLabel = {}; notes.forEach(([l, f]) => byLabel[l] = (byLabel[l] || 1) * f);
  return "His splits vs this defense's " + Object.entries(byLabel).map(([l, f]) => `${l} (${signPct(f)})`).join(", ");
}

function splitsPanel(all, key, line, side, ng, opp){
  const panel = el("section", {class:"panel"}, el("h2", {text:"When the situation matches"}),
    el("p", {class:"sub", text:`Every split from his game log. Rows marked "${sport === "nfl" ? "This week" : "Next game"}" match his next game.`}));
  const G = grpOf(player), oppRank = ng && opp && opp.pos[G] ? opp.pos[G].rank : null;
  const nTeams = Object.keys(defense.teams).length || 30, bottom = nTeams - 9;
  const won = g => g.ts != null ? g.ts > g.os : g.wn === 1, lost = g => g.ts != null ? g.ts < g.os : g.wn === 0;
  const S = [
    ["Home", g => g.h === 1, ng && ng.home === 1], ["Away", g => g.h === 0, ng && ng.home === 0],
    ["Favored", g => g.sp > 0, ng && ng.sp > 0], ["Underdog", g => g.sp < 0, ng && ng.sp < 0],
    ["Big favorite (6+)", g => g.sp >= 6, ng && ng.sp >= 6], ["Big underdog (6+)", g => g.sp <= -6, ng && ng.sp <= -6],
    ["High total (47+)", g => g.t >= 47, ng && ng.t >= 47], ["Low total (under 43)", g => g.t && g.t < 43, ng && ng.t && ng.t < 43],
    ["Dome or closed roof", g => g.r === "dome", ng && ng.roof === "dome"], ["Outdoors", g => g.r === "outdoors", ng && ng.roof === "outdoors"],
    ["Cold (40°F or less)", g => g.r === "outdoors" && g.tp != null && g.tp <= 40, false], ["Windy (15+ mph)", g => g.r === "outdoors" && g.wd >= 15, false],
    ["Division games", g => g.dv === 1, ng && ng.div === 1],
    ...(C().rest ? [["Back-to-back (no rest)", g => g.rs === 0, ng && ng.rest === 0], ["1 day of rest", g => g.rs === 1, ng && ng.rest === 1],
      ["2+ days of rest", g => g.rs >= 2 && g.rs <= 6, ng && ng.rest >= 2 && ng.rest <= 6]] : []),
    ...(sport === "nba" ? [["Starting", g => g.st === 1, false], ["Off the bench", g => g.st === 0, false], ["Played 32+ minutes", g => (g.x.min || 0) >= 32, false]] : []),
    [`vs the 10 toughest matchups for ${grpName()}`, g => g.dr && g.dr <= 10, oppRank && oppRank <= 10],
    [`vs the 10 easiest matchups for ${grpName()}`, g => g.dr && g.dr >= bottom, oppRank && oppRank >= bottom],
    ["Team won", won, false], ["Team lost", lost, false],
    ["Playoffs", g => g.post === 1, false]
  ];
  const tbl = el("table", {class:"rank-t split-t"}, el("thead", {}, el("tr", {}, ...["Situation","Games","Avg","Hit rate"].map(h => el("th", {text:h})))));
  const tb = el("tbody");
  const allAvg = all.length ? all.reduce((s, g) => s + statOf(g, key), 0) / all.length : 0;
  S.forEach(([label, fn, now]) => {
    const list = all.filter(fn); if (!list.length) return;
    const r = hitRate(list, key, line, side), avg = list.reduce((s, g) => s + statOf(g, key), 0) / list.length;
    tb.append(el("tr", {class: now ? "now" : ""},
      el("td", {}, label, now ? el("span", {class:"wk", text: sport === "nfl" ? "This week" : "Next game"}) : null),
      el("td", {text:list.length}),
      el("td", {}, fmt1(avg), el("small", {class: avg > allAvg * 1.08 ? "pos" : avg < allAvg * 0.92 ? "neg" : "", text:` ${avg >= allAvg ? "▲" : "▼"}`})),
      el("td", {}, el("div", {class:"hrbar"}, el("i", {style:`width:${Math.round(r.rate * 100)}%`, class: r.rate >= 0.6 ? "good" : r.rate <= 0.4 ? "bad" : ""}), el("span", {text:`${r.h}/${r.n - r.p} (${pct(r.rate)})`})))));
  });
  tbl.append(tb);
  panel.append(el("div", {class:"tablewrap"}, tbl), el("p", {class:"why", style:"margin-top:8px", text:`Arrows compare each split's average with his overall average (${fmt1(allAvg)}). Small samples swing a lot, so read the games column first.`}));
  return panel;
}

function schemePanel(ng, opp){
  const sch = player.scheme; if (sport !== "nfl" || !sch || !Object.keys(sch).length) return null;
  const L = defense.league.scheme, os = opp ? opp.scheme : {};
  const panel = el("section", {class:"panel"}, el("h2", {text:"Scheme matchup"}));
  const covYears = (sch.cov_seasons || []).length ? `${sch.cov_seasons[0]}–${sch.cov_seasons[sch.cov_seasons.length - 1]}` : null;
  panel.append(el("p", {class:"sub", text:`How he produces against different looks (shrunk toward his overall numbers when the sample is small), next to what ${ng ? ng.opp : "the opponent"} actually does. Blitz and box data come from FTN charting through this week. Man/zone coverage comes from ${covYears || "past seasons"}, because it's published after each season, so the opponent's man rate is last season's.`}));
  const rows = el("div", {class:"scheme-grid"});
  const card = (title, lines, oppTxt) => rows.append(el("div", {class:"sch"}, el("h3", {text:title}), ...lines.map(([l, v, n]) => el("div", {class:"sch-row"}, el("span", {text:l}), el("strong", {text:v}), n != null ? el("small", {text:` ${n} plays`}) : null)), oppTxt ? el("p", {class:"why", text:oppTxt}) : null));
  const rate = (a, b) => a == null || b == null ? "" : `${ng ? ng.opp : "Opponent"}: ${pct(a)} (league ${pct(b)})`;
  if (sch.unit === "dropback"){
    const f = x => x ? `${fmt1(x.pyd)} yds/dropback, ${fmt1(x.ptd * 100)}% TD, ${fmt1(x.int * 100)}% INT` : "–";
    if (sch.blitz) card("Against the blitz", [["Blitzed", f(sch.blitz.yes), sch.blitz.yes.n], ["Not blitzed", f(sch.blitz.no), sch.blitz.no.n]], rate(os.blitz, L.blitz) && "Blitz rate. " + rate(os.blitz, L.blitz));
    if (sch.cov) card("Man vs zone", [["Man", f(sch.cov.man), sch.cov.man.n], ["Zone", f(sch.cov.zone), sch.cov.zone.n]], os.man != null ? "Man rate. " + rate(os.man, L.man) : null);
  } else if (sch.unit === "team dropback"){
    const f = x => x ? `${fmt1(x.reyd * 35)} yds, ${fmt1(x.rec * 35)} rec, ${fmt1(x.tgt * 35)} tgt` : "–";
    const note = "Per 35 team pass plays, about one game's worth.";
    if (sch.blitz) card("Against the blitz", [["Blitzed", f(sch.blitz.yes), sch.blitz.yes.n], ["Not blitzed", f(sch.blitz.no), sch.blitz.no.n]], `${note} Blitz rate. ${rate(os.blitz, L.blitz)}`);
    if (sch.cov) card("Man vs zone", [["Man", f(sch.cov.man), sch.cov.man.n], ["Zone", f(sch.cov.zone), sch.cov.zone.n]], os.man != null ? `${note} Man rate. ${rate(os.man, L.man)}` : note);
  }
  if (sch.box){
    const f = x => x ? `${fmt1(x.ruyd)} yds/carry, ${fmt1(x.rutd * 100)}% TD` : "–";
    card("Defenders in the box", [["Light (6 or fewer)", f(sch.box.light), sch.box.light.n], ["Base (7)", f(sch.box.base), sch.box.base.n], ["Stacked (8+)", f(sch.box.stacked), sch.box.stacked.n]],
      os.stacked != null ? `${ng ? ng.opp : "Opponent"} stacks the box on ${pct(os.stacked)} of runs (league ${pct(L.stacked)}) and goes light on ${pct(os.light)} (league ${pct(L.light)}).` : null);
  }
  panel.append(rows);
  return panel;
}

function defensePanel(ng, opp){
  const G = grpOf(player);
  if (!ng || !opp || !opp.pos[G]) return null;
  const pd = opp.pos[G], lg = defense.league.pos[G], keys = (C().defKeys[G] || []).filter(k => pd.allow[k] != null && lg[k]);
  if (!keys.length) return null;
  const goalie = sport === "nhl" && G === "G", pitcher = sport === "mlb" && G !== "H";
  const what = goalie ? `${ng.opp}'s offense vs goalies` : pitcher ? `${ng.opp}'s lineup vs ${grpName()}` : `${ng.opp} vs ${grpName()}`;
  const panel = el("section", {class:"panel"}, el("h2", {text:`${what}: ${ordinal(pd.rank)} toughest matchup`}),
    el("p", {class:"sub", text:`Per game ${goalie ? "against" : pitcher ? "against" : "allowed to"} all ${grpName()} combined. ${pd.g} game${pd.g === 1 ? "" : "s"} this season, blended with last season so early games don't overreact.`}));
  const dl = el("div", {class:"def-row"});
  keys.forEach(k => { const f = pd.allow[k] / lg[k];
    dl.append(el("div", {}, el("span", {class:"lbl", text:(C().label[k] || k) + (goalie || pitcher ? "" : " allowed")}), el("strong", {text:fmt1(pd.allow[k])}),
      el("small", {class: f > 1.05 ? "pos" : f < 0.95 ? "neg" : "", text:` ${signPct(f)} vs avg`}))); });
  panel.append(dl);
  return panel;
}

function matesPanel(all, key, line, side){
  const panel = el("section", {class:"panel"}, el("h2", {text:"With or without a teammate"}),
    el("p", {class:"sub", text:"How he does when a teammate plays or sits. \"Without\" means the teammate didn't record a stat that week, usually because he was inactive. Only games where they were on the same team count."}));
  const sel = el("select", {class:"inline", "aria-label":"Teammate"});
  sel.append(el("option", {value:"", text:"Pick a teammate..."}));
  player.mates.forEach((m, i) => sel.append(el("option", {value:String(i), text:`${m.name} (${m.pos})`, selected: ui.mate === String(i) ? "" : false})));
  sel.onchange = () => { ui.mate = sel.value; render(); };
  panel.append(sel);
  if (ui.mate !== ""){
    const bit = 1 << Number(ui.mate), m = player.mates[Number(ui.mate)];
    const elig = all.filter(g => g.me & bit);
    const withL = elig.filter(g => g.mp & bit), without = elig.filter(g => !(g.mp & bit));
    const tbl = el("table", {class:"rank-t split-t", style:"margin-top:10px"}, el("thead", {}, el("tr", {}, ...["", "Games", "Avg", "Hit rate"].map(h => el("th", {text:h})))));
    const tb = el("tbody");
    [[`With ${m.name}`, withL], [`Without ${m.name}`, without]].forEach(([l, list]) => {
      const r = hitRate(list, key, line, side);
      tb.append(el("tr", {}, el("td", {text:l}), el("td", {text:list.length}),
        el("td", {text: list.length ? fmt1(list.reduce((s, g) => s + statOf(g, key), 0) / list.length) : "–"}),
        el("td", {text: r ? `${r.h}/${r.n - r.p} (${pct(r.rate)})` : "–"})));
    });
    tbl.append(tb); panel.append(el("div", {class:"tablewrap"}, tbl));
    if (without.length && without.length < 3) panel.append(el("p", {class:"why", text:"Only a game or two without him, so treat this as a hint, not a trend."}));
  }
  return panel;
}

/* ---------- Live tracking ---------- */
let tracked = store.get("tradescale:tracked") || [];
let liveHost = null, liveTimer = null, toastTimer = null;
const saveTracked = () => store.set("tradescale:tracked", tracked);
const sportLabel = sp => (SPORTS.find(s => s[0] === sp) || [, sp])[1];

function trackCurrent(){
  const key = ui.stat, line = Number(ui.line), pr = project(key);
  if (!pr){ toast("Not enough games to model this player yet."); return; }
  const P = probOver(pr.mu, pr.sd, line, pr.count, pr.disp);
  const ng = nextGame();
  const bet = {id: Date.now().toString(36), sport, pid: player.id, name: player.name, team: player.team, grp: grpOf(player),
    key, label: labelOf(key), line, side: ui.side, mu: pr.mu, sd: pr.sd, count: pr.count, disp: pr.disp,
    pre: ui.side === "over" ? P.over : P.under, start: ng ? (ng.time && ng.time.includes("T") ? ng.time : ng.date) : null,
    opp: ng ? ng.opp : "", added: new Date().toISOString(), hist: []};
  if (sport === "mlb" && grpOf(player) === "SP"){ const po = project("outs"); bet.outsMu = po ? po.mu : 17; }
  if (tracked.some(b => b.sport === bet.sport && b.pid === bet.pid && b.key === bet.key && b.line === bet.line && b.side === bet.side && !b.result)){
    toast("You're already tracking that one."); return;
  }
  tracked.unshift(bet); saveTracked(); renderTracker(); pollSoon(0);
  toast(`Tracking ${bet.name} ${bet.side} ${bet.line} ${bet.label}.`);
  document.getElementById("tracker").scrollIntoView({behavior:"smooth", block:"start"});
}

function startText(b){
  if (!b.start) return "Waiting for the next game";
  const d = new Date(b.start.length > 10 ? b.start : b.start + "T12:00:00");
  const opts = b.start.length > 10 ? {weekday:"short", hour:"numeric", minute:"2-digit"} : {weekday:"short", month:"short", day:"numeric"};
  return `${b.opp ? "vs " + b.opp + ", " : ""}${d.toLocaleString(undefined, opts)}`;
}
function spark(hist){
  if (!hist || hist.length < 2) return null;
  const ns = "http://www.w3.org/2000/svg", w = 120, h = 32, svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.setAttribute("class", "spark"); svg.setAttribute("aria-hidden", "true");
  const pts = hist.map((p, i) => `${(i / (hist.length - 1)) * w},${h - 2 - p[1] * (h - 4)}`).join(" ");
  const mid = document.createElementNS(ns, "line"); mid.setAttribute("x1", 0); mid.setAttribute("x2", w); mid.setAttribute("y1", h / 2); mid.setAttribute("y2", h / 2); mid.setAttribute("class", "spark-mid");
  const pl = document.createElementNS(ns, "polyline"); pl.setAttribute("points", pts); pl.setAttribute("class", "spark-line");
  svg.append(mid, pl); return svg;
}
function liveRow(b){
  const L = b.live || {}, ch = b.lc;
  const status = b.result ? (b.result === "won" ? "Won" : b.result === "lost" ? "Lost" : "Push")
    : L.state === "live" ? `Live, ${L.detail || ""}` : L.state === "final" ? "Final" : startText(b);
  const score = L.score && L.state !== "pre" ? `${b.team} ${L.score[0]}–${L.score[1]} ${L.opp || ""}` : "";
  const cur = ch ? ch.cur : null, pctToLine = cur == null ? 0 : Math.min(1, cur / Math.max(b.line, 0.5));
  const row = el("li", {class:`trk ${b.result ? "res-" + b.result : L.state === "live" ? "is-live" : ""}`},
    el("div", {class:"trk-main"},
      el("div", {class:"trk-name"}, el("strong", {text:b.name}), el("span", {class:"tag", text:sportLabel(b.sport)})),
      el("div", {class:"trk-prop", text:`${b.side === "over" ? "Over" : "Under"} ${b.line} ${b.label}`}),
      el("div", {class:"trk-status"}, L.state === "live" && !b.result ? el("span", {class:"dot"}) : null, status, score ? el("span", {class:"split", text:"  " + score}) : null),
      cur != null ? el("div", {class:"trk-prog"}, el("div", {class:"bar"}, el("i", {style:`width:${Math.round(pctToLine * 100)}%`})),
        el("span", {text:`${fmt1(cur)} of ${b.line}${ch && ch.approx ? " (approx.)" : ""}`})) : null,
      L.inBox === false && L.state === "live" ? el("small", {class:"split", text:"Not in the box score yet."}) : null),
    el("div", {class:"trk-num"},
      el("span", {class:"num", text: b.result ? (b.result === "won" ? "✓" : b.result === "lost" ? "✕" : "=") : ch ? pct(ch.chance) : pct(b.pre)}),
      el("small", {text: ch && !b.result ? `was ${pct(b.pre)} pre-game` : b.result ? `pre-game ${pct(b.pre)}` : "pre-game chance"}),
      spark(b.hist)),
    el("button", {class:"x", text:"×", "aria-label":`Stop tracking ${b.name}`, onclick: () => { tracked = tracked.filter(t => t.id !== b.id); saveTracked(); renderTracker(); }}));
  return row;
}
function renderTracker(){
  const host = $("tracker"); if (!host) return;
  host.innerHTML = "";
  if (!tracked.length){ host.hidden = true; return; }
  host.hidden = false;
  const anyDone = tracked.some(b => b.result || (b.live && b.live.state === "final"));
  const alertsBtn = ("Notification" in window) && Notification.permission !== "granted"
    ? el("button", {class:"btn", text:"Turn on alerts", onclick: async () => { try { await Notification.requestPermission(); } catch(e){} renderTracker(); }}) : null;
  host.append(el("div", {class:"bar-row", style:"justify-content:space-between"},
    el("h2", {text:"Tracked props"}),
    el("div", {class:"bar-row"}, alertsBtn,
      el("button", {class:"btn", text:"Refresh", onclick: () => { LIVE.clearCache(); pollSoon(0); }}),
      anyDone ? el("button", {class:"btn", text:"Clear finished", onclick: () => { tracked = tracked.filter(b => !(b.result || (b.live && b.live.state === "final"))); saveTracked(); renderTracker(); }}) : null)),
    el("p", {class:"sub", text:"Live chances update every 30 seconds while a game is on. They start from the pre-game projection and lean more on tonight's pace as the game goes on."}));
  const ul = el("ul", {class:"trk-list"});
  tracked.forEach(b => ul.append(liveRow(b)));
  host.append(ul);
}
async function updateBet(b){
  if (b.result && b.live && b.live.state === "final") return;
  try {
    const L = await LIVE.playerLive(b.sport, b.team, b.name);
    b.live = L;
    if (L.state === "live" || L.state === "final"){
      if (!L.x && L.state === "final"){ b.lc = null; return; }
      const ch = LIVE.liveChance(b, L);
      const was = b.result;
      b.lc = ch; b.result = ch.result;
      if (L.state === "live" || !b.hist.length || b.hist[b.hist.length - 1][1] !== ch.chance){
        b.hist.push([Date.now(), ch.chance]); if (b.hist.length > 150) b.hist.splice(0, b.hist.length - 150);
      }
      if (ch.result && ch.result !== was) notify(b, ch);
    }
  } catch(e){ b.live = Object.assign(b.live || {}, {error: "Couldn't reach live scores"}); }
}
function notify(b, ch){
  const msg = `${b.name} ${b.side} ${b.line} ${b.label}: ${ch.result === "won" ? "hit" : ch.result === "lost" ? "missed" : "push"} (${fmt1(ch.cur)})`;
  toast(msg);
  try { if ("Notification" in window && Notification.permission === "granted") new Notification("Trade Scale", {body: msg}); } catch(e){}
}
function toast(msg){
  let t = document.getElementById("toast");
  if (!t){ t = el("div", {id:"toast", role:"status", "aria-live":"polite"}); document.body.append(t); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 4500);
}

async function refreshPlayerLive(){
  if (!player || !liveHost) return;
  const host = liveHost, p = player, sp = sport;
  let L;
  try { L = await LIVE.playerLive(sp, p.team, p.name); } catch(e){ return; }
  if (host !== liveHost || p !== player || !L || (L.state !== "live" && L.state !== "final")) { if (host === liveHost) host.innerHTML = ""; return; }
  if (L.state === "final" && L.date && Date.now() - new Date(L.date) > 14 * 3600e3){ host.innerHTML = ""; return; }
  const pr = project(ui.stat); if (!pr){ host.innerHTML = ""; return; }
  const bet = {sport: sp, grp: grpOf(p), key: ui.stat, line: Number(ui.line), side: ui.side, mu: pr.mu, sd: pr.sd, count: pr.count, disp: pr.disp};
  if (sp === "mlb" && grpOf(p) === "SP"){ const po = project("outs"); bet.outsMu = po ? po.mu : 17; }
  const ch = L.x ? LIVE.liveChance(bet, L) : null;
  host.innerHTML = "";
  host.append(el("section", {class:`panel live-card ${L.state === "live" ? "is-live" : ""}`},
    el("div", {class:"bar-row", style:"justify-content:space-between"},
      el("div", {}, el("span", {class:"lbl", text: L.state === "live" ? "Live now" : "Final"}),
        el("strong", {class:"lc-score", text:`${p.team} ${L.score[0]}–${L.score[1]} ${L.opp}`}), el("span", {class:"split", text:"  " + (L.detail || "")})),
      ch ? el("div", {class:"lc-num"}, el("span", {class:"num", text: ch.result ? (ch.result === "won" ? "Hit" : ch.result === "lost" ? "Missed" : "Push") : pct(ch.chance)}),
        el("small", {text: ch.result ? `${fmt1(ch.cur)} ${labelOf(ui.stat)}` : `live chance of ${ui.side} ${ui.line}`})) : null),
    ch ? el("div", {class:"trk-prog", style:"margin-top:10px"}, el("div", {class:"bar"}, el("i", {style:`width:${Math.round(Math.min(1, ch.cur / Math.max(bet.line, 0.5)) * 100)}%`})),
      el("span", {text:`${fmt1(ch.cur)} ${labelOf(ui.stat)} so far, line ${ui.line}${ch.f > 0 ? `, about ${Math.round(ch.f * 100)}% of the game left` : ""}${ch.approx ? " (total bases approximate)" : ""}`}))
      : el("p", {class:"sub", style:"margin:8px 0 0", text: L.inBox === false ? "He isn't in the box score yet." : "No stats for him yet."})));
}

// one loop drives both the tracker and the open player's live card
async function poll(){
  clearTimeout(liveTimer);
  if (document.hidden){ liveTimer = setTimeout(poll, 60000); return; }
  await Promise.all(tracked.filter(b => !(b.result && b.live && b.live.state === "final")).map(updateBet));
  saveTracked(); renderTracker();
  await refreshPlayerLive();
  const live = tracked.some(b => b.live && b.live.state === "live") || (liveHost && liveHost.querySelector(".is-live"));
  const soon = tracked.some(b => !b.result && b.start && new Date(b.start.length > 10 ? b.start : b.start + "T00:00:00") - Date.now() < 3 * 3600e3);
  liveTimer = setTimeout(poll, live ? 30000 : soon ? 120000 : 600000);
}
function pollSoon(ms){ clearTimeout(liveTimer); liveTimer = setTimeout(poll, ms); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollSoon(0); });

/* ---------- Boot ---------- */
function readHash(){
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("sp") && CFG[h.get("sp")]) sport = h.get("sp");
  if (h.get("s")) ui.stat = h.get("s");
  if (h.get("l")) ui.line = Number(h.get("l"));
  if (h.get("side") === "under") ui.side = "under";
  return h.get("p");
}
function renderSports(){
  const nav = $("sports"); if (!nav) return; nav.innerHTML = "";
  SPORTS.forEach(([id, label]) => nav.append(el("button", {text:label, "aria-pressed": String(sport === id), onclick: () => { if (id !== sport) switchSport(id); }})));
}
const teamFix = t => ({LAR:"LA", JAC:"JAX", WSH:"WAS"}[t] || t);   // Sleeper vs nflverse team codes
async function switchSport(id, playerId){
  sport = id; player = null; index = null; defense = null; injuries = null;
  ui = Object.assign(ui, {stat:null, line:null, range:"10", mate:"", oddsO:"", oddsU:""});
  store.set("tradescale:props-sport", id);
  renderSports(); $("picker").innerHTML = ""; $("app").innerHTML = "";
  const status = $("status"); status.classList.remove("warn"); status.textContent = "Loading...";
  if (!playerId) history.replaceState(null, "", `#sp=${id}`);
  try {
    [index, defense] = await Promise.all([getJSON(BASE() + "index.json"), getJSON(BASE() + "defense.json")]);
  } catch(e){
    status.classList.add("warn");
    status.textContent = "This sport's props data isn't built yet. It appears after the next daily update (or run the workflow on GitHub).";
    return;
  }
  if (id !== sport) return;   // user switched again while loading
  const live = index.players.filter(p => p[5] > 0).length;
  status.textContent = `${index.players.length} players, ${seasonName(index.season)} season${live ? "" : " (last season's games until the new one starts)"}, updated ${TS.ago(index.updated)}.`;
  renderPicker();
  TS.loadSport(id).then(pool => {   // injury tags from the daily player file (football and basketball)
    if (id !== sport) return;
    injuries = new Map(pool.filter(p => p.inj).map(p => [norm(p.name) + (id === "nfl" ? "|" + teamFix(p.team) : ""), p.inj]));
    if (player) render();
  }).catch(() => {});
  if (playerId) openPlayer(playerId, true); else render();
}
(() => {
  const id = readHash();
  if (!id) sport = store.get("tradescale:props-sport") || sport;
  renderTracker();
  switchSport(sport, id);
  pollSoon(1500);
})();
})();
