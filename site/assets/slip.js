/* Bet slip reader: turns pasted or OCR'd sportsbook text (DraftKings, FanDuel, etc.) into legs.
   Pure functions, no page state, so it can be tested on its own. */
const SLIP = (() => {
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z0-9.+\- ]/g, " ").replace(/\s+/g, " ").trim();

  // market phrases -> stat key, per sport (longest phrases are tried first)
  const MARKETS = {
    nfl: [
      ["passing + rushing yards","pyd+ruyd"],["pass + rush yds","pyd+ruyd"],["pass + rush yards","pyd+ruyd"],
      ["rushing + receiving yards","ruyd+reyd"],["rush + rec yds","ruyd+reyd"],["rush + rec yards","ruyd+reyd"],["rush+rec yds","ruyd+reyd"],
      ["passing yards","pyd"],["pass yds","pyd"],["passing yds","pyd"],["passing touchdowns","ptd"],["passing tds","ptd"],["pass tds","ptd"],
      ["pass completions","cmp"],["completions","cmp"],["pass attempts","att"],["passing attempts","att"],["interceptions thrown","int"],["interceptions","int"],
      ["rushing yards","ruyd"],["rush yds","ruyd"],["rushing yds","ruyd"],["rush attempts","car"],["rushing attempts","car"],["carries","car"],
      ["receiving yards","reyd"],["rec yds","reyd"],["receiving yds","reyd"],["receptions","rec"],["targets","tgt"],
      ["anytime touchdown scorer","td"],["anytime td scorer","td"],["anytime touchdown","td"],["anytime td","td"],["to score a touchdown","td"],["to score a td","td"],
      ["touchdowns","td"],["fantasy points","ppr"]],
    nba: [
      ["points + rebounds + assists","pts+reb+ast"],["pts + reb + ast","pts+reb+ast"],["pts+reb+ast","pts+reb+ast"],["pra","pts+reb+ast"],
      ["points + rebounds","pts+reb"],["pts + reb","pts+reb"],["points + assists","pts+ast"],["pts + ast","pts+ast"],
      ["rebounds + assists","reb+ast"],["reb + ast","reb+ast"],["steals + blocks","stl+blk"],["stl + blk","stl+blk"],
      ["three pointers made","fg3"],["3-pointers made","fg3"],["3 pointers made","fg3"],["threes made","fg3"],["threes","fg3"],["3pt made","fg3"],["3-pt made","fg3"],
      ["points","pts"],["pts","pts"],["rebounds","reb"],["reb","reb"],["assists","ast"],["ast","ast"],["steals","stl"],["blocks","blk"],["turnovers","tov"]],
    nhl: [
      ["anytime goalscorer","g"],["anytime goal scorer","g"],["to score a goal","g"],["goalscorer","g"],["power play goals","ppg"],
      ["shots on goal","sog"],["shots","sog"],["sog","sog"],["blocked shots","blk"],["goalie saves","sv"],["saves","sv"],["goals against","ga"],
      ["points","pts"],["goals","g"],["assists","a"],["hits","hit"]],
    mlb: [
      ["hits + runs + rbis","h+r+rbi"],["hits + runs + rbi","h+r+rbi"],["hits+runs+rbis","h+r+rbi"],["h+r+rbi","h+r+rbi"],
      ["pitcher strikeouts","k"],["strikeouts thrown","k"],["outs recorded","outs"],["pitching outs","outs"],["earned runs allowed","er"],
      ["hits allowed","ha"],["walks allowed","bba"],["pitch count","pc"],
      ["to hit a home run","hr"],["home runs","hr"],["home run","hr"],["total bases","tb"],["rbis","rbi"],["rbi","rbi"],["runs scored","r"],["runs","r"],
      ["stolen bases","sb"],["walks","bb"],["hits","h"],["strikeouts","k"]]
  };
  // markets that are "yes/no" by nature: a hit means at least one
  const YES = /\b(anytime|to score|goalscorer|goal scorer|scorer|to hit a home run|to record)\b/;
  const ODDS = /(?:^|[\s(])([+\-]\d{3,5})(?=$|[\s)])/;

  const nameNorm = s => norm(s).replace(/\./g, "").replace(/\s+/g, " ").trim();
  function buildIndex(players){
    // players: [{sport, pid, name, team, grp}]
    const list = players.map(p => ({...p, n: nameNorm(p.name)})).filter(p => p.n.length > 3);
    list.sort((a, b) => b.n.length - a.n.length);
    const byLast = new Map();
    list.forEach(p => { const parts = p.n.split(" "); const last = parts[parts.length - 1]; (byLast.get(last) || byLast.set(last, []).get(last)).push(p); });
    return {list, byLast};
  }

  // every player this line could be, best evidence first:
  // full name > first name + last name > initial + last name > a long last name on its own
  function findPlayers(line, idx){
    const l = " " + nameNorm(line) + " ";
    const exact = idx.list.filter(p => p.n.split(" ")[0].length > 2 && l.includes(" " + p.n + " "));
    if (exact.length){
      const longest = exact[0].n.length;
      return {cands: exact.filter(p => p.n.length === longest), exact: true};
    }
    const toks = nameNorm(line).split(" "), scored = new Map();
    for (let i = 0; i < toks.length; i++){
      const cands = idx.byLast.get(toks[i]); if (!cands) continue;
      const prev = toks[i - 1] || "";
      for (const c of cands){
        const first = c.n.split(" ")[0];
        let sc = 0;
        if (prev && prev === first && first.length > 2) sc = 3;
        else if (prev && prev[0] === first[0] && (prev.length <= 2 || first.length <= 2)) sc = 2;
        else if (toks[i].length >= 5) sc = 1;
        if (sc > (scored.get(c) || 0)) scored.set(c, sc);
      }
    }
    if (!scored.size) return null;
    const top = Math.max(...scored.values());
    return {cands: [...scored].filter(([, v]) => v === top).map(([c]) => c), exact: top === 3};
  }

  function findMarket(text, sport, grp){
    const t = " " + norm(text) + " ";
    for (const [phrase, key] of MARKETS[sport] || []){
      if (t.includes(" " + phrase + " ") || t.includes(" " + phrase.replace(/ /g, "") + " ")){
        if (sport === "mlb" && key === "k" && grp === "H") return "so";            // a hitter's strikeouts
        if (sport === "mlb" && key === "h" && grp === "SP" && !t.includes("hits allowed")) return "ha";
        return key;
      }
    }
    return null;
  }

  // the first over/under/"N+"/yes-market in the text wins, so a later leg's line can't leak in
  function findLine(text){
    const t = String(text).replace(/\u2212/g, "-").replace(/½/g, ".5");
    const found = [];
    let m;
    if ((m = /\b(over|o)\s*(\d+(?:\.\d+)?)/i.exec(t))) found.push({at: m.index, side:"over", line:Number(m[2])});
    if ((m = /\b(under|u)\s*(\d+(?:\.\d+)?)/i.exec(t))) found.push({at: m.index, side:"under", line:Number(m[2])});
    if ((m = /(?:^|\s)(\d+)\s*\+(?!\d)/.exec(t))) found.push({at: m.index, side:"over", line:Number(m[1]) - 0.5});
    if (found.length){ found.sort((a, b) => a.at - b.at); return {side: found[0].side, line: found[0].line}; }
    if (YES.test(norm(t))) return {side:"over", line:0.5};
    return null;
  }

  const american = s => { const n = Number(String(s).replace(/\u2212/g, "-")); return isFinite(n) && Math.abs(n) >= 100 ? n : null; };
  function fromPayout(text){
    const t = norm(text).replace(/,/g, "");
    const wager = t.match(/(?:wager|stake|bet|risk)\s*\$?\s*(\d+(?:\.\d+)?)/);
    const pay = t.match(/(?:to pay|payout|to win|potential payout|returns?)\s*\$?\s*(\d+(?:\.\d+)?)/);
    if (!wager || !pay) return null;
    const w = Number(wager[1]), p = Number(pay[1]); if (!(w > 0 && p > w)) return null;
    const isWin = /to win/.test(t) && !/to pay|payout|return/.test(t);
    const dec = isWin ? 1 + p / w : p / w;
    return {stake: w, odds: dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1))};
  }

  function parse(text, idx){
    const raw = String(text || "").replace(/\r/g, "").replace(/\u2212/g, "-");
    const lines = raw.split(/\n|(?<=[a-z0-9)])\s*[|•·]\s*/i).map(s => s.trim()).filter(Boolean);
    const hits = [];
    lines.forEach((line, i) => { const f = findPlayers(line, idx); if (f) hits.push({i, ...f}); });
    const legs = [], used = new Set();
    hits.forEach((h, k) => {
      const stop = Math.min(lines.length, hits[k + 1] ? hits[k + 1].i : lines.length, h.i + 4);
      // grow the context a line at a time until we have a market and a line for one of the candidates
      let best = null;
      for (let end = h.i + 1; end <= stop; end++){
        const ctx = lines.slice(h.i, end).join(" ");
        for (const c of h.cands){
          const key = findMarket(ctx, c.sport, c.grp);
          const ln = findLine(ctx) || (key && /^(td|g|hr)$/.test(key) ? {side:"over", line:0.5} : null);
          const score = (key ? 2 : 0) + (ln ? 1 : 0);
          if (!best || score > best.score) best = {c, key, ln, ctx, end, score};
        }
        if (best && best.score === 3) break;
      }
      const {c, key, ln, ctx, end} = best;
      const om = ctx.match(ODDS);
      for (let j = h.i; j < end; j++) used.add(j);
      legs.push({sport: c.sport, pid: c.pid, name: c.name, team: c.team, grp: c.grp, key, line: ln ? ln.line : null,
                 side: ln ? ln.side : "over", odds: om ? american(om[1]) : null, text: ctx.slice(0, 120),
                 sure: h.exact && h.cands.length === 1 && !!key && !!ln});
    });
    // leftovers that look like bets but have no player we know (spreads, totals, moneylines, other sports)
    lines.forEach((line, i) => {
      if (used.has(i)) return;
      if (/\b(over|under|o\d|u\d)\b|[+\-]\d\.5|\bmoneyline\b|\bml\b|\bspread\b/i.test(line) && !/parlay|wager|payout|to pay|odds boost/i.test(line) && line.length < 80)
        legs.push({unsupported: true, text: line, odds: (line.match(ODDS) || [])[1] ? american(line.match(ODDS)[1]) : null});
    });
    // whole-slip odds: a line mentioning parlay/SGP with odds, else payout math, else a lone leg's odds
    let odds = null, stake = null;
    const pl = lines.find(l => /parlay|sgp|leg|odds/i.test(l) && ODDS.test(l));
    if (pl) odds = american(pl.match(ODDS)[1]);
    const pay = fromPayout(raw);
    if (pay){ stake = pay.stake; if (odds == null) odds = pay.odds; }
    if (odds == null && legs.length === 1) odds = legs[0].odds;
    return {legs, odds, stake};
  }

  return {parse, buildIndex, findLine, findMarket, norm, MARKETS};
})();
if (typeof module !== "undefined") module.exports = SLIP;
