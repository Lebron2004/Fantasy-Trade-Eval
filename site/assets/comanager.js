/* Co-manager engine: weekly point projections that retune themselves against real results,
   playoff odds from simulating the rest of the season, and buy/sell reads on every player.
   Used by league.html. Everything it learns is kept in this browser. */
const CM = (() => {
  const {store, adjusted, signalOf, getJSON} = TS;
  const POS = new Set(["QB", "RB", "WR", "TE"]);
  const OUT = new Set(["Out", "IR", "PUP", "Sus", "NA", "IL7", "IL10", "IL15", "IL60"]);
  const LONG_OUT = new Set(["IR", "PUP", "Sus", "NA", "IL60"]);
  const INJ = {Questionable: 0.9, Doubtful: 0.25, GTD: 0.85, DTD: 0.85};
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- Data the football model reads (both optional) ---------- */
  let defense = null, results = null;
  async function load(sport){
    if (sport !== "nfl") return;
    try { defense = defense || await getJSON("data/nfl-defense.json"); } catch(e){ defense = {teams:{}}; }
    try { results = results || await getJSON("data/nfl-results.json"); } catch(e){ results = {weeks:{}}; }
  }
  const nflWeek = () => (defense && defense.week) || (results && results.week) || null;
  const oppOf = p => { const nx = (p.x || {}).nx; return nx && nx !== "BYE" ? nx.replace(/^(vs |@)/, "") : null; };
  // How a defense treats this player's position: factor (above 1 = allows more) and rank (1 = toughest).
  function defenseVs(p){
    const o = oppOf(p), t = o && defense && defense.teams && defense.teams[o], r = t && t[p.pos];
    return r ? {opp: o, f: r[0], rank: r[1], of: Object.keys(defense.teams).length} : null;
  }

  /* ---------- Weekly points model ----------
     Expected points = a weighted blend of four estimates (Sleeper's projection, season points per game,
     last-four-games form, and the trained prop model's next-game projection), scaled by the matchup:
     1 + k * (defense factor - 1). The blend weights and k start at sensible values and are retuned
     every week against what players actually scored. */
  const FEATS = ["proj", "ppg", "form", "model"];
  const START = {w: {proj: 0.40, ppg: 0.20, form: 0.25, model: 0.15}, k: 1};
  const MKEY = "tradescale:cm-model", LKEY = "tradescale:cm-log";
  let M = Object.assign({}, START, store.get(MKEY) || {});

  function feats(p, sp){
    const x = p.x || {}, g = signalOf(p, sp);
    // Sleeper's season projection sometimes arrives as a season total for defenses; no one projects 40+ a game.
    return {proj: x.proj != null && x.proj <= 40 ? x.proj : null, ppg: x.ppg ?? null, form: x.form ?? null,
            model: g && /point/i.test(g.label) ? g.proj : null, mu: x.mu ?? 1};
  }
  function blend(f, w){
    let s = 0, t = 0;
    for (const k of FEATS) if (f[k] != null){ s += w[k] * f[k]; t += w[k]; }
    return t ? s / t : null;
  }
  const predict = (f, P) => { const b = blend(f, P.w); return b == null ? null : Math.max(0, b * (1 + P.k * (f.mu - 1))); };

  // Players with no stats yet: points per game in line with others at his position and value.
  const ratioCache = new Map();
  function fromValue(p, sp){
    const key = sp + p.pos;
    if (!ratioCache.has(key)){
      const pool = TS.pools[sp] || [], rs = [];
      pool.forEach(q => { if (q.pos !== p.pos) return; const b = blend(feats(q, sp), M.w), v = adjusted(q, sp); if (b != null && v > 5) rs.push(b / v); });
      rs.sort((a, b) => a - b);
      let r = rs[Math.floor(rs.length / 2)];
      if (r == null){   // kickers and defenses carry no stats here: about 8 points a week for a starter
        const vs = pool.filter(q => q.pos === p.pos).map(q => adjusted(q, sp)).sort((a, b) => b - a).slice(0, 16);
        r = vs.length ? 8 / Math.max(vs[Math.floor(vs.length / 2)], 1) : 0.15;
      }
      ratioCache.set(key, r);
    }
    return adjusted(p, sp) * ratioCache.get(key);
  }
  TS.onSettings(() => ratioCache.clear());

  // This week's expected fantasy points (football), or for other sports this week's value with injuries counted.
  // ros: a typical rest-of-season week instead (no single matchup, schedule strength instead).
  function points(p, sp, ros){
    const x = p.x || {};
    if (sp !== "nfl"){
      if (ros) return LONG_OUT.has(p.inj) ? 0 : adjusted(p, sp) * (x.sos ? 1 + 0.6 * (x.sos - 1) : 1);
      return OUT.has(p.inj) ? 0 : adjusted(p, sp) * (INJ[p.inj] || 1) * (x.sos ? 1 + 0.6 * (x.sos - 1) : 1);
    }
    const f = feats(p, sp);
    let b = blend(f, M.w); if (b == null) b = fromValue(p, sp);
    if (ros) return LONG_OUT.has(p.inj) ? 0 : b * (x.sos ? 1 + 0.6 * M.k * (x.sos - 1) : 1);
    if (x.nx === "BYE" || OUT.has(p.inj)) return 0;
    return Math.max(0, b * (INJ[p.inj] || 1) * (1 + M.k * (f.mu - 1)));
  }
  const unit = sp => sp === "nfl" ? "pts" : "value";

  /* ---------- Learning loop ---------- */
  const seasonOf = iso => { const d = iso ? new Date(iso) : new Date(); return d.getUTCMonth() < 2 ? d.getUTCFullYear() - 1 : d.getUTCFullYear(); };
  // Save this week's inputs for every relevant player, so they can be graded once the games are played.
  // A player's line freezes once his game is in the books (his result shows up in the results file).
  function logWeek(sp){
    const W = nflWeek(), pool = TS.pools[sp];
    if (sp !== "nfl" || !W || !pool) return;
    const season = seasonOf(pool.updated);
    let log = store.get(LKEY);
    if (!log || log.season !== season) log = {season, weeks:{}};
    const done = (results && results.weeks && results.weeks[W]) || {};
    const wk = log.weeks[W] || (log.weeks[W] = {});
    let n = 0;
    for (const p of pool){
      if (!POS.has(p.pos) || done[p.id]) continue;
      const f = feats(p, sp);
      if (f.proj == null && f.ppg == null && f.form == null) continue;
      wk[p.id] = [f.proj, f.ppg, f.form, f.model, f.mu, p.inj || "", p.pos, p.x && p.x.nx === "BYE" ? 1 : 0];
      if (++n >= 400) break;
    }
    const keep = Object.keys(log.weeks).map(Number).sort((a, b) => b - a).slice(0, 20);
    log.weeks = Object.fromEntries(keep.map(w => [w, log.weeks[w]]));
    store.set(LKEY, log);
  }

  // Graded examples: the weeks this browser logged, plus a replay of earlier weeks from the results file
  // (points per game and form as they stood before each game, and that week's opponent).
  function samples(sp){
    const out = [], W = nflWeek(), R = (results && results.weeks) || {}, pool = TS.pools[sp];
    if (!W || !pool) return out;
    const weeks = Object.keys(R).map(Number).filter(w => w < W).sort((a, b) => a - b);
    const hist = new Map();
    for (const w of weeks){
      for (const [pid, [pts, opp]] of Object.entries(R[w])){
        const h = hist.get(pid) || [], p = pool.byId.get(pid);
        if (p && POS.has(p.pos) && h.length >= 2){
          const ppg = h.reduce((a, b) => a + b, 0) / h.length, last = h.slice(-4);
          const d = defense && defense.teams && defense.teams[opp], mu = d && d[p.pos] ? d[p.pos][0] : 1;
          if (ppg >= 3) out.push({w, pos: p.pos, y: pts, f: {proj: null, ppg, form: last.reduce((a, b) => a + b, 0) / last.length, model: null, mu}, wt: 1});
        }
        h.push(pts); hist.set(pid, h);
      }
    }
    const log = store.get(LKEY);
    if (log && log.season === seasonOf(pool.updated)){
      for (const [w, rows] of Object.entries(log.weeks)){
        if (Number(w) >= W || !R[w]) continue;
        for (const [pid, r] of Object.entries(rows)){
          const [proj, ppg, form, model, mu, inj, pos, bye] = r, res = R[w][pid];
          if (!res || bye || OUT.has(inj)) continue;
          out.push({w: Number(w), pos, y: res[0], f: {proj, ppg, form, model, mu}, wt: 3, logged: true});
        }
      }
    }
    return out;
  }
  function score(S, P){
    let e = 0, t = 0;
    for (const s of S){ const p = predict(s.f, P); if (p == null) continue; e += s.wt * Math.abs(p - s.y); t += s.wt; }
    return t ? e / t : Infinity;
  }
  // Close calls: players at the same position ranked within three spots of each other that week.
  // How often did the higher projection actually score more?
  function hitRate(S, P){
    const by = {};
    S.forEach(s => { const p = predict(s.f, P); if (p != null && p >= 5) (by[s.w + s.pos] ||= []).push([p, s.y]); });
    let right = 0, n = 0;
    Object.values(by).forEach(l => {
      l.sort((a, b) => b[0] - a[0]);
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < Math.min(l.length, i + 4); j++){
        if (l[i][1] === l[j][1]) continue;
        n++; if (l[i][1] > l[j][1]) right++;
      }
    });
    return n ? right / n : null;
  }
  // Coordinate search on the blend weights and matchup strength, pulled toward the starting values
  // when there's little data so one odd week can't swing it.
  function fit(S, from){
    let P = {w: {...from.w}, k: from.k};
    const n = S.reduce((a, s) => a + s.wt, 0), lam = 400 / (n + 50);
    const obj = Q => score(S, Q) + lam * (FEATS.reduce((a, k) => a + (Q.w[k] - START.w[k]) ** 2, 0) + 0.25 * (Q.k - START.k) ** 2);
    let best = obj(P);
    for (const step of [0.1, 0.05, 0.02]){
      for (let pass = 0, moved = true; moved && pass < 30; pass++){
        moved = false;
        for (const key of [...FEATS, "k"]) for (const dir of [1, -1]){
          const Q = {w: {...P.w}, k: P.k};
          if (key === "k") Q.k = clamp(P.k + dir * step * 2, 0, 2.5);
          else Q.w[key] = clamp(P.w[key] + dir * step, 0.02, 1);
          const v = obj(Q);
          if (v < best - 1e-6){ best = v; P = Q; moved = true; }
        }
      }
    }
    const t = FEATS.reduce((a, k) => a + P.w[k], 0);
    FEATS.forEach(k => P.w[k] = Math.round(P.w[k] / t * 1000) / 1000);
    P.k = Math.round(P.k * 100) / 100;
    return P;
  }
  // Retune once per new batch of results: hold out the latest finished week to check the tuned model
  // honestly against the starting weights, then fit on everything for the weeks ahead.
  function learn(sp){
    if (sp !== "nfl") return M;
    logWeek(sp);
    const S = samples(sp), key = `${results && results.updated}|${S.length}`;
    if (M.key === key) return M;
    if (S.length < 60){ M = Object.assign({}, START, {key, n: S.length}); return M; }
    const last = Math.max(...S.map(s => s.w)), train = S.filter(s => s.w < last), test = S.filter(s => s.w === last);
    let check = null;
    if (train.length >= 60 && test.length >= 20){
      const P = fit(train, START);
      check = {week: last, mae: score(test, P), mae0: score(test, START), hit: hitRate(test, P), hit0: hitRate(test, START), n: test.length};
    }
    const prev = M.w && M.k != null ? {w: M.w, k: M.k} : START;
    M = Object.assign(fit(S, prev), {key, n: S.length, logged: S.filter(s => s.logged).length,
      weeks: [...new Set(S.map(s => s.w))].length, check, prev: {w: prev.w, k: prev.k}, at: new Date().toISOString()});
    store.set(MKEY, M);
    ratioCache.clear();
    return M;
  }
  const modelState = () => M;
  const START_MODEL = START;

  /* ---------- Buy/sell read on one player ---------- */
  // Positive = trending up (buy), negative = trending down (sell), with the plain-language reasons.
  function outlook(p, sp){
    const x = p.x || {}, why = [];
    let s = 0;
    const g = signalOf(p, sp);
    if (g && Math.abs(g.s) >= 0.2){
      s += clamp(g.s, -1, 1) * 0.8;
      why.push(g.s > 0 ? `the trained model ranks him ${g.mr}${sfx(g.mr)} at his position, above his ${g.vr}${sfx(g.vr)} by trade value`
                       : `the trained model ranks him only ${g.mr}${sfx(g.mr)} at his position, below his ${g.vr}${sfx(g.vr)} by trade value`);
    }
    if (x.form != null && x.ppg != null){
      const t = clamp((x.form - x.ppg) / Math.max(x.ppg, 6), -0.5, 0.5);
      s += t * 0.8;
      if (Math.abs(t) >= 0.12) why.push(t > 0 ? `heating up: ${x.form} points a game over his last four, up from ${x.ppg}` : `cooling off: ${x.form} points a game over his last four, down from ${x.ppg}`);
    }
    if (x.proj != null && x.ppg != null){
      const d = clamp((x.proj - x.ppg) / Math.max(x.ppg, 6), -0.4, 0.4);
      s += d * 0.5;
      if (d <= -0.2) why.push(`scoring well above his projection (${x.ppg} vs ${x.proj}), so expect him to come back down`);
      if (d >= 0.2) why.push(`scoring below his projection (${x.ppg} vs ${x.proj}), so a bounce back is likely`);
    }
    if (x.sos != null){
      s += clamp((x.sos - 1) * 4, -0.4, 0.4);
      if (Math.abs(x.sos - 1) >= 0.04) why.push(`${x.sos > 1 ? "an easy" : "a hard"} rest-of-season schedule`);
    }
    if (TS.HURT.has(p.inj)){ s -= 0.3; why.push(`injured (${p.inj})`); }
    return {s, why};
  }
  const sfx = n => (["th","st","nd","rd"][(n % 100 - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");

  /* ---------- Playoff odds: simulate every remaining week ---------- */
  function rng(seed){ return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // teams: [{id, now:{mean, sd}, ros:{mean, sd}, w, l, t, pf}]; sched: {week: [[idA, idB], ...]} (missing weeks are drawn at random)
  // weeks: the remaining regular-season weeks, first one is this week. me: your team id.
  function simulate({teams, sched, weeks, spots, me, n = 4000, seed = 7}){
    const R = rng(seed), N = teams.length, ix = new Map(teams.map((t, i) => [t.id, i]));
    let spare = null;
    const gauss = () => { if (spare != null){ const v = spare; spare = null; return v; } let u = 0, v = 0; while (!u) u = R(); v = R();
      const m = Math.sqrt(-2 * Math.log(u)); spare = m * Math.sin(2 * Math.PI * v); return m * Math.cos(2 * Math.PI * v); };
    const made = new Array(N).fill(0), top = new Array(N).fill(0), wins = new Array(N).fill(0), seeds = new Array(N).fill(0);
    const meI = ix.get(me);
    const cond = {win: [0, 0], loss: [0, 0]};
    const ids = teams.map((_, i) => i);
    const W = new Float64Array(N), PF = new Float64Array(N);
    for (let s = 0; s < n; s++){
      teams.forEach((t, i) => { W[i] = (t.w || 0) + 0.5 * (t.t || 0); PF[i] = t.pf || 0; });
      let myFirst = null;
      weeks.forEach((wk, wi) => {
        let games = sched && sched[wk];
        if (!games || !games.length){
          const o = ids.slice();
          for (let i = o.length - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
          games = []; for (let i = 0; i + 1 < o.length; i += 2) games.push([teams[o[i]].id, teams[o[i + 1]].id]);
          if (wi === 0 && meI != null && sched && sched.opp){   // you named this week's opponent
            const oi = ix.get(sched.opp);
            if (oi != null){ const rest = o.filter(i => i !== meI && i !== oi); games = [[me, sched.opp]];
              for (let i = 0; i + 1 < rest.length; i += 2) games.push([teams[rest[i]].id, teams[rest[i + 1]].id]); }
          }
        }
        for (const [a, b] of games){
          const ia = ix.get(a), ib = ix.get(b); if (ia == null || ib == null) continue;
          const da = wi === 0 ? teams[ia].now : teams[ia].ros, db = wi === 0 ? teams[ib].now : teams[ib].ros;
          const pa = da.mean + da.sd * gauss(), pb = db.mean + db.sd * gauss();
          PF[ia] += pa; PF[ib] += pb;
          if (pa > pb) W[ia]++; else W[ib]++;
          if (wi === 0 && (ia === meI || ib === meI)) myFirst = (ia === meI) === (pa > pb);
        }
      });
      const order = ids.slice().sort((a, b) => W[b] - W[a] || PF[b] - PF[a]);
      order.forEach((i, r) => { if (r < spots) made[i]++; if (r < Math.min(2, spots)) top[i]++; wins[i] += W[i]; if (i === meI) seeds[r]++; });
      if (myFirst != null){ const c = myFirst ? cond.win : cond.loss; c[0]++; if (order.indexOf(meI) < spots) c[1]++; }
    }
    const out = {};
    teams.forEach((t, i) => out[t.id] = {odds: made[i] / n, bye: top[i] / n, wins: wins[i] / n});
    return {teams: out, ifWin: cond.win[0] ? cond.win[1] / cond.win[0] : null, ifLoss: cond.loss[0] ? cond.loss[1] / cond.loss[0] : null,
            seeds: seeds.map(c => c / n)};
  }

  return {load, nflWeek, oppOf, defenseVs, points, unit, learn, modelState, START: START_MODEL, outlook, simulate, POS, OUT, LONG_OUT};
})();
