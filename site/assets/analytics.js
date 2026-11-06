/* Trade Scale analytics page: the graded track record of every pick the site showed (scripts/analytics.py keeps it in
   data/analytics.json), each sport's model report card, the college backtest, and the fantasy trade market. */
(() => {
const {el, getJSON, store, ago} = TS;
const $ = id => document.getElementById(id);

const SPORTS = [["all","All sports"],["nfl","Football"],["nba","Basketball"],["nhl","Hockey"],["mlb","Baseball"],
  ["cfb","College FB"],["cbb","College BB"],["ufc","UFC"],["soc","Soccer"],["cri","Cricket"]];
const NAME = Object.fromEntries(SPORTS);
const PROP_SPORTS = ["nfl","nba","nhl","mlb","ufc","soc","cri"], COLLEGE = ["cfb","cbb"], FANTASY = ["nfl","nba","nhl","mlb"];
// prop names, as props.js labels them
const LABEL = {
  nfl: {pyd:"pass yds", ptd:"pass TDs", cmp:"completions", att:"attempts", int:"INTs", car:"carries", ruyd:"rush yds", rec:"receptions",
        tgt:"targets", reyd:"rec yds", ppr:"PPR pts", td:"TDs", "ruyd+reyd":"rush + rec yds", "pyd+ruyd":"pass + rush yds"},
  nba: {pts:"pts", reb:"reb", ast:"ast", fg3:"threes", stl:"steals", blk:"blocks", tov:"turnovers", min:"minutes",
        "pts+reb+ast":"pts + reb + ast", "pts+reb":"pts + reb", "pts+ast":"pts + ast", "reb+ast":"reb + ast", "stl+blk":"steals + blocks"},
  nhl: {g:"goals", a:"assists", pts:"points", sog:"shots", hit:"hits", blk:"blocks", ppg:"PP goals", toi:"minutes", sv:"saves", ga:"goals against", sa:"shots faced"},
  mlb: {h:"hits", tb:"total bases", hr:"HR", rbi:"RBI", r:"runs", bb:"walks", so:"strikeouts", sb:"steals", k:"strikeouts", outs:"outs",
        er:"earned runs", ha:"hits allowed", bba:"walks allowed", pc:"pitches", "h+r+rbi":"hits + runs + RBI"},
  ufc: {win:"wins", ko:"wins by KO/TKO", sub:"wins by submission", dec:"wins by decision", dist:"fight goes the distance", rnd:"rounds",
        sig:"sig. strikes", tdl:"takedowns", kd:"knockdowns"},
  soc: {g:"goals", a:"assists", "g+a":"goals + assists", sh:"shots", sot:"shots on target", fc:"fouls", fs:"fouls drawn", yc:"yellow cards", sv:"saves", gc:"goals conceded"},
  cri: {r:"runs", bf:"balls faced", f4:"fours", s6:"sixes", "f4+s6":"boundaries", wk:"wickets", rc:"runs conceded", bb:"balls bowled"},
};
const BINARY = ["win","ko","sub","dec","dist"];
const MARKET = {ml:"Winners", spread:"Spreads", total:"Totals"};
const WINDOWS = [["7","Last 7 days"],["30","Last 30 days"],["all","Since tracking began"]];

let sport = "all", win = "30", A = null;
const pct = p => p == null || isNaN(p) ? "–" : Math.round(p * 100) + "%";
const pct1 = p => p == null || isNaN(p) ? "–" : (p * 100).toFixed(1) + "%";
const signed = (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
const fmtDate = s => new Date(s + "T12:00:00").toLocaleDateString(undefined, {month:"short", day:"numeric"});
const BREAK_EVEN = 110 / 210;   // a -110 bet needs 52.4% to break even

/* ---------- picks ---------- */
// [id, sport, date, kind, name, team, opp, key, line, side, p, result, actual]
const P = r => ({id:r[0], sport:r[1], date:r[2], kind:r[3], name:r[4], team:r[5], opp:r[6], key:r[7], line:r[8], side:r[9], p:r[10], res:r[11], actual:r[12]});
function pickText(x){
  if (x.kind !== "prop") return x.name;
  const lab = (LABEL[x.sport] || {})[x.key] || x.key;
  if (BINARY.includes(x.key)) return x.side === "over" ? `${x.name}: ${lab}` : `${x.name}: not ${lab}`;
  return `${x.name} ${x.side === "over" ? "over" : "under"} ${x.line} ${lab}`;
}
function actualText(x){
  if (x.actual == null) return x.res === "V" ? "didn't play" : "";
  if (x.kind === "ml" || x.kind === "spread") return x.actual > 0 ? `won by ${x.actual}` : x.actual < 0 ? `lost by ${-x.actual}` : "tied";
  if (x.kind === "total") return `${x.actual} total`;
  if (BINARY.includes(x.key)) return x.actual ? "yes" : "no";
  return `had ${x.actual}`;
}
const inWindow = d => {
  if (win === "all") return true;
  const cut = new Date(); cut.setDate(cut.getDate() - Number(win));
  return d >= cut.toISOString().slice(0, 10);
};
// the top picks (parlay-only legs are graded for their parlays but left out of the picks' record)
const picksFor = sp => (A.picks || []).map(P).filter(x => x.kind !== "leg" && (sp === "all" || x.sport === sp));
function summarize(list){
  const g = list.filter(x => x.res === "W" || x.res === "L");
  const w = g.filter(x => x.res === "W").length, l = g.length - w;
  const push = list.filter(x => x.res === "P").length, voids = list.filter(x => x.res === "V").length;
  const pending = list.filter(x => x.res == null).length;
  const exp = g.length ? g.reduce((s, x) => s + x.p, 0) / g.length : null;
  return {w, l, push, voids, pending, n: g.length, rate: g.length ? w / g.length : null, exp, units: w * 100 / 110 - l};
}

/* ---------- small pieces ---------- */
const tile = (lbl, val, sub, cls = "") => el("div", {class:`tile ${cls}`}, el("span", {class:"lbl", text:lbl}), el("b", {text:val}), sub ? el("small", {text:sub}) : null);
const rateClass = (rate, n) => rate == null || n < 10 ? "" : rate >= 0.55 ? "good" : rate >= BREAK_EVEN ? "mid" : "bad";
const panel = (title, sub, ...kids) => el("section", {class:"panel"}, el("h2", {text:title}), sub ? el("p", {class:"sub", text:sub}) : null, ...kids);
function seg(options, current, onPick){
  return el("div", {class:"seg", role:"group"}, ...options.map(([id, label]) => el("button", {text:label, "aria-pressed": String(id === current), onclick: () => onPick(id)})));
}
// one row of a bullet chart: a bar for what happened, a tick for what was expected
function bullet(label, val, mark, text, title){
  const row = el("div", {class:"an-row", title: title || ""},
    el("span", {class:"an-l", text:label}),
    el("div", {class:"bar"}, el("i", {style:`width:${Math.max(0, Math.min(1, val)) * 100}%`}),
      mark != null ? el("span", {class:"avg", style:`left:${Math.max(0, Math.min(1, mark)) * 100}%`}) : null),
    el("b", {text}));
  return row;
}
function table(head, rows){
  return el("div", {class:"tablewrap"}, el("table", {class:"an-t"},
    el("thead", {}, el("tr", {}, ...head.map(h => el("th", {text:h})))),
    el("tbody", {}, ...rows.map(r => el("tr", {}, ...r.map(c => c instanceof Node ? el("td", {}, c) : el("td", {text: c == null ? "–" : String(c)})))))));
}
const sportBtn = sp => el("button", {class:"linkish", text:NAME[sp], onclick: () => go(sp)});

/* ---------- track record ---------- */
function recordTiles(s, parl){
  const exp = s.exp != null ? `model expected ${pct(s.exp)}` : "";
  return el("div", {class:"tiles"},
    tile("Record", s.n ? `${s.w}-${s.l}${s.push ? "-" + s.push : ""}` : "–", s.n ? `${s.n} graded${s.voids ? `, ${s.voids} void` : ""}` : "nothing graded yet"),
    tile("Hit rate", pct1(s.rate), exp, rateClass(s.rate, s.n)),
    tile("Profit at -110", s.n ? `${signed(s.units)}u` : "–", s.n ? `${signed(s.units / s.n * 100, 1)}% per bet` : "1 unit a pick", s.n >= 10 ? (s.units >= 0 ? "good" : "bad") : ""),
    parl ? tile("Parlays", parl.n ? `${parl.w}-${parl.l}` : "–", parl.n ? `hit ${pct(parl.w / parl.n)}, model expected ${pct(parl.exp)}` : "3-leg, one leg a game") : null,
    tile("Waiting", String(s.pending), s.pending ? "picks for games not graded yet" : "no open picks"));
}
function parlaysFor(sp){
  const list = (A.parlays || []).filter(p => (sp === "all" || p[1] === sp) && p[2] && inWindow(p[2]));
  const g = list.filter(p => p[5] === "W" || p[5] === "L");
  const w = g.filter(p => p[5] === "W").length;
  return {n: g.length, w, l: g.length - w, exp: g.length ? g.reduce((s, p) => s + p[3], 0) / g.length : null};
}
// running profit, one point a day
function profitChart(list){
  const days = {};
  list.filter(x => x.res === "W" || x.res === "L").forEach(x => { days[x.date] = (days[x.date] || 0) + (x.res === "W" ? 100 / 110 : -1); });
  const ds = Object.keys(days).sort();
  if (ds.length < 2) return null;
  let run = 0; const pts = ds.map(d => (run += days[d], [d, run]));
  const W = 640, H = 180, pad = {l:36, r:10, t:12, b:22};
  const lo = Math.min(0, ...pts.map(p => p[1])), hi = Math.max(0, ...pts.map(p => p[1]));
  const span = hi - lo || 1;
  const x = i => pad.l + i * (W - pad.l - pad.r) / (pts.length - 1), y = v => pad.t + (hi - v) * (H - pad.t - pad.b) / span;
  const NS = "http://www.w3.org/2000/svg", s = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = s("svg", {viewBox:`0 0 ${W} ${H}`, class:"an-line", role:"img", "aria-label":`Running profit, ${signed(run)} units after ${ds.length} days`});
  [hi, 0, lo].filter((v, i, a) => a.indexOf(v) === i).forEach(v => {
    svg.append(s("line", {x1:pad.l, x2:W - pad.r, y1:y(v), y2:y(v), class: v === 0 ? "zero" : "grid"}));
    const t = s("text", {x:pad.l - 6, y:y(v) + 4, "text-anchor":"end"}); t.textContent = signed(v, 0); svg.append(t);
  });
  [0, pts.length - 1].forEach(i => { const t = s("text", {x:x(i), y:H - 6, "text-anchor": i ? "end" : "start"}); t.textContent = fmtDate(pts[i][0]); svg.append(t); });
  svg.append(s("path", {d: pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(""), class:"ln"}));
  const dot = s("circle", {r:5, class:"dot", visibility:"hidden"}); svg.append(dot);
  const tip = el("div", {class:"an-tip", hidden:true});
  const hit = s("rect", {x:pad.l, y:0, width:W - pad.l - pad.r, height:H, fill:"transparent"});
  hit.addEventListener("pointermove", e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) * W / r.width;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((px - pad.l) / ((W - pad.l - pad.r) / (pts.length - 1)))));
    dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(pts[i][1])); dot.setAttribute("visibility", "visible");
    tip.hidden = false; tip.textContent = `${fmtDate(pts[i][0])}: ${signed(pts[i][1])}u total (${signed(days[pts[i][0]])}u that day)`;
    tip.style.left = `${x(i) / W * 100}%`;
  });
  hit.addEventListener("pointerleave", () => { dot.setAttribute("visibility", "hidden"); tip.hidden = true; });
  svg.append(hit);
  return el("div", {class:"an-chart"}, svg, tip);
}
function byConfidence(list){
  const B = [[0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7], [0.7, 1.01]];
  const g = list.filter(x => x.res === "W" || x.res === "L");
  const rows = B.map(([lo, hi]) => {
    const b = g.filter(x => x.p >= lo && x.p < hi);
    if (!b.length) return null;
    const rate = b.filter(x => x.res === "W").length / b.length, exp = b.reduce((s, x) => s + x.p, 0) / b.length;
    return bullet(hi > 1 ? "70%+" : `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`, rate, exp, `${pct(rate)} of ${b.length}`, `Model expected ${pct(exp)}`);
  }).filter(Boolean);
  return rows.length ? el("div", {class:"an-bars"}, ...rows) : null;
}
function recentList(list){
  const done = list.filter(x => x.res).slice(-20).reverse();
  if (!done.length) return null;
  return el("ul", {class:"an-res"}, ...done.map(x => el("li", {class:`r-${x.res}`},
    el("span", {class:"ic", text: x.res === "W" ? "✓" : x.res === "L" ? "✗" : x.res === "P" ? "=" : "–", "aria-label": {W:"won", L:"lost", P:"push", V:"void"}[x.res]}),
    el("div", {}, el("strong", {text:pickText(x)}), el("small", {text:`${sport === "all" ? NAME[x.sport] + ", " : ""}${fmtDate(x.date)}. Model ${pct(x.p)}${actualText(x) ? `, ${actualText(x)}` : ""}.`})))));
}
function byType(list, sp){
  const groups = {};
  list.filter(x => x.res === "W" || x.res === "L").forEach(x => {
    const k = x.kind === "prop" ? ((LABEL[sp] || {})[x.key] || x.key) : MARKET[x.kind] || x.kind;
    (groups[k] = groups[k] || []).push(x);
  });
  const rows = Object.entries(groups).map(([k, xs]) => ({k, ...summarize(xs)})).sort((a, b) => b.n - a.n);
  if (!rows.length) return null;
  return table([COLLEGE.includes(sp) ? "Bet" : "Prop", "Record", "Hit rate", "Model expected", "Profit at -110"],
    rows.map(r => [r.k, `${r.w}-${r.l}`, pct1(r.rate), pct(r.exp), `${signed(r.units)}u`]));
}
function trackRecord(sp){
  const all = picksFor(sp), list = all.filter(x => inWindow(x.date));
  const s = summarize(list);
  const box = panel("Track record", null);
  box.append(el("div", {class:"bar-row", style:"justify-content:space-between;margin-bottom:10px"},
    el("p", {class:"sub", style:"margin:0", text: sp === "all" ? "Every pick the Props page showed, across every sport." :
      COLLEGE.includes(sp) ? "The best spreads, totals and winners the college tab showed." : "The top picks the Props page showed for this sport."}),
    seg(WINDOWS, win, w => { win = w; store.set("tradescale:analytics-window", w); render(); })));
  box.append(recordTiles(s, COLLEGE.includes(sp) ? null : parlaysFor(sp)));
  if (!all.length){
    box.append(el("p", {class:"empty", text:`Tracking started ${A.since ? fmtDate(A.since) : "with the latest update"}. Picks are saved each morning and graded the morning after their games, so results fill in here day by day.`}));
    return box;
  }
  if (!s.n) box.append(el("p", {class:"empty", text: s.pending ? "No graded picks in this window yet. The open ones are graded the morning after their games." : "No picks in this window. Try a longer one."}));
  const chart = profitChart(list);
  if (chart) box.append(el("h3", {text:"Running profit"}), el("p", {class:"sub", text:"Units won or lost if every pick was a 1-unit bet at -110."}), chart);
  const conf = byConfidence(list);
  if (conf) box.append(el("h3", {text:"Did the sure ones hit more?"}),
    el("p", {class:"sub", text:"Picks grouped by the model's chance. The bar is how often they hit; the tick is what the model expected."}), conf);
  return box;
}

/* ---------- all sports ---------- */
function overview(){
  const app = $("app");
  app.append(trackRecord("all"));
  const rows = SPORTS.slice(1).map(([sp]) => {
    const s = summarize(picksFor(sp).filter(x => inWindow(x.date)));
    const m = (A.models || {})[sp], c = (A.college || {})[sp];
    let model = "–";
    if (m && m.trained && m.formula) model = `${signed((1 - m.trained.log_loss / m.formula.log_loss) * 100, 1)}% vs formula`;
    else if (c && c.backtest && c.backtest.winner != null) model = `winners ${pct(c.backtest.winner)}${c.backtest.ats ? `, ATS ${pct(c.backtest.ats.pct)}` : ""}`;
    const status = m ? (m.used ? "Model live" : "Formula") : c ? "Game lines" : "No data yet";
    return [sportBtn(sp), s.n ? `${s.w}-${s.l}` : "–", pct1(s.rate), pct(s.exp), s.n ? `${signed(s.units)}u` : "–", String(s.pending), model, status];
  });
  app.append(panel("By sport", "Each sport's record in this window, next to how its model did on games it never trained on. Tap a sport for its full breakdown.",
    table(["Sport", "Record", "Hit rate", "Expected", "Profit", "Open", "Model test", "Picks from"], rows)));
  // where the models are sharpest: held-out hit rate on their most confident picks
  const sharp = PROP_SPORTS.map(sp => {
    const m = (A.models || {})[sp]; if (!m || !m.picks || !m.picks.length) return null;
    const top = m.picks.filter(b => b[0] >= 0.6), n = top.reduce((s, b) => s + b[2], 0);
    if (!n) return null;
    return {sp, n, rate: top.reduce((s, b) => s + b[2] * b[4], 0) / n};
  }).filter(Boolean).sort((a, b) => b.rate - a.rate);
  if (sharp.length) app.append(panel("Where the models are sharpest", "On held-out games, how often each sport's model was right when it gave a side 60% or better.",
    el("div", {class:"an-bars"}, ...sharp.map(r => bullet(NAME[r.sp], r.rate, BREAK_EVEN, `${pct1(r.rate)} of ${r.n.toLocaleString()}`, "Tick: 52.4%, break-even at -110")))));
  app.append(recentPanel("all"));
}
function recentPanel(sp){
  const list = picksFor(sp).filter(x => inWindow(x.date));
  const r = recentList(list);
  const open = list.filter(x => x.res == null).sort((a, b) => b.p - a.p).slice(0, 8);
  const box = panel("Latest results", null);
  box.append(r || el("p", {class:"empty", style:"margin:0", text:"Nothing graded in this window yet."}));
  if (open.length) box.append(el("h3", {text:"Still open"}), el("ul", {class:"an-res"}, ...open.map(x => el("li", {},
    el("span", {class:"ic", text:"◷"}), el("div", {}, el("strong", {text:pickText(x)}),
      el("small", {text:`${sp === "all" ? NAME[x.sport] + ", " : ""}${fmtDate(x.date)}. Model ${pct(x.p)}.`}))))));
  return box;
}

/* ---------- one sport ---------- */
function modelCard(sp){
  const m = (A.models || {})[sp];
  if (!m) return panel("Model report card", "This sport's model hasn't been trained yet. Its report card shows up after the next daily update.");
  const t = m.trained || {}, f = m.formula || {};
  const gain = t.log_loss && f.log_loss ? 1 - t.log_loss / f.log_loss : null;
  const box = panel("Model report card", `Trained on ${m.games ? m.games.toLocaleString() + " past games" : "past games"} and tested on ${m.n ? m.n.toLocaleString() + " props" : "props"} from games it never saw${m.test_from ? ` (from ${fmtDate(m.test_from)})` : ""}. ${m.used ? "It beat the hand-tuned formula, so it's the one pricing props today." : "It didn't beat the hand-tuned formula this time, so the Props page uses the formula."} Updated ${ago(m.updated)}.`);
  const top60 = (m.picks || []).filter(b => b[0] >= 0.6), n60 = top60.reduce((s, b) => s + b[2], 0);
  box.append(el("div", {class:"tiles"},
    tile("vs the formula", gain == null ? "–" : `${signed(gain * 100, 1)}%`, "less prediction error (log loss)", gain == null ? "" : gain > 0 ? "good" : "bad"),
    tile("Ranking skill", t.auc ? t.auc.toFixed(3) : "–", "AUC: 0.5 is a coin flip, 1 is perfect"),
    tile("Sure picks hit", n60 ? pct1(top60.reduce((s, b) => s + b[2] * b[4], 0) / n60) : "–", n60 ? `${n60.toLocaleString()} test picks at 60%+` : "", n60 ? "good" : ""),
    tile("Overs that hit", pct(m.over_rate), "of test props at the default line")));
  if (m.picks && m.picks.length) box.append(el("h3", {text:"Test picks by confidence"}),
    el("p", {class:"sub", text:"Taking the side the model favored on every test prop. The bar is how often it hit; the tick is what the model said."}),
    el("div", {class:"an-bars"}, ...m.picks.map(b => bullet(b[1] >= 1 ? "70%+" : `${Math.round(b[0] * 100)}-${Math.round(b[1] * 100)}%`, b[4], b[3], `${pct1(b[4])} of ${b[2].toLocaleString()}`, `Model said ${pct1(b[3])}`))));
  if (m.calibration && m.calibration.length) box.append(el("h3", {text:"Are its chances honest?"}),
    el("p", {class:"sub", text:"Test props grouped by the model's chance of the over. When it says 30%, the over should hit about 30% of the time: the bar is what happened, the tick is what it said."}),
    el("div", {class:"an-bars"}, ...m.calibration.map(b => bullet(`${Math.round(b[0] * 100)}-${Math.round(b[1] * 100)}%`, b[4], b[3], pct(b[4]), `${b[2].toLocaleString()} props, model said ${pct1(b[3])}`))));
  if (m.importance && m.importance.length){
    const mx = m.importance[0][1];
    box.append(el("h3", {text:"What moves its chances most"}),
      el("div", {class:"an-bars"}, ...m.importance.slice(0, 7).map(([g, v]) => bullet(g, v / mx, null, pct(v)))));
  }
  const bs = Object.entries(m.by_stat || {}).map(([k, v]) => ({k, n:v.n, gain: 1 - v.trained / v.formula}))
    .sort((a, b) => b.gain - a.gain);
  if (bs.length) box.append(el("h3", {text:"Best and worst props for the model"}),
    table(["Prop", "Test props", "vs the formula"], bs.map(r => [(LABEL[sp] || {})[r.k] || r.k, r.n.toLocaleString(), `${signed(r.gain * 100, 1)}%`])));
  if (m.note) box.append(el("p", {class:"why", text:m.note}));
  return box;
}
function collegeCard(sp){
  const c = (A.college || {})[sp];
  if (!c) return panel("Model report card", "The college game model hasn't run yet. Its backtest shows up after the next daily update.");
  const bt = c.backtest || {}, M = c.model || {};
  const box = panel("Model report card", `Team ratings fit on game margins and points, tested week by week on ${bt.season || "last season"}${bt.games ? ` (${bt.games.toLocaleString()} games)` : ""}, using only games played before each week. ${c.season} so far: ${(c.games_this_season || 0).toLocaleString()} games. Updated ${ago(c.updated)}.`);
  box.append(el("div", {class:"tiles"},
    tile("Winners", pct1(bt.winner), "picked straight up", bt.winner >= 0.7 ? "good" : ""),
    tile("Against the spread", bt.ats ? pct1(bt.ats.pct) : "–", bt.ats ? `${(bt.ats.n || 0).toLocaleString()} games, 52.4% breaks even` : "no past lines to test", bt.ats ? rateClass(bt.ats.pct, 99) : ""),
    tile("Totals", bt.ou ? pct1(bt.ou.pct) : "–", bt.ou ? `${(bt.ou.n || 0).toLocaleString()} games` : "no past totals to test", bt.ou ? rateClass(bt.ou.pct, 99) : ""),
    tile("Typical miss", bt.mae != null ? `${Number(bt.mae).toFixed(1)} pts` : "–", "on the final margin"),
    tile("Home edge", M.hfa != null ? `${M.hfa} pts` : "–", M.k != null ? `trusts the model ${Math.round(M.k * 100)}% vs the book` : "")));
  if (c.top && c.top.length) box.append(el("h3", {text:"Top rated teams"}),
    table(["Rank", "Team", "Rating"], c.top.map(t => [`#${t[3]}`, t[1], t[2] != null ? signed(t[2]) : "–"])),
    el("p", {class:"why", text:"Rating: points better than an average team on a neutral field."}));
  return box;
}
async function marketCard(sp){
  const box = panel("Trade market", "Where the trained model and trade values disagree most: buys are players the model ranks above their trade value at their position, sells the other way.");
  let sig, pool;
  try { [sig, pool] = await Promise.all([getJSON("data/signals.json"), TS.loadSport(sp)]); } catch(e){ box.append(el("p", {class:"empty", text:"Trade data isn't available right now."})); return box; }
  const S = (sig.sports || {})[sp];
  if (!S){ box.append(el("p", {class:"empty", style:"margin:0", text:"No model projections for this sport today (it's out of season, or the model kept the formula)."})); return box; }
  const rows = Object.entries(S.players).map(([id, v]) => ({p: pool.byId.get(id), v})).filter(r => r.p && !TS.HURT.has(r.p.inj) && !["DEF","K"].includes(r.p.pos));
  const buys = rows.filter(r => r.v[5] >= 0.4).sort((a, b) => b.v[5] - a.v[5]), sells = rows.filter(r => r.v[5] <= -0.4).sort((a, b) => a.v[5] - b.v[5]);
  box.append(el("div", {class:"tiles"},
    tile("Players projected", rows.length.toLocaleString(), S.label),
    tile("Buy signals", String(buys.length), "model likes them more", "good"),
    tile("Sell signals", String(sells.length), "model likes them less", "bad")));
  const line = r => [`${r.p.name}`, `${r.p.pos} ${r.p.team || ""}`.trim(), `#${r.v[2]} by model`, `#${r.v[3]} by value`, r.v[0] != null ? r.v[0].toFixed(1) : "–"];
  const head = ["Player", "Pos", "Model rank", "Value rank", "Next game"];
  if (buys.length) box.append(el("h3", {text:"Top buys"}), table(head, buys.slice(0, 6).map(line)));
  if (sells.length) box.append(el("h3", {text:"Top sells"}), table(head, sells.slice(0, 6).map(line)));
  box.append(el("p", {class:"why", text:`Ranks are within each position. Next game is the model's projected ${S.label}. Updated ${ago(S.updated || sig.updated)}.`}));
  return box;
}
async function sportView(sp){
  const app = $("app");
  app.append(trackRecord(sp));
  const list = picksFor(sp).filter(x => inWindow(x.date));
  const t = byType(list, sp);
  if (t) app.append(panel(COLLEGE.includes(sp) ? "By bet type" : "By prop", "Which kinds of picks have paid off in this window.", t));
  app.append(recentPanel(sp));
  app.append(COLLEGE.includes(sp) ? collegeCard(sp) : modelCard(sp));
  if (FANTASY.includes(sp)){ const box = await marketCard(sp); if (sport === sp) app.append(box); }
}

/* ---------- boot ---------- */
function renderSports(){
  const nav = $("sports"); nav.innerHTML = "";
  SPORTS.forEach(([id, label]) => nav.append(el("button", {text:label, "data-sport":id, "aria-pressed": String(sport === id), onclick: () => go(id)})));
}
function go(sp){
  sport = sp; store.set("tradescale:analytics-sport", sp);
  history.replaceState(null, "", sp === "all" ? location.pathname : `#sp=${sp}`);
  render(); window.scrollTo({top:0, behavior:"smooth"});
}
function render(){
  renderSports();
  $("app").innerHTML = "";
  if (sport === "all") overview(); else sportView(sport);
}
(async () => {
  const h = new URLSearchParams(location.hash.slice(1)).get("sp");
  sport = NAME[h] ? h : (NAME[store.get("tradescale:analytics-sport")] ? store.get("tradescale:analytics-sport") : "all");
  const w = store.get("tradescale:analytics-window"); if (WINDOWS.some(x => x[0] === w)) win = w;
  try { A = await getJSON("data/analytics.json"); }
  catch(e){ A = {picks:[], parlays:[], models:{}, college:{}}; }
  const n = (A.picks || []).filter(r => r[3] !== "leg").length;
  $("status").textContent = A.updated ? `${n.toLocaleString()} picks tracked since ${fmtDate(A.since)}, updated ${ago(A.updated)}.` : "Analytics start with the next daily update.";
  render();
})();
})();
