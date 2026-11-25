/* Props page (NFL, NBA, NHL, MLB, college football and basketball, UFC, soccer, T20 cricket): hit-rate history, situational and scheme
   splits, and a transparent projection. */
(() => {
const {el, norm, getJSON, store, chanceClass} = TS;
const $ = id => document.getElementById(id);
const SPORTS = [["nfl","Football"],["nba","Basketball"],["nhl","Hockey"],["mlb","Baseball"],["cfb","College FB"],["cbb","College BB"],["ufc","UFC"],["soc","Soccer"],["cri","Cricket"]];
const FOOTBALL = ["nfl"];
// college tabs price games (spread, moneyline, total), not players: many states allow only game bets on college sports
const GAME_SPORTS = ["cfb","cbb"];
const isGameSport = sp => GAME_SPORTS.includes(sp);
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
    search: "Search any MLB player or team", rest: null},
  // a fighter is his own "team"; his opponent is the matchup, and "defense" is what an opponent gives up per fight
  ufc: {
    props: null,
    all: [["win","To win the fight"],["ko","Wins by KO/TKO"],["sub","Wins by submission"],["dec","Wins by decision"],["dist","Fight goes the distance"],
          ["rnd","Total rounds"],["sig","Significant strikes"],["tdl","Takedowns"],["kd","Knockdowns"]],
    label: {win:"wins", ko:"KO/TKO wins", sub:"submission wins", dec:"decision wins", dist:"fights to the distance", rnd:"rounds",
            sig:"sig. strikes", str:"total strikes", tdl:"takedowns", kd:"knockdowns", ctrl:"control minutes"},
    count: ["win","ko","sub","dec","dist","tdl","kd"],
    binary: ["win","ko","sub","dec","dist"],
    yesNo: {win:["Wins the fight","Doesn't win"], ko:["Wins by KO/TKO","No KO/TKO win"], sub:["Wins by submission","No submission win"],
            dec:["Wins by decision","No decision win"], dist:["Goes the distance","Doesn't go the distance"]},
    cv: {sig:.6, rnd:.4}, disp: {tdl:1.8, kd:1.3}, maxLine: {rnd:2.5},
    groups: {FLY:"flyweights", BW:"bantamweights", FW:"featherweights", LW:"lightweights", WW:"welterweights", MW:"middleweights",
             LHW:"light heavyweights", HW:"heavyweights", WSW:"strawweights", WFLY:"flyweights", WBW:"bantamweights", WFW:"featherweights"},
    defKeys: null, defLabel: {sig:"sig. strikes absorbed", tdl:"takedowns allowed", kd:"knockdowns suffered", win:"opponents' win rate"},
    search: "Search any UFC fighter", rest: null},
  // Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS and the Champions League in one tab
  soc: {
    props: {F: [["sot","Shots on target"],["sh","Shots"],["g","Anytime goalscorer"],["a","Assists"],["g+a","Goal or assist"],["fc","Fouls committed"],["fs","Fouls drawn"],["yc","Booked (yellow card)"]],
            M: [["sh","Shots"],["sot","Shots on target"],["g","Anytime goalscorer"],["a","Assists"],["g+a","Goal or assist"],["fc","Fouls committed"],["fs","Fouls drawn"],["yc","Booked (yellow card)"]],
            D: [["sh","Shots"],["sot","Shots on target"],["fc","Fouls committed"],["fs","Fouls drawn"],["g","Anytime goalscorer"],["yc","Booked (yellow card)"]],
            G: [["sv","Saves"],["gc","Goals conceded"]]},
    label: {g:"goals", a:"assists", sh:"shots", sot:"shots on target", fc:"fouls", fs:"fouls drawn", yc:"yellow cards", sv:"saves", gc:"goals conceded"},
    count: ["g","a","sh","sot","fc","fs","yc","sv","gc"],
    yesNo: {g:["Scores (anytime)","Doesn't score"], yc:["Gets booked","Not booked"]},
    cv: {}, disp: {sh:1.25, sot:1.1, fc:1.2, fs:1.25, sv:1.1},
    groups: {F:"forwards", M:"midfielders", D:"defenders", G:"goalkeepers"},
    defKeys: {F:["sh","sot","g","a"], M:["sh","sot","g","fs"], D:["sh","fc","fs","g"], G:["sv","gc"]},
    search: "Search any soccer player or club", rest: null},
  // T20: IPL, Big Bash, PSL, CPL, SA20, MLC, ILT20 and men's T20 internationals
  cri: {
    props: {BAT: [["r","Runs"],["f4","Fours"],["s6","Sixes"],["f4+s6","Boundaries (4s + 6s)"],["bf","Balls faced"]],
            AR: [["r","Runs"],["wk","Wickets"],["f4","Fours"],["s6","Sixes"],["rc","Runs conceded"]],
            BOWL: [["wk","Wickets"],["rc","Runs conceded"],["bb","Balls bowled"]]},
    label: {r:"runs", bf:"balls faced", f4:"fours", s6:"sixes", wk:"wickets", rc:"runs conceded", bb:"balls bowled", ct:"catches"},
    count: ["f4","s6","wk","ct"],
    cv: {r:.85, bf:.75, rc:.35, bb:.25}, disp: {f4:1.9, s6:1.9, "f4+s6":2.1, wk:1.15},
    groups: {BAT:"batters", AR:"all-rounders", BOWL:"bowlers"},
    defKeys: {BAT:["r","f4","s6","bf"], AR:["r","wk","s6","rc"], BOWL:["wk","rc","bb"]},
    search: "Search any T20 cricketer or team", rest: null}
};
CFG.nba.props = {G: CFG.nba.all, F: CFG.nba.all, C: CFG.nba.all};
CFG.ufc.props = Object.fromEntries(Object.keys(CFG.ufc.groups).map(g => [g, CFG.ufc.all]));
CFG.ufc.defKeys = Object.fromEntries(Object.keys(CFG.ufc.groups).map(g => [g, ["sig","tdl","kd","win"]]));
let sport = "nfl";
const C = () => CFG[sport];
const BASE = () => `data/props/${sport}/`;
const grpOf = p => p.grp || p.pos;
const labelOf = key => key === "td" ? "TDs" : key.split("+").map(k => C().label[k] || k).join(" + ");
const isCount = key => key.split("+").every(k => C().count.includes(k)) || key === "td";
const isBinary = key => (C().binary || []).includes(key);   // yes/no props (a UFC win): 1 with chance mu, else 0
// how a pick reads: "Over 24.5 pts", or for a yes/no prop "Wins by KO/TKO"
function sideText(key, line, side){
  const yn = (C().yesNo || {})[key];
  if (yn && line < 1) return yn[side === "over" ? 0 : 1];
  return `${side === "over" ? "Over" : "Under"} ${line} ${labelOf(key)}`;
}
const components = key => key === "td" ? ["rutd","retd"] : key.split("+");

/* ---------- State ---------- */
let index = null, defense = null, player = null, injuries = null, model = null;
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
function probOver(mu, sd, line, count, disp = 1, binary = false){
  if (binary){ const p = line < 1 ? Math.min(0.95, Math.max(0.05, mu)) : 0; return {over:p, push:0, under:1 - p}; }
  if (count){ const k = Math.floor(line); const pOver = 1 - countCdf(k, mu, disp); const pPush = Number.isInteger(line) ? countCdf(k, mu, disp) - countCdf(k - 1, mu, disp) : 0; return {over:pOver, push:pPush, under:1 - pOver - pPush}; }
  const hi = Math.floor(line) + 0.5, lo = Math.ceil(line) - 0.5;    // continuity correction for whole-number stats
  const over = 1 - Phi((hi - mu) / sd), under = Phi((lo - mu) / sd);
  return {over, under, push: Math.max(0, 1 - over - under)};
}
/* ---------- Trained model ---------- */
// scripts/train_props_model.py writes, into each player's file, the trained model's chance of the Over for his next
// game at a grid of half-point lines ("ml"). It's used wherever the line falls inside that grid; otherwise the formula.
const FLOAT_STATS = {nfl:["ppr"], nba:["min"], nhl:["toi"], mlb:[], ufc:["rnd"], soc:[], cri:[]};
function mlChance(doc, key, line, sp = sport){
  const m = doc && doc.ml && doc.ml[key]; if (!m || !m.l || !m.l.length) return null;
  const L = m.l, P = m.p;
  const at = x => {
    if (x < L[0] - 1e-6 || x > L[L.length - 1] + 1e-6) return null;
    let i = 0; while (i < L.length - 2 && L[i + 1] < x) i++;
    if (L.length === 1 || x <= L[i]) return P[i];
    const t = Math.min(1, (x - L[i]) / (L[i + 1] - L[i])); return P[i] + t * (P[i + 1] - P[i]);
  };
  const whole = !components(key).some(c => (FLOAT_STATS[sp] || []).includes(c));
  if (whole && Number.isInteger(line)){ const o = at(line + 0.5), u = at(line - 0.5); if (o == null || u == null) return null; return {over:o, under:1 - u, push:Math.max(0, u - o)}; }
  const o = at(whole ? Math.floor(line) + 0.5 : line); if (o == null) return null;
  return {over:o, under:1 - o, push:0};
}
// the chance used everywhere: trained model when it covers this line, formula otherwise
function sideChance(doc, key, line, side, pr, sp = sport){
  const ml = mlChance(doc, key, line, sp), P = pr ? probOver(pr.mu, pr.sd, line, pr.count, pr.disp, pr.binary) : null;
  const pick = x => x ? (side === "over" ? x.over : x.under) : null;
  return {p: ml ? pick(ml) : pick(P), trained: !!ml, formula: pick(P), push: (ml || P || {push:0}).push};
}
const implied = o => { const n = Number(o); if (!n || Math.abs(n) < 100) return null; return n < 0 ? -n / (-n + 100) : 100 / (n + 100); };
const toAmerican = p => p <= 0 || p >= 1 ? "–" : p >= 0.5 ? String(Math.round(-100 * p / (1 - p))) : "+" + Math.round(100 * (1 - p) / p);
const pct = p => Math.round(p * 100) + "%";
const vsAt = h => h === 0 ? "at" : "vs";    // neutral sites and fights have no home team
const oppShort = o => sport === "ufc" ? String(o).replace(/\s*\(.*\)$/, "").split(" ").slice(-1)[0]
  : (sport === "cri" || sport === "soc") && String(o).length > 10 && String(o).includes(" ") ? String(o).split(/\s+/).map(w => w[0]).join("").toUpperCase()   // "Chennai Super Kings" -> "CSK"
  : o;
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
  if (key === "td" || isBinary(key)) return 0.5;
  const sample = games().slice(-10).map(x => statOf(x, key));   // last 10 games, across seasons if needed
  const m = median(sample), cap = (C().maxLine || {})[key];
  return Math.min(cap ?? Infinity, Math.max(0.5, Math.floor(m) + 0.5));
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
      const [damp, cap] = {nfl:[0.6, 0.3], nba:[0.4, 0.15], nhl:[0.5, 0.2], mlb:[0.5, 0.2], ufc:[0.5, 0.25], soc:[0.4, 0.2], cri:[0.4, 0.2]}[sport];   // trust in position-level defense data
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
  return {mu0, mu1, mu2, mu, sd, parts, count: isCount(key), disp, binary: isBinary(key)};
}

/* ---------- Rendering ---------- */
function renderPicker(){
  const host = $("picker"); host.innerHTML = "";
  if (!index) return;
  host.append(searchBox(sport === "ufc" ? "Search any UFC fighter or fight" : C().search,
    q => [...teamHits(q), ...index.players.filter(p => norm(p[1]).includes(q) || (q.length <= 3 && norm(p[2]) === q)).slice(0, 8)
      .map(p => ({label: p[1], meta: sport === "ufc" ? p[3] : `${p[3]}, ${p[2]}`, pick: () => openPlayer(p[0])}))].slice(0, 9),
    "Search players and teams"));
}
// a search box whose list fills in as you type; hits(q) gives [{label, meta, pick, team}] for a normalized query
function searchBox(placeholder, hits, aria, opts = {}){
  const wrap = el("div", {class:"search", style:"max-width:520px"});
  const input = el("input", {type:"text", placeholder, autocomplete:"off", role:"combobox", "aria-label":aria, "aria-expanded":"false", value: opts.value || ""});
  const ul = el("ul", {class:"results", role:"listbox", id:"prop-res"}); ul.hidden = true; input.setAttribute("aria-controls", "prop-res");
  wrap.append(input, ul);
  let opts_ = [], active = 0;
  const close = () => { ul.hidden = true; input.setAttribute("aria-expanded","false"); };
  const choose = o => { input.value = opts.keep ? input.value : ""; close(); o.pick(); };
  const show = () => {
    const q = norm(input.value.trim()); if (!q){ close(); return; }
    opts_ = hits(q);
    ul.innerHTML = "";
    opts_.forEach((o, i) => { const li = el("li", {role:"option", id:`pr-${i}`, class: o.team ? "team-opt" : ""}, el("span", {text:o.label}), el("span", {class:"meta", text:o.meta})); li.onmousedown = e => { e.preventDefault(); choose(o); }; ul.append(li); });
    if (!opts_.length){ close(); return; }
    active = 0; mark(); ul.hidden = false; input.setAttribute("aria-expanded","true");
  };
  const mark = () => [...ul.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === active)));
  input.oninput = () => { if (opts.onInput) opts.onInput(input.value); show(); }; input.onfocus = show; input.onblur = () => setTimeout(close, 100);
  input.onkeydown = e => {
    if (ul.hidden) return;
    if (e.key === "ArrowDown"){ e.preventDefault(); active = (active + 1) % opts_.length; mark(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); active = (active - 1 + opts_.length) % opts_.length; mark(); }
    else if (e.key === "Enter" && opts_[active]){ e.preventDefault(); choose(opts_[active]); }
    else if (e.key === "Escape") close();
  };
  return wrap;
}

/* ---------- Team search: a team's next game and the likeliest same-game parlay for it ---------- */
// team names come from the slip reader's table (ESPN codes, nicknames, cities, other codes) for the four pro leagues;
// soccer clubs and cricket teams are already named in full, and a UFC fighter is his own "team"
const PRO_TEAMS = ["nfl","nba","nhl","mlb"];
const teamTables = {};
function teamTable(sp){
  if (teamTables[sp]) return teamTables[sp];
  const m = new Map(), text = (typeof SLIP !== "undefined" && SLIP.TEAMS && SLIP.TEAMS[sp]) || "";
  text.split("\n").filter(r => r.trim()).forEach(r => {
    const [abbr, nicks, cities, alts] = r.split("|"), ns = nicks.split("/"), cs = cities.split("/"), codes = [abbr, ...(alts ? alts.split("/") : [])];
    const row = {code: sp === "nfl" ? teamFix(abbr) : abbr, nick: ns[0], city: cs.find(c => !c.includes(ns[0])) || cs[0], keys: [...ns, ...cs, ...cs.map(c => c + " " + ns[0])].map(norm), codes: codes.map(norm)};
    codes.forEach(c => m.set(sp === "nfl" ? teamFix(c) : c, row));
  });
  return teamTables[sp] = m;
}
const teamRow = (sp, code) => teamTable(sp).get(code) || null;
function teamName(sp, code, short){
  const r = PRO_TEAMS.includes(sp) && teamRow(sp, code);
  return r ? (short ? r.nick : r.city.includes(r.nick) ? r.city : `${r.city} ${r.nick}`) : String(code || "");
}
// "Ben" finds the Bengals: a name or city that starts with it (any word), a longer piece anywhere in it, or the exact code
function nameHit(keys, codes, q){
  return codes.includes(q) || keys.some(k => k.startsWith(q) || k.split(" ").some(w => w.startsWith(q)) || (q.length >= 4 && k.includes(q)));
}
const whenText = ng => !ng ? "" : ng.time && String(ng.time).includes("T") ? kickoff(ng.time)
  : `${new Date(ng.date + "T12:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"})}${ng.time ? ", " + ng.time : ""}`;
function nextText(sp, ng){
  if (!ng) return "No game scheduled";
  return `${sp === "ufc" ? "vs" : vsAt(ng.home)} ${teamName(sp, ng.opp, true)}, ${whenText(ng)}`;
}
// teams matching the query: this sport's first (with its next game), then the other pro leagues' (tap to switch)
function teamHits(q){
  const out = [];
  if (isGameSport(sport)){
    const d = gameReady[sport];
    if (d) d.teams.forEach(r => {
      const t = teamInfo(d, r[0]);
      if (!nameHit([t.name, t.short, t.city, t.nick].map(norm), [norm(r[0])], q)) return;
      const g = d.games.find(x => x.home === r[0] || x.away === r[0]);
      out.push({team: true, sp: sport, code: r[0], label: t.name, has: !!g,
        meta: g ? `${g.home === r[0] ? "vs" : "at"} ${teamInfo(d, g.home === r[0] ? g.away : g.home).short}, ${kickoff(g.start)}` : "No game in the next few days",
        pick: () => openCollegeTeam(d, sport, r[0])});
    });
  } else if (index){
    const codes = new Set([...Object.keys(index.next || {}), ...(sport === "ufc" ? [] : index.players.map(p => p[2]))]);
    codes.forEach(code => {
      const r = PRO_TEAMS.includes(sport) && teamRow(sport, code);
      const keys = r ? r.keys : [norm(code)], cs = r ? [...r.codes, norm(code)] : [norm(code)];
      if (sport === "ufc" && !index.next[code]) return;
      if (!nameHit(keys, cs, q)) return;
      const ng = index.next && index.next[code];
      out.push({team: true, sp: sport, code, has: !!ng, label: sport === "ufc" ? `${code} vs ${ng.opp}` : teamName(sport, code),
        meta: sport === "ufc" ? `Fight, ${whenText(ng)}` : nextText(sport, ng), pick: () => openTeam(code)});
    });
  }
  out.sort((a, b) => b.has - a.has || a.label.localeCompare(b.label));
  const here = out.slice(0, 4);
  // the other pro leagues, so "Bengals" works from any tab
  const other = [];
  PRO_TEAMS.filter(sp => sp !== sport).forEach(sp => {
    const seen = new Set();
    teamTable(sp).forEach(r => {
      if (seen.has(r) || !nameHit(r.keys, r.codes, q)) return;
      seen.add(r);
      other.push({team: true, sp, code: r.code, label: teamName(sp, r.code), meta: `${sportLabel(sp)}, see the matchup`, pick: () => switchSport(sp, null, r.code)});
    });
  });
  return [...here, ...other.slice(0, Math.max(0, 4 - here.length))];
}
let team = null;
const sgpData = {};
const loadSgp = sp => sgpData[sp] || (sgpData[sp] = getJSON(`data/props/${sp}/sgp.json`).catch(() => { delete sgpData[sp]; return null; }));
function openTeam(code){
  player = null; team = code;
  history.replaceState(null, "", `#sp=${sport}&team=${encodeURIComponent(code)}`);
  window.scrollTo({top:0, behavior:"smooth"});
  render();
}
// the likeliest same-game parlay of k legs: the most likely props in the game, one per player first
// (two props on one player lean on each other the most), then players' second props if k needs more
function sgpPick(cands, k){
  const sorted = [...cands].sort((a, b) => b.p - a.p), legs = [], who = new Set();
  for (const c of sorted){ if (legs.length >= k) break; if (!who.has(c.pid)){ legs.push(c); who.add(c.pid); } }
  for (const c of sorted){ if (legs.length >= k) break; if (!legs.includes(c)) legs.push(c); }
  return {p: legs.reduce((x, c) => x * c.p, 1), legs};
}
const SGP_NOTE = "Legs in the same game move together (a blowout or a slow game can hit or sink several at once), so the real chance can land a bit above or below the one shown, and books price same-game parlays with that in mind. Compare the fair odds with your book's.";
function sgpCard(k, p, rows, foot, slipFn, books){
  return el("div", {class:"parlays"}, el("div", {class:`parlay ${tier(p, k)}`},
    el("div", {class:"parlay-top"}, el("strong", {text:"Best same-game parlay"}), chancePill(p, k)),
    el("ul", {}, ...rows), books || "",
    el("div", {class:"parlay-foot"}, el("small", {text:`Fair odds ${toAmerican(p)}. ${foot}`}),
      el("button", {class:"btn tiny", text:"Check in slip", onclick: slipFn}))));
}
function matchTitle(sp, code, ng){
  if (sp === "ufc") return `${code} vs ${ng.opp}`;
  const me = teamName(sp, code), them = teamName(sp, ng.opp);
  return ng.home === 1 ? `${them} at ${me}` : ng.home === 0 ? `${me} at ${them}` : `${me} vs ${them}`;
}
async function renderTeam(){
  const app = $("app"); app.innerHTML = "";
  const sp = sport, code = team, ng = index.next && index.next[code];
  const box = el("section", {class:"panel best"});
  app.append(box);
  if (!ng){
    box.append(el("h2", {text: teamName(sp, code)}),
      el("p", {class:"empty", style:"margin:0", text:"No game on the schedule for this team in today's data, so there's no matchup to build a parlay for yet."}));
    return;
  }
  box.append(el("h2", {text: matchTitle(sp, code, ng)}), el("p", {class:"empty", style:"margin:0", text:"Loading the matchup..."}));
  const [data] = await Promise.all([loadSgp(sp), loadOdds()]);
  if (sp !== sport || team !== code || !box.isConnected) return;
  box.replaceWith(teamPanel(sp, code, ng, data));
}
function teamPanel(sp, code, ng, data){
  const box = el("section", {class:"panel best", id:"team-panel"});
  const unit = sp === "ufc" ? "fight" : "game";
  box.append(el("div", {class:"bar-row", style:"justify-content:space-between"},
      el("h2", {text: matchTitle(sp, code, ng)}),
      el("button", {class:"btn tiny", text:"Close", onclick: () => { team = null; history.replaceState(null, "", `#sp=${sp}`); render(); }})),
    appsPicker(() => box.replaceWith(teamPanel(sp, code, ng, data))) || "",
    el("p", {class:"sub", text:`${ng.week != null ? `Week ${ng.week}, ` : ""}${whenText(ng)}${ng.event ? `, ${ng.event}` : ""}. ${sp === "ufc" ? "" : `${teamName(sp, code, true)} ${vsAt(ng.home)} ${teamName(sp, ng.opp, true)}.`}`}));
  const g = data && data.teams && data.games[data.teams[code]];
  const cands = g ? g.legs : [];
  if (cands.length < 2){
    box.append(el("p", {class:"empty", style:"margin:0", text: !data
      ? "Same-game picks aren't built yet. They appear after the next daily update."
      : `The trained model hasn't priced enough props for this ${unit} yet. It only prices players with a steady recent role, and injured players are left out.`}));
    return box;
  }
  const redraw = () => box.replaceWith(teamPanel(sp, code, ng, data));
  const maxLegs = Math.min(MAX_LEGS, cands.length), k = Math.min(parlayLegs, maxLegs);
  const best = sgpPick(cands, k);
  box.append(el("div", {class:"bar-row pick-head"}, el("h3", {text:`Best ${k}-leg parlay for this ${unit}`}), legPicker(maxLegs, redraw)),
    parlayLegs > maxLegs ? el("p", {class:"sub", text:`The model has ${maxLegs} props it can price in this ${unit}, so ${maxLegs} legs is the most.`}) : "",
    sgpCard(k, best.p, best.legs.map(c => el("li", {},
        el("button", {class:"linkish", text:c.name, onclick: () => openPick(c)}),
        el("span", {text:` ${pickText(c, sp)}`}), el("small", {text:` ${sp === "ufc" ? "" : teamName(sp, c.team, true) + ", "}${pct(c.p)}`}))),
      `Each leg is the trained model's chance at the line nearest the player's recent average.`,
      () => checkParlay(best.legs, sp), parlayBooks(propLegs(best.legs, sp), true)),
    el("p", {class:"sub", text: SGP_NOTE}));
  // every prop the model likes in the game, one card a team
  const top = new Map();
  [...cands].sort((a, b) => b.p - a.p).forEach(c => { const t = sp === "ufc" ? c.pid : c.team; if (!top.has(t)) top.set(t, []); if (top.get(t).length < 10) top.get(t).push(c); });
  box.append(el("h3", {text:`The likeliest props in this ${unit}`}),
    el("p", {class:"sub", text:"Up to 10 a side, likeliest first. Tap a name to check it at your book's line."}),
    gameCards([...top.values()].flat().map(c => ({key: sp === "ufc" ? c.pid : c.team, head: sp === "ufc" ? c.name : teamName(sp, c.team), sub: "", p: c.p,
      row: el("li", {}, chancePill(c.p), el("div", {}, el("button", {class:"linkish", text:c.name, onclick: () => openPick(c)}),
        el("span", {text:` ${pickText(c, sp)}`}), el("small", {text:`Hit ${c.l10[0]} of his last ${c.l10[1]}.`}), propBooks(c, sp) || ""))}))));
  return box;
}

/* ---------- Sportsbook odds: which app has the best price for each pick ---------- */
// scripts/update_odds.py writes data/props/odds.json every morning from The Odds API: each book's line and price for the
// day's picks, with the trained model's chance at that book's own line. Only books that post a player's prop list him.
let odds = null, oddsP = null;
const loadOdds = () => oddsP || (oddsP = getJSON("data/props/odds.json").then(d => (odds = d)).catch(() => (odds = null)));
const bookName = k => (odds && odds.books && odds.books[k]) || k;
// "My apps": the books you can bet on (by state or by account); every book until you pick
const myBooks = () => { const m = store.get("tradescale:my-books"); return Array.isArray(m) && m.length ? m : null; };
const usableBook = k => { const m = myBooks(); return !m || m.includes(k); };
const decOdds = a => a == null ? null : a > 0 ? 1 + a / 100 : 1 + 100 / -a;
const amer = a => a == null ? "–" : a > 0 ? "+" + a : String(a).replace("-", "−");
const decToAmer = d => d >= 2 ? "+" + Math.round((d - 1) * 100) : String(Math.round(-100 / (d - 1))).replace("-", "−");
// the same name key scripts/update_odds.py writes (no accents, case, punctuation or Jr./III)
const oddsKey = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['.]/g, "")
  .replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(w => w && !["jr","sr","ii","iii","iv","v"].includes(w)).join(" ");
// offers: [{b, line, price, p, link}] for one bet, best first: what the bet is worth at each book's own line and price
// (the model's chance there times the payout), books without a model chance after, by price
function rankOffers(list){
  const v = o => o.p != null ? o.p * decOdds(o.price) : null;
  return list.filter(o => o.price != null && usableBook(o.b)).sort((a, b) => {
    const va = v(a), vb = v(b);
    if (va != null && vb != null) return vb - va;
    if (va != null || vb != null) return va != null ? -1 : 1;
    return decOdds(b.price) - decOdds(a.price);
  });
}
// a player prop pick {name, key, line, side, p} -> every book's offer on the same side
function propOffers(sp, c){
  const rows = odds && odds.props && ((odds.props[sp] || {})[oddsKey(c.name)] || {})[c.key];
  if (!rows) return [];
  const over = c.side !== "under";
  return rankOffers(rows.map(([b, line, o, u, pO, lo, lu]) => {
    const p = pO != null ? (over ? pO : 1 - pO) : line === c.line ? c.p : null;
    return {b, line, price: over ? o : u, p, link: over ? lo : lu};
  }));
}
// a college game bet (see gameBets) -> every book's offer, with the model's chance at that book's line
function gameOffers(d, sp, b){
  const rows = odds && odds.games && (odds.games[sp] || {})[b.g.id];
  if (!rows) return [];
  return rankOffers(rows.map(r => {
    const ln = r.ln || {};
    if (b.market === "ml"){ const k = b.home ? "mlH" : "mlA"; return {b: r.b, line: null, price: r[k], p: b.p, link: ln[k]}; }
    if (b.market === "spread"){
      if (r.sp == null) return {b: r.b};
      const line = b.home ? r.sp : -r.sp, k = b.home ? "spH" : "spA";
      return {b: r.b, line, price: r[k], p: gameChance(d, b.g, {market:"spread", home:b.home, line}), link: ln[k]};
    }
    if (b.market === "total"){
      if (r.t == null) return {b: r.b};
      const k = b.side === "under" ? "u" : "o";
      return {b: r.b, line: r.t, price: r[k], p: gameChance(d, b.g, {market:"total", side:b.side, line:r.t}), link: ln[k]};
    }
    return {b: r.b};
  }));
}
async function copyText(text){
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it into your app's search to find the bet."); }
  catch(e){ window.prompt("Copy the bet:", text); }
}
const copyBtn = (text, label = "Copy") => el("button", {class:"btn tiny ghost", text:label, "aria-label":`Copy: ${text}`, onclick: e => { e.stopPropagation(); copyText(text); }});
const openBtn = (o, label) => o && o.link ? el("a", {class:"btn tiny", href:o.link, target:"_blank", rel:"noopener", text:label || `Open ${bookName(o.b)}`}) : null;
// one pick's apps: the best app first, then every other app that lists it. textAt(line) is the bet at that app's line,
// copyAt(line) what the copy button copies, short(line) the line alone when an app's line differs from the best one's
function booksLine(offers, textAt, copyAt, short){
  if (!offers.length) return null;
  const best = offers[0], diff = o => o.line != null && o.line !== best.line ? `${short(o.line)} at ` : "";
  return el("div", {class:"books"},
    el("div", {class:"books-best"}, el("span", {class:"book-tag", text:"Best app"}),
      el("strong", {text:`${bookName(best.b)} ${amer(best.price)}`}),
      el("small", {text:` ${textAt(best.line)}${best.p != null ? `, ${pct(best.p)} to hit there` : ""}`}),
      copyBtn(copyAt(best.line)), openBtn(best)),
    offers.length > 1 ? el("small", {class:"books-rest", text:"Also: " + offers.slice(1, 6).map(o => `${bookName(o.b)} ${diff(o)}${amer(o.price)}`).join(", ")
      + (offers.length > 6 ? `, and ${offers.length - 6} more` : "")}) : null);
}
function propBooks(c, sp){
  return booksLine(propOffers(sp, c), line => pickText({...c, line}, sp), line => `${c.name} ${pickText({...c, line}, sp)}`,
    line => `${c.side === "under" ? "U" : "O"} ${line}`);
}
function gameBooks(d, sp, b){
  return booksLine(gameOffers(d, sp, b), line => betText(d, {...b, line}), line => `${betText(d, {...b, line})} (${matchup(d, b.g)})`,
    line => b.market === "total" ? `${b.side === "under" ? "U" : "O"} ${line}` : signed(line));
}
// a parlay: the app with the best payout among those that list every leg (else the one that lists the most),
// legs: [{offers, text}] where text(line) is the leg as you'd type it
function parlayBooks(legs, sameGame){
  if (!odds || !legs.length) return null;
  const books = new Set(legs.flatMap(l => l.offers.map(o => o.b)));
  if (!books.size) return null;
  const rows = [...books].map(b => {
    const picks = legs.map(l => l.offers.find(o => o.b === b) || null);
    const have = picks.filter(Boolean), dec = have.reduce((x, o) => x * decOdds(o.price), 1);
    const p = have.every(o => o.p != null) ? have.reduce((x, o) => x * o.p, 1) : null;
    return {b, picks, n: have.length, dec, p, v: p != null ? p * dec : null};
  }).sort((a, b) => b.n - a.n || (a.v != null && b.v != null ? b.v - a.v : b.dec - a.dec));
  const top = rows[0], all = rows.filter(r => r.n === legs.length);
  const copy = legs.map((l, i) => l.text(top.picks[i] ? top.picks[i].line : undefined)).join("\n");
  const head = top.n === legs.length
    ? [el("span", {class:"book-tag", text:"Best app"}), el("strong", {text:`${bookName(top.b)} ${decToAmer(top.dec)}`}),
       el("small", {text:` all ${legs.length} legs${sameGame ? ", legs' prices multiplied (the app prices same-game parlays lower)" : ""}`})]
    : [el("span", {class:"book-tag", text:"Most legs"}), el("strong", {text:bookName(top.b)}),
       el("small", {text:` lists ${top.n} of ${legs.length} legs. No app has all of them today, so the others may need another app.`})];
  return el("div", {class:"books"},
    el("div", {class:"books-best"}, ...head, copyBtn(copy, "Copy parlay")),
    all.length > 1 ? el("small", {class:"books-rest", text:"Also with every leg: " + all.slice(1, 6).map(r => `${bookName(r.b)} ${decToAmer(r.dec)}`).join(", ")}) : null);
}
const propLegs = (legs, sp) => legs.map(c => ({offers: propOffers(sp, c), text: line => `${c.name} ${pickText(line != null ? {...c, line} : c, sp)}`}));
const gameLegs = (d, sp, legs) => legs.map(b => ({offers: gameOffers(d, sp, b), text: line => `${betText(d, line !== undefined ? {...b, line} : b)} (${matchup(d, b.g)})`}));
// pick the apps you can use; the best app is chosen among these
function appsPicker(redraw){
  if (!odds || !odds.books || !Object.keys(odds.books).length) return null;
  const mine = myBooks(), all = Object.entries(odds.books).sort((a, b) => a[1].localeCompare(b[1]));
  const box = el("details", {class:"apps"}, el("summary", {text:`Your apps: ${mine ? mine.map(bookName).join(", ") : "all"}`}));
  const grid = el("div", {class:"apps-grid"});
  all.forEach(([k, name]) => {
    const cb = el("input", {type:"checkbox", checked: !mine || mine.includes(k) ? "" : false});
    cb.onchange = () => {
      const picked = [...grid.querySelectorAll("input")].map((x, i) => x.checked ? all[i][0] : null).filter(Boolean);
      store.set("tradescale:my-books", picked.length === all.length ? [] : picked);
      redraw();
    };
    grid.append(el("label", {}, cb, el("span", {text:name})));
  });
  box.append(el("p", {class:"sub", text:"Tick the sportsbook apps you have (or that are legal where you are). Each pick's best app is chosen from these."}), grid,
    el("p", {class:"why", text:`Prices from ${odds.source || "the books"}, updated ${TS.ago(odds.updated)}. Lines move during the day, so check the price in the app before you bet.`}));
  return box;
}

/* ---------- Best bets: the trained model's strongest picks and parlays (any number of legs) for the next slate ---------- */
// scripts/best_bets.py writes data/props/best.json every morning, after the model is trained
let best = null;
const loadBest = () => best || (best = getJSON("data/props/best.json").catch(() => { best = null; return null; }));
// color by how likely it is: green for strong, amber for a lean, red for a long shot
const tier = (p, legs = 1) => { const q = Math.pow(p, 1 / legs); return q >= 0.64 ? "hi" : q >= 0.56 ? "mid" : "lo"; };
const chancePill = (p, legs = 1) => el("span", {class:`chance ${tier(p, legs)}`, text:pct(p)});
let bestDate = null;
// how many legs the parlays have: 3 to start, any number the slate's games allow, remembered across visits
const MAX_LEGS = 20;
let parlayLegs = Math.min(MAX_LEGS, Math.max(2, Math.round(+store.get("tradescale:parlay-legs") || 3)));
function legPicker(max, redraw){
  const shown = Math.min(parlayLegs, Math.max(2, max));
  const set = n => { n = Math.min(Math.max(2, max), MAX_LEGS, Math.max(2, Math.round(n) || 2)); input.value = String(n); if (n === parlayLegs) return; parlayLegs = n; store.set("tradescale:parlay-legs", n); redraw(); };
  const input = el("input", {type:"number", min:"2", max:String(Math.max(2, Math.min(max, MAX_LEGS))), value:String(shown), inputmode:"numeric", "aria-label":"Legs per parlay"});
  input.onchange = () => set(+input.value);
  return el("div", {class:"legs-pick"}, el("span", {text:"Legs"}),
    el("button", {class:"btn tiny", text:"\u2212", "aria-label":"One fewer leg", disabled: shown <= 2 ? "" : false, onclick: () => set(shown - 1)}),
    input,
    el("button", {class:"btn tiny", text:"+", "aria-label":"One more leg", disabled: shown >= Math.min(max, MAX_LEGS) ? "" : false, onclick: () => set(shown + 1)}));
}
// the likeliest parlays of k legs, one leg per game: each game's likeliest pick, best games first.
// Later parlays share no player with earlier ones. cands carry .p; gameOf and whoOf give a pick's game and person.
// fits(c, legs), when given, lets a parlay with more legs than games fill up with the next likeliest picks from
// games already in it (a different player each), as long as fits says the pick goes with the legs so far.
function buildParlays(cands, k, n, gameOf, whoOf = () => null, fits = null){
  const out = [], used = new Set();
  for (let i = 0; i < n; i++){
    const free = cands.filter(c => { const who = whoOf(c); return who == null || !used.has(who); });
    const byGame = new Map();
    for (const c of free){ const g = gameOf(c), cur = byGame.get(g); if (!cur || c.p > cur.p) byGame.set(g, c); }
    const legs = [...byGame.values()].sort((a, b) => b.p - a.p).slice(0, k);
    if (legs.length < k && fits){
      const who = new Set(legs.map(whoOf).filter(w => w != null));
      for (const c of [...free].sort((a, b) => b.p - a.p)){
        if (legs.length >= k) break;
        const w = whoOf(c);
        if (legs.includes(c) || (w != null && who.has(w)) || !fits(c, legs)) continue;
        legs.push(c); if (w != null) who.add(w);
      }
    }
    if (legs.length < k) break;
    legs.forEach(c => { const who = whoOf(c); if (who != null) used.add(who); });
    out.push({p: legs.reduce((x, c) => x * c.p, 1), legs});
  }
  return out;
}
const gamesIn = (cands, gameOf) => new Set(cands.map(gameOf)).size;
const sharesGame = (legs, gameOf) => gamesIn(legs, gameOf) < legs.length;

/* ---------- Day picker: bet one day or several at once ---------- */
const localISO = (t = new Date()) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
function dayName(iso){
  if (iso === localISO()) return "Today";
  if (iso === localISO(new Date(Date.now() + 864e5))) return "Tomorrow";
  return new Date(iso + "T12:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"});
}
const daySel = {};   // sport -> the days you picked this visit (the next slate until you pick)
const chosenDays = (sp, dates, def) => { const s = (daySel[sp] || []).filter(d => dates.includes(d)); return s.length ? s : def; };
// days: [{date, games}]; tapping a day adds or removes it, "All" picks every day
function dayPicker(sp, days, chosen, redraw, unit = "game"){
  if (days.length < 2) return null;
  const all = chosen.length === days.length;
  const toggle = d => { const s = chosen.includes(d) ? chosen.filter(x => x !== d) : [...chosen, d]; if (!s.length) return; daySel[sp] = s; redraw(); };
  return el("div", {class:"days-pick"},
    el("div", {class:"days", role:"group", "aria-label":"Days to bet"},
      ...days.map(x => el("button", {class:"day", "aria-pressed": String(chosen.includes(x.date)), onclick: () => toggle(x.date)},
        el("strong", {text:dayName(x.date)}), el("small", {text:`${x.games} ${unit}${x.games === 1 ? "" : "s"}`}))),
      el("button", {class:"day", "aria-pressed": String(all), onclick: () => { daySel[sp] = all ? [days[0].date] : days.map(x => x.date); redraw(); }},
        el("strong", {text:"All"}), el("small", {text:`${days.length} days`}))),
    el("small", {class:"sub", text:"Tap the days you want to bet. Pick more than one to mix them in the same parlays."}));
}
const slateName = b => !/^\d{4}-/.test(b.slate || "") ? (b.slate || "the next slate") : b.slate === bestDate ? "today"
  : new Date(b.slate + "T12:00:00").toLocaleDateString(undefined, {weekday:"long", month:"short", day:"numeric"});
function pickText(c, sp = sport){ return withSport(sp, () => sideText(c.key, c.line, c.side)); }
function withSport(sp, fn){ const saved = sport; sport = sp; try { return fn(); } finally { sport = saved; } }
function openPick(c){
  ui.stat = c.key; ui.line = c.line; ui.side = c.side; ui.oddsO = ""; ui.oddsU = "";
  openPlayer(c.pid, true).then(() => window.scrollTo({top: $("picker").offsetTop - 8, behavior:"smooth"}));
}
async function checkParlay(legs, sp){
  slip = {open:true, legs: legs.map(c => ({sport: sp, pid: c.pid, name: c.name, team: c.team, key: c.key, line: c.line, side: c.side, sure: true})),
          odds:null, stake:null, bonus:false, busy:"", idx: slip.idx};
  renderSlip(); $("slip").scrollIntoView({behavior:"smooth", block:"start"});
  await Promise.all(slip.legs.map(modelLeg)); renderSlip();
}
// the picks can be read one card a game (default, easier to scan) or as one ranked list
let pickView = store.get("tradescale:props-pickview") === "pick" ? "pick" : "game";
function viewToggle(redraw){
  return el("div", {class:"seg", role:"group", "aria-label":"Show the picks"}, ...[["game","By game"],["pick","By pick"]].map(([id, label]) =>
    el("button", {text:label, "aria-pressed": String(pickView === id), onclick: () => { pickView = id; store.set("tradescale:props-pickview", id); redraw(); }})));
}
const pickHead = (title, redraw) => el("div", {class:"bar-row pick-head"}, el("h3", {text:title}), viewToggle(redraw));
// items: [{key, head, sub, p, row}] where row is the element for one pick; one card per game, the game with the likeliest pick first
function gameCards(items){
  const games = new Map();
  items.forEach(it => { if (!games.has(it.key)) games.set(it.key, {head: it.head, sub: it.sub, items: []}); games.get(it.key).items.push(it); });
  const list = [...games.values()].map(g => (g.items.sort((a, b) => b.p - a.p), g)).sort((a, b) => b.items[0].p - a.items[0].p);
  return el("div", {class:"pgames"}, ...list.map(g => el("article", {class:`pgame ${tier(g.items[0].p)}`},
    el("header", {}, el("strong", {text:g.head}), el("small", {text:`${g.sub}${g.sub ? ", " : ""}${g.items.length} pick${g.items.length > 1 ? "s" : ""}`})),
    el("ul", {}, ...g.items.map(it => it.row)))));
}
function bestPanel(b, sp){
  const box = el("section", {class:"panel best"});
  const redraw = () => box.replaceWith(bestPanel(b, sp));
  const unit = sp === "ufc" ? "fight" : "game";
  // the days you picked (the next slate to start: today's games, or the whole NFL week) and their picks
  const days = b.days || [];
  const def = days.filter(x => x.slate).map(x => x.date);
  const chosen = days.length ? chosenDays(sp, days.map(x => x.date), def.length ? def : [days[0].date]) : [];
  const on = days.filter(x => chosen.includes(x.date)), byP = (x, y) => y.p - x.p;
  const v = on.length ? {picks: on.flatMap(x => x.picks).sort(byP), overs: on.flatMap(x => x.overs).sort(byP).slice(0, 6), games: on.reduce((n, x) => n + x.games, 0)} : null;
  const picks = v ? v.picks.slice(0, 12) : b.picks, overs = v ? v.overs : (b.overs || []), nGames = v ? v.games : b.games;
  const isDef = !v || (chosen.length === def.length && chosen.every(d => def.includes(d)));
  const title = isDef && !/^\d{4}-/.test(b.slate || "") ? slateName(b) : !v ? slateName(b) : on.length > 3 ? `${on.length} days` : on.map(x => dayName(x.date)).join(" + ");
  box.append(el("h2", {text:`Best bets: ${title}`}), dayPicker(sp, days, chosen, redraw, unit) || "", appsPicker(redraw) || "");
  if (v && on.some(x => x.date !== days[0].date) && sp !== "nfl")
    box.append(el("p", {class:"sub", text:"Later days list only teams that don't play before then, since the model prices each team's next game. The rest show up once their earlier game is played."}));
  if (!picks.length){ box.append(el("p", {class:"empty", style:"margin:0", text: v ? "No picks for these days yet." : b.note || "No picks for this slate yet."})); return box; }
  const basis = sp === "ufc" ? "his last 10 fights" : "his last 10 games";
  const fresh = sp === "ufc" ? "Rebuilt every morning with the latest results and the next card."
    : sp === "soc" || sp === "cri" ? "Rebuilt every morning with the latest results; players left out of their team's recent matches are skipped, since injury news and lineups aren't in the free data."
    : "Rebuilt every morning with the latest results and injury tags; injured players are left out.";
  box.append(el("p", {class:"sub", text:`The trained model's most likely props across ${nGames} ${unit}${nGames === 1 ? "" : "s"}, each at the line nearest his average over ${basis}. ${odds && odds.props && odds.props[sp] ? "Where the apps have posted the prop, the best app shows under it (best payout for the model's chance at that app's own line), with every other app that lists him." : "Your book's line may differ, so tap a pick to check it at that line."} ${fresh}`}));
  const byId = new Map([...b.picks, ...(b.extra || [])].map(c => [c.pid + ":" + c.key, c]));
  // build the parlays here at the chosen size, from the chosen days' picks (or the older one-slate pool)
  const pool = v ? v.picks : (b.pool || [...b.picks.map(c => c.pid + ":" + c.key), ...(b.extra || []).map(c => c.pid + ":" + c.key)]).map(k => byId.get(k)).filter(Boolean);
  const gameOf = c => [c.team, c.opp].sort().join("-") + c.date;
  // one leg per game first; past the number of games, more players from the same games (never both fighters to win)
  const games = gamesIn(pool, gameOf), maxLegs = Math.min(MAX_LEGS, new Set(pool.map(c => c.pid)).size);
  const fits = (c, legs) => !(c.key === "win" && legs.some(l => l.key === "win" && gameOf(l) === gameOf(c)));
  const parlays = buildParlays(pool, Math.min(parlayLegs, maxLegs), 3, gameOf, c => c.pid, fits);
  if (maxLegs >= 2 && parlays.length){
    const k = parlays[0].legs.length;
    box.append(el("div", {class:"bar-row pick-head"}, el("h3", {text:`${k}-leg parlays`}), legPicker(maxLegs, redraw)));
    if (k > games) box.append(el("p", {class:"sub", text:`${games === 1 ? "There's 1 " + unit : "There are " + games + " " + unit + "s"} with a pick on ${on.length > 1 ? "these days" : "this day"}, so some legs share a ${unit}. Legs in the same ${unit} move together (a blowout or a slow pace can sink several at once), so the real chance can land a bit off the one shown.${days.length > on.length ? ` Add a day above for one leg per ${unit}.` : ""}`}));
    if (parlayLegs > maxLegs) box.append(el("p", {class:"sub", text:`The model has ${maxLegs} players it can pick from on ${on.length > 1 ? "these days" : "this slate"}, so ${maxLegs} legs is the most.`}));
    const grid = el("div", {class:"parlays"});
    parlays.forEach((pl, i) => {
      const legs = pl.legs;
      const card = el("div", {class:`parlay ${tier(pl.p, legs.length)}`},
        el("div", {class:"parlay-top"}, el("strong", {text: i === 0 ? "Best parlay" : `Parlay ${i + 1}`}), chancePill(pl.p, legs.length)),
        el("ul", {}, ...legs.map(c => el("li", {},
          el("button", {class:"linkish", text:c.name, onclick: () => openPick(c)}),
          el("span", {text:` ${pickText(c, sp)}`}), el("small", {text:` ${vsAt(c.home)} ${c.opp}, ${pct(c.p)}`})))),
        parlayBooks(propLegs(legs, sp), false) || "",
        el("div", {class:"parlay-foot"}, el("small", {text:`Fair odds ${toAmerican(pl.p)}. ${sharesGame(legs, gameOf) ? `Some legs share a ${unit}, so they lean on each other a little.` : `One leg per ${unit}, so the legs don't lean on each other.`}`}),
          el("button", {class:"btn tiny", text:"Check in slip", onclick: () => checkParlay(legs, sp)})));
      grid.append(card);
    });
    box.append(grid);
  } else box.append(el("p", {class:"sub", text: maxLegs < 2 ? `Not enough picks on ${on.length > 1 ? "these days" : "this slate"} for a parlay.` : "No parlays for this slate."}));
  const pickList = list => {
    const ul = el("ol", {class:"picks"});
    list.forEach(c => {
      const why = (c.why || []).map(w => w[0].toLowerCase()).join(" and ");
      ul.append(el("li", {class:"pick"},
        chancePill(c.p),
        el("div", {}, el("button", {class:"linkish", text:c.name, onclick: () => openPick(c)}), sp === "ufc" ? null : el("span", {class:"tag", text:c.team}),
          el("div", {class:"pick-line", text:pickText(c, sp)}),
          el("small", {text:`${vsAt(c.home)} ${c.opp}, ${shortDate(c.date)}. Hit ${c.l10[0]} of his last ${c.l10[1]}.${why ? ` Helped most by ${why}.` : ""}`}),
          propBooks(c, sp) || "")));
    });
    return ul;
  };
  if (pickView === "game"){
    const seen = new Set(), all = [...picks, ...overs].filter(c => !seen.has(c.pid + ":" + c.key) && seen.add(c.pid + ":" + c.key));
    const head = c => sp === "ufc" ? `${c.name} vs ${c.opp}` : c.home === 0 ? `${c.team} at ${c.opp}` : c.home ? `${c.opp} at ${c.team}` : `${c.team} vs ${c.opp}`;
    box.append(pickHead("Picks by game", redraw),
      el("p", {class:"sub", text:`Every top pick and best over, one card a ${unit}, the ${unit} with the likeliest pick first. Tap a name to check it at your book's line.`}),
      gameCards(all.map(c => ({key: `${c.date}|${sp === "ufc" ? [c.name, c.opp].sort() : [c.team, c.opp].sort()}`, head: head(c), sub: shortDate(c.date), p: c.p,
        row: el("li", {}, chancePill(c.p), el("div", {}, el("button", {class:"linkish", text:c.name, onclick: () => openPick(c)}),
          el("span", {text:` ${pickText(c, sp)}`}), el("small", {text:`Hit ${c.l10[0]} of his last ${c.l10[1]}.`}), propBooks(c, sp) || ""))}))));
    return box;
  }
  box.append(pickHead("Most likely to hit", redraw), pickList(picks));
  if (overs.length){
    box.append(el("h3", {text:"Best overs"}),
      el("p", {class:"sub", text:"Players finish under their usual line more often than over, so most top picks are unders. These are the overs the model likes most."}),
      pickList(overs));
  }
  return box;
}
async function renderBest(host, sp){
  const [data] = await Promise.all([loadBest(), loadOdds()]);
  if (sp !== sport || player || !host.isConnected) return;
  if (!data || !data.sports || !data.sports[sp]) return;
  bestDate = data.date;
  host.replaceWith(bestPanel(data.sports[sp], sp));
}

function renderLanding(){
  const app = $("app"); app.innerHTML = "";
  const bestHost = el("div"); app.append(bestHost); renderBest(bestHost, sport);
  // UFC: the fighters on the next card, in bout order; everyone else: the season's most productive players
  const card = sport === "ufc" ? cardOrder() : null;
  const box = el("section", {class:"panel"}, el("h2", {text: card ? "On the next card" : "Popular this week"}),
    el("p", {class:"sub", text: card ? "Pick a fighter, or search above for anyone with a recent UFC fight." : "The most productive players this season. Pick one, or search above for anyone."}));
  const grid = el("div", {class:"chips"});
  (card || index.players.slice(0, 30)).forEach(p => grid.append(el("button", {class:"pchip", onclick: () => openPlayer(p[0])},
    el("strong", {text:p[1]}), el("small", {text: card ? `vs ${index.next[p[2]].opp}` : `${p[3]}, ${p[2]}`}))));
  box.append(grid);
  app.append(box);
}

function cardOrder(){
  const on = index.players.filter(p => index.next[p[2]]);
  if (!on.length) return null;
  const when = p => index.next[p[2]].date + (index.next[p[2]].time || ""), bout = p => [p[2], index.next[p[2]].opp].sort().join("|");
  return on.sort((a, b) => when(a).localeCompare(when(b)) || bout(a).localeCompare(bout(b))).slice(0, 40);
}

/* ---------- College game lines: spread, moneyline and total picks from team ratings ---------- */
// scripts/update_college_games.py writes data/props/<cfb|cbb>/games.json every morning: a rating for every team, the model's
// margin and total for each game in the next few days, and the book's line from ESPN when it has one
const gameData = {}, gameReady = {};
const loadGames = sp => gameData[sp] || (gameData[sp] = getJSON(`data/props/${sp}/games.json`).then(d => {
  d.byAbbr = new Map(d.teams.map(r => [r[0], r]));
  d.games = d.games.filter(g => g.m != null && (!g.start || new Date(g.start) > Date.now()));   // not started yet
  return gameReady[sp] = d;
}).catch(e => { delete gameData[sp]; throw e; }));
const schoolKey = s => norm(s || "").replace(/[^a-z0-9]/g, "");
function teamInfo(d, abbr){
  const r = d.byAbbr.get(abbr) || [abbr, abbr, "", abbr];
  const city = r[1] || abbr, nick = r[2] || "";
  return {abbr, city, nick, name: nick ? `${city} ${nick}` : city, short: r[3] || city, rating: r[4], rank: r[5]};
}
const legTeam = t => ({abbr: t.abbr, nick: t.nick, city: t.city, name: t.name});
// the game a slip's team plays next: ESPN's code first, else the school's name
function collegeGame(d, team){
  const want = schoolKey(team.city);
  const row = d.byAbbr.get(team.abbr) || d.teams.find(r => schoolKey(r[1]) === want || schoolKey(r[3]) === want);
  if (!row) return null;
  const g = d.games.find(x => x.home === row[0] || x.away === row[0]);
  return g ? {g, home: g.home === row[0], abbr: row[0]} : null;
}
// the expected home margin and total: the book's line moved part of the way toward the model, by as much as
// trusting the model that far paid off on last season's games (all the way to the model when there's no line)
function expectGame(d, g){
  const M = d.model, L = g.line || {};
  let m = g.m, t = g.t;
  if (L.spread != null) m = -L.spread + M.k * (g.m - -L.spread);
  if (L.total != null && t != null) t = L.total + M.k_total * (t - L.total);
  return {m, t, sd: M.sd || 15, sdT: M.sd_total || 15};
}
// bet: {market: ml|spread|total|teamtotal, home (the side, for team bets), line, side (over|under)}
function gameChance(d, g, bet){
  const e = expectGame(d, g), over = (mu, line, sd) => Phi((mu - line) / sd);
  if (bet.market === "total"){
    if (bet.line == null || e.t == null) return null;
    const p = over(e.t, bet.line, e.sdT); return bet.side === "under" ? 1 - p : p;
  }
  const my = bet.home ? e.m : -e.m;
  if (bet.market === "teamtotal"){
    if (bet.line == null || e.t == null) return null;
    const p = over((e.t + my) / 2, bet.line, e.sdT * 0.7); return bet.side === "under" ? 1 - p : p;
  }
  return Phi((my + (bet.market === "spread" ? bet.line || 0 : 0)) / e.sd);
}
const half = v => Math.round(v * 2) / 2;
function modelLineText(d, g){
  const m = half(g.m);
  if (!m) return "Pick'em";
  const fav = teamInfo(d, m > 0 ? g.home : g.away);
  return `${fav.short} -${Math.abs(m)}`;
}
function bookLineText(d, g){
  const s = g.line && g.line.spread;
  if (s == null) return "–";
  if (!s) return "Pick'em";
  return s < 0 ? `${teamInfo(d, g.home).short} ${s}` : `${teamInfo(d, g.away).short} -${s}`;
}
const kickoff = iso => iso ? new Date(iso).toLocaleString(undefined, {weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}) : "";
const matchup = (d, g) => `${teamInfo(d, g.away).short} ${g.neutral ? "vs" : "at"} ${teamInfo(d, g.home).short}`;
// every bet the model can price on one game, each with its chance
function gameBets(d, g){
  const L = g.line || {}, out = [];
  const pH = gameChance(d, g, {market:"ml", home:true});
  out.push({g, market:"ml", home:true, p:pH, odds:L.mlH}, {g, market:"ml", home:false, p:1 - pH, odds:L.mlA});
  const s = L.spread != null ? L.spread : -half(g.m);   // no book line yet: the model's own
  const cH = gameChance(d, g, {market:"spread", home:true, line:s});
  out.push({g, market:"spread", home:true, line:s, p:cH, book: L.spread != null}, {g, market:"spread", home:false, line:-s, p:1 - cH, book: L.spread != null});
  const t = L.total != null ? L.total : g.t != null ? half(g.t) : null;
  if (t != null){
    const o = gameChance(d, g, {market:"total", line:t, side:"over"});
    out.push({g, market:"total", side:"over", line:t, p:o, book: L.total != null}, {g, market:"total", side:"under", line:t, p:1 - o, book: L.total != null});
  }
  return out;
}
function betText(d, b){
  const me = teamInfo(d, b.home ? b.g.home : b.g.away);
  if (b.market === "ml") return `${me.short} to win`;
  if (b.market === "spread") return `${me.short} ${b.line ? signed(b.line) : "pick'em"}`;
  return `${b.side === "over" ? "Over" : "Under"} ${b.line}`;
}
function betLeg(d, sp, b){
  const home = b.market === "total" ? true : b.home;
  return {kind:"team", sport:sp, market:b.market, team:legTeam(teamInfo(d, home ? b.g.home : b.g.away)), opp:legTeam(teamInfo(d, home ? b.g.away : b.g.home)),
          line: b.market === "ml" ? null : b.line, side: b.market === "total" ? b.side : null, odds: b.odds != null ? b.odds : null, sure:true, alts:[], text:""};
}
async function addBets(d, sp, bets, fresh){
  if (fresh) slip = {open:true, legs:[], odds:null, stake:null, bonus:false, busy:"", idx: slip.idx};
  slip.open = true;
  const legs = bets.map(b => betLeg(d, sp, b));
  slip.legs.push(...legs);
  renderSlip(); $("slip").scrollIntoView({behavior:"smooth", block:"start"});
  await Promise.all(legs.map(modelLeg)); renderSlip();
}

let gameView = {filter:"", open:null};
function gameSportName(sp){ return sp === "cfb" ? "college football" : "college basketball"; }
function renderGamePicker(d, sp){
  const host = $("picker"); host.innerHTML = "";
  // typing narrows the games below; picking a team opens its game with the best same-game parlay
  host.append(searchBox(`Find a ${gameSportName(sp)} team`, q => teamHits(q).slice(0, 8), "Find a team",
    {keep: true, value: gameView.filter, onInput: v => { gameView.filter = v; gameView.open = null; renderGames(d, sp); }}));
}
function openCollegeTeam(d, sp, abbr){
  const g = d.games.find(x => x.home === abbr || x.away === abbr);
  gameView.open = g ? g.id : null;
  history.replaceState(null, "", `#sp=${sp}&team=${encodeURIComponent(abbr)}`);
  if (!g){ toast(`${teamInfo(d, abbr).name} has no game in the next few days.`); return; }
  renderGames(d, sp);
  const p = $("game-panel"); if (p) p.scrollIntoView({behavior:"smooth", block:"start"});
}
function renderGames(d, sp){
  const app = $("app"); app.innerHTML = "";
  const q = schoolKey(gameView.filter);
  const has = g => !q || [g.home, g.away].some(a => { const t = teamInfo(d, a); return [t.name, t.short, a].some(x => schoolKey(x).includes(q)); });
  // the day picker: every day with games (all of them to start), counted before the team filter
  const gDay = g => g.start ? localISO(new Date(g.start)) : "";
  const dayCount = new Map();
  d.games.forEach(g => { const k = gDay(g); if (k) dayCount.set(k, (dayCount.get(k) || 0) + 1); });
  const days = [...dayCount].sort((a, b) => a[0].localeCompare(b[0])).map(([date, games]) => ({date, games}));
  const chosen = chosenDays(sp, days.map(x => x.date), days.map(x => x.date));
  const list = d.games.filter(g => has(g) && (!gDay(g) || days.length < 2 || chosen.includes(gDay(g))));
  const bt = d.backtest || {}, M = d.model || {};
  const intro = el("section", {class:"panel best"},
    el("h2", {text:`${sp === "cfb" ? "College football" : "College basketball"} game picks`}),
    el("p", {class:"sub", text:`Game lines only: spread, moneyline and total, since many states (yours included) don't allow player props on college games. `
      + `The model rates every team from this season's scores, with last season's games carrying the early weeks, and adds a home-field edge of ${fmt1(M.hfa || 0)} points. `
      + `Where the book has posted a line, the chances start from that line and move ${Math.round((M.k || 0) * 100)}% of the way toward the model, because that's how much of the gap held up on last season's games.`
      + (bt.games ? ` Tested week by week on ${bt.season} (${bt.games.toLocaleString()} games), it picked the winner ${pct(bt.winner)} of the time${bt.ats ? ` and went ${pct(bt.ats.pct)} against the spread` : ""}${bt.ou ? ` and ${pct(bt.ou.pct)} on totals` : ""}.` : "")
      + ` Beating -110 takes 52.4%, so treat spread and total picks as leans.`}), dayPicker(sp, days, chosen, () => renderGames(d, sp)) || "", appsPicker(() => renderGames(d, sp)) || "");
  app.append(intro);
  if (!d.games.length){
    intro.append(el("p", {class:"empty", style:"margin:0", text:`No ${gameSportName(sp)} games in the next few days. Picks show up here once the schedule has games.`}));
    return;
  }
  if (gameView.open){ const g = d.games.find(x => x.id === gameView.open); if (g) app.append(gamePanel(d, sp, g)); }
  const all = list.flatMap(g => gameBets(d, g));
  const top = (pred, n) => all.filter(b => b.p > 0.5 && pred(b)).sort((a, b) => b.p - a.p).slice(0, n);   // the side the model favors
  const spreads = top(b => b.market === "spread" && b.book, 8), totals = top(b => b.market === "total" && b.book, 6);
  const mls = top(b => b.market === "ml", 8);
  // a parlay of the chosen size, one leg per game: the likeliest spread or total against a real line in each game,
  // then the likeliest winners from games without one once those run out
  const redraw = () => renderGames(d, sp);
  const lean = all.filter(b => b.p > 0.5 && (b.market === "spread" || b.market === "total") && b.book);
  const withLine = new Set(lean.map(b => b.g.id));
  const legPool = [...lean, ...all.filter(b => b.p > 0.5 && b.market === "ml" && !withLine.has(b.g.id))];
  // more legs than games: games carry a second leg, a side (spread or winner) plus the total, never a spread and winner together
  const good = all.filter(b => b.p > 0.5), kinds = new Map();
  good.forEach(b => { if (!kinds.has(b.g.id)) kinds.set(b.g.id, new Set()); kinds.get(b.g.id).add(b.market === "total" ? "total" : "side"); });
  const games = gamesIn(legPool, b => b.g.id), slots = [...kinds.values()].reduce((n, x) => n + x.size, 0);
  const maxLegs = Math.min(Math.max(games, slots), MAX_LEGS), k = Math.min(parlayLegs, maxLegs);
  const pairs = (b, legs) => { const same = legs.filter(l => l.g.id === b.g.id); return same.length < 2 && same.every(l => (l.market === "total") !== (b.market === "total")); };
  const byLine = k <= games ? buildParlays(lean, k, 1, b => b.g.id)[0] : null;
  const top1 = byLine || (k <= games ? buildParlays(legPool, k, 1, b => b.g.id)[0] : buildParlays(good, k, 1, b => b.g.id, () => null, pairs)[0]);
  const legs = top1 ? top1.legs : [];
  const box = el("section", {class:"panel best"});
  if (legs.length >= 2){
    const p = top1.p;
    box.append(el("div", {class:"bar-row pick-head"}, el("h3", {text:`Best ${k}-leg parlay`}), legPicker(maxLegs, redraw)),
      k > games ? el("p", {class:"sub", text:`${games === 1 ? "There's 1 game" : `There are ${games} games`} on ${chosen.length > 1 ? "these days" : "this day"}, so some games carry two legs: a side and the total. College bets are game lines only (no player props), so a game can't give more than that here.${days.length > chosen.length ? " Add a day above for one leg per game." : ""} Same-game legs lean on each other a little.`}) : "",
      parlayLegs > maxLegs ? el("p", {class:"sub", text:`${maxLegs} legs is the most from these games: college bets are game lines only (no player props), so each game gives at most a side and a total.`}) : "",
      el("div", {class:"parlays"}, el("div", {class:`parlay ${tier(p, k)}`},
      el("div", {class:"parlay-top"}, el("strong", {text:"Best parlay"}), chancePill(p, k)),
      el("ul", {}, ...legs.map(b => el("li", {}, el("button", {class:"linkish", text:betText(d, b), onclick: () => openGame(d, sp, b.g)}),
        el("small", {text:` ${matchup(d, b.g)}, ${pct(b.p)}`})))),
      parlayBooks(gameLegs(d, sp, legs), false) || "",
      el("div", {class:"parlay-foot"}, el("small", {text:`Fair odds ${toAmerican(p)}. ${sharesGame(legs, b => b.g.id) ? "Some games carry two legs." : "One leg per game."}`}),
        el("button", {class:"btn tiny", text:"Check in slip", onclick: () => addBets(d, sp, legs, true)})))));
  }
  const pickList = (bs, why) => el("ol", {class:"picks"}, ...bs.map(b => el("li", {class:"pick"}, chancePill(b.p),
    el("div", {}, el("button", {class:"linkish", text:betText(d, b), onclick: () => openGame(d, sp, b.g)}),
      el("div", {class:"pick-line", text:matchup(d, b.g)}), el("small", {text:`${kickoff(b.g.start)}. ${why(b)}`}), gameBooks(d, sp, b) || ""),
    el("button", {class:"btn tiny", text:"+ Slip", "aria-label":`Add ${betText(d, b)} to the slip`, onclick: () => addBets(d, sp, [b])}))));
  const why = {spread: b => `Model line ${modelLineText(d, b.g)}, book ${bookLineText(d, b.g)}.`, total: b => `Model total ${fmt1(b.g.t)}, book ${b.line}.`,
    ml: b => b.odds != null ? `Book ${signed(b.odds)} (${pct(implied(b.odds))} with the cut).` : `Model line ${modelLineText(d, b.g)}.`};
  if (pickView === "game"){
    box.append(pickHead("Picks by game", redraw),
      el("p", {class:"sub", text:"The best spreads, totals and winners, one card a game, the game with the likeliest pick first. Heavy favorites pay little, so compare a winner's chance with the book's price."}),
      gameCards([...spreads, ...totals, ...mls].map(b => ({key: b.g.id, head: matchup(d, b.g), sub: kickoff(b.g.start), p: b.p,
        row: el("li", {}, chancePill(b.p), el("div", {}, el("button", {class:"linkish", text:betText(d, b), onclick: () => openGame(d, sp, b.g)}),
          el("small", {text:why[b.market](b)}), gameBooks(d, sp, b) || ""),
          el("button", {class:"btn tiny", text:"+ Slip", "aria-label":`Add ${betText(d, b)} to the slip`, onclick: () => addBets(d, sp, [b])}))}))));
  } else box.append(pickHead("Ranked picks", redraw));
  if (pickView === "pick" && spreads.length) box.append(el("h3", {text:"Best spread picks"}), pickList(spreads, b => `Model line ${modelLineText(d, b.g)}, book ${bookLineText(d, b.g)}.`));
  if (pickView === "pick" && totals.length) box.append(el("h3", {text:"Best totals"}), pickList(totals, b => `Model total ${fmt1(b.g.t)}, book ${b.line}.`));
  if (pickView === "pick") box.append(el("h3", {text:"Likeliest winners"}),
    el("p", {class:"sub", text:"Moneyline favorites, safest first. Heavy favorites pay little, so compare the chance with the book's price."}),
    pickList(mls, b => b.odds != null ? `Book ${signed(b.odds)} (${pct(implied(b.odds))} with the cut).` : `Model line ${modelLineText(d, b.g)}.`));
  if (!spreads.length && !totals.length) box.append(el("p", {class:"sub", text:"No book lines posted for these games yet, so only winners are shown. Open a game to price any spread or total."}));
  app.append(box);
  // every game, with the model's number next to the book's
  const tb = el("table", {}, el("thead", {}, el("tr", {}, ...["Game","When","Model line","Book line","Model total","Book total","Win chance"].map(h => el("th", {text:h})))));
  const body = el("tbody");
  list.forEach(g => {
    const pH = gameChance(d, g, {market:"ml", home:true}), fav = teamInfo(d, pH >= 0.5 ? g.home : g.away);
    body.append(el("tr", {}, el("td", {}, el("button", {class:"linkish", text:matchup(d, g), onclick: () => openGame(d, sp, g)})),
      el("td", {text:kickoff(g.start)}), el("td", {text:modelLineText(d, g)}), el("td", {text:bookLineText(d, g)}),
      el("td", {text: g.t != null ? fmt1(g.t) : "–"}), el("td", {text: g.line && g.line.total != null ? String(g.line.total) : "–"}),
      el("td", {class:"ch", text:`${fav.short} ${pct(Math.max(pH, 1 - pH))}`})));
  });
  tb.append(body);
  app.append(el("section", {class:"panel"}, el("h2", {text:`All games (${list.length})`}),
    el("p", {class:"sub", text:"Tap a game to price any spread or total and add it to your slip."}), el("div", {class:"tablewrap"}, tb)));
}
function openGame(d, sp, g){
  gameView.open = g.id; renderGames(d, sp);
  const p = $("game-panel"); if (p) p.scrollIntoView({behavior:"smooth", block:"start"});
}
// one game: every bet with its chance, lines you can change to match your book
function gamePanel(d, sp, g){
  const H = teamInfo(d, g.home), A = teamInfo(d, g.away), L = g.line || {};
  const box = el("section", {class:"panel", id:"game-panel"});
  const rk = t => t.rank ? `#${t.rank} in the ratings` : "unrated";
  box.append(el("div", {class:"bar-row", style:"justify-content:space-between"},
      el("h2", {text:`${A.name} ${g.neutral ? "vs" : "at"} ${H.name}`}),
      el("button", {class:"btn tiny", text:"Close", onclick: () => { gameView.open = null; renderGames(d, sp); }})),
    el("p", {class:"sub", text:`${kickoff(g.start)}${g.neutral ? ", neutral site" : ""}. ${A.short} ${rk(A)}, ${H.short} ${rk(H)}. Model: ${modelLineText(d, g)}, total ${g.t != null ? fmt1(g.t) : "–"}. Book: ${bookLineText(d, g)}${L.total != null ? `, total ${L.total}` : ""}.`}));
  const ul = el("ul", {class:"why-list"});
  let spread = L.spread != null ? L.spread : -half(g.m), total = L.total != null ? L.total : g.t != null ? half(g.t) : null;
  const draw = () => {
    ul.innerHTML = "";
    const row = (label, input, b) => {
      const p = gameChance(d, g, b);
      ul.append(el("li", {}, el("div", {}, el("strong", {text:label}), input || null),
        el("span", {class:`chance ${p == null ? "lo" : tier(p)}`, text: p == null ? "–" : pct(p)}),
        el("button", {class:"btn tiny", text:"+ Slip", "aria-label":`Add ${label} to the slip`, onclick: () => addBets(d, sp, [{g, ...b, odds: b.market === "ml" ? (b.home ? L.mlH : L.mlA) : null}])})));
    };
    const lineIn = (v, set) => { const i = el("input", {type:"number", step:"0.5", value: v ?? "", class:"line-in sm", "aria-label":"Line"}); i.onchange = () => { set(i.value === "" ? null : Number(i.value)); draw(); }; return i; };
    row(`${H.short} spread`, lineIn(spread, v => { spread = v || 0; }), {market:"spread", home:true, line:spread});
    row(`${A.short} spread`, el("small", {text:` ${spread ? signed(-spread) : "pick'em"}`}), {market:"spread", home:false, line:-spread});
    row(`${H.short} to win`, L.mlH != null ? el("small", {text:` book ${signed(L.mlH)}`}) : null, {market:"ml", home:true});
    row(`${A.short} to win`, L.mlA != null ? el("small", {text:` book ${signed(L.mlA)}`}) : null, {market:"ml", home:false});
    if (total != null || g.t != null){
      row("Over", lineIn(total, v => { total = v; }), {market:"total", side:"over", line:total});
      row("Under", el("small", {text:` ${total ?? ""}`}), {market:"total", side:"under", line:total});
    }
  };
  draw();
  // the likeliest same-game parlay: the side the model favors on the winner, the spread and the total (game lines only)
  const sides = gameBets(d, g).filter(b => b.p >= 0.5).filter((b, i, a) => a.findIndex(x => x.market === b.market) === i).sort((a, b) => b.p - a.p);
  if (sides.length >= 2){
    const redraw = () => box.replaceWith(gamePanel(d, sp, g));
    const k = Math.min(parlayLegs, sides.length), legs = sides.slice(0, k), p = legs.reduce((x, b) => x * b.p, 1);
    box.append(el("div", {class:"bar-row pick-head"}, el("h3", {text:`Best ${k}-leg same-game parlay`}), legPicker(sides.length, redraw)),
      parlayLegs > sides.length ? el("p", {class:"sub", text:`College bets here are game lines only (winner, spread and total), so ${sides.length} legs is the most for one game.`}) : "",
      sgpCard(k, p, legs.map(b => el("li", {}, el("strong", {text:betText(d, b)}), el("small", {text:` ${MARKET_LABEL[b.market]}${b.market !== "ml" && !b.book ? " (model line)" : ""}, ${pct(b.p)}`}))),
        "Game lines only, no player props.", () => addBets(d, sp, legs, true), parlayBooks(gameLegs(d, sp, legs), true)),
      el("p", {class:"sub", text: SGP_NOTE + (legs.some(b => b.market === "ml") && legs.some(b => b.market === "spread") ? " Winning and covering go together, so many books won't combine a moneyline and spread on the same team, or price it lower." : "")}),
      el("h3", {text:"Every line in this game"}));
  }
  box.append(ul, el("p", {class:"why", text:`Chances use a spread of about ${fmt1(d.model.sd)} points around the expected margin and ${fmt1(d.model.sd_total)} around the total, which is how far games landed from the model's number last season.`}));
  return box;
}
async function showGames(id, teamCode){
  const status = $("status");
  let d;
  try { [d] = await Promise.all([loadGames(id), loadOdds()]); }
  catch(e){ status.classList.add("warn"); status.textContent = "College game data isn't built yet. It appears after the next daily update (or run the workflow on GitHub)."; return; }
  if (id !== sport) return;
  const lined = d.games.filter(g => g.line && g.line.spread != null).length;
  status.textContent = `${d.games.length} game${d.games.length === 1 ? "" : "s"} in the next few days${d.games.length ? `, ${lined} with a book line` : ""}. ${d.games_this_season ? `Ratings from the ${d.season} season (${d.games_this_season} games played)` : `The ${d.season} season hasn't started, so ratings come from last season`}, updated ${TS.ago(d.updated)}.`;
  renderGamePicker(d, id);
  renderGames(d, id);
  if (teamCode) openCollegeTeam(d, id, teamCode);
}

async function openPlayer(id, fromHash){
  team = null;
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
  if (!player && team){ renderTeam(); return; }
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
  const sub = el("p", {class:"sub", style:"margin:0", text: sport === "ufc"
    ? `${player.pos}. ${all.length} UFC fight${all.length === 1 ? "" : "s"} since ${all.length ? seasonName(all[0].s) : seasonName(season())}, ${all.filter(g => g.wn === 1).length}-${all.filter(g => g.wn === 0).length}.`
    : `${player.pos}, ${player.team}. ${all.length} games since ${all.length ? seasonName(all[0].s) : seasonName(season())}.`});
  if (inj) sub.append(" ", el("span", {class:"inj", text:inj}));
  if ((sport === "nhl" && grpOf(player) === "G") || (sport === "mlb" && grpOf(player) === "SP"))
    sub.append(el("br"), el("small", {text:"Uses only games he started, and assumes he starts the next one. Confirm the starter before betting."}));
  nm.append(sub);
  who.append(nm);
  head.append(who);
  if (ng){
    const bits = [new Date(ng.date + "T12:00:00").toLocaleDateString(undefined, {weekday:"short", month:"short", day:"numeric"})];
    if (FOOTBALL.includes(sport)) bits.push(ng.sp == null ? "no line yet" : ng.sp > 0 ? `favored by ${ng.sp}` : ng.sp < 0 ? `${-ng.sp}-point underdog` : "pick'em");
    if (ng.home == null && sport !== "ufc" && sport !== "cri") bits.push("neutral site");
    if (ng.event) bits.push(ng.event);
    if (ng.sr) bits.push(`${ng.sr} rounds`);
    if (ng.t) bits.push(`total ${ng.t}`);
    if (ng.imp) bits.push(`team expected to score ${fmt1(ng.imp)}`);
    if (ng.rest === 0) bits.push("second night of a back-to-back");
    else if (ng.rest != null && ng.rest <= 4) bits.push(`${ng.rest} day${ng.rest === 1 ? "" : "s"} of rest`);
    if (ng.opp_sp) bits.push(`facing ${ng.opp_sp}`);
    head.append(el("div", {class:"next"}, el("span", {class:"lbl", text: ng.week ? `Week ${ng.week}` : sport === "ufc" ? "Next fight" : "Next game"}),
      el("strong", {text:`${vsAt(ng.home)} ${ng.opp}`}), el("span", {text: bits.join(", ")})));
  } else head.append(el("div", {class:"next"}, el("span", {text: sport === "ufc" ? "Not on an upcoming card yet." : "No upcoming game on the schedule."})));
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
  const sideSeg = el("span", {class:"seg"}, ...["over","under"].map(s => el("button", {text: isBinary(key) && line < 1 ? (s === "over" ? "Yes" : "No") : s === "over" ? "Over" : "Under", "aria-pressed": String(side === s), onclick: () => { ui.side = s; writeHash(); render(); }})));
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
    const ch = sideChance(player, key, line, side, pr), P = {push: ch.push};
    const pSide = ch.p;
    const ipO = implied(ui.oddsO), ipU = implied(ui.oddsU);
    let book = null, bookTxt = "";
    if (ipO && ipU){ const fair = (side === "over" ? ipO : ipU) / (ipO + ipU); book = fair; bookTxt = `Book's fair chance (vig removed): ${pct(fair)}`; }
    else if (side === "over" && ipO){ book = ipO; bookTxt = `Book implies ${pct(ipO)}`; }
    else if (side === "under" && ipU){ book = ipU; bookTxt = `Book implies ${pct(ipU)}`; }
    const big = el("div", {class:"big"}, el("span", {class:"num " + chanceClass(pSide), text:pct(pSide)}),
      el("span", {class:"cap", text:`${ch.trained ? "trained model" : "model"} chance: ${sideText(key, line, side)}`}));
    verdict.append(big);
    const facts = el("div", {class:"facts"},
      pr.binary ? el("div", {}, el("span", {class:"lbl", text:"His rate"}), el("strong", {text:pct(Math.min(1, pr.mu))}), el("small", {text:" opponent-adjusted"}))
        : el("div", {}, el("span", {class:"lbl", text:"Projection"}), el("strong", {text: pr.count ? fmt1(pr.mu) : String(Math.round(pr.mu))}), el("small", {text: pr.count ? " expected" : ` ± ${Math.round(pr.sd)}`})),
      el("div", {}, el("span", {class:"lbl", text:"Fair odds"}), el("strong", {text:toAmerican(pSide)})));
    if (ch.trained) facts.append(el("div", {}, el("span", {class:"lbl", text:"Formula"}), el("strong", {text:pct(ch.formula)}), el("small", {text:" hand-tuned weights"})));
    if (book != null){
      const edge = pSide - book;
      facts.append(el("div", {}, el("span", {class:"lbl", text:"Edge"}),
        el("strong", {class: edge >= 0.05 ? "pos" : edge <= -0.05 ? "neg" : "", text:(edge >= 0 ? "+" : "") + Math.round(edge * 100) + " pts"}), el("small", {text:" " + bookTxt})));
    } else facts.append(el("div", {}, el("span", {class:"lbl", text:"Edge"}), el("small", {text:"Enter the book's odds to compare"})));
    if (P.push > 0.02) facts.append(el("div", {}, el("span", {class:"lbl", text:"Push"}), el("strong", {text:pct(P.push)})));
    verdict.append(facts);
  } else verdict.append(el("p", {class:"empty", style:"margin:0", text:"Not enough games yet to project this player."}));
  ctl.append(verdict);
  // which app has this prop, and the best price for it (only apps that list him)
  const apps = pr ? propBooks({name: player.name, key, line, side, p: sideChance(player, key, line, side, pr).p}, sport) : null;
  if (apps) ctl.append(apps);

  // hit-rate strip
  const strip = el("div", {class:"strip"});
  const cur = all.filter(g => g.s === season()), last = all.filter(g => g.s === season() - 1);
  [["Last 5", all.slice(-5)], ["Last 10", all.slice(-10)], [seasonName(season()), cur], [seasonName(season() - 1), last],
   ng ? [`vs ${ng.opp}`, all.filter(g => g.o === ng.opp)] : null].filter(Boolean).forEach(([lbl, list]) => {
    const r = hitRate(list, key, line, side);
    strip.append(el("div", {class:"hr"}, el("span", {class:"lbl", text:lbl}),
      r ? el("strong", {text:`${r.h}/${r.n - r.p}`}) : el("strong", {text:"–"}), r ? el("small", {class:chanceClass(r.rate), text:pct(r.rate)}) : null));
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
  panel.append(el("div", {class:"bar-row", style:"justify-content:space-between"}, el("h2", {text: sport === "ufc" ? "Fight by fight" : "Game by game"}), seg));
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
    const info = `${when}${g.post ? " (playoffs)" : ""}: ${vsAt(g.h)} ${g.o}${result}${g.sr === 5 ? ", 5 rounds" : ""}${g.ttl ? ", title fight" : ""}${g.sp != null ? `, ${g.sp > 0 ? "favored by " + g.sp : g.sp < 0 ? "underdog by " + (-g.sp) : "pick'em"}` : ""}${g.t ? `, total ${g.t}` : ""}${g.rs === 0 ? ", back-to-back" : ""}${g.st === 0 && sport === "nba" ? ", off the bench" : ""}${g.dr ? `, ${ordinal(g.dr)}-toughest matchup for ${grpName()}` : ""}. ${labelOf(key)}: ${fmt1(v)}. ${Object.entries(g.x).filter(([k]) => k !== "ppr").map(([k, val]) => `${val} ${C().label[k] || k}`).join(", ")}.`;
    const t = document.createElementNS(ns, "title"); t.textContent = info; rect.append(t);
    const pick = () => { detail.textContent = info; svg.querySelectorAll("rect").forEach(r2 => r2.classList.remove("sel")); rect.classList.add("sel"); };
    rect.addEventListener("click", pick); rect.addEventListener("focus", pick);
    svg.append(rect);
    const tv = document.createElementNS(ns, "text"); tv.setAttribute("x", x + bw / 2); tv.setAttribute("y", (H - bottom) - h - 6); tv.setAttribute("class", "tv"); tv.textContent = fmt1(v); svg.append(tv);
    const tl = document.createElementNS(ns, "text"); tl.setAttribute("x", x + bw / 2); tl.setAttribute("y", H - bottom + 17); tl.setAttribute("class", "tl"); tl.textContent = (g.h === 0 ? "@" : "") + oppShort(g.o); svg.append(tl);
    const tw = document.createElementNS(ns, "text"); tw.setAttribute("x", x + bw / 2); tw.setAttribute("y", H - bottom + 32); tw.setAttribute("class", "tw"); tw.textContent = g.w ? `W${g.w}${g.s !== season() ? " '" + String(g.s).slice(2) : ""}` : `${shortDate(g.d)}${String(g.d).slice(0, 4) !== String(new Date().getFullYear()) ? " '" + String(g.d).slice(2, 4) : ""}`; svg.append(tw);
  });
  const ly = y(line);
  const ln = document.createElementNS(ns, "line"); ln.setAttribute("x1", gut - 4); ln.setAttribute("x2", Math.max(W, 320)); ln.setAttribute("y1", ly); ln.setAttribute("y2", ly); ln.setAttribute("class", "ln"); svg.append(ln);
  const lt = document.createElementNS(ns, "text"); lt.setAttribute("x", gut - 8); lt.setAttribute("y", ly + 4); lt.setAttribute("text-anchor", "end"); lt.setAttribute("class", "lt"); lt.textContent = `${line}`; svg.append(lt);
  const r = hitRate(list, key, line, side);
  panel.append(el("p", {class:"sub", text:`${sideText(key, line, side)} hit in ${r.h} of ${r.n - r.p} ${sport === "ufc" ? "fights" : "games"} (${pct(r.rate)})${r.p ? `, ${r.p} push${r.p > 1 ? "es" : ""}` : ""}. Average ${fmt1(vals.reduce((a, b) => a + b, 0) / vals.length)}, median ${fmt1(median(vals))}.`}),
    el("div", {class:"chartwrap"}, svg), detail);
  return panel;
}
const nowTag = () => FOOTBALL.includes(sport) ? "This week" : sport === "ufc" ? "Next fight" : "Next game";
const ordinal = n => n + (["th","st","nd","rd"][(n % 100 - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");

function whyPanel(pr, key, ng, opp){
  const panel = el("section", {class:"panel"}, el("h2", {text:"How the projection is built"}));
  const rows = [
    ["Recent form", `Weighted average of his ${sport === "ufc" ? "fights" : "games"}, newest weighted most`, pr.mu0, null],
    ["Opponent", ng ? (sport === "ufc" ? `What ${ng.opp}'s opponents have done against him vs the division average` : `What ${ng.opp} allows to ${grpName()} vs league average`)
      : sport === "ufc" ? "No fight booked" : "No game scheduled", pr.mu1, pr.mu0 ? pr.mu1 / pr.mu0 : 1],
    sport === "nfl" ? ["Scheme fit", schemeNote(pr), pr.mu2, pr.mu1 ? pr.mu2 / pr.mu1 : 1] : null,
    sport === "nfl"
      ? ["Game script", ng && ng.imp ? `${player.team} ${ng.sp > 0 ? "favored by " + ng.sp : ng.sp < 0 ? "underdog by " + (-ng.sp) : "even"}, expected to score ${fmt1(ng.imp)} (league average ${fmt1(defense.avg_team_total)})` : "No betting line yet", pr.mu, pr.mu2 ? pr.mu / pr.mu2 : 1]
      : ["Schedule", C().rest ? (ng && ng.rest === 0 ? "Second night of a back-to-back, which trims minutes and production" : "Not on a back-to-back, so no adjustment") : "No schedule adjustment for this sport", pr.mu, pr.mu2 ? pr.mu / pr.mu2 : 1]
  ].filter(Boolean);
  const ul = el("ul", {class:"why-list"});
  rows.forEach(([t, d, v, f]) => ul.append(el("li", {},
    el("div", {}, el("strong", {text:t}), el("small", {text:d})),
    f == null ? el("span", {class:"chip", text:"base"}) : el("span", {class:`chip ${f > 1.005 ? "up" : f < 0.995 ? "down" : ""}`, text:signPct(f)}),
    el("span", {class:"v", text: pr.binary ? pct(Math.min(1, v)) : pr.count ? fmt1(v) : String(Math.round(v))}))));
  const mlSec = trainedPanel(key);
  panel.append(ul, el("p", {class:"why", style:"margin-top:10px", text: pr.binary
    ? "This is a yes-or-no prop, so the chance is his own rate, adjusted for the opponent and kept between 5% and 95% so a short record can't make it a sure thing."
    : pr.count
    ? `This stat is modeled as a count. His games swing ${pr.disp > 1.15 ? "more than a steady rate would explain, so the odds are spread wider to match" : "about as much as a steady rate would, so it's priced like one"}.`
    : `This stat uses a bell curve centered on the projection, with a spread of about ${fmt1(pr.sd)} based on how much his games actually swing.`}));
  if (mlSec) panel.append(...mlSec);
  return panel;
}
// what the trained model leaned on for this prop, and how it did on games it never saw
function trainedPanel(key){
  const m = player.ml && player.ml[key]; if (!m || !model || !model.used) return null;
  const out = [el("h3", {text:"What the trained model weighed", style:"margin:18px 0 4px"})];
  const i = m.l.indexOf(m.at), p0 = i >= 0 ? m.p[i] : null;
  if (m.c && m.c.length && p0 != null){
    out.push(el("p", {class:"why", text:`For Over ${m.at}, the model's ${pct(p0)} came from these factors (pushes up or down from a typical prop):`}));
    const ul = el("ul", {class:"why-list"});
    m.c.slice(0, 5).forEach(([g, c]) => {
      const d = Math.round(c * p0 * (1 - p0) * 100);   // log-odds contribution as rough percentage points
      ul.append(el("li", {}, el("div", {}, el("strong", {text:g})),
        el("span", {class:`chip ${d > 0 ? "up" : d < 0 ? "down" : ""}`, text:(d > 0 ? "+" : "") + d + " pts"}), el("span", {class:"v", text:""})));
    });
    out.push(ul);
  }
  const r = model.report && model.report.default_lines;
  if (r){
    const top = (model.importance || []).slice(0, 3).map(x => x[0].toLowerCase()).join(", ");
    out.push(el("p", {class:"why", style:"margin-top:10px", text:
      `Trained with LightGBM on ${(model.player_games || model.games).toLocaleString()} past player games, so the weights come from real results instead of being picked by hand. ` +
      `Tested on ${r.n.toLocaleString()} later props it never saw: average error ${r.trained.brier.toFixed(3)} vs ${r.formula.brier.toFixed(3)} for the formula (Brier score, lower is better). ` +
      (top ? `Across all props it leans most on ${top}.` : "")}));
  }
  return out;
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
    el("p", {class:"sub", text:`Every split from his ${sport === "ufc" ? "fight" : "game"} log. Rows marked "${nowTag()}" match his next ${sport === "ufc" ? "fight" : "game"}.`}));
  const G = grpOf(player), oppRank = ng && opp && opp.pos[G] ? opp.pos[G].rank : null;
  const nTeams = Object.keys(defense.teams).length || 30, bottom = nTeams - 9;
  const won = g => g.ts != null ? g.ts > g.os : g.wn === 1, lost = g => g.ts != null ? g.ts < g.os : g.wn === 0;
  const [big, hiT, loT] = [6, 47, 43];
  const S = [
    ["Home", g => g.h === 1, ng && ng.home === 1], ["Away", g => g.h === 0, ng && ng.home === 0],
    ["Favored", g => g.sp > 0, ng && ng.sp > 0], ["Underdog", g => g.sp < 0, ng && ng.sp < 0],
    [`Big favorite (${big}+)`, g => g.sp >= big, ng && ng.sp >= big], [`Big underdog (${big}+)`, g => g.sp <= -big, ng && ng.sp <= -big],
    [`High total (${hiT}+)`, g => g.t >= hiT, ng && ng.t >= hiT], [`Low total (under ${loT})`, g => g.t && g.t < loT, ng && ng.t && ng.t < loT],
    ["Five-round fights", g => g.sr === 5, ng && ng.sr === 5], ["Three-round fights", g => g.sr === 3, ng && ng.sr === 3],
    ["Title fights", g => g.ttl === 1, false],
    ["Dome or closed roof", g => g.r === "dome", ng && ng.roof === "dome"], ["Outdoors", g => g.r === "outdoors", ng && ng.roof === "outdoors"],
    ["Cold (40°F or less)", g => g.r === "outdoors" && g.tp != null && g.tp <= 40, false], ["Windy (15+ mph)", g => g.r === "outdoors" && g.wd >= 15, false],
    ["Division games", g => g.dv === 1, ng && ng.div === 1],
    ...(C().rest ? [["Back-to-back (no rest)", g => g.rs === 0, ng && ng.rest === 0], ["1 day of rest", g => g.rs === 1, ng && ng.rest === 1],
      ["2+ days of rest", g => g.rs >= 2 && g.rs <= 6, ng && ng.rest >= 2 && ng.rest <= 6]] : []),
    ...(sport === "nba" ? [["Starting", g => g.st === 1, false], ["Off the bench", g => g.st === 0, false], ["Played 32+ minutes", g => (g.x.min || 0) >= 32, false]] : []),
    [`vs the 10 toughest matchups for ${grpName()}`, g => g.dr && g.dr <= 10, oppRank && oppRank <= 10],
    [`vs the 10 easiest matchups for ${grpName()}`, g => g.dr && g.dr >= bottom, oppRank && oppRank >= bottom],
    [sport === "ufc" ? "Won the fight" : "Team won", won, false], [sport === "ufc" ? "Lost the fight" : "Team lost", lost, false],
    ["Playoffs", g => g.post === 1, false]
  ];
  const tbl = el("table", {class:"rank-t split-t"}, el("thead", {}, el("tr", {}, ...["Situation", sport === "ufc" ? "Fights" : "Games","Avg","Hit rate"].map(h => el("th", {text:h})))));
  const tb = el("tbody");
  const allAvg = all.length ? all.reduce((s, g) => s + statOf(g, key), 0) / all.length : 0;
  S.forEach(([label, fn, now]) => {
    const list = all.filter(fn); if (!list.length) return;
    const r = hitRate(list, key, line, side), avg = list.reduce((s, g) => s + statOf(g, key), 0) / list.length;
    tb.append(el("tr", {class: now ? "now" : ""},
      el("td", {}, label, now ? el("span", {class:"wk", text: nowTag()}) : null),
      el("td", {text:list.length}),
      el("td", {}, fmt1(avg), el("small", {class: avg > allAvg * 1.08 ? "pos" : avg < allAvg * 0.92 ? "neg" : "", text:` ${avg >= allAvg ? "▲" : "▼"}`})),
      el("td", {}, el("div", {class:"hrbar"}, el("i", {style:`width:${Math.round(r.rate * 100)}%`, class:chanceClass(r.rate)}), el("span", {text:`${r.h}/${r.n - r.p} (${pct(r.rate)})`})))));
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
  const goalie = (sport === "nhl" || sport === "soc") && G === "G", pitcher = (sport === "mlb" && G !== "H") || (sport === "cri" && G === "BOWL");
  if (sport === "ufc"){   // one opponent, so: what fighters have done against him, per fight
    const panel = el("section", {class:"panel"}, el("h2", {text:`What ${ng.opp} gives up per fight`}),
      el("p", {class:"sub", text:`What his opponents have done against him, per fight (${pd.g} fight${pd.g === 1 ? "" : "s"} this year, blended with last year's), next to the ${grpName()} average.`}));
    const dl = el("div", {class:"def-row"});
    keys.forEach(k => { const f = pd.allow[k] / lg[k];
      dl.append(el("div", {}, el("span", {class:"lbl", text:C().defLabel[k] || k}), el("strong", {text: k === "win" ? pct(pd.allow[k]) : fmt1(pd.allow[k])}),
        el("small", {class: f > 1.05 ? "pos" : f < 0.95 ? "neg" : "", text:` ${signPct(f)} vs avg`}))); });
    panel.append(dl);
    return panel;
  }
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
        el("td", {class: r ? chanceClass(r.rate) : "", text: r ? `${r.h}/${r.n - r.p} (${pct(r.rate)})` : "–"})));
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
  const ch = sideChance(player, key, line, ui.side, pr);
  const ng = nextGame();
  const bet = {id: Date.now().toString(36), sport, pid: player.id, name: player.name, team: player.team, grp: grpOf(player),
    key, label: labelOf(key), desc: sideText(key, line, ui.side), line, side: ui.side, mu: pr.mu, sd: pr.sd, count: pr.count, disp: pr.disp,
    pre: ch.p, start: ng ? (ng.time && ng.time.includes("T") ? ng.time : ng.date) : null,
    opp: ng ? ng.opp : "", added: new Date().toISOString(), hist: []};
  if (sport === "mlb" && grpOf(player) === "SP"){ const po = project("outs"); bet.outsMu = po ? po.mu : 17; }
  if (tracked.some(b => b.sport === bet.sport && b.pid === bet.pid && b.key === bet.key && b.line === bet.line && b.side === bet.side && !b.result)){
    toast("You're already tracking that one."); return;
  }
  tracked.unshift(bet); saveTracked(); renderTracker(); pollSoon(0);
  toast(`Tracking ${bet.name}: ${bet.desc}.`);
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
const legResult = l => l.unsupported ? l.manual : l.result;
// what a winning ticket pays back; a bonus bet keeps only the winnings
const payoutOf = b => b.stake && b.odds ? b.stake * ((b.odds > 0 ? 1 + b.odds / 100 : 1 + 100 / -b.odds) - (b.bonus ? 1 : 0)) : null;
/* ---------- Cash-out advice ----------
   A bet is worth its chance of hitting times what it pays. A cash-out offer above that is free money; below it you're
   paying the book to take the risk off. Books build a cut into offers (usually 5-15%), so most offers sit below and
   holding is the better long-run play. The exception: a long-shot ticket that's mostly come in, where a slightly low
   offer still locks in a big profit and some people would rather take the sure thing. */
const money = v => "$" + (Math.round(v * 100) / 100).toFixed(v >= 100 ? 0 : 2);
function cashAdvice(b){
  if (b.result) return null;
  const pay = payoutOf(b), p = b.lc ? b.lc.chance : b.pre;
  if (!pay || p == null) return {verdict: "info", text: "Add your stake and odds to see what this bet is worth now and whether a cash-out offer is worth taking."};
  const fair = p * pay, cost = b.bonus ? 0 : b.stake, legs = b.type === "parlay" ? b.legs.length : 1;
  const longShot = pay >= 4 * (b.stake || 1) || legs >= 3;
  const offer = Number(b.offer) || 0;
  if (!offer){
    if (p >= 0.9) return {verdict: "hold", fair, text: `Worth about ${money(fair)} now (${pct(p)} to pay ${money(pay)}). It's very likely to hit, so hold unless an offer is at least ${money(fair)}.`};
    return {verdict: "info", fair, text: `Worth about ${money(fair)} now (${pct(p)} to pay ${money(pay)}). Cashing out is smart only if the book offers at least that; enter the offer to check.`};
  }
  const gap = fair - offer, profit = offer - cost;
  if (offer >= fair) return {verdict: "cash", fair, text: `Cash out: the ${money(offer)} offer beats the ${money(fair)} the bet is worth at ${pct(p)}.`};
  if (offer >= 0.92 * fair && longShot && profit > 0)
    return {verdict: "close", fair, text: `Close call: taking ${money(offer)} gives up ${money(gap)} of value but locks in ${money(profit)} profit. Hold for the best long-run return; cash out if the sure money matters more to you.`};
  return {verdict: "hold", fair, text: `Hold: the ${money(offer)} offer is ${money(gap)} under the ${money(fair)} this bet is worth at ${pct(p)}.`};
}
function cashBox(b){
  const a = cashAdvice(b); if (!a) return null;
  const save = () => { const was = b.cashWas; b.cashWas = cashAdvice(b).verdict; saveTracked(); renderTracker();
    if (b.cashWas === "cash" && was !== "cash") alertCash(b); };
  const field = (label, key, ph) => el("label", {class:"cash-f"}, el("span", {text: label}),
    el("input", {type:"number", inputmode:"decimal", step:"any", placeholder: ph, value: b[key] ?? "", "aria-label": label,
      oninput: e => { b[key] = e.target.value === "" ? null : Number(e.target.value); if (key === "offer") b.offerAt = Date.now(); saveTracked(); },
      onchange: save, onblur: () => setTimeout(renderTracker, 0)}));
  const fields = [];
  if (b.type !== "parlay" || b.stake == null || b.odds == null || b.manualPay){
    b.manualPay = true;
    fields.push(field("Stake $", "stake", "10"), field("Odds", "odds", "-110"));
  }
  fields.push(field("Cash-out offer $", "offer", a.fair ? a.fair.toFixed(2) : ""));
  const stale = b.offer && b.offerAt && Date.now() - b.offerAt > 5 * 60e3 && b.live && b.live.state === "live";
  return el("div", {class:`cash cash-${a.verdict}`},
    el("p", {class:"cash-t", text: a.text + (stale ? " Offers move with every play, so update the offer before you decide." : "")}),
    el("div", {class:"cash-in"}, ...fields));
}
function alertCash(b){
  const msg = `Cash-out check: the offer on ${b.type === "parlay" ? "your parlay" : b.name + " " + (b.desc || "")} is now worth taking.`;
  toast(msg); try { if ("Notification" in window && Notification.permission === "granted") new Notification("Trade Scale", {body: msg}); } catch(e){}
}
const MARKET_LABEL = {ml: "Moneyline", spread: "Spread", total: "Game total", teamtotal: "Team total"};
const signed = v => (v > 0 ? "+" : "") + v;
function legText(l){
  if (l.unsupported) return l.text;
  if (l.kind !== "team") return l.desc ? `${l.name}: ${l.desc}` : `${l.name} ${l.side} ${l.line} ${l.label}`;
  if (l.market === "ml") return `${l.team.name} moneyline`;
  if (l.market === "spread") return `${l.team.name} ${l.line ? signed(l.line) : "pick'em"}`;
  if (l.market === "teamtotal") return `${l.team.name} team total ${l.side} ${l.line}`;
  return `${l.team.nick}${l.opp ? " / " + l.opp.nick : ""} ${l.side} ${l.line}`;
}
function teamNow(l){
  const L = l.live || {}, r = legResult(l);
  const score = L.score && (L.state === "live" || L.state === "final") ? `${L.me || l.team.abbr} ${L.score[0]}–${L.score[1]} ${L.opp || ""}` : "";
  if (r) return score || (r === "won" ? "hit" : r === "lost" ? "missed" : "push");
  if (L.state === "live" && l.lc) return `${score}, ${L.detail || "live"}, ${pct(l.lc.chance)}`;
  return `${pct(l.pre)} pre-game`;
}
function parlayRow(b){
  const live = b.live && b.live.state === "live", ch = b.lc ? b.lc.chance : b.pre;
  const won = b.legs.filter(l => legResult(l) === "won").length;
  const legsUl = el("ul", {class:"plegs"});
  b.legs.forEach(l => {
    const r = legResult(l);
    const icon = r === "won" ? "✓" : r === "lost" ? "✕" : r === "push" ? "=" : l.live && l.live.state === "live" ? "●" : "○";
    const now = l.unsupported ? `${pct(l.p)} (your estimate)` : l.kind === "team" ? teamNow(l)
      : l.lc && !r ? `${fmt1(l.lc.cur)} of ${l.line}, ${pct(l.lc.chance)}` : l.lc ? `${fmt1(l.lc.cur)}` : `${pct(l.pre)} pre-game`;
    const li = el("li", {class: r ? "r-" + r : ""}, el("span", {class:"ic", text:icon}),
      el("span", {class:"pl-txt", text: legText(l)}), el("small", {text:now}));
    if (l.unsupported && !b.result) li.append(el("span", {class:"bar-row"},
      el("button", {class:"btn tiny", text:"Hit", onclick: () => { l.manual = "won"; updateParlay(b).then(() => { saveTracked(); renderTracker(); }); }}),
      el("button", {class:"btn tiny", text:"Miss", onclick: () => { l.manual = "lost"; updateParlay(b).then(() => { saveTracked(); renderTracker(); }); }})));
    legsUl.append(li);
  });
  const payout = payoutOf(b);
  return el("li", {class:`trk parlay ${b.result ? "res-" + b.result : live ? "is-live" : ""}`},
    el("div", {class:"trk-main"},
      el("div", {class:"trk-name"}, el("strong", {text: b.legs.length === 1 ? "Single bet" : `${b.legs.length}-leg parlay`}), b.odds != null ? el("span", {class:"tag", text:(b.odds > 0 ? "+" : "") + b.odds}) : null,
        payout ? el("span", {class:"split", text: b.bonus ? `$${b.stake} bonus bet to win $${payout.toFixed(2)}` : `$${b.stake} to pay $${payout.toFixed(2)}`}) : null),
      el("div", {class:"trk-status"}, live && !b.result ? el("span", {class:"dot"}) : null,
        b.result ? (b.result === "won" ? "Won" : "Lost") : `${won} of ${b.legs.length} legs in${live ? ", games live" : b.start ? ", first game " + startText(b) : ""}`),
      legsUl,
      cashBox(b)),
    el("div", {class:"trk-num"}, el("span", {class:"num " + (b.result ? "" : chanceClass(ch)), text: b.result ? (b.result === "won" ? "✓" : "✕") : pct(ch)}),
      el("small", {text: b.result ? `pre-game ${pct(b.pre)}` : `was ${pct(b.pre)} pre-game`}), spark(b.hist)),
    el("button", {class:"x", text:"×", "aria-label":"Stop tracking this parlay", onclick: () => { tracked = tracked.filter(t => t.id !== b.id); saveTracked(); renderTracker(); }}));
}
function liveRow(b){
  if (b.type === "parlay") return parlayRow(b);
  const L = b.live || {}, ch = b.lc;
  const status = b.result ? (b.result === "won" ? "Won" : b.result === "lost" ? "Lost" : "Push")
    : L.state === "live" ? `Live, ${L.detail || ""}` : L.state === "final" ? "Final" : startText(b);
  const score = L.score && L.state !== "pre" ? `${b.team} ${L.score[0]}–${L.score[1]} ${L.opp || ""}` : "";
  const cur = ch ? ch.cur : null, pctToLine = cur == null ? 0 : Math.min(1, cur / Math.max(b.line, 0.5));
  const row = el("li", {class:`trk ${b.result ? "res-" + b.result : L.state === "live" ? "is-live" : ""}`},
    el("div", {class:"trk-main"},
      el("div", {class:"trk-name"}, el("strong", {text:b.name}), el("span", {class:"tag", text:sportLabel(b.sport)})),
      el("div", {class:"trk-prop", text: b.desc || `${b.side === "over" ? "Over" : "Under"} ${b.line} ${b.label}`}),
      el("div", {class:"trk-status"}, L.state === "live" && !b.result ? el("span", {class:"dot"}) : null, status, score ? el("span", {class:"split", text:"  " + score}) : null),
      cur != null ? el("div", {class:"trk-prog"}, el("div", {class:"bar"}, el("i", {style:`width:${Math.round(pctToLine * 100)}%`})),
        el("span", {text:`${fmt1(cur)} of ${b.line}${ch && ch.approx ? " (approx.)" : ""}`})) : null,
      L.inBox === false && L.state === "live" ? el("small", {class:"split", text:"Not in the box score yet."}) : null,
      cashBox(b)),
    el("div", {class:"trk-num"},
      el("span", {class:"num " + (b.result ? "" : chanceClass(ch ? ch.chance : b.pre)), text: b.result ? (b.result === "won" ? "✓" : b.result === "lost" ? "✕" : "=") : ch ? pct(ch.chance) : pct(b.pre)}),
      el("small", {text: ch && !b.result ? `was ${pct(b.pre)} pre-game` : b.result ? `pre-game ${pct(b.pre)}` : "pre-game chance"}),
      spark(b.hist)),
    el("button", {class:"x", text:"×", "aria-label":`Stop tracking ${b.name}`, onclick: () => { tracked = tracked.filter(t => t.id !== b.id); saveTracked(); renderTracker(); }}));
  return row;
}
function renderTracker(){
  const host = $("tracker"); if (!host) return;
  if (host.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;   // don't wipe a number mid-typing; blur redraws
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
    el("p", {class:"sub", text:"Live chances update every 30 seconds while a game is on. They start from the pre-game projection and lean more on tonight's pace as the game goes on. Each bet also shows what it's worth right now (its live chance times the payout): a cash-out offer above that is worth taking, one below it usually isn't."}));
  const ul = el("ul", {class:"trk-list"});
  tracked.forEach(b => ul.append(liveRow(b)));
  host.append(ul);
}
async function updateParlay(b){
  if (b.result) return;
  await Promise.all(b.legs.filter(l => !l.unsupported).map(l => l.kind === "team" ? updateTeamLeg(l) : updateBet(l)));
  const ps = b.legs.map(l => { const r = legResult(l); return r === "won" || r === "push" ? 1 : r === "lost" ? 0 : l.unsupported ? l.p : l.lc ? l.lc.chance : l.pre; });
  const chance = ps.reduce((a, v) => a * v, 1);
  const lost = b.legs.some(l => legResult(l) === "lost");
  const allWon = b.legs.every(l => legResult(l) === "won" || legResult(l) === "push") && b.legs.some(l => legResult(l) === "won");
  const was = b.result;
  b.lc = {chance}; b.result = lost ? "lost" : allWon ? "won" : null;
  const anyLive = b.legs.some(l => l.live && l.live.state === "live");
  if (anyLive || !b.hist.length || b.hist[b.hist.length - 1][1] !== chance){ b.hist.push([Date.now(), chance]); if (b.hist.length > 150) b.hist.splice(0, b.hist.length - 150); }
  b.live = {state: anyLive ? "live" : b.legs.every(l => l.unsupported || legResult(l) || (l.live && l.live.state === "final")) ? "final" : "pre"};
  if (b.result && b.result !== was){
    const pay = payoutOf(b);
    const msg = `Your ${b.legs.length === 1 ? "bet" : b.legs.length + "-leg parlay"} ${b.result === "won" ? "hit" : "missed"}${b.result === "won" && pay ? `: $${pay.toFixed(2)}` : ""}.`;
    toast(msg); try { if ("Notification" in window && Notification.permission === "granted") new Notification("Trade Scale", {body: msg}); } catch(e){}
  }
}
async function updateTeamLeg(l){
  if (l.result && l.live && l.live.state === "final") return;
  try {
    const L = await LIVE.teamLive(l.sport, l.team);
    if (L.state === "none" && l.result) return;      // yesterday's game is off today's scoreboard; keep how it ended
    l.live = L;
    if (L.state === "live" || L.state === "final"){
      const ch = LIVE.teamChance(l, L);
      l.lc = ch; l.result = ch.result;
    }
  } catch(e){ l.live = Object.assign(l.live || {}, {error: "Couldn't reach live scores"}); }
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
  const msg = `${b.name} ${b.desc || `${b.side} ${b.line} ${b.label}`}: ${ch.result === "won" ? "hit" : ch.result === "lost" ? "missed" : "push"} (${fmt1(ch.cur)})`;
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
      ch ? el("div", {class:"lc-num"}, el("span", {class:"num " + (ch.result ? "" : chanceClass(ch.chance)), text: ch.result ? (ch.result === "won" ? "Hit" : ch.result === "lost" ? "Missed" : "Push") : pct(ch.chance)}),
        el("small", {text: ch.result ? `${fmt1(ch.cur)} ${labelOf(ui.stat)}` : `live chance of ${ui.side} ${ui.line}`})) : null),
    ch ? el("div", {class:"trk-prog", style:"margin-top:10px"}, el("div", {class:"bar"}, el("i", {style:`width:${Math.round(Math.min(1, ch.cur / Math.max(bet.line, 0.5)) * 100)}%`})),
      el("span", {text:`${fmt1(ch.cur)} ${labelOf(ui.stat)} so far, line ${ui.line}${ch.f > 0 ? `, about ${Math.round(ch.f * 100)}% of the game left` : ""}${ch.approx ? " (total bases approximate)" : ""}`}))
      : el("p", {class:"sub", style:"margin:8px 0 0", text: L.inBox === false ? "He isn't in the box score yet." : "No stats for him yet."})));
}

// one loop drives both the tracker and the open player's live card
async function poll(){
  clearTimeout(liveTimer);
  if (document.hidden){ liveTimer = setTimeout(poll, 60000); return; }
  await Promise.all(tracked.filter(b => b.type === "parlay" ? !b.result : !(b.result && b.live && b.live.state === "final")).map(b => b.type === "parlay" ? updateParlay(b) : updateBet(b)));
  tracked.forEach(b => { const a = cashAdvice(b), v = a && a.verdict; if (v === "cash" && b.cashWas !== "cash") alertCash(b); b.cashWas = v; });
  saveTracked(); renderTracker();
  await refreshPlayerLive();
  const live = tracked.some(b => b.live && b.live.state === "live") || (liveHost && liveHost.querySelector(".is-live"));
  const soon = tracked.some(b => !b.result && b.start && new Date(b.start.length > 10 ? b.start : b.start + "T00:00:00") - Date.now() < 3 * 3600e3);
  if (tracked.some(b => b.type === "parlay" && b.live && b.live.state === "live")) { liveTimer = setTimeout(poll, 30000); return; }
  liveTimer = setTimeout(poll, live ? 30000 : soon ? 120000 : 600000);
}
function pollSoon(ms){ clearTimeout(liveTimer); liveTimer = setTimeout(poll, ms); }
document.addEventListener("visibilitychange", () => { if (!document.hidden) pollSoon(0); });

/* ---------- Bet slips: upload or paste, model every leg, track the parlay ---------- */
const sportData = {}, playerDocs = {};
async function loadSportData(sp){
  if (!sportData[sp]) sportData[sp] = Promise.all([getJSON(`data/props/${sp}/index.json`), getJSON(`data/props/${sp}/defense.json`)])
    .then(([i, d]) => ({index: i, defense: d})).catch(e => { delete sportData[sp]; throw e; });
  return sportData[sp];
}
async function loadPlayerDoc(sp, pid){
  const k = sp + ":" + pid;
  if (!playerDocs[k]) playerDocs[k] = getJSON(`data/props/${sp}/p/${pid}.json`).catch(e => { delete playerDocs[k]; throw e; });
  return playerDocs[k];
}
// run the projection for any player in any sport by briefly pointing the model at that player's data
function withPlayer(ctx, fn){
  const saved = [sport, index, defense, player];
  sport = ctx.sport; index = ctx.index; defense = ctx.defense; player = ctx.player;
  try { return fn(); } finally { [sport, index, defense, player] = saved; }
}
// a typical two-way market carries about a 4.5% cut; take it out so the chance is the book's honest read
const fairFromOdds = o => { const p = implied(o); return p == null ? null : Math.min(0.97, p / 1.045); };
async function modelTeamLeg(leg){
  // college: the game model, against this leg's own line
  let model = null;
  if (isGameSport(leg.sport)){
    try {
      const d = await loadGames(leg.sport), f = collegeGame(d, leg.team);
      if (f){
        const g = f.g;
        leg.team = legTeam(teamInfo(d, f.abbr)); leg.opp = legTeam(teamInfo(d, f.home ? g.away : g.home));
        leg.start = g.start || null; leg.gameKey = leg.sport + ":" + g.id;
        model = gameChance(d, g, {market: leg.market, home: f.home, line: leg.line, side: leg.side || "over"});
      }
    } catch(e){}
  }
  leg.model = model != null;
  // a prediction-market price ("57%") is already the market's chance, with no vig to take out
  leg.p = leg.mine != null ? leg.mine : model != null ? model : leg.price != null ? leg.price : leg.odds != null ? fairFromOdds(leg.odds) : null;
  if (leg.start === undefined){
    leg.start = null;
    try {
      const L = await LIVE.teamLive(leg.sport, leg.team);
      if (L.state !== "none"){ leg.start = L.date || null; if (!leg.opp && L.opp) leg.opp = {abbr: L.opp, nick: L.opp, name: L.opp}; leg.gameKey = leg.sport + ":" + L.gameId; }
    } catch(e){}
  }
  return leg;
}
async function modelLeg(leg){
  if (leg.unsupported) return leg;
  if (leg.kind === "team") return modelTeamLeg(leg);
  try {
    const [sd, doc] = await Promise.all([loadSportData(leg.sport), loadPlayerDoc(leg.sport, leg.pid)]);
    const ctx = {sport: leg.sport, index: sd.index, defense: sd.defense, player: doc};
    withPlayer(ctx, () => {
      const props = CFG[leg.sport].props[grpOf(doc)] || Object.values(CFG[leg.sport].props)[0];
      leg.grp = grpOf(doc); leg.props = props;
      if (!leg.key || !props.some(p => p[0] === leg.key)) leg.key = leg.key && props.some(p => p[0] === leg.key) ? leg.key : null;
      if (leg.key == null){ leg.p = null; return; }
      if (leg.line == null) leg.line = defaultLine(leg.key);
      const pr = project(leg.key);
      if (!pr){ leg.p = null; leg.note = "Not enough games to model"; return; }
      leg.p = sideChance(doc, leg.key, leg.line, leg.side, pr, leg.sport).p;
      leg.label = labelOf(leg.key); leg.desc = sideText(leg.key, leg.line, leg.side);
      Object.assign(leg, {mu: pr.mu, sd: pr.sd, count: pr.count, disp: pr.disp, pre: leg.p, team: doc.team, name: doc.name});
      if (leg.sport === "mlb" && leg.grp === "SP"){ const po = project("outs"); leg.outsMu = po ? po.mu : 17; }
      const ng = nextGame();
      leg.start = ng ? (ng.time && ng.time.includes("T") ? ng.time : ng.date) : null; leg.opp = ng ? ng.opp : ""; leg.gameKey = ng ? [doc.team, ng.opp].sort().join("-") + ng.date : null;
    });
  } catch(e){ leg.p = null; leg.note = "Couldn't load this player's data"; }
  return leg;
}

let slip = {open: false, legs: [], odds: null, stake: null, busy: "", idx: null};
async function slipIndex(){
  if (slip.idx) return slip.idx;
  const all = [];
  const active = {};
  await Promise.all(SPORTS.map(async ([sp]) => {
    if (isGameSport(sp)){
      // college bets are game lines: teach the reader every school and note who plays soon (football or basketball)
      try { const d = await loadGames(sp); SLIP.setTeams(sp, d.teams); active[sp] = new Set(d.games.flatMap(g => [g.home, g.away])); } catch(e){}
      return;
    }
    try { const d = await loadSportData(sp); d.index.players.forEach(r => all.push({sport: sp, pid: r[0], name: r[1], team: r[2], grp: sp === "nba" ? null : r[3]})); } catch(e){}
  }));
  // a name in two leagues (a rookie who just left college) reads as the pro league first
  const rank = sp => SPORTS.findIndex(s => s[0] === sp);
  all.sort((a, b) => rank(a.sport) - rank(b.sport));
  slip.idx = SLIP.buildIndex(all);
  slip.idx.opts = {active: tm => active[tm.sport] ? active[tm.sport].has(tm.abbr) : undefined};
  return slip.idx;
}
async function readSlipText(text){
  slip.busy = "Reading the slip..."; renderSlip();
  const idx = await slipIndex();
  const r = SLIP.parse(text, idx, idx.opts);
  if (!r.legs.length){ slip.busy = ""; slip.msg = "Couldn't find any legs. Try pasting the text, or add legs below one at a time."; renderSlip(); return; }
  slip.legs.push(...r.legs);
  if (r.odds != null){ slip.odds = r.odds; slip.oddsFrom = r.oddsFrom; }
  if (r.stake != null){ slip.stake = r.stake; slip.bonus = r.bonus; }
  slip.busy = "Modeling each leg..."; renderSlip();
  await Promise.all(slip.legs.map(modelLeg));
  slip.busy = ""; slip.msg = ""; renderSlip();
}

// OCR in the browser with Tesseract.js (loaded only when someone uploads a screenshot)
const OCR_SRC = window.TS_OCR_SRC || "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
function loadScript(src){ return new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error("load")); document.head.append(sc); }); }
async function prepImage(file){
  const img = await createImageBitmap(file);
  const scale = img.width < 1100 ? 2 : 1;
  const c = document.createElement("canvas"); c.width = img.width * scale; c.height = img.height * scale;
  const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  let sum = 0; for (let i = 0; i < px.length; i += 4) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const dark = sum / (px.length / 4) < 128;   // dark-mode slips read much better inverted
  for (let i = 0; i < px.length; i += 4){
    let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (dark) y = 255 - y;
    y = y < 150 ? Math.max(0, y - 40) : Math.min(255, y + 40);   // push text and background apart
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  g.putImageData(d, 0, 0);
  return c;
}
async function readScreenshot(file){
  try {
    slip.busy = "Loading the text reader (first time only)..."; renderSlip();
    if (!window.Tesseract) await loadScript(OCR_SRC);
    const canvas = await prepImage(file);
    slip.busy = "Reading your screenshot..."; renderSlip();
    const worker = await Tesseract.createWorker("eng", 1, window.TS_OCR_OPTS || {});
    const {data} = await worker.recognize(canvas);
    await worker.terminate();
    slip.lastText = data.text;
    await readSlipText(data.text);
  } catch(e){
    slip.busy = ""; slip.msg = "Couldn't read that image. Try a tighter screenshot of just the bet slip, or paste the text instead."; renderSlip();
  }
}

const parlayChance = legs => legs.reduce((p, l) => p * (l.unsupported ? (l.p != null ? l.p : 1) : (l.p != null ? l.p : 1)), 1);
function renderSlip(){
  const host = $("slip"); if (!host) return;
  host.innerHTML = "";
  if (!slip.open){
    host.append(el("div", {class:"bar-row", style:"justify-content:space-between"},
      el("div", {}, el("h2", {text:"Check a bet slip", style:"margin:0"}), el("p", {class:"sub", style:"margin:4px 0 0", text:"Upload a screenshot from DraftKings, FanDuel, or any book, or paste the legs. You'll get each leg's chance and the parlay's."})),
      el("button", {class:"btn primary", text:"Check a slip", onclick: () => { slip.open = true; renderSlip(); }})));
    return;
  }
  host.append(el("div", {class:"bar-row", style:"justify-content:space-between"}, el("h2", {text:"Check a bet slip", style:"margin:0"}),
    el("button", {class:"btn", text:"Close", onclick: () => { slip = {open:false, legs:[], odds:null, stake:null, bonus:false, busy:"", idx: slip.idx}; renderSlip(); }})));

  // inputs
  const file = el("input", {type:"file", accept:"image/*", "aria-label":"Bet slip screenshot", class:"file-in"});
  file.onchange = () => { if (file.files[0]) readScreenshot(file.files[0]); };
  const drop = el("label", {class:"drop"}, file, el("strong", {text:"Upload a screenshot"}), el("small", {text:"Read on your device. Nothing is sent anywhere."}));
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) readScreenshot(f); };
  const ta = el("textarea", {class:"slip-ta", placeholder:"Or paste the slip, or type legs, one per line:\nJosh Allen over 249.5 passing yards\nJames Cook anytime TD\nNikola Jokic 25+ points", "aria-label":"Bet slip text"});
  const go = el("button", {class:"btn primary", text:"Read these legs", onclick: () => { if (ta.value.trim()) readSlipText(ta.value); }});
  host.append(el("div", {class:"slip-in"}, drop, el("div", {class:"slip-paste"}, ta, el("div", {class:"actions", style:"justify-content:flex-start;margin-top:8px"}, go))));
  if (slip.busy) host.append(el("p", {class:"sub", text:slip.busy}));
  if (slip.msg) host.append(el("p", {class:"err", text:slip.msg}));
  if (!slip.legs.length) return;

  // legs
  const ul = el("ul", {class:"legs"});
  slip.legs.forEach((leg, i) => {
    const rm = el("button", {class:"x", text:"×", "aria-label":"Remove leg", onclick: () => { slip.legs.splice(i, 1); renderSlip(); }});
    if (leg.unsupported){
      const pin = el("input", {type:"number", min:1, max:99, class:"odds-in", placeholder:"%", value: leg.p != null ? Math.round(leg.p * 100) : "", "aria-label":"Your chance for this leg"});
      pin.onchange = () => { const v = Number(pin.value); leg.p = v > 0 && v < 100 ? v / 100 : null; renderSlip(); };
      if (leg.p == null && leg.odds != null){ leg.p = implied(leg.odds); pin.value = Math.round(leg.p * 100); }
      ul.append(el("li", {class:"leg unsup"}, el("div", {}, el("strong", {text:leg.text}),
        el("small", {text:"I couldn't tell which team or player this is. Enter your own chance" + (leg.odds != null ? " (filled in from the leg's odds)" : "") + ", or leave blank to skip it."})),
        el("label", {class:"field"}, "Chance", pin), rm));
      return;
    }
    if (leg.kind === "team"){ ul.append(teamLegRow(leg, rm)); return; }
    const sel = el("select", {class:"inline", "aria-label":"Prop"});
    sel.append(el("option", {value:"", text:"Pick the prop..."}));
    (leg.props || []).forEach(([k, l]) => sel.append(el("option", {value:k, text:l, selected: k === leg.key ? "" : false})));
    sel.onchange = async () => { leg.key = sel.value || null; leg.line = null; await modelLeg(leg); renderSlip(); };
    const lin = el("input", {type:"number", step:"0.5", min:"0", value: leg.line ?? "", class:"line-in sm", "aria-label":"Line"});
    lin.onchange = async () => { leg.line = Number(lin.value); await modelLeg(leg); renderSlip(); };
    const yn = leg.key && leg.line != null && leg.line < 1 && withSport(leg.sport, () => isBinary(leg.key));
    const side = el("span", {class:"seg"}, ...["over","under"].map(sd => el("button", {text: yn ? (sd === "over" ? "Yes" : "No") : sd === "over" ? "Over" : "Under", "aria-pressed": String(leg.side === sd),
      onclick: async () => { leg.side = sd; await modelLeg(leg); renderSlip(); }})));
    const pct1 = leg.p != null ? pct(leg.p) : "–";
    ul.append(el("li", {class:"leg"},
      el("div", {}, el("strong", {text:leg.name}), el("span", {class:"tag", text:sportLabel(leg.sport)}),
        el("small", {text:` ${leg.team || ""}${leg.opp ? " vs " + leg.opp : ""}${leg.note ? ". " + leg.note : ""}${!leg.sure ? ". Check this one, I wasn't sure I read it right" : ""}`})),
      el("div", {class:"leg-ctl"}, sel, lin, side),
      el("div", {class:"leg-p"}, el("span", {class:"num " + chanceClass(leg.p), text:pct1}), el("small", {text: leg.odds != null ? `book ${pct(implied(leg.odds))}` : "model"})),
      rm));
  });
  host.append(ul);

  // add a leg by typing
  const add = el("input", {type:"text", class:"add-leg", placeholder:"Add a leg: e.g. McDavid over 3.5 shots", "aria-label":"Add a leg"});
  add.onkeydown = e => { if (e.key === "Enter" && add.value.trim()){ const v = add.value; add.value = ""; readSlipText(v); } };
  host.append(add);

  // the parlay
  const modeled = slip.legs.filter(l => l.p != null);
  const skipped = slip.legs.length - modeled.length;
  const pAll = parlayChance(modeled);
  const oddsIn = el("input", {type:"text", inputmode:"numeric", class:"odds-in", value: slip.odds != null ? (slip.odds > 0 ? "+" + slip.odds : slip.odds) : "", placeholder:"+650", "aria-label":"Slip odds"});
  oddsIn.onchange = () => { const n = Number(oddsIn.value); slip.odds = Math.abs(n) >= 100 ? n : null; slip.oddsFrom = "you"; renderSlip(); };
  const book = slip.odds != null ? implied(slip.odds) : null;
  const games = {}; slip.legs.forEach(l => { if (l.gameKey) games[l.gameKey] = (games[l.gameKey] || 0) + 1; });
  const sameGame = Object.values(games).some(n => n > 1);
  const weakest = [...modeled].sort((a, b) => a.p - b.p)[0];
  const sum = el("div", {class:"verdict-row"},
    el("div", {class:"big"}, el("span", {class:"num " + (modeled.length ? chanceClass(pAll) : ""), text: modeled.length ? pct(pAll) : "–"}),
      el("span", {class:"cap", text:`${modeled.some(l => !l.kind && !l.unsupported) ? "model chance" : "chance"} all ${modeled.length} leg${modeled.length === 1 ? "" : "s"} hit${skipped ? ` (${skipped} skipped)` : ""}`})),
    el("div", {class:"facts"},
      el("div", {}, el("span", {class:"lbl", text:"Slip odds"}), oddsIn),
      book != null ? el("div", {}, el("span", {class:"lbl", text:"Book implies"}), el("strong", {text:pct(book)})) : null,
      book != null && modeled.length ? el("div", {}, el("span", {class:"lbl", text:"Edge"}), el("strong", {class: pAll - book >= 0.02 ? "pos" : pAll - book <= -0.02 ? "neg" : "", text:(pAll >= book ? "+" : "") + (Math.round((pAll - book) * 1000) / 10) + " pts"})) : null,
      el("div", {}, el("span", {class:"lbl", text:"Fair odds"}), el("strong", {text: modeled.length ? toAmerican(pAll) : "–"})),
      slip.stake ? el("div", {}, el("span", {class:"lbl", text: slip.bonus ? "Bonus bet" : "Stake"}), el("strong", {text:"$" + slip.stake})) : null));
  host.append(sum);
  // which app pays the most for these legs (player props the morning's odds cover; game legs aren't matched here)
  const propLegsIn = slip.legs.filter(l => !l.kind && !l.unsupported && l.key && l.line != null);
  const slipBooks = propLegsIn.length === slip.legs.length ? parlayBooks(propLegsIn.map(l => ({offers: propOffers(l.sport, l),
    text: line => `${l.name} ${pickText(line != null ? {...l, line} : l, l.sport)}`})), sameGame) : null;
  if (slipBooks) host.append(slipBooks);
  const notes = [];
  if (weakest && modeled.length > 1) notes.push(`Weakest leg: ${legText(weakest)} at ${pct(weakest.p)}.`);
  if (slip.odds != null && slip.oddsFrom === "legs") notes.push("Slip odds are the legs' odds multiplied. If your book shows different odds for the whole slip, type them in.");
  if (sameGame) notes.push("Some legs are from the same game. Those tend to move together (a big passing day helps the QB and his receivers), so the real chance can be higher or lower than legs multiplied together, and books price same-game parlays with that in mind.");
  if (book != null && modeled.length) notes.push(pAll < book ? "The model thinks this slip is less likely than the book's price, which is normal for parlays: the book's cut compounds with every leg." : "The model rates this slip above the book's price.");
  notes.forEach(n => host.append(el("p", {class:"why", text:n})));
  host.append(el("div", {class:"actions", style:"justify-content:flex-start"},
    el("button", {class:"btn primary", text: slip.legs.length > 1 ? "Track this parlay" : "Track this bet", disabled: modeled.length ? false : "", onclick: trackSlip}),
    el("button", {class:"btn", text:"Start over", onclick: () => { slip.legs = []; slip.odds = null; slip.stake = null; slip.bonus = false; slip.msg = ""; renderSlip(); }})));
}
function teamLegRow(leg, rm){
  const redo = async () => { await modelLeg(leg); renderSlip(); };
  const mk = el("select", {class:"inline", "aria-label":"Bet type"});
  Object.entries(MARKET_LABEL).forEach(([k, l]) => mk.append(el("option", {value:k, text:l, selected: k === leg.market ? "" : false})));
  mk.onchange = () => { leg.market = mk.value; if (leg.market === "ml") leg.line = null; if (/total/.test(leg.market) && !leg.side) leg.side = "over"; redo(); };
  const ctl = el("div", {class:"leg-ctl"}, mk);
  if (leg.market !== "ml"){
    const lin = el("input", {type:"number", step:"0.5", value: leg.line ?? "", class:"line-in sm", "aria-label":"Line", placeholder: leg.market === "spread" ? "-1.5" : "6.5"});
    lin.onchange = () => { leg.line = lin.value === "" ? null : Number(lin.value); redo(); };
    ctl.append(lin);
  }
  if (/total/.test(leg.market)) ctl.append(el("span", {class:"seg"}, ...["over","under"].map(sd => el("button", {text: sd === "over" ? "Over" : "Under", "aria-pressed": String(leg.side === sd),
    onclick: () => { leg.side = sd; redo(); }}))));
  const oddsIn = el("input", {type:"text", inputmode:"numeric", class:"odds-in", value: leg.odds != null ? signed(leg.odds) : "", placeholder:"odds", "aria-label":"Leg odds"});
  oddsIn.onchange = () => { const n = Number(oddsIn.value); leg.odds = Math.abs(n) >= 100 ? n : null; leg.mine = null; redo(); };
  const mine = el("input", {type:"number", min:1, max:99, class:"odds-in", placeholder:"%", value: leg.mine != null ? Math.round(leg.mine * 100) : "", "aria-label":"Your own chance for this leg"});
  mine.onchange = () => { const v = Number(mine.value); leg.mine = mine.value !== "" && v > 0 && v < 100 ? v / 100 : null; redo(); };
  ctl.append(oddsIn, mine);
  // names more than one league uses ("Jets", "Kings"): let them switch if the guess was wrong
  let sportPick = null;
  if (leg.alts && leg.alts.length){
    sportPick = el("select", {class:"inline", "aria-label":"League"});
    [{sport: leg.sport, team: leg.team}, ...leg.alts].forEach((a, k) => sportPick.append(el("option", {value: k, text: `${sportLabel(a.sport)}: ${a.team.name}`})));
    sportPick.onchange = () => {
      const all = [{sport: leg.sport, team: leg.team}, ...leg.alts], pickd = all[Number(sportPick.value)];
      leg.alts = all.filter(a => a !== pickd); leg.sport = pickd.sport; leg.team = pickd.team; leg.opp = null; leg.start = undefined; redo();
    };
    ctl.append(sportPick);
  }
  const where = leg.opp ? (leg.market === "total" ? ` ${leg.team.nick} vs ${leg.opp.nick}` : ` vs ${leg.opp.name}`) : "";
  const from = leg.mine != null ? "your estimate" : leg.model ? "college game model" : leg.odds != null ? `from ${signed(leg.odds)}, minus the book's cut` : "add odds or your %";
  return el("li", {class:"leg"},
    el("div", {}, el("strong", {text: legText(leg)}), el("span", {class:"tag", text:sportLabel(leg.sport)}),
      el("small", {text:`${where.trim()}${!leg.sure ? `${where ? ". " : ""}Check this one, I wasn't sure I read it right` : ""}`})),
    ctl,
    el("div", {class:"leg-p"}, el("span", {class:"num " + chanceClass(leg.p), text: leg.p != null ? pct(leg.p) : "–"}), el("small", {text: from})),
    rm);
}
function trackSlip(){
  const legs = slip.legs.filter(l => l.p != null).map(l => l.unsupported
    ? {unsupported: true, text: l.text, p: l.p, pre: l.p, manual: null}
    : l.kind === "team"
    ? {kind: "team", sport: l.sport, market: l.market, team: l.team, opp: l.opp, line: l.line, side: l.side, odds: l.odds, price: l.price, pre: l.p, start: l.start}
    : {sport: l.sport, pid: l.pid, name: l.name, team: l.team, grp: l.grp, key: l.key, label: l.label, desc: l.desc, line: l.line, side: l.side,
       mu: l.mu, sd: l.sd, count: l.count, disp: l.disp, pre: l.p, outsMu: l.outsMu, start: l.start, opp: l.opp, hist: []});
  if (!legs.length) return;
  const bet = legs.length === 1 && !legs[0].unsupported && legs[0].kind !== "team"
    ? {...legs[0], id: Date.now().toString(36), sport: legs[0].sport, odds: slip.odds, stake: slip.stake, added: new Date().toISOString()}
    : {id: Date.now().toString(36), type: "parlay", legs, odds: slip.odds, stake: slip.stake, bonus: !!slip.bonus, pre: parlayChance(legs.map(l => ({...l, p: l.pre}))),
       start: legs.map(l => l.start).filter(Boolean).sort()[0] || null, added: new Date().toISOString(), hist: []};
  tracked.unshift(bet); saveTracked(); renderTracker(); pollSoon(0);
  toast(bet.type !== "parlay" ? `Tracking ${bet.name}.` : legs.length === 1 ? `Tracking ${legText(legs[0])}.` : `Tracking your ${legs.length}-leg parlay.`);
  slip = {open:false, legs:[], odds:null, stake:null, bonus:false, busy:"", idx: slip.idx}; renderSlip();
  $("tracker").scrollIntoView({behavior:"smooth", block:"start"});
}

/* ---------- Boot ---------- */
let hashTeam = null;
function readHash(){
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get("sp") && (CFG[h.get("sp")] || isGameSport(h.get("sp")))) sport = h.get("sp");
  if (h.get("s")) ui.stat = h.get("s");
  if (h.get("l")) ui.line = Number(h.get("l"));
  if (h.get("side") === "under") ui.side = "under";
  hashTeam = h.get("team");
  return h.get("p");
}
function renderSports(){
  const nav = $("sports"); if (!nav) return; nav.innerHTML = "";
  SPORTS.forEach(([id, label]) => nav.append(el("button", {text:label, "data-sport":id, "aria-pressed": String(sport === id), onclick: () => {
    if (id !== sport) switchSport(id);
    else if ((player || team) && index){ player = null; team = null; history.replaceState(null, "", `#sp=${id}`); render(); }   // back to best bets
  }})));
}
const teamFix = t => ({LAR:"LA", JAC:"JAX", WSH:"WAS"}[t] || t);   // Sleeper vs nflverse team codes
async function switchSport(id, playerId, teamCode){
  sport = id; player = null; team = null; index = null; defense = null; injuries = null; model = null;
  ui = Object.assign(ui, playerId ? {} : {stat:null, line:null}, {range:"10", mate:"", oddsO:"", oddsU:""});   // a shared link keeps its prop and line
  store.set("tradescale:props-sport", id);
  renderSports(); $("picker").innerHTML = ""; $("app").innerHTML = "";
  const status = $("status"); status.classList.remove("warn"); status.textContent = "Loading...";
  if (!playerId && !teamCode || isGameSport(id)) history.replaceState(null, "", `#sp=${id}`);
  if (isGameSport(id)){ gameView = {filter:"", open:null}; await showGames(id, teamCode); return; }
  try {
    [index, defense] = await Promise.all([getJSON(BASE() + "index.json"), getJSON(BASE() + "defense.json")]);
  } catch(e){
    status.classList.add("warn");
    status.textContent = "This sport's props data isn't built yet. It appears after the next daily update (or run the workflow on GitHub).";
    return;
  }
  if (id !== sport) return;   // user switched again while loading
  model = null;
  getJSON(BASE() + "model.json").then(m => { if (id === sport){ model = m; if (player) render(); } }).catch(() => {});
  const live = index.players.filter(p => p[5] > 0).length;
  status.textContent = `${index.players.length} players, ${seasonName(index.season)} season${live ? "" : " (last season's games until the new one starts)"}, updated ${TS.ago(index.updated)}.`;
  renderPicker();
  TS.loadSport(id).then(pool => {   // injury tags from the daily player file (football and basketball)
    if (id !== sport) return;
    injuries = new Map(pool.filter(p => p.inj).map(p => [norm(p.name) + (id === "nfl" ? "|" + teamFix(p.team) : ""), p.inj]));
    if (player) render();
  }).catch(() => {});
  if (playerId) openPlayer(playerId, true);
  else if (teamCode) openTeam(teamCode);
  else render();
}
(() => {
  const id = readHash();
  if (!id && !new URLSearchParams(location.hash.slice(1)).get("sp")) sport = store.get("tradescale:props-sport") || sport;   // a link to a sport wins over the last one used
  renderTracker();
  renderSlip();
  loadOdds().then(() => { if (slip.open && slip.legs.length) renderSlip(); if (player) render(); });
  switchSport(sport, id, id ? null : hashTeam);
  pollSoon(1500);
})();
})();
