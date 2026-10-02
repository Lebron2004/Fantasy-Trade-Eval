/* Live prop tracking: pulls live box scores from ESPN's public API (the host ESPN's own site uses, which
   allows browser requests) and turns a player's current stat plus the time left into a live chance. */
const LIVE = (() => {
  const HOSTS = ["https://site.web.api.espn.com", "https://site.api.espn.com"];
  const PATH = {nfl:"football/nfl", nba:"basketball/nba", nhl:"hockey/nhl", mlb:"baseball/mlb"};
  // our team codes -> ESPN's
  const TEAM = {
    nfl: {LA:"LAR", WAS:"WSH"},
    nba: {},
    nhl: {NJD:"NJ", TBL:"TB", LAK:"LA", SJS:"SJ", UTA:"UTAH"},
    mlb: {AZ:"ARI", CWS:"CHW"}
  };
  const espnTeam = (sport, t) => (TEAM[sport] || {})[t] || t;
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();

  async function espn(sport, path){
    let last;
    for (const h of HOSTS){
      try {
        const r = await fetch(`${h}/apis/site/v2/sports/${PATH[sport]}/${path}`, {cache:"no-store"});
        if (r.ok) return await r.json();
        last = new Error("http " + r.status);
      } catch(e){ last = e; }
    }
    throw last || new Error("espn unavailable");
  }

  /* ---------- scoreboard + summary, cached briefly so many tracked props share one request ---------- */
  const cache = new Map();
  async function cached(key, ttl, fn){
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t < ttl) return hit.p;
    const p = fn(); cache.set(key, {t: Date.now(), p});
    p.catch(() => cache.delete(key));
    return p;
  }
  const scoreboard = sport => cached("sb:" + sport, 20000, () => espn(sport, "scoreboard"));
  const summary = (sport, id) => cached(`sum:${sport}:${id}`, 20000, () => espn(sport, `summary?event=${id}`));

  function statusOf(comp){
    const st = (comp && comp.status) || {}, ty = st.type || {};
    return {state: ty.state || "pre", completed: !!ty.completed, detail: ty.shortDetail || ty.detail || "",
            period: st.period || 0, clock: typeof st.clock === "number" ? st.clock : null};
  }
  // team: our code, or for team bets {abbr, nick} (ESPN's code plus the nickname, which survives code changes)
  async function findGame(sport, team){
    const sb = await scoreboard(sport), code = typeof team === "string" ? team : team.abbr, nick = typeof team === "string" ? "" : norm(team.nick);
    const want = espnTeam(sport, code);
    for (const ev of sb.events || []){
      const comp = (ev.competitions || [])[0] || {};
      const cs = comp.competitors || [];
      const me = cs.find(c => c.team && (c.team.abbreviation === want || c.team.abbreviation === code || (nick && norm(c.team.name || c.team.shortDisplayName) === nick)));
      if (!me) continue;
      const them = cs.find(c => c !== me) || {};
      return {id: ev.id, date: ev.date, home: me.homeAway === "home", status: statusOf(comp),
              score: [Number(me.score) || 0, Number(them.score) || 0], opp: them.team ? them.team.abbreviation : "",
              myAbbr: me.team.abbreviation};
    }
    return null;
  }

  /* ---------- fraction of the game left ---------- */
  function remaining(sport, st, home, extra){
    if (st.state === "post" || st.completed) return 0;
    if (st.state === "pre") return 1;
    const p = st.period || 1, c = st.clock ?? 0;
    if (sport === "nfl") return p > 4 ? 0.02 : Math.max(0, ((4 - p) * 900 + c) / 3600);
    if (sport === "nba") return p > 4 ? 0.02 : Math.max(0, ((4 - p) * 720 + c) / 2880);
    if (sport === "nhl") return p > 3 ? 0.02 : Math.max(0, ((3 - p) * 1200 + c) / 3600);
    if (sport === "mlb"){
      // offensive innings his team has finished: away bats in the top, home in the bottom
      const d = (st.detail || "").toLowerCase(), afterTop = /^(mid|bot|bottom|end)/.test(d), afterBot = /^end/.test(d);
      const done = (p - 1) + (home ? (afterBot ? 1 : 0) : (afterTop ? 1 : 0));
      const f = Math.max(0, (9 - done) / 9);
      if (extra && extra.pitcher){            // starting pitcher: done once someone else takes the mound
        if (extra.relieved) return 0;
        const left = Math.max(0, (extra.outsMu || 17) - (extra.outs || 0)) / (extra.outsMu || 17);
        return Math.min(f, Math.max(left, 0.05));
      }
      return p >= 9 && f === 0 ? 0.02 : f;
    }
    return 0.5;
  }

  /* ---------- box score parsing (by ESPN stat key, falling back to the column label) ---------- */
  const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const pair = v => String(v || "").split(/[\/-]/).map(num);
  const toiMin = v => { const [m, s] = String(v || "0:0").split(":").map(Number); return (m || 0) + (s || 0) / 60; };
  const ipOuts = v => { const [w, f] = String(v || "0").split(".").map(Number); return (w || 0) * 3 + (f || 0); };
  function rowsFor(sum){
    // name -> {team, groups: {groupName: {KEY/LABEL: value}}}
    const out = new Map();
    for (const tm of ((sum.boxscore || {}).players || [])){
      const abbr = (tm.team || {}).abbreviation;
      for (const grp of (tm.statistics || [])){
        const keys = grp.keys || [], labels = grp.labels || [], gname = (grp.name || grp.type || "").toLowerCase();
        (grp.athletes || []).forEach((a, order) => {
          const nm = norm((a.athlete || {}).displayName);
          if (!nm) return;
          const rec = out.get(nm) || {team: abbr, groups: {}, dnp: false, order: {}};
          const g = rec.groups[gname] = rec.groups[gname] || {};
          (a.stats || []).forEach((v, i) => { if (keys[i]) g["k:" + keys[i]] = v; if (labels[i]) g["l:" + String(labels[i]).toUpperCase()] = v; });
          if (a.didNotPlay) rec.dnp = true;
          rec.order[gname] = {i: order, n: (grp.athletes || []).length};
          out.set(nm, rec);
        });
      }
    }
    return out;
  }
  const pick = (g, keys, labels) => {
    if (!g) return undefined;
    for (const k of keys) if (g["k:" + k] != null) return g["k:" + k];
    for (const l of labels) if (g["l:" + l] != null) return g["l:" + l];
    return undefined;
  };
  function extract(sport, rec){
    const G = rec.groups, x = {}, set = (k, v) => { if (v !== undefined) x[k] = num(v); };
    if (sport === "nfl"){
      const ps = G.passing, ru = G.rushing, re = G.receiving;
      const ca = pick(ps, ["completions/passingAttempts"], ["C/ATT"]);
      if (ca !== undefined){ const [c, a] = pair(ca); x.cmp = c; x.att = a; }
      set("pyd", pick(ps, ["passingYards"], ["YDS"])); set("ptd", pick(ps, ["passingTouchdowns"], ["TD"])); set("int", pick(ps, ["interceptions"], ["INT"]));
      set("car", pick(ru, ["rushingAttempts"], ["CAR"])); set("ruyd", pick(ru, ["rushingYards"], ["YDS"])); set("rutd", pick(ru, ["rushingTouchdowns"], ["TD"]));
      set("rec", pick(re, ["receptions"], ["REC"])); set("reyd", pick(re, ["receivingYards"], ["YDS"])); set("retd", pick(re, ["receivingTouchdowns"], ["TD"]));
      set("tgt", pick(re, ["receivingTargets"], ["TGTS"]));
      x.ppr = 0.04 * (x.pyd || 0) + 4 * (x.ptd || 0) - 2 * (x.int || 0) + 0.1 * (x.ruyd || 0) + 6 * (x.rutd || 0) + (x.rec || 0) + 0.1 * (x.reyd || 0) + 6 * (x.retd || 0);
    } else if (sport === "nba"){
      const g = Object.values(G)[0];
      set("pts", pick(g, ["points"], ["PTS"])); set("reb", pick(g, ["rebounds"], ["REB"])); set("ast", pick(g, ["assists"], ["AST"]));
      set("stl", pick(g, ["steals"], ["STL"])); set("blk", pick(g, ["blocks"], ["BLK"])); set("tov", pick(g, ["turnovers"], ["TO"]));
      set("min", pick(g, ["minutes"], ["MIN"]));
      const t3 = pick(g, ["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], ["3PT"]);
      if (t3 !== undefined) x.fg3 = pair(t3)[0];
    } else if (sport === "nhl"){
      const g = G.goalies || G.goalie, sk = G.forwards || G.defenses || G.defense || G.skaters || Object.values(G).find(v => v !== g);
      if (g && Object.keys(g).length){
        set("sv", pick(g, ["saves"], ["SV"])); set("ga", pick(g, ["goalsAgainst"], ["GA"])); set("sa", pick(g, ["shotsAgainst"], ["SA"]));
      }
      if (sk){
        set("g", pick(sk, ["goals"], ["G"])); set("a", pick(sk, ["assists"], ["A"]));
        set("sog", pick(sk, ["shotsTotal", "shots"], ["SOG", "S"])); set("hit", pick(sk, ["hits"], ["HT"])); set("blk", pick(sk, ["blockedShots"], ["BS"]));
        set("ppg", pick(sk, ["powerPlayGoals"], ["PPG"]));
        const toi = pick(sk, ["timeOnIce"], ["TOI"]); if (toi !== undefined) x.toi = toiMin(toi);
        x.pts = pick(sk, ["points"], ["PTS"]) !== undefined ? num(pick(sk, ["points"], ["PTS"])) : (x.g || 0) + (x.a || 0);
      }
    } else if (sport === "mlb"){
      const b = G.batting, p = G.pitching;
      if (b){
        set("h", pick(b, ["hits"], ["H"])); set("hr", pick(b, ["homeRuns"], ["HR"])); set("rbi", pick(b, ["RBIs", "rbi"], ["RBI"]));
        set("r", pick(b, ["runs"], ["R"])); set("bb", pick(b, ["walks", "baseOnBalls"], ["BB"])); set("so", pick(b, ["strikeouts"], ["K", "SO"]));
        set("sb", pick(b, ["stolenBases"], ["SB"]));
        const d2 = pick(b, ["doubles"], ["2B"]), d3 = pick(b, ["triples"], ["3B"]);
        x.tb = (x.h || 0) + num(d2 || 0) + 2 * num(d3 || 0) + 3 * (x.hr || 0);
        x._tbApprox = d2 === undefined;
      }
      if (p){
        const ip = pick(p, ["fullInnings.partInnings", "inningsPitched"], ["IP"]); if (ip !== undefined) x.outs = ipOuts(ip);
        set("k", pick(p, ["strikeouts"], ["K", "SO"])); set("er", pick(p, ["earnedRuns"], ["ER"])); set("ha", pick(p, ["hits"], ["H"]));
        set("bba", pick(p, ["walks"], ["BB"]));
        const pc = pick(p, ["pitchCount", "pitches"], ["PC", "PC-ST", "#P"]); if (pc !== undefined) x.pc = pair(pc)[0];
        const o = rec.order.pitching; x._relieved = o ? o.i < o.n - 1 : false;
      }
    }
    return x;
  }

  /* ---------- live state for one player ---------- */
  async function playerLive(sport, team, name){
    const game = await findGame(sport, team);
    if (!game) return {state:"none"};
    const base = {state: game.status.state === "in" ? "live" : game.status.state === "post" ? "final" : "pre",
                  detail: game.status.detail, score: game.score, opp: game.opp, home: game.home, date: game.date, gameId: game.id};
    if (base.state === "pre") return base;
    let sum;
    try { sum = await summary(sport, game.id); } catch(e){ return {...base, error: "box score unavailable"}; }
    const hdr = (((sum.header || {}).competitions || [])[0]);
    const st = hdr ? statusOf(hdr) : game.status;
    const rows = rowsFor(sum), want = norm(name);
    let rec = rows.get(want);
    if (!rec){   // fall back to first initial + last name ("C. McDavid", "Connor McDavid")
      const parts = want.split(" "), last = parts[parts.length - 1], first = (parts[0] || "")[0];
      for (const [k, v] of rows){ const kp = k.split(" "); if (kp[kp.length - 1] === last && (kp[0] || "")[0] === first){ rec = v; break; } }
    }
    const state = st.state === "in" ? "live" : st.state === "post" ? "final" : base.state;
    if (!rec) return {...base, state, detail: st.detail, status: st, inBox: false};
    return {...base, state, detail: st.detail, status: st, inBox: true, dnp: rec.dnp, x: extract(sport, rec)};
  }

  /* ---------- chance of the prop given what's happened so far ---------- */
  function erf(x){ const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  const Phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  function countCdf(k, mu, disp){
    if (k < 0) return 0;
    if (mu <= 0) return 1;
    if (disp <= 1.02){ let term = Math.exp(-mu), s = term; for (let i = 1; i <= k; i++){ term *= mu / i; s += term; } return Math.min(1, s); }
    const r = mu / (disp - 1), q = mu / (r + mu); let p = Math.pow(r / (r + mu), r), s = p;
    for (let i = 0; i < k; i++){ p *= (i + r) / (i + 1) * q; s += p; }
    return Math.min(1, s);
  }
  const statValue = (x, key) => key === "td" ? (x.rutd || 0) + (x.retd || 0) : key.split("+").reduce((s, k) => s + (x[k] || 0), 0);

  function liveChance(bet, live){
    const cur = live.x ? statValue(live.x, bet.key) : 0;
    const extra = bet.sport === "mlb" && bet.grp === "SP" ? {pitcher: true, outs: live.x ? live.x.outs : 0, outsMu: bet.outsMu, relieved: live.x && live.x._relieved} : null;
    const f = live.state === "final" ? 0 : remaining(bet.sport, live.status || {state: live.state}, live.home, extra);
    const elapsed = 1 - f;
    // blend the pre-game rate with tonight's pace; trust pace more as the game goes on
    const paceFull = elapsed > 0.08 ? cur / elapsed : bet.mu;
    const w = Math.min(0.5, elapsed * 0.6);
    const muRem = Math.max(0, ((1 - w) * bet.mu + w * paceFull) * f);
    const need = bet.line - cur;     // over needs final > line
    let over;
    if (cur > bet.line) over = 1;
    else if (f <= 0) over = cur > bet.line ? 1 : 0;
    else if (bet.count){
      const k = Math.floor(need);                         // need at least k+1 more
      over = 1 - countCdf(k, muRem, bet.disp || 1);
    } else {
      const sd = Math.max(0.3, bet.sd * Math.sqrt(f)), hi = Math.floor(need) + 0.5;
      over = 1 - Phi((hi - muRem) / sd);
    }
    const final = f <= 0;
    let push = final && cur === bet.line ? 1 : 0;
    const chance = bet.side === "over" ? over : (cur > bet.line ? 0 : 1 - over - (final ? push : 0));
    let result = null;
    if (final) result = push ? "push" : (bet.side === "over" ? (cur > bet.line ? "won" : "lost") : (cur < bet.line ? "won" : "lost"));
    else if (bet.side === "over" && cur > bet.line) result = "won";
    else if (bet.side === "under" && cur > bet.line) result = "lost";
    return {cur, f, chance: Math.max(0, Math.min(1, chance)), result, muRem, approx: !!(live.x && live.x._tbApprox && bet.key.includes("tb"))};
  }

  /* ---------- team bets: moneyline, spread, totals ---------- */
  // how much a full game's margin and total swing, in points/goals/runs
  const SPREAD_SD = {nfl: 13.5, nba: 12.5, nhl: 2.3, mlb: 4.2}, TOTAL_SD = {nfl: 13.5, nba: 18, nhl: 2.3, mlb: 4.4};
  function PhiInv(p){ let lo = -8, hi = 8; for (let i = 0; i < 60; i++){ const m = (lo + hi) / 2; if (Phi(m) < p) lo = m; else hi = m; } return (lo + hi) / 2; }
  // chance a whole-number score X (remaining part of the game ~ normal) lands above "need"; plus the chance it lands exactly on it
  function above(need, mu, sd){
    if (sd <= 0) return {win: mu > need ? 1 : 0, tie: mu === need ? 1 : 0};
    const k = Math.floor(need) + 1, win = 1 - Phi((k - 0.5 - mu) / sd);
    const tie = Number.isInteger(need) ? Phi((need + 0.5 - mu) / sd) - Phi((need - 0.5 - mu) / sd) : 0;
    return {win, tie};
  }
  async function teamLive(sport, team){
    const g = await findGame(sport, team);
    if (!g) return {state: "none"};
    return {state: g.status.state === "in" ? "live" : g.status.state === "post" ? "final" : "pre",
            detail: g.status.detail, status: g.status, score: g.score, opp: g.opp, me: g.myAbbr, home: g.home, date: g.date, gameId: g.id};
  }
  // leg: {sport, market: ml|spread|total|teamtotal, line, side, pre}; live from teamLive
  function teamChance(leg, live){
    const sp = leg.sport, f = live.state === "final" ? 0 : remaining(sp, live.status || {state: live.state}, live.home);
    const [me, them] = live.score || [0, 0], pre = Math.min(0.97, Math.max(0.03, leg.pre || 0.5));
    const sdS = SPREAD_SD[sp] || 10, sdT = (TOTAL_SD[sp] || 10) * (leg.market === "teamtotal" ? 0.7 : 1);
    let win, push = 0, cur, need, sd, mu;
    if (leg.market === "total" || leg.market === "teamtotal"){
      cur = leg.market === "total" ? me + them : me;
      // the pre-game chance tells us where the book expects the total to land
      const z = PhiInv(pre), muFull = leg.side === "under" ? leg.line - sdT * z : leg.line + sdT * z;
      mu = muFull * f; sd = sdT * Math.sqrt(f); need = leg.line - cur;
      const a = above(need, mu, sd);
      win = leg.side === "under" ? 1 - a.win - a.tie : a.win; push = a.tie;
    } else {
      const s = leg.market === "spread" ? leg.line || 0 : 0;   // a -1.5 favorite needs to win by 2
      cur = me - them;
      mu = (-s + sdS * PhiInv(pre)) * f; sd = sdS * Math.sqrt(f); need = -s - cur;
      const a = above(need, mu, sd);
      win = a.win; push = a.tie;
      if (leg.market === "ml"){ win += push / 2; push = 0; }   // tied late: overtime is about a coin flip
    }
    let result = null;
    if (f <= 0){
      const margin = leg.market === "total" || leg.market === "teamtotal" ? (leg.side === "under" ? leg.line - cur : cur - leg.line) : cur + (leg.market === "spread" ? leg.line || 0 : 0);
      result = margin > 0 ? "won" : margin < 0 ? "lost" : "push";
      win = result === "won" ? 1 : 0;
    } else if ((leg.market === "total" || leg.market === "teamtotal") && cur > leg.line) result = leg.side === "over" ? "won" : "lost";
    return {cur, f, chance: Math.max(0, Math.min(1, result === "won" ? 1 : result === "lost" ? 0 : win)), result};
  }

  const clearCache = () => cache.clear();
  return {playerLive, liveChance, teamLive, teamChance, clearCache, findGame, espnTeam, norm, _remaining: remaining, _extract: extract, _rowsFor: rowsFor};
})();
