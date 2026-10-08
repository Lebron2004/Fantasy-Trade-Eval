/* My League page: sync or build a league, grade every team by position,
   and suggest trades and pickups that fix your weak spots. */
(() => {
const {SPORTS, store, settings, el, adjusted, packageScore, injTag, toItem} = TS;
const $ = id => document.getElementById(id);

const {DEFAULT_SLOTS, GROUPS, FLEX, SKIP_SLOTS, accepts, slotWidth, parseSlots} = TS.LINEUP;

/* ---------- State ---------- */
let leagues = store.get("tradescale:leagues") || [];
let active = store.get("tradescale:active-league") || {};
let sport = (store.get("tradescale:v2") || {}).sport || "nfl";
let view = {creating:false, editing:false, compare:"", ideaTeam:""};
const saveLeagues = () => { store.set("tradescale:leagues", leagues); store.set("tradescale:active-league", active); };
const sportLeagues = () => leagues.filter(l => l.sport === sport);
const current = () => sportLeagues().find(l => l.id === active[sport]) || sportLeagues()[0] || null;

/* ---------- Analysis engine ---------- */
function makeEngine(L){
  const pool = TS.pools[L.sport], sp = L.sport;
  const val = p => adjusted(p, sp);
  const byVal = (a, b) => val(b) - val(a);
  const groups = GROUPS[sp].filter(g => L.slots.some(s => accepts(sp, s, {elig:[g]})));
  const groupOf = p => p.elig.find(e => groups.includes(e)) || (sp === "mlb" && p.elig.includes("OF") ? "OF" : null);
  const dedicated = Object.fromEntries(groups.map(g => [g, L.slots.filter(s => s === g).length]));
  const order = L.slots.map((s, i) => ({s, i, w: slotWidth(sp, s)})).sort((a, b) => a.w - b.w || a.i - b.i);

  const resolve = ids => ids.map(id => pool.byId.get(String(id))).filter(Boolean);
  function lineup(players, vf){
    const v = vf || val;
    const sorted = vf ? [...players].sort((a, b) => v(b) - v(a)) : [...players].sort(byVal), used = new Set(), starters = new Array(L.slots.length).fill(null);
    for (const o of order){
      const p = sorted.find(q => !used.has(q.id) && accepts(sp, o.s, q));
      if (p){ used.add(p.id); starters[o.i] = p; }
    }
    let total = 0; starters.forEach(p => { if (p) total += v(p); });
    return {starters, bench: sorted.filter(p => !used.has(p.id)), total};
  }
  function profile(players){
    const lu = lineup(players), sums = {}, counts = {}, benchBest = {};
    groups.forEach(g => { sums[g] = 0; counts[g] = 0; });
    lu.starters.forEach(p => { const g = p && groupOf(p); if (g){ sums[g] += val(p); counts[g]++; } });
    lu.bench.forEach(p => { const g = groupOf(p); if (g && !benchBest[g]) benchBest[g] = p; });
    return {lu, sums, counts, benchBest, players};
  }
  // Position-by-position value ladders across the whole player pool (for leagues without every roster entered).
  const ladders = {};
  groups.forEach(g => ladders[g] = pool.filter(p => groupOf(p) === g).map(val).sort((a, b) => b - a));
  function syntheticAvg(g, n){
    const N = L.size || 12, lad = ladders[g]; let s = 0;
    for (let i = 0; i < n; i++) s += lad[i * N + Math.floor(N / 2)] || 0;
    return s;
  }
  return {pool, sp, val, byVal, groups, groupOf, dedicated, resolve, lineup, profile, syntheticAvg};
}

function analyzeLeague(L){
  const E = makeEngine(L);
  const teams = L.teams.map(t => ({...t, roster: E.resolve(t.players), missing: t.players.length - E.resolve(t.players).length}));
  teams.forEach(t => t.prof = E.profile(t.roster));
  const full = teams.filter(t => t.roster.length >= Math.max(5, L.slots.length * 0.6));
  const useLeague = full.length >= 4;
  const benchmark = {};
  E.groups.forEach(g => {
    benchmark[g] = useLeague ? full.reduce((s, t) => s + t.prof.sums[g], 0) / full.length : null;
  });
  const gradeFor = (t, g) => {
    const n = Math.max(t.prof.counts[g], E.dedicated[g]);
    const avg = useLeague ? benchmark[g] : E.syntheticAvg(g, n);
    return avg > 0 ? t.prof.sums[g] / avg : (t.prof.sums[g] > 0 ? 1.5 : 1);
  };
  teams.forEach(t => {
    t.grades = {}; E.groups.forEach(g => t.grades[g] = gradeFor(t, g));
    const shown = E.groups.filter(g => E.dedicated[g] > 0 || t.prof.counts[g] > 0);
    t.shownGroups = shown;
    t.needs = shown.filter(g => t.grades[g] < 0.92).sort((a, b) => t.grades[a] - t.grades[b]);
    t.strengths = shown.filter(g => t.grades[g] >= 1.15).sort((a, b) => t.grades[b] - t.grades[a]);
  });
  const ranks = {};
  if (useLeague) E.groups.forEach(g => {
    const sorted = [...full].sort((a, b) => b.prof.sums[g] - a.prof.sums[g]);
    sorted.forEach((t, i) => { (ranks[t.id] ||= {})[g] = i + 1; });
  });
  const powerOrder = [...teams].filter(t => t.roster.length).sort((a, b) => b.prof.lu.total - a.prof.lu.total);
  return {E, teams, useLeague, ranks, fullCount: full.length, powerOrder};
}

// The trained model's lean on a package: average buy/sell score of the players you get minus the ones you send.
function modelEdge(give, get, sp){
  const avg = list => { const g = list.map(p => TS.signalOf(p, sp)).filter(Boolean); return g.length ? g.reduce((a, x) => a + x.s, 0) / g.length : 0; };
  return avg(get) - avg(give);
}
const pairs = arr => { const out = []; for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) out.push([arr[i], arr[j]]); return out; };

function tradeIdeas(A, me, only){
  const {E} = A, base = me.prof.lu.total, myTop = [...me.roster].sort(E.byVal).slice(0, 12);
  const gives = [...myTop.map(p => [p]), ...pairs(myTop)];
  const found = [];
  for (const T of A.teams){
    if (T.id === me.id || T.roster.length < 3 || (only && T.id !== only)) continue;
    const tBase = T.prof.lu.total, tTop = [...T.roster].sort(E.byVal).slice(0, 12);
    const gets = [...tTop.map(p => [p]), ...pairs(tTop)];
    for (const give of gives){
      const ps = packageScore(give, E.sp); if (ps <= 0) continue;
      for (const get of gets){
        if (give.length === 2 && get.length === 2) continue;
        const ratio = packageScore(get, E.sp) / ps;
        if (ratio < 0.85 || ratio > 1.15) continue;          // keep it realistic: roughly even value
        const giveIds = new Set(give.map(p => p.id)), getIds = new Set(get.map(p => p.id));
        const mine = E.lineup(me.roster.filter(p => !giveIds.has(p.id)).concat(get));
        const myGain = mine.total - base; if (myGain < 3) continue;
        const theirs = E.lineup(T.roster.filter(p => !getIds.has(p.id)).concat(give));
        const theirGain = theirs.total - tBase; if (theirGain < -4) continue;
        const edge = modelEdge(give, get, E.sp);
        found.push({team:T, give, get, myGain, theirGain, ratio, after: mine, edge,
                    score: myGain + 0.5 * Math.max(0, theirGain) + (theirGain >= 0 ? 3 : 0) + 4 * edge});
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const usedGet = new Set(), giveCount = {}, out = [];
  for (const f of found){
    if (f.get.some(p => usedGet.has(p.id)) || f.give.some(p => (giveCount[p.id] || 0) >= 2)) continue;
    f.get.forEach(p => usedGet.add(p.id)); f.give.forEach(p => giveCount[p.id] = (giveCount[p.id] || 0) + 1);
    out.push(f); if (out.length === 8) break;
  }
  return out;
}

// No other rosters entered: point the user's surplus at the kind of player they should target.
function tradeTargets(A, me){
  const {E} = A, taken = new Set(A.teams.flatMap(t => t.players.map(String)));
  const chips = me.prof.lu.bench.filter(p => E.val(p) >= 20).slice(0, 3);
  const out = [];
  for (const g of me.needs.slice(0, 2)){
    for (const chip of chips){
      const cv = E.val(chip), baseTotal = me.prof.lu.total;
      const targets = E.pool.filter(p => !taken.has(p.id) && E.groupOf(p) === g && E.val(p) >= cv * 0.8 && E.val(p) <= cv * 1.1)
        .filter(p => E.lineup(me.roster.filter(q => q.id !== chip.id).concat(p)).total - baseTotal > 2)
        .sort(E.byVal).slice(0, 5);
      if (targets.length){ out.push({group:g, chip, targets}); break; }
    }
  }
  return out;
}

function pickups(A, me, L){
  const {E} = A, rostered = new Set(A.teams.flatMap(t => t.players.map(String)));
  const exact = L.source === "sleeper" || A.teams.filter(t => t.roster.length).length >= (L.size || 12) * 0.75;
  const rosterSize = L.slots.length + (L.benchSize || Math.round(L.slots.length * 0.6));
  const cutoff = exact ? 0 : Math.round((L.size || 12) * rosterSize * 0.9);
  const ranked = [...E.pool].sort(E.byVal);
  const cands = ranked.filter((p, i) => i >= cutoff && !rostered.has(p.id)).slice(0, 250);
  const base = me.prof.lu, out = [];
  for (const p of cands){
    const after = E.lineup(me.roster.concat(p)), gain = after.total - base.total;
    if (gain > 0.5){
      const idx = after.starters.findIndex(q => q && q.id === p.id);
      const replaced = base.starters[idx];
      out.push({p, gain, slot: L.slots[idx], over: replaced && replaced.id !== p.id ? replaced : null});
    }
  }
  out.sort((a, b) => b.gain - a.gain);
  const starts = out.slice(0, 6);
  const stash = [];
  for (const g of me.needs){
    const p = cands.find(q => E.groupOf(q) === g && !starts.some(s => s.p.id === q.id) && !stash.some(s => s.p.id === q.id));
    if (p) stash.push({p, group:g});
    if (stash.length >= 3) break;
  }
  const drop = me.prof.lu.bench.length ? me.prof.lu.bench[me.prof.lu.bench.length - 1] : null;
  return {exact, starts, stash, drop};
}

/* ---------- Rendering helpers ---------- */
const fmt = v => Math.round(v);
function gradeInfo(g){
  if (g >= 1.15) return ["g-strong","Strong"];
  if (g >= 0.92) return ["g-solid","Solid"];
  if (g >= 0.75) return ["g-thin","Thin"];
  return ["g-weak","Weak"];
}
const pct = g => { const d = Math.round((g - 1) * 100); return d === 0 ? "league average" : `${Math.abs(d)}% ${d > 0 ? "above" : "below"} average`; };
function playerLine(p, E, extra){
  const n = el("span", {class:"pl"}, p.name); const tg = injTag(p); if (tg) n.append(tg);
  const st = TS.signalTag(p, E.sp); if (st) n.append(st);
  n.append(el("small", {text:` ${p.pos}, ${p.team || "FA"}, ${fmt(E.val(p))}${extra ? ", " + extra : ""}`}));
  return el("div", {}, n);
}
function openInCalculator(give, get){
  const st = store.get("tradescale:v2") || {sport, trades:{}};
  st.sport = sport; st.trades = st.trades || {};
  st.trades[sport] = {send: give.map(toItem), get: get.map(toItem)};
  store.set("tradescale:v2", st);
  location.href = "index.html";
}

/* ---------- Sleeper sync ---------- */
const SL = "https://api.sleeper.app/v1/";
async function sl(path){
  let r;
  try { r = await fetch(SL + path); }
  catch(e){ throw new Error("network"); }
  if (!r.ok) throw new Error("http " + r.status);
  return r.json();
}
function sleeperLeague(lg, rosters, users, userId){
  const names = Object.fromEntries((users || []).map(u => [u.user_id, (u.metadata && u.metadata.team_name) || u.display_name]));
  const rp = lg.roster_positions || [];
  const slots = rp.filter(s => !SKIP_SLOTS.has(s));
  const teams = (rosters || []).map(r => ({id:String(r.roster_id), name: names[r.owner_id] || `Team ${r.roster_id}`,
    players: (r.players || []).map(String)}));
  const mine = (rosters || []).find(r => r.owner_id === userId);
  const rec = (lg.scoring_settings || {}).rec || 0;
  return {
    id: "sl-" + lg.league_id, sport, name: lg.name, source: "sleeper", sleeperId: lg.league_id, userId,
    size: lg.total_rosters || teams.length, slots: slots.length ? slots : parseSlots(DEFAULT_SLOTS[sport]),
    benchSize: rp.filter(s => s === "BN").length, teams, myTeamId: mine ? String(mine.roster_id) : (teams[0] || {}).id,
    syncedAt: new Date().toISOString(),
    prefs: {scoring: rec >= 1 ? "ppr" : rec >= 0.5 ? "half" : "std",
            qb: rp.includes("SUPER_FLEX") || rp.filter(s => s === "QB").length >= 2 ? "sf" : "1qb",
            mode: (lg.settings || {}).type === 2 ? "dynasty" : "redraft"}
  };
}
function applyPrefs(L){
  if (!L.prefs) return;
  if (L.sport === "nfl"){ TS.setSetting("scoring", L.prefs.scoring); TS.setSetting("qb", L.prefs.qb); }
  TS.setSetting("mode", L.prefs.mode);
}
async function refreshSleeper(L, btn){
  btn.disabled = true; btn.textContent = "Refreshing...";
  try {
    const [lg, rosters, users] = await Promise.all([sl(`league/${L.sleeperId}`), sl(`league/${L.sleeperId}/rosters`), sl(`league/${L.sleeperId}/users`)]);
    const fresh = sleeperLeague(lg, rosters, users, L.userId);
    Object.assign(L, {teams: fresh.teams, slots: fresh.slots, benchSize: fresh.benchSize, size: fresh.size, syncedAt: fresh.syncedAt, name: fresh.name});
    if (!L.teams.some(t => t.id === L.myTeamId)) L.myTeamId = fresh.myTeamId;
    saveLeagues(); render();
  } catch(e){
    btn.disabled = false; btn.textContent = "Couldn't reach Sleeper, try again";
  }
}

let lastIdeas = [], lastPickups = null;

/* ---------- This week: matchup-adjusted lineup ---------- */
const OUT_NOW = new Set(["Out", "IR", "PUP", "Sus", "NA"]);
function weekFactor(p){
  const x = p.x || {};
  if (x.nx === "BYE" || OUT_NOW.has(p.inj)) return 0;
  let f = p.inj === "Doubtful" ? 0.25 : p.inj === "Questionable" ? 0.9 : 1;
  if (x.mu != null) f *= 1 + (x.mu - 1);   // a single game swings more than a season
  return f;
}
function renderThisWeek(app, L, A, me){
  const {E} = A;
  const wv = p => E.val(p) * weekFactor(p);
  const week = E.lineup(me.roster, wv);
  const seasonIds = new Set(me.prof.lu.starters.filter(Boolean).map(p => p.id));
  const weekIds = new Set(week.starters.filter(Boolean).map(p => p.id));
  const ins = week.starters.filter(p => p && !seasonIds.has(p.id));
  const outs = me.prof.lu.starters.filter(p => p && !weekIds.has(p.id));
  const panel = el("section", {class:"panel"}, el("h2", {text:"This week"}),
    el("p", {class:"sub", text:"Your best lineup for this week's games: each player's value adjusted for his opponent's defense against his position, byes, and injury designations."}));
  if (ins.length){
    const sum = el("div", {class:"summary"});
    sum.textContent = ins.map((p, i) => {
      const o = outs[i];
      const why = o ? (o.x && o.x.nx === "BYE" ? `${o.name} is on bye` : OUT_NOW.has(o.inj) ? `${o.name} is ${o.inj === "IR" ? "on IR" : "out"}`
        : o.inj === "Doubtful" ? `${o.name} is doubtful` : `${p.name} has the better matchup (${(p.x || {}).nx || ""})`) : "";
      return `Start ${p.name}${o ? ` over ${o.name}` : ""}${why ? `: ${why}.` : "."}`;
    }).join(" ");
    panel.append(sum);
  } else panel.append(el("div", {class:"summary", text:"Your season lineup is also your best lineup this week. No changes needed."}));
  const ul = el("ul", {class:"lu"});
  week.starters.forEach((p, i) => {
    if (!p){ ul.append(el("li", {class:"empty-slot"}, el("span", {class:"slot", text:L.slots[i]}), el("span", {class:"nm", text:"Nobody available"}), el("span"))); return; }
    const nm = el("span", {class:"nm"}, p.name); const tg = injTag(p); if (tg) nm.append(tg);
    const mt = TS.matchupTag(p); if (mt) nm.append(mt);
    nm.append(el("small", {text:`${p.pos}, ${p.team}`}));
    ul.append(el("li", {}, el("span", {class:"slot", text:L.slots[i]}), nm, el("span", {class:"v", text:fmt(wv(p))})));
  });
  panel.append(ul);
  app.append(panel);
}

/* ---------- News for your team: what changed and what to do about it ---------- */
const OUT_ALL = new Set([...OUT_NOW, "IL7", "IL10", "IL15", "IL60"]);
function newsAdvice(i, p, A, me, L){
  const {E} = A, lu = me.prof.lu, idx = lu.starters.findIndex(q => q && q.id === p.id), starting = idx >= 0;
  const fill = () => {   // who takes his spot if he sits
    const without = E.lineup(me.roster.filter(q => q.id !== p.id));
    const inIds = new Set(lu.starters.filter(Boolean).map(q => q.id));
    const sub = without.starters.find(q => q && !inIds.has(q.id));
    return sub ? `${sub.name} moves into your lineup` : "you have nobody to fill his spot, so check the pickups below";
  };
  const status = i.kind === "injury" ? i.to : p.inj;
  if (OUT_ALL.has(status)){
    const ir = /^(IR|IL\d+|PUP)$/.test(status) ? " Move him to an IR spot if your league has one, which frees a roster spot for a pickup." : "";
    return (starting ? `Bench him: ${fill()}.` : "He's already on your bench, so no lineup change.") + ir;
  }
  if (status === "Doubtful") return starting ? `Plan to sit him: ${fill()}.` : "Leave him on your bench.";
  if (status === "Questionable" || status === "DTD") return starting ? `Game-time call. If he's ruled out, ${fill()}.` : "Keep an eye on it; he's on your bench either way.";
  if (i.kind === "injury" && !i.to) return starting ? "Back in your lineup." : "Healthy again; see if he beats one of your starters.";
  if (i.kind === "team") return `Recheck his role: his value is now ${fmt(E.val(p))}.`;
  const g = TS.signalOf(p, L.sport);
  if (g && g.sell) return "The trained model is lower on him than his value. A good time to shop him.";
  if (g && g.buy) return "The trained model likes his next game. Keep him in your lineup.";
  return "";
}
function renderTeamNews(app, L, A, me){
  const cut = new Date(Date.now() - 7 * 864e5).toISOString();
  const rows = me.roster.map(p => ({p, items: TS.newsFor(L.sport, p.id).filter(i => i.d >= cut)})).filter(r => r.items.length || (r.p.inj && OUT_ALL.has(r.p.inj)));
  if (!rows.length) return;
  const starterIds = new Set(me.prof.lu.starters.filter(Boolean).map(p => p.id));
  const urgency = r => (TS.HURT.has(r.p.inj) ? 2 : r.p.inj ? 1 : 0) + (starterIds.has(r.p.id) ? 2 : 0);
  rows.sort((a, b) => urgency(b) - urgency(a) || A.E.val(b.p) - A.E.val(a.p));
  const panel = el("section", {class:"panel news-panel"}, el("h2", {text:"News for your team"}),
    el("p", {class:"sub", text:"Injury changes, team changes, and the latest notes on your players from the past week, updated every morning, with what to do about each."}));
  const ul = el("ul", {class:"news"});
  rows.slice(0, 12).forEach(({p, items}) => {
    const top = items[0] || {kind:"injury", to:p.inj, from:"", d:new Date().toISOString()};
    const advice = newsAdvice(top, p, A, me, L);
    const lvl = TS.HURT.has(p.inj) ? "bad" : p.inj ? "warn" : top.kind === "injury" && !top.to ? "good" : "";
    const nm = el("div", {class:"nm"}, el("b", {text:p.name}), injTag(p) || "", TS.signalTag(p, L.sport) || "",
      el("small", {text:` ${p.pos}, ${p.team || "FA"}${starterIds.has(p.id) ? ", starter" : ", bench"}`}));
    const body = el("div", {class:"body"}, nm);
    items.slice(0, 2).forEach(i => {
      const t = TS.newsLine(i);
      if (t) body.append(el("p", {class:"line"}, el("span", {class:"when", text:TS.newsWhen(i) + " "}), t,
        i.url ? el("a", {href:i.url, target:"_blank", rel:"noopener", text:" Read"}) : ""));
    });
    if (advice) body.append(el("p", {class:"todo", text:advice}));
    ul.append(el("li", {class:lvl}, body));
  });
  panel.append(ul);
  app.append(panel);
}

/* ---------- Buy low, sell high: where the trained model disagrees with trade value ---------- */
function renderBuySell(app, L, A, me){
  const {E} = A, sp = L.sport;
  if (!me.roster.some(p => TS.signalOf(p, sp)) && !E.pool.some(p => TS.signalOf(p, sp))) return;
  const mine = new Set(me.roster.map(p => p.id));
  const others = A.teams.filter(t => t.id !== me.id && t.roster.length);
  const owner = new Map(); others.forEach(t => t.roster.forEach(p => owner.set(p.id, t)));
  const sells = me.roster.filter(p => { const g = TS.signalOf(p, sp); return g && g.sell; })
    .sort((a, b) => E.val(b) - E.val(a)).slice(0, 4);
  const cap = Math.max(...me.roster.map(p => E.val(p)), 0) * 1.1;
  const pool = others.length ? others.flatMap(t => t.roster) : E.pool.filter(p => !mine.has(p.id));
  const need = new Set(me.needs);
  const buys = pool.filter(p => { const g = TS.signalOf(p, sp); return g && g.buy && E.val(p) >= 10 && E.val(p) <= cap; })
    .sort((a, b) => (need.has(E.groupOf(b)) - need.has(E.groupOf(a))) || TS.signalOf(b, sp).s * E.val(b) - TS.signalOf(a, sp).s * E.val(a)).slice(0, 6);
  if (!sells.length && !buys.length) return;
  const panel = el("section", {class:"panel"}, el("h2", {text:"Buy low, sell high"}),
    el("p", {class:"sub", text:"Where the trained prop model disagrees with trade value. It predicts each player's next game from three seasons of game logs, his opponent, role, and rest, and ranks him at his position. A player it ranks well above his trade value is a buy; well below is a sell."}));
  const row = (p, kind) => {
    const g = TS.signalOf(p, sp), t = owner.get(p.id);
    const btn = el("button", {class:"btn", text: kind === "sell" ? "Shop him" : "Build a trade",
      onclick: () => kind === "sell" ? openInCalculator([p], []) : openInCalculator([], [p])});
    return el("li", {}, el("span", {class:"slot " + (kind === "sell" ? "sig-sell" : "sig-buy"), text: kind === "sell" ? "Sell" : "Buy"}),
      el("span", {class:"nm"}, p.name, injTag(p) || "", el("small", {text:` ${p.pos}, ${p.team || "FA"}${t ? `, on ${t.name}` : ""}, value ${fmt(E.val(p))}`}),
        el("small", {class:"insight", text: TS.signalText(p, sp)})), btn);
  };
  const ul = el("ul", {class:"lu bs"});
  sells.forEach(p => ul.append(row(p, "sell")));
  buys.forEach(p => ul.append(row(p, "buy")));
  panel.append(ul);
  app.append(panel);
}

/* ---------- Defense vs position table (football) ---------- */
let defenseData = null, defenseSort = "RB";
async function renderDefense(app){
  const box = el("details", {class:"panel"});
  box.append(el("summary", {text:"Defense vs position"}));
  const body = el("div");
  box.append(body);
  app.append(box);
  try { defenseData = defenseData || await TS.getJSON("data/nfl-defense.json"); }
  catch(e){ body.append(el("p", {class:"sub", text:"Defense ratings show up after the next daily data run."})); return; }
  const draw = () => {
    body.innerHTML = "";
    body.append(el("p", {class:"sub", text:"Fantasy points each defense allows to each position compared with the league average, blending this season with last. Green means easier for your players. Click a column to sort."}));
    const POS = ["QB","RB","WR","TE"];
    const rows = Object.entries(defenseData.teams || {}).sort((a, b) => b[1][defenseSort][0] - a[1][defenseSort][0]);
    const head = el("tr", {}, el("th", {text:"Defense"}), el("th", {text:"Next game"}),
      ...POS.map(p => el("th", {style:"cursor:pointer", text: p + (p === defenseSort ? " ▾" : ""), onclick: () => { defenseSort = p; draw(); }})));
    const tb = el("tbody");
    rows.forEach(([team, r]) => {
      tb.append(el("tr", {}, el("td", {text:team}), el("td", {text:(defenseData.next || {})[team] || "-"}),
        ...POS.map(p => {
          const f = r[p][0], pct = Math.round((f - 1) * 100);
          const cls = f >= 1.12 ? "g2" : f >= 1.04 ? "g1" : f <= 0.88 ? "b2" : f <= 0.96 ? "b1" : "";
          return el("td", {class:"f " + cls, title:`Ranks ${r[p][1]} of ${rows.length} (1 = toughest)`, text:(pct > 0 ? "+" : "") + pct + "%"});
        })));
    });
    body.append(el("div", {class:"tablewrap"}, el("table", {class:"rank-t def-t"}, el("thead", {}, head), tb)));
  };
  draw();
}

/* ---------- AI GM context ---------- */
function leaguePrompt(L, A, me, q){
  const {E} = A, sp = L.sport;
  const fmtS = {ppr:"PPR", half:"half PPR", std:"standard"}[settings.scoring];
  const line = p => TS.aiLine(p, sp);
  const out = [];
  out.push(`League: ${L.name} (${L.source === "manual" ? "entered by hand" : L.source}), ${L.size} teams, ${TS.sportName(sp)}, ${settings.mode}${sp === "nfl" ? `, ${fmtS}, ${settings.qb === "sf" ? "superflex" : "1 QB"}` : ""}.`);
  out.push(`Starting lineup slots: ${L.slots.join(", ")}. The app weighs outlook ${settings.upside}% and track record ${100 - settings.upside}%.`);
  out.push("", `MY TEAM: ${me.name}`, "Starters:");
  me.prof.lu.starters.forEach((p, i) => out.push(`- ${L.slots[i]}: ${p ? line(p) : "EMPTY"}`));
  out.push("Bench:");
  me.prof.lu.bench.forEach(p => out.push(`- ${line(p)}`));
  out.push("", "Position grades vs " + (A.useLeague ? "league average" : "an average team") + ":");
  me.shownGroups.forEach(g => {
    const r = A.ranks[me.id] && A.ranks[me.id][g];
    out.push(`- ${g}: ${gradeInfo(me.grades[g])[1]} (${Math.round(me.grades[g] * 100)}% of average${r ? `, ranked ${r} of ${A.fullCount}` : ""})`);
  });
  const others = A.teams.filter(t => t.id !== me.id && t.roster.length);
  if (others.length){
    out.push("", "OTHER TEAMS (top players, needs):");
    others.slice(0, 15).forEach(t => out.push(`- ${t.name}: needs ${t.needs.slice(0, 2).join(", ") || "nothing"}; strong at ${t.strengths.slice(0, 2).join(", ") || "nothing"}; top: ${[...t.roster].sort(E.byVal).slice(0, 5).map(p => `${p.name} ${p.pos} ${fmt(E.val(p))}`).join(", ")}`));
  }
  if (lastIdeas.length){
    out.push("", "TRADE IDEAS FROM THE APP'S MODEL:");
    lastIdeas.slice(0, 6).forEach(f => out.push(`- Send ${f.give.map(p => p.name).join(" + ")} to ${f.team.name} for ${f.get.map(p => p.name).join(" + ")} (my lineup +${fmt(f.myGain)}, theirs ${f.theirGain >= 0 ? "+" : ""}${fmt(f.theirGain)}${Math.abs(f.edge) >= 0.3 ? `, trained model ${f.edge > 0 ? "likes" : "is wary of"} it` : ""})`));
  }
  if (lastPickups){
    const pk = [...lastPickups.starts.map(s => `${s.p.name} (${s.p.pos}, would start at ${s.slot}, +${fmt(s.gain)})`), ...lastPickups.stash.map(s => `${s.p.name} (${s.p.pos}, depth)`)];
    if (pk.length) out.push("", `WAIVER OPTIONS (${lastPickups.exact ? "confirmed available" : "probably available"}): ${pk.join("; ")}`);
  }
  out.push("", `My question: ${q || "What are my best moves this week?"}`);
  return out.join("\n");
}

/* ---------- Views ---------- */
function renderSetup(app){
  const has = sportLeagues();
  const wrap = el("section", {class:"panel"});
  wrap.append(el("h2", {text: has.length ? "Add another league" : `Set up your ${TS.sportName(sport).toLowerCase()} league`}),
    el("p", {class:"sub", text:"Sync straight from Sleeper, or enter rosters yourself for ESPN, Yahoo, or any other platform."}));
  const grid = el("div", {class:"setup"});

  // Sleeper side
  const left = el("div", {}, el("h3", {text:"Sync from Sleeper"}));
  if (sport === "nfl" || sport === "nba"){
    const name = el("input", {type:"text", placeholder:"Your Sleeper username", autocomplete:"off", "aria-label":"Sleeper username"});
    name.value = store.get("tradescale:sleeper-user") || "";
    const go = el("button", {class:"btn primary", text:"Find my leagues"});
    const msg = el("p", {class:"err"}); msg.hidden = true;
    const list = el("ul", {class:"leagues"});
    const find = async () => {
      const u = name.value.trim(); if (!u) return;
      msg.hidden = true; list.innerHTML = ""; go.disabled = true; go.textContent = "Looking...";
      try {
        const user = await sl(`user/${encodeURIComponent(u)}`);
        if (!user || !user.user_id) throw new Error("nouser");
        store.set("tradescale:sleeper-user", u);
        let season = new Date().getFullYear();
        try { const st = await sl(`state/${sport}`); if (st && st.season) season = Number(st.season); } catch(e){}
        let lgs = await sl(`user/${user.user_id}/leagues/${sport}/${season}`) || [];
        if (!lgs.length) lgs = await sl(`user/${user.user_id}/leagues/${sport}/${season - 1}`) || [];
        if (!lgs.length){ msg.textContent = `No ${TS.sportName(sport).toLowerCase()} leagues found for ${u} this season.`; msg.hidden = false; }
        lgs.forEach(lg => {
          const b = el("button", {}, el("strong", {text: lg.name}), el("br"),
            el("small", {text:`${lg.total_rosters} teams, ${lg.season} season${(lg.settings || {}).type === 2 ? ", dynasty" : ""}`}));
          b.onclick = async () => {
            b.disabled = true; b.querySelector("small").textContent = "Importing rosters...";
            try {
              const [rosters, users] = await Promise.all([sl(`league/${lg.league_id}/rosters`), sl(`league/${lg.league_id}/users`)]);
              const L = sleeperLeague(lg, rosters, users, user.user_id);
              leagues = leagues.filter(x => x.id !== L.id).concat(L);
              active[sport] = L.id; view.creating = false; saveLeagues(); applyPrefs(L); render();
            } catch(e){ b.disabled = false; msg.textContent = "Couldn't load that league's rosters. Try again in a moment."; msg.hidden = false; }
          };
          list.append(el("li", {}, b));
        });
      } catch(e){
        msg.textContent = e.message === "nouser" || e.message === "http 404" ? `Sleeper doesn't have a user named "${u}". Check the spelling (it's your username, not your team name).`
          : e.message === "network" ? "This page couldn't reach Sleeper. Your browser or network may be blocking it. You can still build the league by hand on the right."
          : "Sleeper didn't answer. Try again in a moment.";
        msg.hidden = false;
      }
      go.disabled = false; go.textContent = "Find my leagues";
    };
    go.onclick = find; name.onkeydown = e => { if (e.key === "Enter") find(); };
    left.append(el("div", {class:"bar-row"}, name, go), msg, list);
  } else {
    left.append(el("p", {class:"sub", text:"Sleeper doesn't run baseball or hockey leagues. Build yours by hand on the right. Adding your own roster takes a couple of minutes, and adding other teams unlocks trade ideas with them."}));
  }

  // Manual side
  const right = el("div", {}, el("h3", {text:"Build it yourself"}));
  const lname = el("input", {type:"text", value:`My ${TS.sportName(sport).toLowerCase()} league`});
  const size = el("select", {}); [8,10,12,14,16,18,20].forEach(n => size.append(el("option", {value:n, text:`${n} teams`, selected: n === 12 ? "" : false})));
  const slotsIn = el("textarea", {}); slotsIn.value = DEFAULT_SLOTS[sport];
  const create = el("button", {class:"btn primary", text:"Create league", onclick: () => {
    const slots = parseSlots(slotsIn.value); if (!slots.length) return;
    const L = {id:"m-" + Date.now(), sport, name: lname.value.trim() || "My league", source:"manual", size: Number(size.value),
               slots, benchSize: Math.round(slots.length * 0.6), teams:[{id:"t1", name:"My team", players:[]}], myTeamId:"t1"};
    leagues.push(L); active[sport] = L.id; view = {creating:false, editing:true, compare:"", ideaTeam:""}; saveLeagues(); render();
  }});
  right.append(el("label", {class:"field"}, "League name", lname),
    el("label", {class:"field", style:"margin-top:10px"}, "League size", size),
    el("label", {class:"field", style:"margin-top:10px"}, "Starting lineup slots (comma separated, bench not needed)", slotsIn),
    el("div", {class:"actions", style:"justify-content:flex-start"}, create));
  grid.append(left, right);
  wrap.append(grid);
  const synced = el("div", {style:"margin-top:18px;border:1px solid var(--line);border-radius:14px;padding:16px"},
    el("h3", {style:"margin-top:0", text:"Synced from ESPN or Yahoo"}));
  const slist = el("ul", {class:"synced"}, el("li", {class:"split", text:"Checking for synced leagues..."}));
  synced.append(slist);
  wrap.append(synced);
  TS.getJSON("data/leagues/index.json").then(idx => {
    const mine = (idx || []).filter(e => e.sport === sport);
    slist.innerHTML = "";
    if (!mine.length) throw new Error("none");
    mine.forEach(e => {
      const b = el("button", {class:"btn", text: e.ok === false ? "Retry later" : "Import", disabled: e.ok === false ? "" : false});
      b.onclick = async () => {
        b.disabled = true; b.textContent = "Importing...";
        try {
          const L = await TS.getJSON(`data/leagues/${e.id}.json`);
          leagues = leagues.filter(x => x.id !== L.id).concat(L);
          active[sport] = L.id; view.creating = false; saveLeagues(); applyPrefs(L); render();
        } catch(err){ b.disabled = false; b.textContent = "Couldn't load, try again"; }
      };
      slist.append(el("li", {class:"bar-row", style:"justify-content:space-between;border-bottom:1px solid var(--line);padding:8px 0"},
        el("span", {}, el("strong", {text:e.name}), el("small", {class:"split", text: e.ok === false ? `  ${e.error || "Last sync failed"}` : `  ${e.source === "espn" ? "ESPN" : "Yahoo"}, synced ${TS.ago(e.syncedAt)}${e.unmatched ? `, ${e.unmatched} players not matched` : ""}`})), b));
    });
  }).catch(() => {
    slist.innerHTML = "";
    slist.append(el("li", {class:"sub", style:"margin:0", text:"No ESPN or Yahoo leagues are set up yet. Those platforms need a login, so they sync through your daily GitHub job: list your league in leagues.json and add your login secrets. The README walks through it step by step."}));
  });
  if (has.length) wrap.append(el("div", {class:"actions", style:"justify-content:flex-start"},
    el("button", {class:"btn", text:"Back to my league", onclick: () => { view.creating = false; render(); }})));
  app.append(wrap);
}

function renderLeagueBar(app, L, A){
  const bar = el("section", {class:"panel", style:"margin-top:0"});
  const row = el("div", {class:"bar-row"});
  const lsel = el("select", {class:"inline", "aria-label":"League"});
  sportLeagues().forEach(l => lsel.append(el("option", {value:l.id, text:l.name, selected: l.id === L.id ? "" : false})));
  lsel.onchange = () => { active[sport] = lsel.value; view.compare = ""; view.ideaTeam = ""; saveLeagues(); render(); };
  const tsel = el("select", {class:"inline", "aria-label":"Your team"});
  L.teams.forEach(t => tsel.append(el("option", {value:t.id, text:t.name, selected: t.id === L.myTeamId ? "" : false})));
  tsel.onchange = () => { L.myTeamId = tsel.value; view.compare = ""; saveLeagues(); render(); };
  row.append(el("label", {class:"field"}, "League", lsel), el("label", {class:"field"}, "Your team", tsel));
  const btns = el("div", {class:"bar-row", style:"margin-left:auto;align-self:flex-end"});
  if (L.source === "sleeper"){
    const rb = el("button", {class:"btn", text:"Refresh rosters"}); rb.onclick = () => refreshSleeper(L, rb);
    btns.append(el("small", {class:"split", text:`Synced ${TS.ago(L.syncedAt)}`}), rb);
  } else if (L.source === "espn" || L.source === "yahoo"){
    btns.append(el("small", {class:"split", text:`${L.source === "espn" ? "ESPN" : "Yahoo"} rosters from ${TS.ago(L.syncedAt)}, refreshed every morning`}));
  } else {
    btns.append(el("button", {class:"btn", text: view.editing ? "Done editing" : "Edit teams", onclick: () => { view.editing = !view.editing; render(); }}));
  }
  btns.append(el("button", {class:"btn", text:"Add league", onclick: () => { view.creating = true; render(); }}),
    el("button", {class:"btn", text:"Remove", onclick: () => {
      if (!confirm(`Remove "${L.name}" from this browser?`)) return;
      leagues = leagues.filter(l => l.id !== L.id); delete active[sport]; saveLeagues(); render();
    }}));
  row.append(btns);
  bar.append(row);
  const missing = A.teams.find(t => t.id === L.myTeamId)?.missing || 0;
  if (missing) bar.append(el("p", {class:"sub", style:"margin:10px 0 0", text:`${missing} player${missing > 1 ? "s" : ""} on your roster ${missing > 1 ? "aren't" : "isn't"} on a pro roster right now, so ${missing > 1 ? "they're" : "it's"} left out.`}));
  app.append(bar);
}

function renderTeamEditor(app, L){
  const panel = el("section", {class:"panel"});
  panel.append(el("h2", {text:"Teams"}), el("p", {class:"sub", text:"Add your roster first. Add other teams' rosters too, and you'll get trade ideas with those teams, league rankings, and exact waiver pickups."}));
  const grid = el("div", {class:"teams-edit"});
  const allIds = () => new Set(L.teams.flatMap(t => t.players.map(String)));
  L.teams.forEach(t => {
    const card = el("div", {class:"team-card"});
    const nm = el("input", {type:"text", value:t.name, "aria-label":"Team name", class:"field"});
    nm.style.cssText = "border:1px solid var(--line);background:var(--paper);border-radius:10px;padding:6px 10px;font-weight:600;width:100%";
    nm.onchange = () => { t.name = nm.value.trim() || t.name; saveLeagues(); };
    const head = el("div", {class:"bar-row"}, nm);
    if (t.id !== L.myTeamId) head.append(el("button", {class:"x", text:"×", "aria-label":`Remove ${t.name}`, onclick: () => {
      L.teams = L.teams.filter(x => x.id !== t.id); saveLeagues(); render(); }}));
    card.append(head, el("div", {class:"split", style:"margin-top:4px", text: t.id === L.myTeamId ? "Your team" : `${t.players.length} players`}));
    const sHost = el("div", {class:"search", style:"margin-top:8px"});
    card.append(sHost);
    const srch = TS.makeSearch(sHost, {sport: () => sport, exclude: allIds, label:`Add a player to ${t.name}`,
      placeholder: () => "Add a player", onPick: p => { t.players.push(p.id); view.focusTeam = t.id; saveLeagues(); render(); }});
    if (view.focusTeam === t.id){ view.focusTeam = null; setTimeout(() => srch.input.focus({preventScroll:true}), 0); }
    const ul = el("ul");
    t.players.map(id => TS.pools[sport].byId.get(String(id))).filter(Boolean).sort((a, b) => adjusted(b, sport) - adjusted(a, sport)).forEach(p => {
      ul.append(el("li", {}, el("span", {}, p.name, el("small", {text:` ${p.pos}, ${Math.round(adjusted(p, sport))}`})),
        el("button", {class:"x", text:"×", "aria-label":`Remove ${p.name}`, onclick: () => { t.players = t.players.filter(x => String(x) !== p.id); saveLeagues(); render(); }})));
    });
    card.append(ul);
    grid.append(card);
  });
  panel.append(grid, el("div", {class:"actions", style:"justify-content:flex-start"},
    el("button", {class:"btn", text:"Add a team", onclick: () => { L.teams.push({id:"t" + Date.now(), name:`Team ${L.teams.length + 1}`, players:[]}); saveLeagues(); render(); }})));
  app.append(panel);
}

function renderAnalysis(app, L, A){
  const {E} = A, me = A.teams.find(t => t.id === L.myTeamId);
  if (!me || !me.roster.length){
    app.append(el("section", {class:"panel"}, el("p", {class:"empty", style:"margin:0", text:"Add players to your team to see your lineup, needs, trade ideas, and pickups."})));
    return;
  }
  const them = view.compare ? A.teams.find(t => t.id === view.compare) : null;

  renderTeamNews(app, L, A, me);
  const grid = el("div", {class:"lg-grid"});
  // Lineup
  const lu = el("section", {class:"panel"}, el("h2", {text:"Your best lineup"}),
    el("p", {class:"sub", text:`Starters are worth ${fmt(me.prof.lu.total)} combined.${A.powerOrder.length >= 2 ? ` That ranks ${A.powerOrder.indexOf(me) + 1} of ${A.powerOrder.length} teams entered.` : ""}`}));
  const ul = el("ul", {class:"lu"});
  me.prof.lu.starters.forEach((p, i) => {
    if (!p){ ul.append(el("li", {class:"empty-slot"}, el("span", {class:"slot", text:L.slots[i]}), el("span", {class:"nm", text:"Empty, nobody on your roster fits"}), el("span"))); return; }
    const nm = el("span", {class:"nm"}, p.name); const tg = injTag(p); if (tg) nm.append(tg);
    const mt = TS.matchupTag(p); if (mt) nm.append(mt);
    nm.append(el("small", {text:`${p.pos}, ${p.team}${p.prod != null ? `, track record ${p.prod}` : ""}${p.outlook != null ? `, outlook ${p.outlook}` : ""}`}));
    const ins = TS.insightText(p); if (ins) nm.append(el("small", {class:"insight", text:ins}));
    ul.append(el("li", {}, el("span", {class:"slot", text:L.slots[i]}), nm, el("span", {class:"v", text:fmt(E.val(p))})));
  });
  lu.append(ul);
  if (me.prof.lu.bench.length){
    lu.append(el("h3", {text:"Bench"}));
    const bu = el("ul", {class:"lu"});
    me.prof.lu.bench.forEach(p => {
      const nm = el("span", {class:"nm"}, p.name); const tg = injTag(p); if (tg) nm.append(tg);
      const mt = TS.matchupTag(p); if (mt) nm.append(mt);
      nm.append(el("small", {text:`${p.pos}, ${p.team}`}));
      bu.append(el("li", {}, el("span", {class:"slot", text:"BN"}), nm, el("span", {class:"v", text:fmt(E.val(p))})));
    });
    lu.append(bu);
  }

  // Where you stand
  const ws = el("section", {class:"panel"}, el("h2", {text:"Where you stand"}));
  const cmp = el("select", {class:"inline", "aria-label":"Compare with"});
  cmp.append(el("option", {value:"", text:"Compare with another team..."}));
  A.teams.filter(t => t.id !== me.id && t.roster.length).forEach(t => cmp.append(el("option", {value:t.id, text:t.name, selected: t.id === view.compare ? "" : false})));
  cmp.onchange = () => { view.compare = cmp.value; view.ideaTeam = cmp.value; render(); };
  ws.append(el("p", {class:"sub", text: A.useLeague ? `Each position's starters compared with the league average (${A.fullCount} teams).`
    : `Each position's starters compared with what an average team in a ${L.size}-team league would start.`}));
  if (A.teams.filter(t => t.roster.length).length > 1) ws.append(el("div", {style:"margin-bottom:6px"}, cmp));

  // plain-language summary
  const sum = el("div", {class:"summary"});
  const bits = [];
  if (me.needs.length){
    const g = me.needs[0];
    bits.push(`Your biggest need is ${g}: your starters there are ${pct(me.grades[g])}.`);
    if (me.needs[1]) bits.push(`${me.needs[1]} is also thin.`);
  } else bits.push("You don't have a weak spot. Every position is at or above average.");
  if (me.strengths.length) bits.push(`You're strongest at ${me.strengths.slice(0, 2).join(" and ")}.`);
  const chips = me.prof.lu.bench.filter(p => E.val(p) >= 25).slice(0, 2);
  if (chips.length) bits.push(`Best trade chips: ${chips.map(p => `${p.name} (${fmt(E.val(p))})`).join(" and ")}, who ${chips.length > 1 ? "aren't" : "isn't"} starting for you.`);
  if (them){
    bits.push(them.needs.length ? `${them.name} needs ${them.needs.slice(0, 2).join(" and ")}.` : `${them.name} has no obvious weak spot.`);
  }
  sum.textContent = bits.join(" ");
  ws.append(sum);
  me.shownGroups.forEach(g => {
    const [cls, word] = gradeInfo(me.grades[g]);
    const bars = el("div", {class:"bars"});
    const b1 = el("div", {class:"bar"}, el("i", {style:`width:${Math.min(me.grades[g] / 1.5, 1) * 100}%`}), el("span", {class:"avg"}));
    bars.append(b1);
    if (them) bars.append(el("div", {class:"bar them"}, el("i", {style:`width:${Math.min((them.grades[g] || 0) / 1.5, 1) * 100}%`}), el("span", {class:"avg"})));
    const rank = A.ranks[me.id] && A.ranks[me.id][g];
    ws.append(el("div", {class:`grp ${cls}`}, el("b", {text:g}), bars,
      el("div", {class:"grade"}, el("strong", {text:word}), rank ? `${ordinal(rank)} of ${A.fullCount}` : `${fmt(me.grades[g] * 100)}% of avg`)));
  });
  ws.append(el("div", {class:"legend"}, el("span", {text:"Line = average team"}), them ? el("span", {text:`Thin gray bar = ${them.name}`}) : null));
  grid.append(lu, ws);
  app.append(grid);

  // Trade ideas
  const ti = el("section", {class:"panel"}, el("h2", {text:"Trade ideas"}));
  const others = A.teams.filter(t => t.id !== me.id && t.roster.length >= 3);
  if (others.length){
    const tsel = el("select", {class:"inline", "aria-label":"Trade partner"});
    tsel.append(el("option", {value:"", text:"All teams"}));
    others.forEach(t => tsel.append(el("option", {value:t.id, text:t.name, selected: t.id === view.ideaTeam ? "" : false})));
    tsel.onchange = () => { view.ideaTeam = tsel.value; render(); };
    ti.append(el("p", {class:"sub", text:"Deals that improve your starting lineup at roughly even value, without gutting the other team's lineup, so they have a real reason to say yes."}),
      el("div", {style:"margin-bottom:12px"}, tsel));
    const box = el("div", {class:"ideas"}, el("p", {class:"empty", style:"margin:0", text:"Crunching trades..."}));
    ti.append(box);
    setTimeout(() => {
      const ideas = tradeIdeas(A, me, view.ideaTeam);
      lastIdeas = ideas;
      box.innerHTML = "";
      if (!ideas.length) box.append(el("p", {class:"empty", style:"margin:0", text:"No even-value trade improves your lineup right now. Try the other team filter, or lean the Value by slider the other way."}));
      ideas.forEach(f => box.append(ideaCard(f, me, E, L)));
    }, 30);
  } else {
    ti.append(el("p", {class:"sub", text: L.source === "manual" ? "Add other teams' rosters (Edit teams) to get specific deals with them. Until then, here's who to target with your spare pieces." : "No other rosters to trade with."}));
    const targets = tradeTargets(A, me);
    if (!targets.length) ti.append(el("p", {class:"empty", style:"margin:0", text: me.needs.length ? "You don't have spare bench value to trade yet. Check the pickups below." : "You don't have a weak spot to trade for."}));
    targets.forEach(t => ti.append(el("div", {class:"idea"},
      el("div", {class:"deal"},
        el("div", {class:"give"}, el("h4", {text:"Offer"}), playerLine(t.chip, E, "on your bench")),
        el("span", {class:"arrow", text:"→"}),
        el("div", {class:"get"}, el("h4", {text:`For a ${t.group} like`}), ...t.targets.map(p => playerLine(p, E)))),
      el("p", {class:"why", text:`Any of these would start for you at ${t.group}, your weakest spot, and they're valued close to ${t.chip.name}.`}))));
  }
  app.append(ti);
  renderBuySell(app, L, A, me);

  // This week (football): start/sit using matchups, byes, and injury designations
  if (me.roster.some(p => p.x && p.x.nx)) renderThisWeek(app, L, A, me);

  // Pickups
  const pk = pickups(A, me, L);
  lastPickups = pk;
  const pu = el("section", {class:"panel"}, el("h2", {text:"Waiver pickups"}),
    el("p", {class:"sub", text: pk.exact ? "Players nobody in your league has rostered." : "Players ranked outside what a league your size usually rosters, so they're probably available. Check your league to confirm."}));
  const plist = el("ul", {class:"lu"});
  pk.starts.forEach(s => plist.append(el("li", {}, el("span", {class:"slot", text:s.slot}),
    el("span", {class:"nm"}, s.p.name, injTag(s.p) || "", el("small", {text:`${s.p.pos}, ${s.p.team}. Would start${s.over ? ` over ${s.over.name}` : ""}.`})),
    el("span", {class:"chip up", text:`+${fmt(s.gain)}`}))));
  pk.stash.forEach(s => plist.append(el("li", {}, el("span", {class:"slot", text:s.group}),
    el("span", {class:"nm"}, s.p.name, injTag(s.p) || "", el("small", {text:`${s.p.pos}, ${s.p.team}. Best available ${s.group} depth, ${fmt(E.val(s.p))}.`})),
    el("span", {class:"chip", text:"Stash"}))));
  if (!pk.starts.length && !pk.stash.length) plist.append(el("li", {}, el("span"), el("span", {class:"nm", text:"Nothing out there beats what you have."}), el("span")));
  pu.append(plist);
  if (pk.drop && (pk.starts.length || pk.stash.length)) pu.append(el("p", {class:"why", style:"margin-top:10px", text:`If you need a roster spot, ${pk.drop.name} (${fmt(E.val(pk.drop))}) is your least valuable player.`}));
  app.append(pu);

  // Power rankings
  if (A.powerOrder.length >= 2){
    const pr = el("section", {class:"panel"}, el("h2", {text:"Power rankings"}),
      el("p", {class:"sub", text:"By the value of each team's best starting lineup. Click a team to compare and see trades with them."}));
    const tbl = el("table", {class:"rank-t"}, el("thead", {}, el("tr", {}, ...["#","Team","Starters","Strongest","Needs"].map(h => el("th", {text:h})))));
    const tb = el("tbody");
    A.powerOrder.forEach((t, i) => {
      const tr = el("tr", {class: (t.id === me.id ? "me" : "pick")},
        el("td", {text:i + 1}), el("td", {text:t.name + (t.id === me.id ? " (you)" : "")}), el("td", {text:fmt(t.prof.lu.total)}),
        el("td", {text:t.strengths.slice(0, 2).join(", ") || "None"}), el("td", {text:t.needs.slice(0, 2).join(", ") || "None"}));
      if (t.id !== me.id) tr.onclick = () => { view.compare = t.id; view.ideaTeam = t.id; render(); window.scrollTo({top:0, behavior:"smooth"}); };
      tb.append(tr);
    });
    tbl.append(tb);
    pr.append(el("div", {class:"tablewrap"}, tbl));
    app.append(pr);
  }
  if (L.sport === "nfl") renderDefense(app);
  renderAIPanel(app, L, A, me);
}
function renderAIPanel(app, L, A, me){
  const box = el("section", {class:"panel"}, el("h2", {text:"Ask the AI GM"}));
  const host = el("div");
  box.append(host);
  app.append(box);
  AI.panel(host, {
    intro: "It reads your whole league from this page, checks today's injury news and depth charts, and tells you what to do.",
    presets: ["What are my best moves this week?", "Who should I start this week?", "Find me a trade for my weakest spot", "Who should I pick up?"],
    system: () => AI.system(TS.sportName(L.sport)),
    buildPrompt: q => leaguePrompt(L, A, me, q)
  });
}
const ordinal = n => n + (["th","st","nd","rd"][(n % 100 - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");

function ideaCard(f, me, E, L){
  // Explain each incoming starter by who he pushes out of your lineup.
  const afterIds = new Set(f.after.starters.filter(Boolean).map(p => p.id));
  const leaving = me.prof.lu.starters.filter(p => p && !afterIds.has(p.id));
  const lines = [];
  f.get.forEach(p => {
    const idx = f.after.starters.findIndex(q => q && q.id === p.id);
    if (idx < 0){ lines.push(`${p.name} adds depth`); return; }
    const g = E.groupOf(p);
    let mi = leaving.findIndex(q => E.groupOf(q) === g); if (mi < 0) mi = 0;
    const out = leaving.splice(mi, 1)[0];
    lines.push(out ? `${p.name} starts at ${L.slots[idx]} over ${out.name}` : `${p.name} fills an empty ${L.slots[idx]} spot`);
  });
  const why = lines.join(". ");
  const fills = [...new Set(f.give.map(p => E.groupOf(p)).filter(g => g && f.team.needs.includes(g)))];
  const theirWhy = fills.length ? ` It fills their ${fills.join(" and ")} need${fills.length > 1 ? "s" : ""}.` : f.theirGain >= 0 ? " Their lineup doesn't get worse." : " They lose a little lineup value, so expect some haggling.";
  const fairness = Math.round((f.ratio - 1) * 100);
  // what the trained prop model says about each side, in its own sentences
  const modelBits = [];
  const say = (p, side) => {
    const g = TS.signalOf(p, L.sport); if (!g) return;
    const pr = `${g.proj} ${g.label}`;
    if (side === "get" && g.buy) modelBits.push(`The trained model projects ${p.name} for ${pr} next game, more than his value suggests, so you're buying low.`);
    if (side === "get" && g.sell) modelBits.push(`The trained model projects only ${pr} for ${p.name} next game, less than his value suggests.`);
    if (side === "give" && g.sell) modelBits.push(`The trained model projects only ${pr} for ${p.name} next game, so you're selling high.`);
    if (side === "give" && g.buy) modelBits.push(`The trained model likes ${p.name} (${pr} next game), so you may be selling low.`);
  };
  f.get.forEach(p => say(p, "get")); f.give.forEach(p => say(p, "give"));
  const modelWhy = modelBits.length ? " " + modelBits.join(" ") : "";
  return el("div", {class:"idea"},
    el("div", {class:"deal"},
      el("div", {class:"give"}, el("h4", {text:"You send"}), ...f.give.map(p => playerLine(p, E))),
      el("span", {class:"arrow", text:"→"}),
      el("div", {class:"get"}, el("h4", {text:`From ${f.team.name}`}), ...f.get.map(p => playerLine(p, E)))),
    el("p", {class:"why", text:(why ? why + "." : "") + theirWhy + modelWhy}),
    el("div", {class:"foot"},
      el("div", {class:"bar-row"},
        el("span", {class:"chip up", text:`Your lineup +${fmt(f.myGain)}`}),
        el("span", {class:`chip ${f.theirGain >= 0 ? "up" : "down"}`, text:`Theirs ${f.theirGain >= 0 ? "+" : ""}${fmt(f.theirGain)}`}),
        el("span", {class:"chip", text: Math.abs(fairness) <= 5 ? "Even value" : fairness > 0 ? `You get ${fairness}% more value` : `You pay ${-fairness}% extra`}),
        f.edge >= 0.3 ? el("span", {class:"chip sig-buy", text:"Model likes it"}) : f.edge <= -0.3 ? el("span", {class:"chip sig-sell", text:"Model is wary"}) : null),
      el("button", {class:"btn", text:"Open in trade calculator", onclick: () => openInCalculator(f.give, f.get)})));
}

/* ---------- Page ---------- */
function renderSports(){
  const nav = $("sports"); nav.innerHTML = "";
  SPORTS.forEach(([id, label]) => nav.append(el("button", {text:label, "data-sport":id, "aria-pressed": String(sport === id), onclick: () => switchSport(id)})));
}
const refreshedFiles = new Set();
async function refreshFromFile(L){
  if (refreshedFiles.has(L.id)) return;
  refreshedFiles.add(L.id);
  try {
    const fresh = await TS.getJSON(`data/leagues/${L.id}.json`);
    if (fresh.syncedAt === L.syncedAt) return;
    const keepMine = fresh.teams.some(t => t.id === L.myTeamId) ? L.myTeamId : fresh.myTeamId;
    Object.assign(L, {teams: fresh.teams, slots: fresh.slots, benchSize: fresh.benchSize, size: fresh.size,
                      syncedAt: fresh.syncedAt, name: fresh.name, myTeamId: keepMine});
    saveLeagues(); render();
  } catch(e){ /* keep what we have */ }
}
function render(){
  renderSports();
  TS.settingsBar($("settings"), sport, render);
  const app = $("app"); app.innerHTML = "";
  const status = $("status"); status.classList.remove("warn");
  const pool = TS.pools[sport];
  if (!pool){ status.textContent = "Loading players..."; return; }
  status.textContent = `${pool.length.toLocaleString()} ${TS.sportName(sport).toLowerCase()} players, updated ${TS.ago(pool.updated)}.`;
  const L = current();
  if (!L || view.creating){ renderSetup(app); return; }
  active[sport] = L.id;
  if (L.source === "espn" || L.source === "yahoo") refreshFromFile(L);
  const mine = L.teams.find(t => t.id === L.myTeamId);
  if (L.source === "manual" && (!mine || !mine.players.length)) view.editing = true;
  const A = analyzeLeague(L);
  renderLeagueBar(app, L, A);
  if (L.source === "manual" && view.editing) renderTeamEditor(app, L);
  renderAnalysis(app, L, A);
}
async function switchSport(id){
  sport = id; view = {creating:false, editing:false, compare:"", ideaTeam:""};
  const st = store.get("tradescale:v2") || {trades:{}}; st.sport = id; store.set("tradescale:v2", st);
  render();
  try { await TS.loadSport(id); }
  catch(e){ const s = $("status"); s.classList.add("warn"); s.textContent = "Player data didn't load. Open this page from your GitHub Pages link, or run the update script first."; return; }
  render();
}
switchSport(sport);
})();
