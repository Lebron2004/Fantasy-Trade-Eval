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
  const teams = (rosters || []).map(r => {
    const st = r.settings || {};
    return {id:String(r.roster_id), name: names[r.owner_id] || `Team ${r.roster_id}`, players: (r.players || []).map(String),
            rec: {w: st.wins || 0, l: st.losses || 0, t: st.ties || 0, pf: (st.fpts || 0) + (st.fpts_decimal || 0) / 100}};
  });
  const mine = (rosters || []).find(r => r.owner_id === userId);
  const rec = (lg.scoring_settings || {}).rec || 0;
  return {
    id: "sl-" + lg.league_id, sport, name: lg.name, source: "sleeper", sleeperId: lg.league_id, userId,
    size: lg.total_rosters || teams.length, slots: slots.length ? slots : parseSlots(DEFAULT_SLOTS[sport]),
    benchSize: rp.filter(s => s === "BN").length, teams, myTeamId: mine ? String(mine.roster_id) : (teams[0] || {}).id,
    syncedAt: new Date().toISOString(), playoffTeams: Number((lg.settings || {}).playoff_teams) || null,
    regEnd: Number((lg.settings || {}).playoff_week_start) ? Number(lg.settings.playoff_week_start) - 1 : null,
    prefs: {scoring: rec >= 1 ? "ppr" : rec >= 0.5 ? "half" : "std",
            qb: rp.includes("SUPER_FLEX") || rp.filter(s => s === "QB").length >= 2 ? "sf" : "1qb",
            mode: (lg.settings || {}).type === 2 ? "dynasty" : "redraft"}
  };
}
// This week's number and every remaining regular-season matchup, for the playoff odds.
async function sleeperSchedule(L){
  let week = null;
  try { const st = await sl(`state/${L.sport}`); week = Number(st && (st.display_week || st.week)) || null; } catch(e){}
  L.week = week; L.sched = {};
  if (!week || !L.regEnd || week > L.regEnd) return;
  const ws = []; for (let w = week; w <= L.regEnd; w++) ws.push(w);
  const got = await Promise.all(ws.map(w => sl(`league/${L.sleeperId}/matchups/${w}`).catch(() => null)));
  got.forEach((m, i) => {
    if (!Array.isArray(m)) return;
    const by = {};
    m.forEach(r => { if (r.matchup_id != null) (by[r.matchup_id] ||= []).push(String(r.roster_id)); });
    L.sched[ws[i]] = Object.values(by).filter(g => g.length === 2);
  });
}
function applyPrefs(L){
  if (!L.prefs) return;
  if (L.sport === "nfl"){ TS.setSetting("scoring", L.prefs.scoring); TS.setSetting("qb", L.prefs.qb); }
  TS.setSetting("mode", L.prefs.mode);
}
async function refreshSleeper(L, btn){
  btn = btn || {};
  btn.disabled = true; btn.textContent = "Refreshing...";
  try {
    const [lg, rosters, users] = await Promise.all([sl(`league/${L.sleeperId}`), sl(`league/${L.sleeperId}/rosters`), sl(`league/${L.sleeperId}/users`)]);
    const fresh = sleeperLeague(lg, rosters, users, L.userId);
    Object.assign(L, {teams: fresh.teams, slots: fresh.slots, benchSize: fresh.benchSize, size: fresh.size, syncedAt: fresh.syncedAt, name: fresh.name,
                      playoffTeams: fresh.playoffTeams, regEnd: fresh.regEnd});
    await sleeperSchedule(L);
    if (!L.teams.some(t => t.id === L.myTeamId)) L.myTeamId = fresh.myTeamId;
    saveLeagues(); render();
  } catch(e){
    btn.disabled = false; btn.textContent = "Couldn't reach Sleeper, try again";
  }
}

let lastIdeas = [], lastPickups = null;

/* ---------- Co-manager: one brief per render, shared by every tab ---------- */
const OUT_NOW = new Set(["Out", "IR", "PUP", "Sus", "NA"]);
const TABS = [["co","Co-manager"],["start","Start / sit"],["buy","Buy"],["sell","Sell"],["pos","Positions"],["offers","Fair offers"],["playoffs","Playoffs"],["team","Team & waivers"]];
let tab = store.get("tradescale:league-tab") || "co";
const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const pctTxt = v => v == null ? "-" : v >= 0.995 ? "99%+" : v <= 0.005 ? "<1%" : `${Math.round(v * 100)}%`;
const pts = (v, B) => B.unit === "pts" ? (Math.round(v * 10) / 10).toFixed(1) : fmt(v);

function brief(L, A, me){
  const {E} = A, sp = L.sport;
  const memo = {}, once = (k, f) => () => (k in memo ? memo[k] : (memo[k] = f()));
  const B = {sp, unit: CM.unit(sp), wk: p => CM.points(p, sp), ros: p => CM.points(p, sp, true)};
  B.week = E.lineup(me.roster, B.wk);
  B.ideas = once("ideas", () => tradeIdeas(A, me, ""));
  B.pickups = once("pk", () => pickups(A, me, L));
  B.po = once("po", () => playoffs(L, A, me, B));
  B.po2 = once("po2", () => playoffs(L, A, me, B, null, 2000));
  B.buys = once("buys", () => buyList(L, A, me, B));
  B.sells = once("sells", () => sellList(L, A, me, B));
  B.calls = once("calls", () => closeCalls(L, A, me, B));
  B.changes = once("chg", () => weekChanges(me, B));
  return B;
}

// Lineup moves for this week compared with your usual (season-long) lineup.
function weekChanges(me, B){
  const seasonIds = new Set(me.prof.lu.starters.filter(Boolean).map(p => p.id));
  const weekIds = new Set(B.week.starters.filter(Boolean).map(p => p.id));
  const ins = B.week.starters.filter(p => p && !seasonIds.has(p.id));
  const outs = me.prof.lu.starters.filter(p => p && !weekIds.has(p.id));
  return ins.map((p, i) => {
    const o = outs[i];
    const why = !o ? "" : o.x && o.x.nx === "BYE" ? `${o.name} is on bye` : OUT_NOW.has(o.inj) ? `${o.name} is ${o.inj === "IR" ? "on IR" : "out"}`
      : o.inj === "Doubtful" ? `${o.name} is doubtful` : `${p.name} has the better week (${pts(B.wk(p), B)} vs ${pts(B.wk(o), B)} projected)`;
    return {p, o, why};
  });
}

// Why a player projects the way he does this week: the defense he faces, his form, and the trained model.
function matchupText(p, B){
  const x = p.x || {}, bits = [];
  if (B.sp !== "nfl"){
    if (x.sos != null && Math.abs(x.sos - 1) >= 0.03) bits.push(`${x.sos > 1 ? "easier" : "harder"} schedule than average`);
    const g = TS.signalOf(p, B.sp); if (g) bits.push(`trained model: ${g.proj} ${g.label} next game`);
    return bits.join(" · ");
  }
  if (x.nx === "BYE") return "On bye this week";
  const d = CM.defenseVs(p);
  if (d){
    const pc = Math.round((d.f - 1) * 100);
    bits.push(`${x.nx}: ${pc === 0 ? `an average defense against ${p.pos}s` : `allows ${Math.abs(pc)}% ${pc > 0 ? "more" : "fewer"} points than average to ${p.pos}s`} (${ordinal(d.rank)} toughest of ${d.of})`);
  } else if (x.nx) bits.push(x.nx);
  if (x.form != null) bits.push(`last 4: ${x.form} a game`);
  else if (x.ppg != null) bits.push(`${x.ppg} a game`);
  const g = TS.signalOf(p, B.sp); if (g && /point/i.test(g.label)) bits.push(`trained model: ${g.proj}`);
  return bits.join(" · ");
}

// Bench players close enough to a starter that it's a real decision.
function closeCalls(L, A, me, B){
  const out = [], st = B.week.starters;
  B.week.bench.forEach(b => {
    const mb = B.wk(b); if (mb <= 0) return;
    let best = null;
    st.forEach((s, i) => { if (s && accepts(L.sport, L.slots[i], b)){ const ms = B.wk(s); if (!best || ms < best.ms) best = {s, ms, i}; } });
    if (!best) return;
    const rel = B.sp === "nfl" ? 0.55 : 0.15;
    const prob = Phi((mb - best.ms) / (rel * Math.sqrt(mb * mb + best.ms * best.ms) || 1));
    if (prob >= 0.38) out.push({b, s: best.s, slot: L.slots[best.i], prob, mb, ms: best.ms});
  });
  const seen = new Set();
  return out.sort((a, b) => b.prob - a.prob).filter(c => !seen.has(c.s.id) && seen.add(c.s.id)).slice(0, 4);
}

/* Playoff odds: every team's weekly score as a bell curve around its best lineup's projection,
   simulated through the rest of the regular season. */
function teamDist(E, roster, f, sp){
  const lu = E.lineup(roster, f);
  const sd = sp === "nfl" ? 0.55 * Math.sqrt(lu.starters.reduce((a, p) => a + (p ? f(p) ** 2 : 0), 0)) : 0.12 * lu.total;
  return {mean: lu.total, sd: Math.max(sd, 1)};
}
function playoffs(L, A, me, B, override, n){
  const {E} = A, sp = L.sport, S = L.season || {};
  const W = L.week || (sp === "nfl" ? CM.nflWeek() : null);
  const regEnd = L.regEnd || S.regEnd || (sp === "nfl" ? 14 : null);
  const weeks = [];
  if (W && regEnd) for (let w = W; w <= regEnd; w++) weeks.push(w);
  else for (let w = 1; w <= (S.weeksLeft ?? 20); w++) weeks.push(w);
  const size = Math.max(L.size || 0, L.teams.length);
  const spots = Math.max(1, Math.min(S.spots || L.playoffTeams || Math.min(6, Math.floor(size / 2)), size));
  const rosterOf = t => (override && override[t.id]) || t.roster;
  const entered = A.teams.filter(t => rosterOf(t).length >= Math.max(3, L.slots.length * 0.6));
  const D = new Map(entered.map(t => [t.id, {now: teamDist(E, rosterOf(t), B.wk, sp), ros: teamDist(E, rosterOf(t), B.ros, sp)}]));
  // Teams without a roster entered play like an average team.
  let avg;
  if (entered.filter(t => t.id !== me.id).length >= 2){
    const m = k => { const l = [...D.values()].map(d => d[k]); return {mean: l.reduce((a, d) => a + d.mean, 0) / l.length, sd: l.reduce((a, d) => a + d.sd, 0) / l.length}; };
    avg = {now: m("now"), ros: m("ros")};
  } else {
    let mine = 0, typical = 0;
    me.shownGroups.forEach(g => { const s = me.prof.sums[g], gr = me.grades[g]; if (s > 0 && gr > 0){ mine += s; typical += s / gr; } });
    const f = mine ? typical / mine : 1, d = D.get(me.id) || {now:{mean:0, sd:1}, ros:{mean:0, sd:1}};
    avg = {now: {mean: d.now.mean * f, sd: d.now.sd * f}, ros: {mean: d.ros.mean * f, sd: d.ros.sd * f}};
  }
  const recOf = t => t.rec || (L.records || {})[t.id] || {w:0, l:0, t:0, pf:0};
  const teams = L.teams.map(t => ({id: t.id, name: t.name, ...recOf(t), ...(D.get(t.id) || avg), est: !D.has(t.id)}));
  const myRec = recOf(me), gp = (myRec.w || 0) + (myRec.l || 0) + (myRec.t || 0);
  for (let i = teams.length; i < size; i++) teams.push({id: "x" + i, name: `Team ${i + 1}`, w: gp / 2, l: gp / 2, t: 0, pf: 0, ...avg, est: true, phantom: true});
  let opp = null;
  if (L.sched && W && L.sched[W]){ const g = L.sched[W].find(g => g.includes(me.id)); if (g) opp = g.find(id => id !== me.id); }
  else if (S.opp) opp = S.opp;
  const mine = teams.find(t => t.id === me.id), ot = opp && teams.find(t => t.id === opp);
  const winNow = mine && ot ? Phi((mine.now.mean - ot.now.mean) / Math.sqrt(mine.now.sd ** 2 + ot.now.sd ** 2)) : null;
  const sched = L.sched && Object.keys(L.sched).length ? L.sched : {opp: S.opp};
  const res = weeks.length ? CM.simulate({teams, sched, weeks, spots, me: me.id, n: n || 4000}) : null;
  return {res, teams, weeks, spots, W, regEnd, opp: ot, winNow, mine, est: teams.filter(t => t.est).length, scheduled: !!(L.sched && Object.keys(L.sched).length)};
}

/* Fair offers for one player: the package from your roster closest to even value that helps your lineup most. */
function offerFor(A, me, target, owner){
  const {E} = A, sp = E.sp, ts = packageScore([target], sp); if (ts <= 0) return null;
  const mine = [...me.roster].sort(E.byVal).slice(0, 14), base = me.prof.lu.total;
  let best = null;
  for (const give of [...mine.map(p => [p]), ...pairs(mine)]){
    const r = packageScore(give, sp) / ts;
    if (r < 0.95 || r > 1.25) continue;            // they get at least even value, but don't overpay
    const ids = new Set(give.map(p => p.id));
    const myGain = E.lineup(me.roster.filter(p => !ids.has(p.id)).concat(target)).total - base;
    const theirGain = owner ? E.lineup(owner.roster.filter(p => p.id !== target.id).concat(give)).total - owner.prof.lu.total : 0;
    const score = myGain + 0.3 * theirGain - 25 * Math.max(0, r - 1.05);
    if (!best || score > best.score) best = {give, get: [target], myGain, theirGain, ratio: 1 / r, score, team: owner};
  }
  return best && best.myGain > -1 ? best : null;
}
function returnFor(A, me, p, others){
  const {E} = A, sp = E.sp, ps = packageScore([p], sp), base = me.prof.lu.total, need = new Set(me.needs);
  let best = null;
  others.forEach(T => T.roster.forEach(q => {
    const r = packageScore([q], sp) / ps;
    if (r < 0.8 || r > 1.1) return;
    const myGain = E.lineup(me.roster.filter(x => x.id !== p.id).concat(q)).total - base;
    const theirGain = E.lineup(T.roster.filter(x => x.id !== q.id).concat(p)).total - T.prof.lu.total;
    const score = myGain + (need.has(E.groupOf(q)) ? 4 : 0) + 0.3 * theirGain + 5 * CM.outlook(q, sp).s;
    if (!best || score > best.score) best = {give: [p], get: [q], myGain, theirGain, ratio: r, score, team: T};
  }));
  return best;
}

function buyList(L, A, me, B){
  const {E} = A, sp = L.sport, mine = new Set(me.roster.map(p => p.id));
  const others = A.teams.filter(t => t.id !== me.id && t.roster.length);
  const owner = new Map(); others.forEach(t => t.roster.forEach(p => owner.set(p.id, t)));
  const cap = Math.max(...me.roster.map(p => E.val(p)), 0) * 1.1, need = new Set(me.needs), base = me.prof.lu.total;
  const pool = others.length ? others.flatMap(t => t.roster) : E.pool.filter(p => !mine.has(p.id) && E.val(p) >= 15).slice(0, 300);
  const out = [];
  pool.forEach(p => {
    if (E.val(p) < 10 || E.val(p) > cap || TS.HURT.has(p.inj)) return;
    const o = CM.outlook(p, sp); if (o.s < 0.2) return;
    const g = E.groupOf(p), starts = E.lineup(me.roster.concat(p)).total - base > 1;
    const s = o.s + (need.has(g) ? 0.25 : 0) + (starts ? 0.15 : 0);
    out.push({p, s, why: o.why, need: need.has(g), starts, owner: owner.get(p.id)});
  });
  out.sort((a, b) => b.s * (0.5 + E.val(b.p) / 100) - a.s * (0.5 + E.val(a.p) / 100));
  return out.slice(0, 8).map(b => Object.assign(b, {offer: offerFor(A, me, b.p, b.owner)}));
}
function sellList(L, A, me, B){
  const {E} = A, sp = L.sport, others = A.teams.filter(t => t.id !== me.id && t.roster.length >= 3);
  const starters = new Set(me.prof.lu.starters.filter(Boolean).map(p => p.id)), out = [];
  me.roster.forEach(p => {
    if (E.val(p) < 12) return;
    const o = CM.outlook(p, sp), surplus = !starters.has(p.id) && E.val(p) >= 25;
    let s = -o.s; const why = o.s < 0 ? o.why.slice() : [];
    if (surplus){ s += 0.3; why.push("he doesn't crack your starting lineup, so his value is sitting on your bench"); }
    if (s < 0.2) return;
    out.push({p, s, why, surplus});
  });
  out.sort((a, b) => b.s * (0.5 + E.val(b.p) / 100) - a.s * (0.5 + E.val(a.p) / 100));
  return out.slice(0, 6).map(x => Object.assign(x, {offer: others.length ? returnFor(A, me, x.p, others) : null}));
}

/* ---------- Tab views ---------- */
const tile = (label, value, sub, cls) => el("div", {class:"tile" + (cls ? " " + cls : "")}, el("span", {class:"lbl", text:label}), el("b", {text:value}), sub ? el("small", {text:sub}) : null);
const goTab = id => { tab = id; store.set("tradescale:league-tab", id); render(); window.scrollTo({top: $("tabs") ? $("tabs").offsetTop - 12 : 0, behavior:"smooth"}); };
const recText = r => r ? `${r.w || 0}-${r.l || 0}${r.t ? "-" + r.t : ""}` : "0-0";
const oddsCls = v => v == null ? "" : v >= 0.7 ? "good" : v >= 0.4 ? "mid" : "bad";

function renderCoManager(box, L, A, me, B){
  const {E} = A, po = B.po(), my = po.res && po.res.teams[me.id];
  const tiles = el("div", {class:"tiles"});
  tiles.append(tile("Record", recText(po.mine), A.powerOrder.length >= 2 ? `Power rank ${A.powerOrder.indexOf(me) + 1} of ${A.powerOrder.length}` : ""));
  tiles.append(tile("Playoff odds", my ? pctTxt(my.odds) : "-", my ? `Top ${po.spots} make it · ${Math.round(my.wins * 10) / 10} wins projected` : "Season is over", oddsCls(my && my.odds)));
  tiles.append(po.opp ? tile("This week", pctTxt(po.winNow), `to beat ${po.opp.name}`, oddsCls(po.winNow))
    : tile("This week", `${pts(B.week.total, B)} ${B.unit}`, "projected from your best lineup"));
  if (po.opp) tiles.append(tile("Projected score", `${pts(po.mine.now.mean, B)}-${pts(po.opp.now.mean, B)}`, B.unit === "pts" ? "fantasy points" : "lineup value"));
  box.append(el("section", {class:"panel cm-head"}, el("h2", {text:`Your co-manager: ${me.name}`}),
    el("p", {class:"sub", text:"Everything worth doing this week, most important first. Each line links to the tab with the details."}), tiles));

  // The game plan
  const plan = [];
  const add = (tag, text, to, cls) => plan.push({tag, text, to, cls});
  const ch = B.changes();
  if (ch.length) ch.forEach(c => add("Lineup", `Start ${c.p.name}${c.o ? ` over ${c.o.name}` : ""}${c.why ? `: ${c.why}.` : "."}`, "start", "act"));
  else add("Lineup", "Your usual lineup is also your best lineup this week. No changes needed.", "start", "ok");
  B.week.starters.filter(p => p && p.inj && !OUT_NOW.has(p.inj)).forEach(p => add("Injury", `${p.name} is ${p.inj.toLowerCase()}. Check his status before kickoff and have a backup ready.`, "start", "warn"));
  const cc = B.calls()[0];
  if (cc) add("Close call", `${cc.slot}: ${cc.s.name} (${pts(cc.ms, B)}) or ${cc.b.name} (${pts(cc.mb, B)}). ${cc.b.name} outscores him ${pctTxt(cc.prob)} of the time.`, "start");
  const pk = B.pickups();
  if (pk.starts[0]) add("Waivers", `Pick up ${pk.starts[0].p.name} (${pk.starts[0].p.pos}, ${pk.starts[0].p.team}). He'd start${pk.starts[0].over ? ` over ${pk.starts[0].over.name}` : ""} and adds ${fmt(pk.starts[0].gain)} to your lineup.`, "team", "act");
  const idea = B.ideas()[0];
  if (idea){
    const d = oddsDelta(L, A, me, B, idea);
    add("Trade", `Offer ${idea.give.map(p => p.name).join(" + ")} to ${idea.team.name} for ${idea.get.map(p => p.name).join(" + ")}. Your lineup gains ${fmt(idea.myGain)}${d != null && Math.abs(d) >= 0.01 ? ` and your playoff odds ${d > 0 ? "rise" : "drop"} ${Math.abs(Math.round(d * 100))} points` : ""}.`, "offers", "act");
  }
  const by = B.buys()[0];
  if (by) add("Buy", `${by.p.name} (${by.p.pos}${by.owner ? `, on ${by.owner.name}` : ""}): ${by.why[0] || "the numbers like him"}.${by.offer ? ` A fair offer: ${by.offer.give.map(p => p.name).join(" + ")}.` : ""}`, "buy");
  const sl = B.sells()[0];
  if (sl) add("Sell", `${sl.p.name}: ${sl.why[0]}.${sl.offer ? ` ${sl.offer.team.name} would give you ${sl.offer.get[0].name} for him.` : ""}`, "sell");
  if (me.needs.length) add("Need", `${me.needs[0]} is your weakest spot (${pct(me.grades[me.needs[0]])}). The Positions tab shows the best fix.`, "pos");
  if (my){
    const swing = po.res.ifWin != null && po.res.ifLoss != null ? ` Win this week and they go to ${pctTxt(po.res.ifWin)}; lose and they fall to ${pctTxt(po.res.ifLoss)}.` : "";
    add("Playoffs", `You make the playoffs in ${pctTxt(my.odds)} of ${po.res ? "simulated seasons" : "seasons"}.${swing}`, "playoffs", oddsCls(my.odds) === "bad" ? "warn" : "");
  }
  const ul = el("ul", {class:"plan"});
  plan.forEach(x => ul.append(el("li", {class:x.cls || ""}, el("span", {class:"tag", text:x.tag}), el("span", {class:"txt", text:x.text}),
    el("button", {class:"btn small", text:"Details", onclick: () => goTab(x.to)}))));
  box.append(el("section", {class:"panel"}, el("h2", {text:"This week's game plan"}), ul));
  renderLearning(box, L);
}

// How the projection model has tuned itself so far.
function renderLearning(box, L){
  if (L.sport !== "nfl") return;
  const M = CM.modelState(), S = CM.START;
  const names = {proj:"Sleeper's projection", ppg:"season average", form:"last four games", model:"the trained prop model"};
  const panel = el("section", {class:"panel"}, el("h2", {text:"How the co-manager is learning"}));
  if (!M.n || M.n < 60){
    panel.append(el("p", {class:"sub", text:"Each week it saves its projection for every player, then grades itself against what they actually scored once the games are played and retunes its weights. It needs the first batch of graded games, which arrives with the next daily data update."}));
    box.append(panel); return;
  }
  const order = Object.keys(names).sort((a, b) => M.w[b] - M.w[a]);
  panel.append(el("p", {class:"sub", text:`Graded against ${M.n.toLocaleString()} real player games over ${M.weeks} week${M.weeks === 1 ? "" : "s"}${M.logged ? `, ${M.logged.toLocaleString()} of them projections this browser saved before kickoff` : ""}. It retunes every time new results come in.`}));
  const ul = el("ul", {class:"lu learn"});
  order.forEach(k => ul.append(el("li", {}, el("span", {class:"slot", text:`${Math.round(M.w[k] * 100)}%`}),
    el("span", {class:"nm", text:`Weight on ${names[k]}`}, el("small", {text:`started at ${Math.round(S.w[k] * 100)}%`})), el("span"))));
  ul.append(el("li", {}, el("span", {class:"slot", text:`${M.k}×`}), el("span", {class:"nm", text:"How much the matchup counts"},
    el("small", {text: M.k > 1.05 ? "Defenses swing scores more than it first assumed." : M.k < 0.95 ? "Defenses matter less than it first assumed." : "About as much as it first assumed."})), el("span")));
  panel.append(ul);
  if (M.check){
    const c = M.check, better = c.mae < c.mae0;
    panel.append(el("div", {class:"summary", style:"margin-top:12px", text:
      `Honest check on week ${c.week}, which it didn't train on: the tuned weights missed by ${c.mae.toFixed(2)} points per player versus ${c.mae0.toFixed(2)} with the starting weights${better ? "" : ", so it's not beating them yet and leans toward the starting weights"}.` +
      (c.hit != null ? ` On close start/sit calls it picked the higher scorer ${pctTxt(c.hit)} of the time (starting weights: ${pctTxt(c.hit0)}).` : "")}));
  }
  box.append(panel);
}

function renderStartSit(box, L, A, me, B){
  const panel = el("section", {class:"panel"}, el("h2", {text:"Start / sit"}),
    el("p", {class:"sub", text: B.sp === "nfl"
      ? "Projected fantasy points for this week: a blend of Sleeper's projection, season average, recent form, and the trained prop model, adjusted for how this week's defense treats each position, byes, and injury designations. The blend retunes itself every week."
      : "This week's value for each player, with injury designations and schedule strength counted."}));
  const ch = B.changes();
  panel.append(el("div", {class:"summary", text: ch.length ? ch.map(c => `Start ${c.p.name}${c.o ? ` over ${c.o.name}` : ""}${c.why ? `: ${c.why}.` : "."}`).join(" ")
    : "Your usual lineup is also your best lineup this week. No changes needed."}));
  const row = (slot, p, verdict) => {
    const nm = el("span", {class:"nm"}, p.name); const tg = injTag(p); if (tg) nm.append(tg);
    const mt = TS.matchupTag(p); if (mt) nm.append(mt);
    nm.append(el("small", {text:`${p.pos}, ${p.team || "FA"}`}));
    const why = matchupText(p, B); if (why) nm.append(el("small", {class:"insight", text:why}));
    return el("li", {}, el("span", {class:"slot", text:slot}), nm,
      el("span", {class:"ss"}, el("span", {class:"v", text:pts(B.wk(p), B)}), el("span", {class:"chip " + (verdict === "Start" ? "up" : "down"), text:verdict})));
  };
  const ul = el("ul", {class:"lu"});
  B.week.starters.forEach((p, i) => ul.append(p ? row(L.slots[i], p, "Start")
    : el("li", {class:"empty-slot"}, el("span", {class:"slot", text:L.slots[i]}), el("span", {class:"nm", text:"Nobody available. Check the waiver pickups."}), el("span"))));
  panel.append(ul);
  if (B.week.bench.length){
    panel.append(el("h3", {text:"Bench"}));
    const bu = el("ul", {class:"lu"});
    B.week.bench.forEach(p => bu.append(row("BN", p, "Sit")));
    panel.append(bu);
  }
  box.append(panel);
  const calls = B.calls();
  if (calls.length){
    const cp = el("section", {class:"panel"}, el("h2", {text:"Close calls"}),
      el("p", {class:"sub", text:"Bench players close enough to a starter that it's worth a second look. The chance is how often the bench player outscores him, given how much scores swing week to week."}));
    const cu = el("ul", {class:"plan"});
    calls.forEach(c => cu.append(el("li", {}, el("span", {class:"tag", text:c.slot}),
      el("span", {class:"txt"}, el("b", {text:`${c.s.name} ${pts(c.ms, B)}`}), ` or ${c.b.name} ${pts(c.mb, B)}. ${c.b.name} wins this one ${pctTxt(c.prob)} of the time.`,
        el("small", {text:`${c.s.name}: ${matchupText(c.s, B) || "no matchup data"}. ${c.b.name}: ${matchupText(c.b, B) || "no matchup data"}.`})),
      el("span", {class:"chip", text: c.prob >= 0.47 ? "Coin flip" : "Lean starter"}))));
    cp.append(cu);
    box.append(cp);
  }
}

function dealCard(f, me, E, L, B, label){
  const card = el("div", {class:"idea"},
    el("div", {class:"deal"},
      el("div", {class:"give"}, el("h4", {text:"You send"}), ...f.give.map(p => playerLine(p, E))),
      el("span", {class:"arrow", text:"→"}),
      el("div", {class:"get"}, el("h4", {text: f.team ? `From ${f.team.name}` : "You get"}), ...f.get.map(p => playerLine(p, E)))));
  if (label) card.append(el("p", {class:"why", text:label}));
  const fair = Math.round((f.ratio - 1) * 100);
  card.append(el("div", {class:"foot"}, el("div", {class:"bar-row"},
    el("span", {class:`chip ${f.myGain >= 0 ? "up" : "down"}`, text:`Your lineup ${f.myGain >= 0 ? "+" : ""}${fmt(f.myGain)}`}),
    f.team ? el("span", {class:`chip ${f.theirGain >= 0 ? "up" : "down"}`, text:`Theirs ${f.theirGain >= 0 ? "+" : ""}${fmt(f.theirGain)}`}) : null,
    el("span", {class:"chip", text: Math.abs(fair) <= 5 ? "Even value" : fair > 0 ? `You get ${fair}% more value` : `You pay ${-fair}% extra`}),
    f.team ? acceptChip(f) : null),
    el("button", {class:"btn", text:"Open in trade calculator", onclick: () => openInCalculator(f.give, f.get)})));
  return card;
}
function acceptChip(f){
  const [t, c] = f.theirGain >= 0 && f.ratio <= 1.03 ? ["Likely yes", "up"] : f.theirGain >= -2 && f.ratio <= 1.1 ? ["Worth a try", ""] : ["Needs a sweetener", "down"];
  return el("span", {class:"chip " + c, text:t});
}

function renderBuy(box, L, A, me, B){
  const {E} = A, list = B.buys();
  const panel = el("section", {class:"panel"}, el("h2", {text:"Players to buy"}),
    el("p", {class:"sub", text:"Players whose outlook is better than their trade value: the trained model likes them more than the market does, they're heating up, they've been unlucky against their projection, or their schedule gets easier. Players who fill one of your needs come first, each with a fair offer from your roster."}));
  if (!list.length) panel.append(el("p", {class:"empty", text:"Nobody stands out as underpriced right now."}));
  list.forEach(b => {
    const head = el("div", {class:"bs-head"}, el("span", {class:"slot sig-buy", text:"Buy"}),
      el("span", {class:"nm"}, el("b", {text:b.p.name}), injTag(b.p) || "", el("small", {text:` ${b.p.pos}, ${b.p.team || "FA"}${b.owner ? `, on ${b.owner.name}` : ""}, value ${fmt(E.val(b.p))}${b.need ? ", fills a need" : ""}${b.starts ? ", would start for you" : ""}`})));
    const card = el("div", {class:"bs-card"}, head, el("p", {class:"why", text: cap1(b.why.join("; ")) + "."}));
    if (b.offer) card.append(dealCard(b.offer, me, E, L, B, b.owner ? "" : "Nobody else's roster is entered, so this is what to offer whoever has him."));
    else card.append(el("p", {class:"why", text:"No package from your roster gets close to his value without hurting your lineup."}));
    panel.append(card);
  });
  box.append(panel);
}
function renderSell(box, L, A, me, B){
  const {E} = A, list = B.sells();
  const panel = el("section", {class:"panel"}, el("h2", {text:"Players to sell"}),
    el("p", {class:"sub", text:"Your players whose trade value is ahead of their outlook (the trained model is lower on them, they're cooling off, scoring above their projection, or facing a tough schedule), plus bench players worth more as trade chips. Each comes with the best fair return from another team."}));
  if (!list.length) panel.append(el("p", {class:"empty", text:"Nobody on your roster looks overpriced right now."}));
  list.forEach(x => {
    const head = el("div", {class:"bs-head"}, el("span", {class:"slot sig-sell", text:"Sell"}),
      el("span", {class:"nm"}, el("b", {text:x.p.name}), injTag(x.p) || "", el("small", {text:` ${x.p.pos}, ${x.p.team || "FA"}, value ${fmt(E.val(x.p))}`})));
    const card = el("div", {class:"bs-card"}, head, el("p", {class:"why", text: cap1(x.why.join("; ")) + "."}));
    if (x.offer) card.append(dealCard(x.offer, me, E, L, B, ""));
    else {
      const needy = A.teams.filter(t => t.id !== me.id && t.needs.includes(E.groupOf(x.p))).map(t => t.name);
      card.append(el("p", {class:"why", text: needy.length ? `Shop him to ${needy.slice(0, 3).join(", ")}: they're thin at ${E.groupOf(x.p)}.` : "Add other teams' rosters to see a specific return."}),
        el("button", {class:"btn", text:"Shop him in the calculator", onclick: () => openInCalculator([x.p], [])}));
    }
    panel.append(card);
  });
  box.append(panel);
}
const cap1 = s => s ? s[0].toUpperCase() + s.slice(1) : s;

function renderPositions(box, L, A, me, B){
  const {E} = A, pk = B.pickups(), ideas = B.ideas(), buys = B.buys();
  const panel = el("section", {class:"panel"}, el("h2", {text:"Improve your positions"}),
    el("p", {class:"sub", text: (A.useLeague ? `Each position's starters against the league average (${A.fullCount} teams)` : `Each position's starters against an average team in a ${L.size}-team league`) + ", weakest first, with the best way to fix it."}));
  const groups = [...me.shownGroups].sort((a, b) => me.grades[a] - me.grades[b]);
  groups.forEach(g => {
    const [cls, word] = gradeInfo(me.grades[g]), rank = A.ranks[me.id] && A.ranks[me.id][g];
    const starters = B.week.starters.filter(p => p && E.groupOf(p) === g);
    const card = el("div", {class:`pos-card ${cls}`});
    card.append(el("div", {class:"grp"}, el("b", {text:g}),
      el("div", {class:"bars"}, el("div", {class:"bar"}, el("i", {style:`width:${Math.min(me.grades[g] / 1.5, 1) * 100}%`}), el("span", {class:"avg"}))),
      el("div", {class:"grade"}, el("strong", {text:word}), rank ? `${ordinal(rank)} of ${A.fullCount}` : `${fmt(me.grades[g] * 100)}% of avg`)));
    card.append(el("p", {class:"why", text:`Starting: ${starters.map(p => `${p.name} (${pts(B.wk(p), B)} this week)`).join(", ") || "nobody"}.`}));
    const fixes = [];
    const pu = pk.starts.find(s => E.groupOf(s.p) === g) || pk.stash.find(s => s.group === g);
    if (pu) fixes.push(`Pick up ${pu.p.name} (${pu.p.team}, value ${fmt(E.val(pu.p))})${pu.gain ? `: adds ${fmt(pu.gain)} to your lineup` : " as depth"}.`);
    const id = ideas.find(f => f.get.some(p => E.groupOf(p) === g));
    if (id) fixes.push(`Trade ${id.give.map(p => p.name).join(" + ")} to ${id.team.name} for ${id.get.map(p => p.name).join(" + ")}: your lineup +${fmt(id.myGain)} at even value.`);
    const by = buys.find(b => E.groupOf(b.p) === g && (!id || !id.get.some(p => p.id === b.p.id)));
    if (by) fixes.push(`Buy-low target: ${by.p.name}${by.owner ? ` on ${by.owner.name}` : ""}${by.offer ? `, for ${by.offer.give.map(p => p.name).join(" + ")}` : ""}.`);
    if (me.grades[g] >= 1.15){
      const spare = me.prof.lu.bench.filter(p => E.groupOf(p) === g && E.val(p) >= 15);
      fixes.unshift(spare.length ? `You're deep here. ${spare.slice(0, 2).map(p => p.name).join(" and ")} could fetch help at ${me.needs[0] || "another spot"}.` : "A strength. Trade from here only if it fixes a weaker spot.");
    } else if (!fixes.length) fixes.push(me.grades[g] >= 0.92 ? "Solid. Nothing on the market clearly beats what you have." : "No clear fix on waivers or at even value. Look at the Buy tab for longer-term targets.");
    const fl = el("ul", {class:"fixes"}); fixes.forEach(t => fl.append(el("li", {text:t})));
    card.append(fl);
    panel.append(card);
  });
  box.append(panel);
}

function renderOffers(box, L, A, me, B){
  const {E} = A, ti = el("section", {class:"panel"}, el("h2", {text:"Fair offers"}));
  const others = A.teams.filter(t => t.id !== me.id && t.roster.length >= 3);
  if (!others.length){
    ti.append(el("p", {class:"sub", text: L.source === "manual" ? "Add other teams' rosters (Edit teams) to get specific deals with them. Until then, here's who to target with your spare pieces." : "No other rosters to trade with."}));
    const targets = tradeTargets(A, me);
    if (!targets.length) ti.append(el("p", {class:"empty", style:"margin:0", text: me.needs.length ? "You don't have spare bench value to trade yet. Check the pickups." : "You don't have a weak spot to trade for."}));
    targets.forEach(t => ti.append(el("div", {class:"idea"},
      el("div", {class:"deal"},
        el("div", {class:"give"}, el("h4", {text:"Offer"}), playerLine(t.chip, E, "on your bench")),
        el("span", {class:"arrow", text:"→"}),
        el("div", {class:"get"}, el("h4", {text:`For a ${t.group} like`}), ...t.targets.map(p => playerLine(p, E)))),
      el("p", {class:"why", text:`Any of these would start for you at ${t.group}, your weakest spot, and they're valued close to ${t.chip.name}.`}))));
    box.append(ti); return;
  }
  const tsel = el("select", {class:"inline", "aria-label":"Trade partner"});
  tsel.append(el("option", {value:"", text:"All teams"}));
  others.forEach(t => tsel.append(el("option", {value:t.id, text:t.name, selected: t.id === view.ideaTeam ? "" : false})));
  tsel.onchange = () => { view.ideaTeam = tsel.value; render(); };
  ti.append(el("p", {class:"sub", text:"Deals within about 15% of even value that improve your starting lineup without gutting the other team's, so they have a real reason to say yes. Each shows how it moves your playoff odds and how likely they are to accept."}),
    el("div", {style:"margin-bottom:12px"}, tsel));
  const ideas = view.ideaTeam ? tradeIdeas(A, me, view.ideaTeam) : B.ideas();
  lastIdeas = ideas;
  const list = el("div", {class:"ideas"});
  if (!ideas.length) list.append(el("p", {class:"empty", style:"margin:0", text:"No even-value trade improves your lineup right now. Try another team, or lean the Value by slider the other way."}));
  ideas.forEach((f, i) => {
    const card = ideaCard(f, me, E, L);
    const bar = card.querySelector(".foot .bar-row");
    bar.append(acceptChip(f));
    if (i < 5){ const d = oddsDelta(L, A, me, B, f); if (d != null) bar.append(el("span", {class:`chip ${d >= 0.005 ? "up" : d <= -0.005 ? "down" : ""}`, text:`Playoff odds ${d >= 0 ? "+" : ""}${Math.round(d * 100)}`})); }
    list.append(card);
  });
  ti.append(list);
  box.append(ti);
}
// How a trade moves your playoff odds (same simulated seasons with and without it).
function oddsDelta(L, A, me, B, f){
  const base = B.po2(); if (!base.res) return null;
  const giveIds = new Set(f.give.map(p => p.id)), getIds = new Set(f.get.map(p => p.id));
  const ov = {[me.id]: me.roster.filter(p => !giveIds.has(p.id)).concat(f.get)};
  if (f.team) ov[f.team.id] = f.team.roster.filter(p => !getIds.has(p.id)).concat(f.give);
  const after = playoffs(L, A, me, B, ov, 2000);
  return after.res.teams[me.id].odds - base.res.teams[me.id].odds;
}

function renderPlayoffs(box, L, A, me, B){
  const po = B.po(), my = po.res && po.res.teams[me.id], S = L.season || (L.season = {});
  const panel = el("section", {class:"panel"}, el("h2", {text:"Playoff picture"}));
  if (!po.res){
    panel.append(el("p", {class:"sub", text:"The regular season is over, so there's nothing left to simulate."}));
    box.append(panel); return;
  }
  panel.append(el("p", {class:"sub", text:`${po.res ? "4,000" : ""} simulated seasons: every remaining game played out with each team's projected lineup and normal week-to-week swings, starting from today's records. Top ${po.spots} make the playoffs; ties go to points scored.${po.est ? ` ${po.est} team${po.est > 1 ? "s" : ""} without a roster entered ${po.est > 1 ? "are" : "is"} treated as average.` : ""}`}));
  const tiles = el("div", {class:"tiles"});
  tiles.append(tile("Make playoffs", pctTxt(my.odds), `${po.weeks.length} week${po.weeks.length === 1 ? "" : "s"} left`, oddsCls(my.odds)));
  tiles.append(tile("Top-2 seed", pctTxt(my.bye), "first-round bye in most leagues"));
  tiles.append(tile("Projected wins", (Math.round(my.wins * 10) / 10).toString(), `now ${recText(po.mine)}`));
  if (po.res.ifWin != null && po.res.ifLoss != null) tiles.append(tile("This week swings it", `${pctTxt(po.res.ifWin)} / ${pctTxt(po.res.ifLoss)}`, "if you win / if you lose"));
  panel.append(tiles);
  if (po.opp) panel.append(el("div", {class:"summary", style:"margin-top:12px", text:`This week: ${me.name} ${pts(po.mine.now.mean, B)} vs ${po.opp.name} ${pts(po.opp.now.mean, B)} projected. You win ${pctTxt(po.winNow)} of the time.`}));
  // Remaining schedule (Sleeper)
  if (po.scheduled){
    const rows = po.weeks.map(w => {
      const g = (L.sched[w] || []).find(g => g.includes(me.id)); const o = g && po.teams.find(t => t.id === g.find(id => id !== me.id));
      if (!o) return null;
      const d = w === po.W ? "now" : "ros", p = Phi((po.mine[d].mean - o[d].mean) / Math.sqrt(po.mine[d].sd ** 2 + o[d].sd ** 2));
      return el("tr", {}, el("td", {text:`Week ${w}`}), el("td", {text:o.name}), el("td", {text:recText(o)}), el("td", {class:"f " + (p >= 0.6 ? "g2" : p >= 0.5 ? "g1" : p <= 0.4 ? "b2" : "b1"), text:pctTxt(p)}));
    }).filter(Boolean);
    if (rows.length) panel.append(el("h3", {text:"Your remaining schedule"}), el("div", {class:"tablewrap"}, el("table", {class:"rank-t def-t"},
      el("thead", {}, el("tr", {}, ...["Week","Opponent","Their record","Win chance"].map(h => el("th", {text:h})))), el("tbody", {}, ...rows))));
  }
  // Standings with odds
  const editable = L.source !== "sleeper";
  const sorted = [...po.teams].sort((a, b) => po.res.teams[b.id].odds - po.res.teams[a.id].odds);
  const tb = el("tbody");
  sorted.forEach(t => {
    const r = po.res.teams[t.id], real = L.teams.find(x => x.id === t.id);
    const rec = editable && real ? recInputs(L, real) : el("td", {text:recText(t)});
    tb.append(el("tr", {class: t.id === me.id ? "me" : ""}, el("td", {text: t.name + (t.id === me.id ? " (you)" : "") + (t.est ? " *" : "")}), rec,
      el("td", {text:pts(t.ros.mean, B)}), el("td", {text:(Math.round(r.wins * 10) / 10).toString()}),
      el("td", {class:"f " + (r.odds >= 0.7 ? "g2" : r.odds >= 0.5 ? "g1" : r.odds <= 0.2 ? "b2" : "b1"), text:pctTxt(r.odds)})));
  });
  panel.append(el("h3", {text:"League odds"}), el("div", {class:"tablewrap"}, el("table", {class:"rank-t def-t"},
    el("thead", {}, el("tr", {}, ...["Team", editable ? "Record (W-L)" : "Record", `Weekly ${B.unit}`, "Final wins", "Playoffs"].map(h => el("th", {text:h})))), tb)));
  if (po.est) panel.append(el("p", {class:"split", text:"* No roster entered, so this team plays like an average team."}));
  // League settings for leagues that don't sync them
  if (editable){
    const num = (label, key, def, min, max) => {
      const i = el("input", {type:"number", min, max, value: S[key] ?? def, class:"num"});
      i.onchange = () => { const v = Number(i.value); if (v >= min && v <= max){ S[key] = v; saveLeagues(); render(); } };
      return el("label", {class:"field"}, label, i);
    };
    const opp = el("select", {class:"inline", "aria-label":"This week's opponent"});
    opp.append(el("option", {value:"", text:"Not set (random)"}));
    L.teams.filter(t => t.id !== me.id).forEach(t => opp.append(el("option", {value:t.id, text:t.name, selected: S.opp === t.id ? "" : false})));
    opp.onchange = () => { S.opp = opp.value || null; saveLeagues(); render(); };
    const row = el("div", {class:"bar-row", style:"margin-top:14px"}, num("Playoff spots", "spots", po.spots, 1, 20));
    if (L.sport === "nfl" && CM.nflWeek()) row.append(num("Last regular-season week", "regEnd", po.regEnd || 14, CM.nflWeek(), 18));
    else row.append(num("Weeks left in the regular season", "weeksLeft", po.weeks.length, 0, 26));
    row.append(el("label", {class:"field"}, "This week's opponent", opp));
    panel.append(el("h3", {text:"Your league's settings"}), el("p", {class:"sub", text:`${L.source === "manual" ? "Entered by hand" : "ESPN and Yahoo syncs don't include standings yet"}, so type each team's record above and set these to match your league.`}), row);
  } else if (!po.scheduled) panel.append(el("p", {class:"split", text:"Refresh rosters to pull standings and the schedule from Sleeper."}));
  box.append(panel);
}
function recInputs(L, t){
  const R = (L.records ||= {}), r = R[t.id] || {w:0, l:0, t:0, pf:0};
  const inp = (k, lbl) => { const i = el("input", {type:"number", min:0, max:30, value:r[k] || 0, class:"num rec", "aria-label":`${t.name} ${lbl}`});
    i.onchange = () => { R[t.id] = Object.assign({w:0, l:0, t:0, pf:0}, R[t.id], {[k]: Math.max(0, Number(i.value) || 0)}); saveLeagues(); render(); }; return i; };
  return el("td", {style:"white-space:nowrap"}, inp("w", "wins"), "-", inp("l", "losses"));
}

/* ---------- News for your team: what changed and what to do about it ---------- */
const OUT_ALL = CM.OUT;
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
function leaguePrompt(L, A, me, q, B){
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
  if (B){
    const po = B.po(), my = po.res && po.res.teams[me.id];
    out.push("", `THIS WEEK'S PROJECTED LINEUP (${B.unit === "pts" ? "fantasy points, matchup-adjusted" : "value, injuries counted"}):`);
    B.week.starters.forEach((p, i) => p && out.push(`- ${L.slots[i]}: ${p.name} ${pts(B.wk(p), B)}${matchupText(p, B) ? ` (${matchupText(p, B)})` : ""}`));
    B.week.bench.slice(0, 6).forEach(p => out.push(`- Bench: ${p.name} ${pts(B.wk(p), B)}${matchupText(p, B) ? ` (${matchupText(p, B)})` : ""}`));
    B.calls().forEach(c => out.push(`- Close call at ${c.slot}: ${c.s.name} vs ${c.b.name}, bench player outscores ${pctTxt(c.prob)} of the time`));
    if (my) out.push("", `PLAYOFFS: record ${recText(po.mine)}, ${po.weeks.length} regular-season weeks left, top ${po.spots} make it. Simulated playoff odds ${pctTxt(my.odds)}, projected ${Math.round(my.wins * 10) / 10} wins` +
      (po.opp ? `. This week vs ${po.opp.name}: ${pctTxt(po.winNow)} to win` : "") + (po.res.ifWin != null ? `. Odds ${pctTxt(po.res.ifWin)} with a win, ${pctTxt(po.res.ifLoss)} with a loss.` : "."));
    const buys = B.buys().slice(0, 5), sells = B.sells().slice(0, 4);
    if (buys.length){ out.push("", "BUY TARGETS (outlook better than trade value):");
      buys.forEach(b => out.push(`- ${b.p.name} (${b.p.pos}${b.owner ? `, on ${b.owner.name}` : ""}): ${b.why.join("; ")}${b.offer ? `. Fair offer: ${b.offer.give.map(p => p.name).join(" + ")}` : ""}`)); }
    if (sells.length){ out.push("", "SELL CANDIDATES ON MY ROSTER:");
      sells.forEach(x => out.push(`- ${x.p.name} (${x.p.pos}): ${x.why.join("; ")}${x.offer ? `. Best return: ${x.offer.get[0].name} from ${x.offer.team.name}` : ""}`)); }
    if (!lastIdeas.length) lastIdeas = B.ideas();
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
              await sleeperSchedule(L);
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
  const me = A.teams.find(t => t.id === L.myTeamId);
  if (!me || !me.roster.length){
    app.append(el("section", {class:"panel"}, el("p", {class:"empty", style:"margin:0", text:"Add players to your team to see your co-manager, lineup, playoff odds, trade offers, and pickups."})));
    return;
  }
  const B = brief(L, A, me);
  if (!TABS.some(t => t[0] === tab)) tab = "co";
  const bar = el("nav", {class:"tabs", id:"tabs", role:"tablist", "aria-label":"My league sections"});
  TABS.forEach(([id, label]) => bar.append(el("button", {role:"tab", "aria-selected": String(tab === id), text:label, onclick: () => goTab(id)})));
  const box = el("div", {class:"tabbody", role:"tabpanel"}, el("section", {class:"panel"}, el("p", {class:"empty", style:"margin:0", text:"Crunching your league..."})));
  app.append(bar, box);
  const views = {co: renderCoManager, start: renderStartSit, buy: renderBuy, sell: renderSell, pos: renderPositions, offers: renderOffers, playoffs: renderPlayoffs, team: renderTeamTab};
  setTimeout(() => {
    box.innerHTML = "";
    try { views[tab](box, L, A, me, B); }
    catch(e){ console.error(e); box.append(el("section", {class:"panel"}, el("p", {class:"err", text:"Something went wrong building this tab. Try refreshing the page."}))); }
    lastPickups = B.pickups();
  }, 20);
  renderAIPanel(app, L, A, me, B);
}
function renderTeamTab(box, L, A, me, B){
  const {E} = A;
  const them = view.compare ? A.teams.find(t => t.id === view.compare) : null;

  renderTeamNews(box, L, A, me);
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
  box.append(grid);

  // Pickups
  const pk = B.pickups();
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
  box.append(pu);

  // Power rankings
  if (A.powerOrder.length >= 2){
    const pr = el("section", {class:"panel"}, el("h2", {text:"Power rankings"}),
      el("p", {class:"sub", text:"By the value of each team's best starting lineup. Click a team to compare with it here and to see trades with it under Fair offers."}));
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
    box.append(pr);
  }
  if (L.sport === "nfl") renderDefense(box);
}
function renderAIPanel(app, L, A, me, B){
  const box = el("section", {class:"panel"}, el("h2", {text:"Ask the AI GM"}));
  const host = el("div");
  box.append(host);
  app.append(box);
  AI.panel(host, {
    intro: "It reads your whole league from this page, checks today's injury news and depth charts, and tells you what to do.",
    presets: ["Give me my game plan for this week", "What are my best moves this week?", "Who should I start this week?", "Find me a trade for my weakest spot", "Who should I pick up?"],
    system: () => AI.system(TS.sportName(L.sport)),
    buildPrompt: q => leaguePrompt(L, A, me, q, B)
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
  if (L.source === "sleeper" && !refreshedFiles.has(L.id)){ refreshedFiles.add(L.id); refreshSleeper(L); }
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
  await CM.load(id);
  try { CM.learn(id); } catch(e){ console.error(e); }
  render();
}
switchSport(sport);
})();
