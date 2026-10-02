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
  // teams per sport: ESPN code | nickname(s) | city(s) | other codes books use
  const TEAMS = {
    nhl: `ANA|Ducks|Anaheim|ANH
BOS|Bruins|Boston|
BUF|Sabres|Buffalo|
CGY|Flames|Calgary|CAL
CAR|Hurricanes/Canes|Carolina|
CHI|Blackhawks|Chicago|
COL|Avalanche/Avs|Colorado|
CBJ|Blue Jackets|Columbus|CLB
DAL|Stars|Dallas|
DET|Red Wings|Detroit|
EDM|Oilers|Edmonton|
FLA|Panthers|Florida|
LA|Kings|Los Angeles|LAK
MIN|Wild|Minnesota|
MTL|Canadiens/Habs|Montreal|MON
NSH|Predators/Preds|Nashville|NAS
NJ|Devils|New Jersey|NJD
NYI|Islanders|NY Islanders/New York|
NYR|Rangers|NY Rangers/New York|
OTT|Senators/Sens|Ottawa|
PHI|Flyers|Philadelphia|
PIT|Penguins/Pens|Pittsburgh|
SJ|Sharks|San Jose|SJS
SEA|Kraken|Seattle|
STL|Blues|St. Louis/St Louis|
TB|Lightning|Tampa Bay/Tampa|TBL
TOR|Maple Leafs/Leafs|Toronto|
UTAH|Mammoth/Hockey Club|Utah|UTA
VAN|Canucks|Vancouver|
VGK|Golden Knights|Vegas/Las Vegas|VGS/VEG/LV
WSH|Capitals/Caps|Washington|WAS
WPG|Jets|Winnipeg|WIN`,
    nba: `ATL|Hawks|Atlanta|
BOS|Celtics|Boston|
BKN|Nets|Brooklyn|BRK/BKN
CHA|Hornets|Charlotte|CHO
CHI|Bulls|Chicago|
CLE|Cavaliers/Cavs|Cleveland|
DAL|Mavericks/Mavs|Dallas|
DEN|Nuggets|Denver|
DET|Pistons|Detroit|
GS|Warriors|Golden State|GSW
HOU|Rockets|Houston|
IND|Pacers|Indiana|
LAC|Clippers|LA Clippers/Los Angeles|
LAL|Lakers|LA Lakers/Los Angeles|
MEM|Grizzlies|Memphis|
MIA|Heat|Miami|
MIL|Bucks|Milwaukee|
MIN|Timberwolves/Wolves|Minnesota|
NO|Pelicans|New Orleans|NOP
NY|Knicks|New York|NYK
OKC|Thunder|Oklahoma City|
ORL|Magic|Orlando|
PHI|76ers/Sixers|Philadelphia|
PHX|Suns|Phoenix|PHO
POR|Trail Blazers/Blazers|Portland|
SAC|Kings|Sacramento|
SA|Spurs|San Antonio|SAS
TOR|Raptors|Toronto|
UTAH|Jazz|Utah|UTA
WSH|Wizards|Washington|WAS`,
    nfl: `ARI|Cardinals|Arizona|
ATL|Falcons|Atlanta|
BAL|Ravens|Baltimore|
BUF|Bills|Buffalo|
CAR|Panthers|Carolina|
CHI|Bears|Chicago|
CIN|Bengals|Cincinnati|
CLE|Browns|Cleveland|
DAL|Cowboys|Dallas|
DEN|Broncos|Denver|
DET|Lions|Detroit|
GB|Packers|Green Bay|GNB
HOU|Texans|Houston|
IND|Colts|Indianapolis|
JAX|Jaguars/Jags|Jacksonville|JAC
KC|Chiefs|Kansas City|KAN
LV|Raiders|Las Vegas|LVR
LAC|Chargers|LA Chargers/Los Angeles|
LAR|Rams|LA Rams/Los Angeles|LA
MIA|Dolphins|Miami|
MIN|Vikings|Minnesota|
NE|Patriots/Pats|New England|NWE
NO|Saints|New Orleans|NOR
NYG|Giants|NY Giants/New York|
NYJ|Jets|NY Jets/New York|
PHI|Eagles|Philadelphia|
PIT|Steelers|Pittsburgh|
SF|49ers/Niners|San Francisco|SFO
SEA|Seahawks|Seattle|
TB|Buccaneers/Bucs|Tampa Bay|TAM
TEN|Titans|Tennessee|
WSH|Commanders|Washington|WAS`,
    mlb: `ARI|Diamondbacks/D-backs/Dbacks|Arizona|AZ
ATH|Athletics/A's|Oakland/Sacramento|OAK
ATL|Braves|Atlanta|
BAL|Orioles|Baltimore|
BOS|Red Sox|Boston|
CHC|Cubs|Chicago Cubs/Chicago|
CHW|White Sox|Chicago White Sox/Chicago|CWS
CIN|Reds|Cincinnati|
CLE|Guardians|Cleveland|
COL|Rockies|Colorado|
DET|Tigers|Detroit|
HOU|Astros|Houston|
KC|Royals|Kansas City|KCR
LAA|Angels|LA Angels/Los Angeles|
LAD|Dodgers|LA Dodgers/Los Angeles|
MIA|Marlins|Miami|
MIL|Brewers|Milwaukee|
MIN|Twins|Minnesota|
NYM|Mets|NY Mets/New York|
NYY|Yankees|NY Yankees/New York|
PHI|Phillies|Philadelphia|
PIT|Pirates|Pittsburgh|
SD|Padres|San Diego|SDP
SF|Giants|San Francisco|SFG
SEA|Mariners|Seattle|
STL|Cardinals|St. Louis/St Louis|
TB|Rays|Tampa Bay|TBR
TEX|Rangers|Texas|
TOR|Blue Jays/Jays|Toronto|
WSH|Nationals/Nats|Washington|WSN/WAS`
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
    if ((m = /(?:^|\s)(\d+(?:\.5)?)\s*\+(?!\d)/.exec(t))) found.push({at: m.index, side:"over", line: m[1].includes(".") ? Number(m[1]) : Number(m[1]) - 0.5});
    if (found.length){ found.sort((a, b) => a.at - b.at); return {side: found[0].side, line: found[0].line}; }
    if (YES.test(norm(t))) return {side:"over", line:0.5};
    return null;
  }

  const american = s => { const n = Number(String(s).replace(/−/g, "-")); return isFinite(n) && Math.abs(n) >= 100 ? n : null; };
  const toDec = o => o > 0 ? 1 + o / 100 : 1 + 100 / -o;
  const fromDec = d => d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));

  /* ---------- teams ---------- */
  const tkey = s => " " + norm(s).replace(/[.']/g, " ").replace(/\s+/g, " ").trim() + " ";
  const TEAM_LIST = [];
  Object.entries(TEAMS).forEach(([sport, rows]) => rows.split("\n").forEach(row => {
    const [abbr, nicks, cities, alts] = row.split("|");
    const nk = nicks.split("/"), cs = cities.split("/");
    TEAM_LIST.push({sport, abbr, nick: nk[0], city: cs[0], nicks: nk.map(tkey), cities: cs.map(tkey),
      codes: [abbr, ...(alts ? alts.split("/") : [])].map(c => new RegExp(`(^|[^A-Za-z])${c}(?=$|[^A-Za-z'])`))});
  }));
  // every team named in a line, grouped by where the name sits (one spot can be several teams: "Kings", "Jets")
  function findTeams(line){
    const t = tkey(line), groups = [];
    for (const tm of TEAM_LIST){
      let at = -1, len = 0, score = 0;
      for (const n of tm.nicks){ const i = t.indexOf(n); if (i >= 0 && n.length > len){ at = i; len = n.length; score = 2; } }
      const city = tm.cities.find(c => t.includes(c)), code = tm.codes.map(re => re.exec(line)).find(Boolean);
      if (at < 0){
        if (city){ at = t.indexOf(city); len = city.length; score = 1; }
        else if (code){ at = code.index; len = code[0].length + 1; score = 1; }
        else continue;
      } else if (city || code) score = 3;
      // spans share their edge spaces, so neighbours ("Knicks @ Heat") only touch
      const g = groups.find(g => g.at < at + len - 1 && at < g.at + g.len - 1);
      const m = {tm, score};
      if (!g) groups.push({at, len, cands: [m]});
      else { g.cands.push(m); if (len > g.len){ g.at = at; g.len = len; } }
    }
    groups.forEach(g => { const top = Math.max(...g.cands.map(c => c.score)); g.score = top; g.cands = g.cands.filter(c => c.score === top).map(c => c.tm); });
    // a longer name wins over a shorter one inside it ("Golden Knights" over a lone "Golden State" city match, etc.)
    return groups.filter(g => g.score >= 2 || !groups.some(h => h !== g && h.score >= 2)).sort((a, b) => a.at - b.at);
  }
  // blank team names out so "VGS Golden Knights" can't be read as a player named Golden
  function maskTeams(line, groups){
    let t = tkey(line);
    groups.forEach(g => g.cands.forEach(tm => [...tm.nicks, ...tm.cities].forEach(n => { t = t.split(n).join(" "); })));
    return t;
  }
  const teamOut = tm => ({abbr: tm.abbr, nick: tm.nick, city: tm.city, name: tm.city.includes(tm.nick) ? tm.city : `${tm.city} ${tm.nick}`});
  // lines a league could actually post, so "Jets -3.5" is football and "Kings over 220.5" is basketball
  const PLAUSIBLE = {nhl: {spread: 3, total: [3, 10]}, mlb: {spread: 3, total: [4, 16]}, nba: {spread: 30, total: [150, 280]}, nfl: {spread: 30, total: [25, 75]}};
  function plausible(sport, market, ln){
    const P = PLAUSIBLE[sport]; if (ln == null || !P) return true;
    if (market === "spread") return Math.abs(ln) <= P.spread;
    if (market === "total") return ln >= P.total[0] && ln <= P.total[1];
    return true;
  }

  const SPREAD = /(?:^|\s)([+\-]\d{1,2}(?:\.\d)?)(?=$|[\s)])/;
  const TOTAL = /(?:^|[^a-z])(over|under|o|u)\s*(\d{1,3}(?:\.\d)?)(?![\d:])/i;
  const ML_WORD = /\b(money ?line|ml|h2h)\b/i, SPREAD_WORD = /\b(spread|puck ?line|run ?line|handicap)\b/i, PK = /\b(pk|pick ?em|pick)\b/i;
  const TOTAL_WORD = /\btotal\b/i, TEAM_TOTAL = /\bteam total\b/i;
  const PAYLINE = /\b(wager|payout|to pay|to win|net return|returns?|stake|bonus bets?|free bet|odds boost|cash ?out|risk)\b/i;
  // a game line on a team: odds, a spread, a total, or the word moneyline
  const teamSignal = line => ODDS.test(line) || SPREAD.test(line) || ML_WORD.test(line) || TOTAL.test(line);

  function buildTeamLeg(lines, rows, i, stop){
    const ctx = lines.slice(i, stop).join(" ");
    // the pick's own text: its line, plus the next one when the market sits under the team name
    const line = !teamSignal(lines[i]) && lines[i + 1] && i + 1 < stop ? lines[i] + " " + lines[i + 1] : lines[i];
    let groups = rows[i].teams.slice();
    // teams on the lines under the pick (the matchup) tell us the opponent and settle the sport
    const others = [];
    for (let j = i + 1; j < stop; j++) rows[j].teams.forEach(g => others.push(g));
    const om = line.match(ODDS) || ctx.match(ODDS);
    const tot = TOTAL.exec(line) || (TOTAL_WORD.test(ctx) ? TOTAL.exec(ctx) : null);
    let market = "ml", ln = null, side = null;
    if (tot){ market = TEAM_TOTAL.test(ctx) ? "teamtotal" : "total"; side = /^u/i.test(tot[1]) ? "under" : "over"; ln = Number(tot[2]); }
    else {
      const sp = SPREAD.exec(line.replace(ODDS, " "));
      if (sp && !ML_WORD.test(ctx)){ market = "spread"; ln = Number(sp[1]); }
      else if (SPREAD_WORD.test(ctx) && PK.test(line)){ market = "spread"; ln = 0; }
    }
    if (!groups.length) groups = others.slice(0, 2);
    if (!groups.length) return null;
    const pickG = groups[0];
    const rest = [...groups.slice(1), ...others].filter(g => !g.cands.some(c => pickG.cands.includes(c)));
    // sports both sides of the matchup can be
    const restSports = new Set(rest.flatMap(g => g.cands.map(c => c.sport)));
    let cands = pickG.cands.filter(c => !restSports.size || restSports.has(c.sport));
    if (!cands.length) cands = pickG.cands;
    const ok = cands.filter(c => plausible(c.sport, market, ln));
    if (ok.length) cands = ok;
    return {kind: "team", cands, rest, market, line: ln, side, odds: om ? american(om[1]) : null,
            text: line.slice(0, 120), ctx: ctx.slice(0, 160), sure: pickG.score >= 2 && cands.length === 1 && (market !== "ml" || !!om || ML_WORD.test(ctx))};
  }
  function finishTeamLeg(leg, votes){
    let c = leg.cands[0];
    if (leg.cands.length > 1) c = [...leg.cands].sort((a, b) => (votes[b.sport] || 0) - (votes[a.sport] || 0))[0];
    const opp = leg.rest.map(g => g.cands.find(x => x.sport === c.sport && x !== c)).find(Boolean);
    const out = {kind: "team", sport: c.sport, market: leg.market, team: teamOut(c), opp: opp ? teamOut(opp) : null,
      line: leg.line, side: leg.side, odds: leg.odds, text: leg.text, sure: leg.sure,
      alts: leg.cands.filter(x => x !== c).map(x => ({sport: x.sport, team: teamOut(x)}))};
    return out;
  }

  /* ---------- wager, payout and bonus bets ---------- */
  const LABELS = [["profit", /\b(net return|to win|net payout|profit|potential win(?:nings)?|winnings)\b/i],
                  ["total", /\b(to pay|total payout|potential payout|payout|returns?)\b/i],
                  ["stake", /\b(wager|stake|risk|bet amount|total wager|bonus bets?|free bet)\b/i]];
  function fromPayout(lines, legOdds){
    const found = {};
    const money = s => { let m = [...s.matchAll(/\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g)]; if (!m.length) m = [...s.matchAll(/(?:^|\s)(\d[\d,]*\.\d{2})(?=\s|$)/g)]; return m.map(x => Number(x[1].replace(/,/g, ""))); };
    lines.forEach((line, i) => {
      const labs = [];
      let rest = line;
      for (const [k, re] of LABELS){ const m = re.exec(rest); if (m){ labs.push({k, at: m.index}); rest = rest.slice(0, m.index) + " ".repeat(m[0].length) + rest.slice(m.index + m[0].length); } }
      if (!labs.length) return;
      labs.sort((a, b) => a.at - b.at);
      let amts = money(line);
      if (!amts.length && lines[i + 1]) amts = money(lines[i + 1]);   // labels on one line, amounts under them
      labs.forEach((l, k) => { if (amts[k] != null && found[l.k] == null) found[l.k] = amts[k]; });
    });
    const bonus = lines.some(l => /\b(bonus bets?|free bet|bonus)\b/i.test(l) && !/odds boost|profit boost/i.test(l));
    const w = found.stake;
    if (!(w > 0)) return null;
    let dec = null;
    if (found.profit > 0) dec = 1 + found.profit / w;
    else if (found.total > w){
      dec = found.total / w;
      // bonus bets don't return the stake, so many books show winnings as "payout"; leg odds settle which it is
      const alt = 1 + found.total / w;
      if (legOdds ? Math.abs(alt - legOdds) < Math.abs(dec - legOdds) : bonus) dec = alt;
    }
    return {stake: w, bonus, odds: dec && dec > 1.01 ? fromDec(dec) : null};
  }

  function parse(text, idx){
    const raw = String(text || "").replace(/\r/g, "").replace(/[−–]/g, "-").replace(/½/g, ".5");
    const lines = raw.split(/\n|(?<=[a-z0-9)])\s*[|•·]\s*/i).map(s => s.trim()).filter(Boolean);
    const rows = lines.map(line => {
      const teams = PAYLINE.test(line) ? [] : findTeams(line);
      const pl = findPlayers(teams.length ? maskTeams(line, teams) : line, idx);
      let kind = null;
      if (pl && pl.exact) kind = "player";
      else if (teams.length && !PAYLINE.test(line) && teamSignal(line) && (teams.some(g => g.score >= 2) || ML_WORD.test(line) || SPREAD.test(line) || TOTAL.test(line))) kind = "team";
      else if (/^\W{0,3}(over|under|o|u)\s*\d/i.test(line) && !pl) kind = "total";
      else if (pl && !teams.length) kind = "player";
      return {line, teams, pl, kind};
    });
    // FanDuel-style: the team on one line, the market and odds on the next
    const TIME = /\b\d{1,2}:\d{2}\b|\b(mon|tue|wed|thu|fri|sat|sun|today|tomorrow)\b/i;
    rows.forEach((r, i) => {
      const nx = rows[i + 1];
      if (!r.kind && nx && !nx.kind && r.teams.length === 1 && r.teams[0].score >= 2 && !TIME.test(r.line) && !/[@]|\bvs\.?\b|\bat\b/i.test(r.line)
          && !nx.teams.length && !nx.pl && !PAYLINE.test(nx.line) && teamSignal(nx.line)) r.kind = "team";
    });
    const sel = rows.map((r, i) => r.kind ? i : -1).filter(i => i >= 0);
    const legs = [], used = new Set(), pending = [];
    sel.forEach((i, k) => {
      const stop = Math.min(lines.length, sel[k + 1] != null ? sel[k + 1] : lines.length, i + 4);
      if (rows[i].kind === "player"){
        const h = rows[i].pl;
        // grow the context a line at a time until we have a market and a line for one of the candidates
        let best = null;
        for (let end = i + 1; end <= stop; end++){
          const ctx = lines.slice(i, end).join(" ");
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
        for (let j = i; j < end; j++) used.add(j);
        legs.push({sport: c.sport, pid: c.pid, name: c.name, team: c.team, grp: c.grp, key, line: ln ? ln.line : null,
                   side: ln ? ln.side : "over", odds: om ? american(om[1]) : null, text: ctx.slice(0, 120),
                   sure: h.exact && h.cands.length === 1 && !!key && !!ln});
        return;
      }
      const t = buildTeamLeg(lines, rows, i, stop);
      if (!t) return;
      for (let j = i; j < stop; j++) used.add(j);
      pending.push(legs.length); legs.push(t);
    });
    // settle sports for names more than one league uses ("Jets", "Kings") by what the rest of the slip is
    const votes = {};
    legs.forEach(l => { const sp = l.kind === "team" ? (l.cands.length === 1 ? l.cands[0].sport : null) : l.sport; if (sp) votes[sp] = (votes[sp] || 0) + 1; });
    pending.forEach(k => { legs[k] = finishTeamLeg(legs[k], votes); });
    // leftovers that look like bets but have nothing we can place
    lines.forEach((line, i) => {
      if (used.has(i)) return;
      if (/\b(over|under|o\d|u\d)\b|[+\-]\d\.5|\bmoneyline\b|\bml\b|\bspread\b/i.test(line) && !/parlay|wager|payout|to pay|odds boost/i.test(line) && line.length < 80)
        legs.push({unsupported: true, text: line, odds: (line.match(ODDS) || [])[1] ? american(line.match(ODDS)[1]) : null});
    });
    // whole-slip odds: a line naming the parlay with odds, else payout math, else the legs' odds multiplied
    let odds = null, stake = null, bonus = false, oddsFrom = null;
    const pl = lines.find((l, i) => !used.has(i) && /\b(parlay|sgp|legs?|odds)\b/i.test(l) && ODDS.test(l));
    if (pl){ odds = american(pl.match(ODDS)[1]); oddsFrom = "slip"; }
    const priced = legs.filter(l => l.odds != null);
    const legDec = legs.length > 1 && priced.length === legs.length ? priced.reduce((d, l) => d * toDec(l.odds), 1) : null;
    const pay = fromPayout(lines, legDec);
    if (pay){ stake = pay.stake; bonus = pay.bonus; if (odds == null && pay.odds != null){ odds = pay.odds; oddsFrom = "payout"; } }
    if (odds == null && legDec){ odds = fromDec(legDec); oddsFrom = "legs"; }
    if (odds == null && legs.length === 1 && legs[0].odds != null){ odds = legs[0].odds; oddsFrom = "legs"; }
    return {legs, odds, stake, bonus, oddsFrom};
  }

  return {parse, buildIndex, findLine, findMarket, findTeams, norm, MARKETS, TEAMS};
})();
if (typeof module !== "undefined") module.exports = SLIP;
