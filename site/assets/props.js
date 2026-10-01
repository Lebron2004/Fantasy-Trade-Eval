/* Props page (NFL): hit-rate history, situational and scheme splits, and a transparent projection. */
(() => {
const {el, norm, getJSON, store} = TS;
const $ = id => document.getElementById(id);
const BASE = "data/props/nfl/";

/* ---------- Prop definitions ---------- */
// key: stat or "a+b" combo. "td" = rushing + receiving TDs (anytime scorer).
const PROPS = {
  QB: [["pyd","Passing yards"],["ptd","Passing TDs"],["cmp","Completions"],["att","Pass attempts"],["int","Interceptions"],
       ["ruyd","Rushing yards"],["pyd+ruyd","Pass + rush yards"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]],
  RB: [["ruyd","Rushing yards"],["car","Carries"],["ruyd+reyd","Rush + rec yards"],["rec","Receptions"],["reyd","Receiving yards"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]],
  WR: [["reyd","Receiving yards"],["rec","Receptions"],["tgt","Targets"],["ruyd+reyd","Rush + rec yards"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]],
  TE: [["reyd","Receiving yards"],["rec","Receptions"],["tgt","Targets"],["td","Anytime TD"],["ppr","Fantasy points (PPR)"]]
};
const LABEL = {pyd:"pass yds", ptd:"pass TDs", cmp:"completions", att:"attempts", int:"INTs", car:"carries", ruyd:"rush yds", rutd:"rush TDs",
               rec:"receptions", tgt:"targets", reyd:"rec yds", retd:"rec TDs", ppr:"PPR pts", td:"TDs"};
const components = key => key === "td" ? ["rutd","retd"] : key.split("+");
const COUNT = new Set(["ptd","int","td","rutd","retd","rec","tgt"]);       // modeled as counts (Poisson)
const CV = {pyd:.32, att:.2, cmp:.24, ruyd:.5, reyd:.62, rec:.45, tgt:.4, car:.3, ppr:.45};   // typical game-to-game spread

/* ---------- State ---------- */
let index = null, defense = null, player = null, injuries = null;
let ui = {stat:null, line:null, side:"over", range:"10", mate:"", oddsO:"", oddsU:""};

/* ---------- Math ---------- */
const statOf = (g, key) => components(key).reduce((s, c) => s + (g.x[c] || 0), 0);
function erf(x){ // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
}
const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
function poissonCdf(k, mu){ if (k < 0) return 0; let term = Math.exp(-mu), s = term; for (let i = 1; i <= k; i++){ term *= mu / i; s += term; } return Math.min(1, s); }
function probOver(mu, sd, line, count){
  if (count){ const k = Math.floor(line); const pOver = 1 - poissonCdf(k, mu); const pPush = Number.isInteger(line) ? poissonCdf(k, mu) - poissonCdf(k - 1, mu) : 0; return {over:pOver, push:pPush, under:1 - pOver - pPush}; }
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
  const pos = player.pos, sch = player.scheme || {};
  const parts = components(key).map(c => {
    const base = g.reduce((s, x, i) => s + w[i] * (x.x[c] || 0), 0) / W;
    // opponent: what this defense allows to the position vs league average
    let fOpp = 1;
    if (opp && opp.pos[pos] && lg.pos[pos] && lg.pos[pos][c]){
      const raw = (opp.pos[pos].allow[c] ?? lg.pos[pos][c]) / lg.pos[pos][c];
      fOpp = Math.min(1.35, Math.max(0.7, 1 + (raw - 1) * 0.6));
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
    // game script: spread and implied team total
    let fScr = 1;
    if (ng && ng.imp && defense.avg_team_total){
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
  const cv = key.includes("+") ? 0.42 : (CV[key] || 0.5);
  const n = g.length, sd = Math.max(1, Math.sqrt((n * varEmp + 6 * (cv * mu) ** 2) / (n + 6)));
  return {mu0, mu1, mu2, mu, sd, parts, count: COUNT.has(key)};
}

/* ---------- Rendering ---------- */
function renderPicker(){
  const host = $("picker"); host.innerHTML = "";
  if (!index) return;
  const wrap = el("div", {class:"search", style:"max-width:520px"});
  const input = el("input", {type:"text", placeholder:"Search any NFL player or team", autocomplete:"off", role:"combobox", "aria-label":"Search players", "aria-expanded":"false"});
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
  try { player = await getJSON(BASE + "p/" + id + ".json"); }
  catch(e){ $("app").innerHTML = ""; $("app").append(el("section", {class:"panel"}, el("p", {class:"err", text:"Couldn't load that player. He may have been removed in today's update."}))); return; }
  const props = PROPS[player.pos] || PROPS.WR;
  if (!fromHash || !props.some(p => p[0] === ui.stat)){ ui.stat = props[0][0]; ui.line = null; ui.oddsO = ""; ui.oddsU = ""; }
  if (ui.line == null) ui.line = defaultLine(ui.stat);
  ui.mate = "";
  store.set("tradescale:props-last", id);
  if (!fromHash) window.scrollTo({top:0, behavior:"smooth"});
  writeHash(); render();
}
function writeHash(){
  if (!player) return;
  history.replaceState(null, "", `#p=${player.id}&s=${encodeURIComponent(ui.stat)}&l=${ui.line}&side=${ui.side}`);
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
  const inj = injuries && injuries.get(norm(player.name) + "|" + player.team);
  const sub = el("p", {class:"sub", style:"margin:0", text:`${player.pos}, ${player.team}. ${all.length} games since ${all.length ? all[0].s : season()}.`});
  if (inj) sub.append(" ", el("span", {class:"inj", text:inj}));
  nm.append(sub);
  who.append(nm);
  head.append(who);
  if (ng){
    const spTxt = ng.sp == null ? "no line yet" : ng.sp > 0 ? `favored by ${ng.sp}` : ng.sp < 0 ? `${-ng.sp}-point underdog` : "pick'em";
    head.append(el("div", {class:"next"}, el("span", {class:"lbl", text:`Week ${ng.week}`}),
      el("strong", {text:`${ng.home ? "vs" : "at"} ${ng.opp}`}),
      el("span", {text:`${new Date(ng.date + "T12:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"})}, ${spTxt}${ng.t ? `, total ${ng.t}` : ""}${ng.imp ? `, team expected to score ${fmt1(ng.imp)}` : ""}`})));
  } else head.append(el("div", {class:"next"}, el("span", {text:"No upcoming game on the schedule."})));
  app.append(head);

  /* controls */
  const ctl = el("section", {class:"panel"});
  const statSel = el("select", {class:"inline", "aria-label":"Prop"});
  (PROPS[player.pos] || PROPS.WR).forEach(([k, l]) => statSel.append(el("option", {value:k, text:l, selected: k === key ? "" : false})));
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
    el("label", {class:"field"}, "Under odds", oU)));

  /* verdict */
  const pr = project(key);
  const verdict = el("div", {class:"verdict-row"});
  if (pr){
    const P = probOver(pr.mu, pr.sd, line, pr.count);
    const pSide = side === "over" ? P.over : P.under;
    const ipO = implied(ui.oddsO), ipU = implied(ui.oddsU);
    let book = null, bookTxt = "";
    if (ipO && ipU){ const fair = (side === "over" ? ipO : ipU) / (ipO + ipU); book = fair; bookTxt = `Book's fair chance (vig removed): ${pct(fair)}`; }
    else if (side === "over" && ipO){ book = ipO; bookTxt = `Book implies ${pct(ipO)}`; }
    else if (side === "under" && ipU){ book = ipU; bookTxt = `Book implies ${pct(ipU)}`; }
    const big = el("div", {class:"big"}, el("span", {class:"num", text:pct(pSide)}),
      el("span", {class:"cap", text:`model chance of ${side === "over" ? "Over" : "Under"} ${line} ${LABEL[key] || key.split("+").map(k => LABEL[k]).join(" + ")}`}));
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
  [["Last 5", all.slice(-5)], ["Last 10", all.slice(-10)], [`${season()}`, cur], [`${season() - 1}`, last],
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

  /* scheme */
  const sp = schemePanel(ng, opp);
  if (sp) app.append(sp);

  /* teammates */
  if (player.mates && player.mates.length) app.append(matesPanel(all, key, line, side));
}

function chartPanel(all, key, line, side){
  const panel = el("section", {class:"panel"});
  const ranges = [["5","Last 5"],["10","Last 10"],["season",`${season()}`],["all","All"]];
  const seg = el("span", {class:"seg"}, ...ranges.map(([v, l]) => el("button", {text:l, "aria-pressed": String(ui.range === v), onclick: () => { ui.range = v; render(); }})));
  panel.append(el("div", {class:"bar-row", style:"justify-content:space-between"}, el("h2", {text:"Game by game"}), seg));
  let list = ui.range === "5" ? all.slice(-5) : ui.range === "10" ? all.slice(-10) : ui.range === "season" ? all.filter(g => g.s === season()) : all;
  if (!list.length){ panel.append(el("p", {class:"empty", text:"No games in this range."})); return panel; }
  const vals = list.map(g => statOf(g, key));
  const maxV = Math.max(line * 1.25, ...vals, 1);
  const gut = 44, bw = 46, gap = 10, H = 220, top = 22, bottom = 44, W = gut + list.length * (bw + gap) + gap;
  const y = v => top + (H - top - bottom) * (1 - v / maxV);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${Math.max(W, 320)} ${H}`); svg.setAttribute("class", "chart"); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `${player.name} ${LABEL[key] || key} by game against a line of ${line}`);
  svg.style.minWidth = Math.max(W, 320) * 0.85 + "px";
  svg.style.maxWidth = Math.max(W, 320) * 1.3 + "px";
  const detail = el("p", {class:"chart-detail", text:"Tap a bar for game details."});
  list.forEach((g, i) => {
    const v = vals[i], x = gut + gap + i * (bw + gap), r = hit(v, line, side);
    const rect = document.createElementNS(ns, "rect");
    const yy = y(v), h = Math.max(2, (H - bottom) - yy);
    rect.setAttribute("x", x); rect.setAttribute("y", (H - bottom) - h); rect.setAttribute("width", bw); rect.setAttribute("height", h);
    rect.setAttribute("rx", 5); rect.setAttribute("class", "b-" + r); rect.setAttribute("tabindex", "0");
    const info = `${g.s} week ${g.w}${g.post ? " (playoffs)" : ""}: ${g.h ? "vs" : "at"} ${g.o}${g.ts != null ? `, ${g.ts > g.os ? "won" : g.ts < g.os ? "lost" : "tied"} ${g.ts}–${g.os}` : ""}${g.sp != null ? `, ${g.sp > 0 ? "favored by " + g.sp : g.sp < 0 ? "underdog by " + (-g.sp) : "pick'em"}` : ""}${g.t ? `, total ${g.t}` : ""}${g.dr ? `, ${ordinal(g.dr)}-toughest defense vs ${player.pos}s` : ""}. ${LABEL[key] || key}: ${fmt1(v)}. ${Object.entries(g.x).filter(([k]) => k !== "ppr").map(([k, val]) => `${val} ${LABEL[k]}`).join(", ")}.`;
    const t = document.createElementNS(ns, "title"); t.textContent = info; rect.append(t);
    const pick = () => { detail.textContent = info; svg.querySelectorAll("rect").forEach(r2 => r2.classList.remove("sel")); rect.classList.add("sel"); };
    rect.addEventListener("click", pick); rect.addEventListener("focus", pick);
    svg.append(rect);
    const tv = document.createElementNS(ns, "text"); tv.setAttribute("x", x + bw / 2); tv.setAttribute("y", (H - bottom) - h - 6); tv.setAttribute("class", "tv"); tv.textContent = fmt1(v); svg.append(tv);
    const tl = document.createElementNS(ns, "text"); tl.setAttribute("x", x + bw / 2); tl.setAttribute("y", H - bottom + 17); tl.setAttribute("class", "tl"); tl.textContent = (g.h ? "" : "@") + g.o; svg.append(tl);
    const tw = document.createElementNS(ns, "text"); tw.setAttribute("x", x + bw / 2); tw.setAttribute("y", H - bottom + 32); tw.setAttribute("class", "tw"); tw.textContent = `W${g.w}${g.s !== season() ? " '" + String(g.s).slice(2) : ""}`; svg.append(tw);
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
    ["Opponent defense", ng ? `What ${ng.opp} allows to ${player.pos}s vs league average` : "No game scheduled", pr.mu1, pr.mu0 ? pr.mu1 / pr.mu0 : 1],
    ["Scheme fit", schemeNote(pr), pr.mu2, pr.mu1 ? pr.mu2 / pr.mu1 : 1],
    ["Game script", ng && ng.imp ? `${player.team} ${ng.sp > 0 ? "favored by " + ng.sp : ng.sp < 0 ? "underdog by " + (-ng.sp) : "even"}, expected to score ${fmt1(ng.imp)} (league average ${fmt1(defense.avg_team_total)})` : "No betting line yet", pr.mu, pr.mu2 ? pr.mu / pr.mu2 : 1]
  ];
  const ul = el("ul", {class:"why-list"});
  rows.forEach(([t, d, v, f]) => ul.append(el("li", {},
    el("div", {}, el("strong", {text:t}), el("small", {text:d})),
    f == null ? el("span", {class:"chip", text:"base"}) : el("span", {class:`chip ${f > 1.005 ? "up" : f < 0.995 ? "down" : ""}`, text:signPct(f)}),
    el("span", {class:"v", text: pr.count ? fmt1(v) : String(Math.round(v))}))));
  panel.append(ul, el("p", {class:"why", style:"margin-top:10px", text: pr.count
    ? "Touchdowns, receptions, targets, and interceptions are modeled as counts (a Poisson distribution), the standard way to price how often something happens."
    : `Yardage and volume use a bell curve centered on the projection, with a spread of about ${Math.round(pr.sd)} based on how much his games actually swing.`}));
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
    el("p", {class:"sub", text:`Every split from his game log. Rows marked "This week" match his next game.`}));
  const oppRank = ng && opp && opp.pos[player.pos] ? opp.pos[player.pos].rank : null;
  const S = [
    ["Home", g => g.h === 1, ng && ng.home === 1], ["Away", g => g.h === 0, ng && ng.home === 0],
    ["Favored", g => g.sp > 0, ng && ng.sp > 0], ["Underdog", g => g.sp < 0, ng && ng.sp < 0],
    ["Big favorite (6+)", g => g.sp >= 6, ng && ng.sp >= 6], ["Big underdog (6+)", g => g.sp <= -6, ng && ng.sp <= -6],
    ["High total (47+)", g => g.t >= 47, ng && ng.t >= 47], ["Low total (under 43)", g => g.t && g.t < 43, ng && ng.t && ng.t < 43],
    ["Dome or closed roof", g => g.r === "dome", ng && ng.roof === "dome"], ["Outdoors", g => g.r === "outdoors", ng && ng.roof === "outdoors"],
    ["Cold (40°F or less)", g => g.r === "outdoors" && g.tp != null && g.tp <= 40, false], ["Windy (15+ mph)", g => g.r === "outdoors" && g.wd >= 15, false],
    ["Division games", g => g.dv === 1, ng && ng.div === 1],
    [`vs top-10 defenses vs ${player.pos}s`, g => g.dr && g.dr <= 10, oppRank && oppRank <= 10],
    [`vs bottom-10 defenses vs ${player.pos}s`, g => g.dr && g.dr >= 23, oppRank && oppRank >= 23],
    ["Team won", g => g.ts != null && g.ts > g.os, false], ["Team lost", g => g.ts != null && g.ts < g.os, false],
    ["Playoffs", g => g.post === 1, false]
  ];
  const tbl = el("table", {class:"rank-t split-t"}, el("thead", {}, el("tr", {}, ...["Situation","Games","Avg","Hit rate"].map(h => el("th", {text:h})))));
  const tb = el("tbody");
  const allAvg = all.length ? all.reduce((s, g) => s + statOf(g, key), 0) / all.length : 0;
  S.forEach(([label, fn, now]) => {
    const list = all.filter(fn); if (!list.length) return;
    const r = hitRate(list, key, line, side), avg = list.reduce((s, g) => s + statOf(g, key), 0) / list.length;
    tb.append(el("tr", {class: now ? "now" : ""},
      el("td", {}, label, now ? el("span", {class:"wk", text:"This week"}) : null),
      el("td", {text:list.length}),
      el("td", {}, fmt1(avg), el("small", {class: avg > allAvg * 1.08 ? "pos" : avg < allAvg * 0.92 ? "neg" : "", text:` ${avg >= allAvg ? "▲" : "▼"}`})),
      el("td", {}, el("div", {class:"hrbar"}, el("i", {style:`width:${Math.round(r.rate * 100)}%`, class: r.rate >= 0.6 ? "good" : r.rate <= 0.4 ? "bad" : ""}), el("span", {text:`${r.h}/${r.n - r.p} (${pct(r.rate)})`})))));
  });
  tbl.append(tb);
  panel.append(el("div", {class:"tablewrap"}, tbl), el("p", {class:"why", style:"margin-top:8px", text:`Arrows compare each split's average with his overall average (${fmt1(allAvg)}). Small samples swing a lot, so read the games column first.`}));
  return panel;
}

function schemePanel(ng, opp){
  const sch = player.scheme; if (!sch || !Object.keys(sch).length) return null;
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
  if (opp && opp.pos[player.pos]){
    const pd = opp.pos[player.pos], lg = defense.league.pos[player.pos];
    const keys = player.pos === "QB" ? ["pyd","ptd","int","ruyd"] : player.pos === "RB" ? ["ruyd","rutd","rec","reyd"] : ["rec","reyd","retd","tgt"];
    const dl = el("div", {class:"def-row"});
    keys.forEach(k => { if (pd.allow[k] == null) return; const f = pd.allow[k] / lg[k];
      dl.append(el("div", {}, el("span", {class:"lbl", text:LABEL[k] + " allowed"}), el("strong", {text:fmt1(pd.allow[k])}),
        el("small", {class: f > 1.05 ? "pos" : f < 0.95 ? "neg" : "", text:` ${signPct(f)} vs avg`}))); });
    panel.append(el("h3", {text:`${ng.opp} defense vs ${player.pos}s: ${ordinal(pd.rank)} toughest by fantasy points allowed`}),
      el("p", {class:"sub", text:`Per game to all ${player.pos}s combined. ${pd.g} game${pd.g === 1 ? "" : "s"} this season, blended with last season so early weeks don't overreact.`}), dl);
  }
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

/* ---------- Boot ---------- */
function readHash(){
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("s")) ui.stat = h.get("s");
  if (h.get("l")) ui.line = Number(h.get("l"));
  if (h.get("side") === "under") ui.side = "under";
  return h.get("p");
}
(async () => {
  const status = $("status");
  try {
    [index, defense] = await Promise.all([getJSON(BASE + "index.json"), getJSON(BASE + "defense.json")]);
  } catch(e){
    status.classList.add("warn");
    status.textContent = "Props data isn't built yet. It appears after the next daily update (or run the workflow on GitHub).";
    return;
  }
  status.textContent = `${index.players.length} players, ${index.season} season, updated ${TS.ago(index.updated)}.`;
  renderPicker();
  // injury tags come from the daily Sleeper player file, matched by name and team
  TS.loadSport("nfl").then(pool => {
    injuries = new Map(pool.filter(p => p.inj).map(p => [norm(p.name) + "|" + teamFix(p.team), p.inj]));
    if (player) render();
  }).catch(() => {});
  const id = readHash() || null;
  if (id) openPlayer(id, true); else render();
})();
const teamFix = t => ({LAR:"LA", JAC:"JAX", WSH:"WAS"}[t] || t);   // Sleeper vs nflverse team codes
})();
