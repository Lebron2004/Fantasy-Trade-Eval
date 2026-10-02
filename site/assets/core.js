/* Trade Scale shared core: data loading, player valuation, settings, and player search.
   Used by both index.html (trade calculator) and league.html (league analysis). */
const TS = (() => {
  const SPORTS = [["nfl","Football"],["nba","Basketball"],["mlb","Baseball"],["nhl","Hockey"]];
  const sportName = id => (SPORTS.find(s => s[0] === id) || [,""])[1];

  const store = {
    get(k){ try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch(e){ return null; } },
    set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
  };

  /* ---------- Settings shared by every page ---------- */
  const DEFAULTS = {mode:"redraft", scoring:"ppr", qb:"1qb", upside:60};
  const settings = Object.assign({}, DEFAULTS);
  (function loadSettings(){
    const saved = store.get("tradescale:settings");
    const legacy = store.get("tradescale:v2") || {};   // older builds kept these on the trade state
    for (const k of Object.keys(DEFAULTS)){
      if (saved && saved[k] != null) settings[k] = saved[k];
      else if (legacy[k] != null) settings[k] = legacy[k];
    }
  })();
  const listeners = [];
  function setSetting(k, v){ settings[k] = v; store.set("tradescale:settings", settings); valueCache.clear(); listeners.forEach(f => f()); }
  const onSettings = f => listeners.push(f);

  /* ---------- Data ---------- */
  async function getJSON(path){
    const r = await fetch(path + (path.includes("?") ? "&" : "?") + "t=" + Math.floor(Date.now()/3.6e6), {cache:"no-cache"});
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json();
  }
  const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const pools = {};
  async function loadSport(sport){
    if (pools[sport]) return pools[sport];
    const d = await getJSON(`data/${sport}.json`);
    const list = d.players.map(r => {
      const [id,name,team,pos,born,value,inj,prod,outlook,elig,x] = r;
      return {id:String(id), name, team, pos, born, value, inj: inj || "", prod: prod ?? null, outlook: outlook ?? null,
              elig: String(elig || pos || "").split("/").filter(Boolean), x: x || {}, key: norm(name)};
    });
    list.updated = d.updated;
    list.byId = new Map(list.map(p => [p.id, p]));
    await Promise.all([loadSignals(sport), loadNews(sport)]);
    pools[sport] = list;
    return list;
  }

  /* ---------- Trained-model signals and player news (both optional: the pages work without them) ---------- */
  const signals = {}, news = {};
  let signalFile = null, newsFile = null;
  async function loadSignals(sport){
    try { signalFile = signalFile || await getJSON("data/signals.json"); } catch(e){ signalFile = {sports:{}}; }
    signals[sport] = (signalFile.sports || {})[sport] || null;
  }
  async function loadNews(sport){
    try { newsFile = newsFile || await getJSON("data/news.json"); } catch(e){ newsFile = {items:[]}; }
    const by = new Map();
    (newsFile.items || []).filter(i => i.sport === sport).forEach(i => { if (!by.has(i.id)) by.set(i.id, []); by.get(i.id).push(i); });
    by.forEach(l => l.sort((a, b) => b.d.localeCompare(a.d)));
    by.all = (newsFile.items || []).filter(i => i.sport === sport).sort((a, b) => b.d.localeCompare(a.d));
    news[sport] = by;
  }
  // What the trained prop model thinks of a player next to his trade value.
  // s > 0: the model ranks him higher at his position than his trade value does (buy); s < 0: lower (sell).
  function signalOf(p, sport){
    const S = signals[sport], r = S && !p.custom && S.players[p.id];
    if (!r) return null;
    const [proj, avg, mr, vr, n, s] = r;
    return {proj, avg, mr, vr, n, s, label: S.label.split(" (")[0], buy: s >= 0.4, sell: s <= -0.4};
  }
  function signalText(p, sport){
    const g = signalOf(p, sport); if (!g) return "";
    const pos = sport === "nfl" ? p.pos + "s" : "players at his position";
    return `The trained model projects ${g.proj} ${g.label} next game${g.avg != null ? ` (${g.avg} over his last 20 games)` : ""}: ` +
      `${ordinalN(g.mr)} of ${g.n} ${pos} by the model, ${ordinalN(g.vr)} by trade value.`;
  }
  function signalTag(p, sport){
    const g = signalOf(p, sport);
    if (!g || !(g.buy || g.sell)) return null;
    return el("span", {class:"mu sig " + (g.buy ? "sig-buy" : "sig-sell"), title: signalText(p, sport)}, g.buy ? "Model: buy" : "Model: sell");
  }
  const ordinalN = n => n + (["th","st","nd","rd"][(n % 100 - 20) % 10] || ["th","st","nd","rd"][n % 100] || "th");
  const newsFor = (sport, id) => ((news[sport] && news[sport].get(String(id))) || []);
  const allNews = sport => (news[sport] && news[sport].all) || [];
  const HURT = new Set(["Out","IR","PUP","Sus","NA","IL7","IL10","IL15","IL60","Doubtful"]);
  // One line saying what happened, in plain words.
  function newsLine(i){
    if (i.kind === "injury"){
      if (!i.to) return `Off the injury report${i.from ? ` (was ${i.from})` : ""}.`;
      const word = {IR:"placed on IR", PUP:"on the PUP list", Sus:"suspended", NA:"not active", DTD:"day-to-day", Out:"ruled out",
                    IL7:"on the 7-day IL", IL10:"on the 10-day IL", IL15:"on the 15-day IL", IL60:"on the 60-day IL"}[i.to] || i.to.toLowerCase();
      return `Now ${word}${i.from ? ` (was ${i.from})` : ""}.`;
    }
    if (i.kind === "team") return `Moved from ${i.from} to ${i.to}.`;
    return i.text || "";
  }
  const newsWhen = i => new Date(i.d).toLocaleDateString(undefined, {month:"short", day:"numeric"});

  /* ---------- Valuation ---------- */
  function ageOf(born){
    if (!born) return null;
    const b = new Date(String(born).slice(0,10) + "T00:00:00"); if (isNaN(b)) return null;
    return Math.floor((Date.now() - b) / 31557600000);
  }
  const PEAK = {nfl:{RB:26,WR:29,TE:30,QB:34,K:35,DEF:99}, nba:{_:30}, mlb:{_:31,RP:32}, nhl:{_:30,G:32}};
  function ageFactor(p, sport){
    const age = ageOf(p.born); if (age == null) return 1;
    const tbl = PEAK[sport] || {}; const peak = tbl[p.pos] ?? tbl._ ?? 29;
    if (age <= peak) return 1 + Math.min(0.15, (peak - age) * 0.03);
    return Math.max(0.45, 1 - (age - peak) * 0.09);
  }
  // Blend of what a player has done (track record) and what he's expected to do (outlook).
  function baseValue(p){
    if (p.custom || p.edited) return Number(p.value) || 0;
    const u = settings.upside / 100, o = p.outlook, d = p.prod;
    if (o != null && d != null) return u * o + (1 - u) * d;
    if (o != null) return o;
    if (d != null) return d;
    return Number(p.value) || 0;
  }
  const valueCache = new Map();
  function adjusted(p, sport){
    if (p.custom || p.edited) return Number(p.value) || 0;   // a number you typed is final
    const key = !p.custom && !p.edited ? sport + ":" + p.id : null;
    if (key && valueCache.has(key)) return valueCache.get(key);
    let v = baseValue(p);
    if (sport === "nfl"){
      const fmt = {ppr:{}, half:{RB:1.04,WR:.97,TE:.97}, std:{RB:1.08,WR:.93,TE:.92}}[settings.scoring] || {};
      v *= fmt[p.pos] ?? 1;
      if (settings.qb === "sf" && p.pos === "QB") v *= 1.45;
    }
    if (settings.mode === "dynasty") v *= ageFactor(p, sport);
    if (key) valueCache.set(key, v);
    return v;
  }
  // Stars beat depth: each value goes through a power curve before summing.
  const packageScore = (list, sport) => list.reduce((s,p) => s + 100 * Math.pow(Math.max(0, adjusted(p, sport))/100, 1.6), 0);

  /* ---------- Small UI helpers ---------- */
  const el = (tag, props = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k,v] of Object.entries(props)){
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e[k] = v;
      else if (v !== false && v != null) e.setAttribute(k, v);
    }
    kids.flat().forEach(c => c != null && e.append(c));
    return e;
  };
  const injTag = p => p.inj ? el("span", {class:"inj", text:p.inj}) : null;
  function metaText(p){
    if (p.custom) return "Custom player";
    const parts = [p.pos, p.team || "Free agent"].filter(Boolean);
    const age = ageOf(p.born); if (age != null) parts.push("age " + age);
    return parts.join(", ");
  }
  function splitText(p){
    if (p.custom || (p.prod == null && p.outlook == null)) return "";
    const bits = [];
    if (p.prod != null) bits.push(`track record ${p.prod}`);
    if (p.outlook != null) bits.push(`outlook ${p.outlook}`);
    return bits.join(", ");
  }
  const toItem = p => ({id:p.id, name:p.name, team:p.team, pos:p.pos, born:p.born, value:p.value, inj:p.inj,
                        prod:p.prod, outlook:p.outlook, elig:p.elig, x:p.x || {}});

  /* ---------- Matchups and form (football has the most detail; hockey has schedule strength) ---------- */
  function matchupWord(mu){
    if (mu == null) return null;
    if (mu >= 1.15) return ["Great", "mu-great"];
    if (mu >= 1.05) return ["Good", "mu-good"];
    if (mu > 0.95) return ["Neutral", "mu-neutral"];
    if (mu > 0.85) return ["Tough", "mu-tough"];
    return ["Brutal", "mu-brutal"];
  }
  function matchupTag(p){
    const x = p.x || {};
    if (!x.nx) return null;
    if (x.nx === "BYE") return el("span", {class:"mu mu-bye", text:"Bye"});
    const w = matchupWord(x.mu);
    return el("span", {class:"mu " + (w ? w[1] : ""), title: w ? `${w[0]} matchup: this defense allows ${Math.round(Math.abs(x.mu - 1) * 100)}% ${x.mu >= 1 ? "more" : "fewer"} points than average to ${p.pos}s` : ""},
      x.nx + (w ? ` · ${w[0]}` : ""));
  }
  function insightText(p){
    const x = p.x || {}, bits = [];
    if (x.form != null && x.ppg != null){
      const d = x.form - x.ppg;
      bits.push(`last 4: ${x.form} ppg${Math.abs(d) >= 2 ? (d > 0 ? " (heating up)" : " (cooling off)") : ""}`);
    } else if (x.ppg != null) bits.push(`${x.ppg} ppg`);
    if (x.proj != null) bits.push(`projected ${x.proj}`);
    if (x.use != null) bits.push(`${x.use} touches+targets/g`);
    if (x.sos != null) bits.push(`rest-of-season schedule ${x.sos >= 1.04 ? "easy" : x.sos <= 0.96 ? "hard" : "average"}`);
    return bits.join(", ");
  }
  function aiLine(p, sport){
    const x = p.x || {};
    const parts = [`${p.name} (${p.pos}, ${p.team || "FA"}${ageOf(p.born) != null ? ", age " + ageOf(p.born) : ""})`,
      `value ${Math.round(adjusted(p, sport))}`];
    if (p.prod != null) parts.push(`track record ${p.prod}`);
    if (p.outlook != null) parts.push(`outlook ${p.outlook}`);
    if (p.inj) parts.push(`injury: ${p.inj}`);
    if (x.ppg != null) parts.push(`${x.ppg} ppg this season`);
    if (x.form != null) parts.push(`${x.form} ppg last 4`);
    if (x.proj != null) parts.push(`${x.proj} projected ppg`);
    if (x.use != null) parts.push(`${x.use} touches+targets/g`);
    if (x.nx) parts.push(`next: ${x.nx}${x.mu != null ? ` (defense factor ${x.mu})` : ""}`);
    if (x.sos != null) parts.push(`rest-of-season schedule factor ${x.sos}`);
    if (x.gl != null) parts.push(`${x.gl} games left`);
    const g = signalOf(p, sport);
    if (g) parts.push(`trained model: ${g.proj} ${g.label} projected next game${g.avg != null ? ` vs ${g.avg} over his last 20 games` : ""}, ranked ${g.mr} of ${g.n} at his position by the model vs ${g.vr} by trade value`);
    const nw = newsFor(sport, p.id)[0];
    if (nw) parts.push(`latest news (${nw.d.slice(0, 10)}): ${newsLine(nw)}`);
    return parts.join(", ");
  }

  function seg(label, key, options, after){
    const wrap = el("span");
    wrap.append(el("span", {class:"lbl", text:label}));
    const g = el("span", {class:"seg", role:"group", "aria-label":label});
    options.forEach(([val,text]) => g.append(el("button", {text, "aria-pressed": String(settings[key] === val),
      onclick: () => { setSetting(key, val); after && after(); }})));
    wrap.append(g);
    return wrap;
  }
  function settingsBar(container, sport, after){
    container.innerHTML = "";
    container.append(seg("League","mode",[["redraft","Redraft"],["dynasty","Dynasty"]], after));
    if (sport === "nfl"){
      container.append(seg("Scoring","scoring",[["ppr","PPR"],["half","Half PPR"],["std","Standard"]], after));
      container.append(seg("QB","qb",[["1qb","1 QB"],["sf","Superflex"]], after));
    }
    const range = el("input", {type:"range", min:0, max:100, step:5, value:settings.upside, "aria-label":"Weight between track record and outlook"});
    let t; range.oninput = () => { clearTimeout(t); t = setTimeout(() => setSetting("upside", Number(range.value)), 120); };
    container.append(el("span", {class:"upside"}, el("span", {class:"lbl", text:"Value by"}),
      el("small", {text:"Track record"}), range, el("small", {text:"Outlook"})));
  }

  /* ---------- Player search (accessible combobox) ---------- */
  function makeSearch(host, {sport, exclude = () => new Set(), onPick, allowCustom = false, label = "Search players", placeholder}){
    const input = el("input", {type:"text", autocomplete:"off", role:"combobox", "aria-expanded":"false", "aria-label":label});
    const lid = "res-" + Math.random().toString(36).slice(2,8);
    const ul = el("ul", {class:"results", id:lid, role:"listbox"}); ul.hidden = true;
    input.setAttribute("aria-controls", lid);
    host.append(input, ul);
    let opts = [], active = -1;
    const close = () => { ul.hidden = true; input.setAttribute("aria-expanded","false"); active = -1; };
    const pick = o => { input.value = ""; close(); onPick(o.custom ? {custom:true, name:o.name} : o.p); input.focus(); };
    function show(){
      const q = norm(input.value.trim()), pool = pools[sport()];
      if (!q || !pool){ close(); return; }
      const taken = exclude(), hits = [];
      for (const p of pool){   // pools are sorted best-first, so early matches are the most relevant
        if (taken.has(p.id)) continue;
        if (p.key.includes(q) || (q.length <= 3 && norm(p.team) === q)){ hits.push(p); if (hits.length === 8) break; }
      }
      opts = hits.map(p => ({p}));
      if (allowCustom && !hits.some(p => p.key === q)) opts.push({custom:true, name: input.value.trim()});
      ul.innerHTML = "";
      opts.forEach((o, i) => {
        const li = el("li", {role:"option", id:`${lid}-${i}`});
        if (o.custom) li.append(el("span", {class:"custom", text:`Add "${o.name}" as a custom player`}));
        else {
          const n = el("span", {text:o.p.name}); const tg = injTag(o.p); if (tg) n.append(tg);
          li.append(n, el("span", {class:"meta", text:`${o.p.pos}, ${o.p.team || "FA"}  ${Math.round(adjusted(o.p, sport()))}`}));
        }
        li.onmousedown = e => { e.preventDefault(); pick(o); };
        ul.append(li);
      });
      if (!opts.length){ close(); return; }
      active = 0; mark(); ul.hidden = false; input.setAttribute("aria-expanded","true");
    }
    function mark(){
      [...ul.children].forEach((li,i) => li.setAttribute("aria-selected", String(i === active)));
      const cur = ul.children[active];
      if (cur){ input.setAttribute("aria-activedescendant", cur.id); cur.scrollIntoView({block:"nearest"}); }
    }
    input.addEventListener("input", show);
    input.addEventListener("focus", show);
    input.addEventListener("blur", () => setTimeout(close, 100));
    input.addEventListener("keydown", e => {
      if (ul.hidden) return;
      if (e.key === "ArrowDown"){ e.preventDefault(); active = (active+1) % opts.length; mark(); }
      else if (e.key === "ArrowUp"){ e.preventDefault(); active = (active-1+opts.length) % opts.length; mark(); }
      else if (e.key === "Enter" && opts[active]){ e.preventDefault(); pick(opts[active]); }
      else if (e.key === "Escape") close();
    });
    const refreshPlaceholder = () => { input.placeholder = placeholder ? placeholder() : `Search any ${sportName(sport()).toLowerCase()} player or team`; };
    refreshPlaceholder();
    return {input, refreshPlaceholder};
  }

  function ago(iso){
    if (!iso) return "never";
    const m = Math.max(1, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 60) return `${m} minute${m===1?"":"s"} ago`;
    const h = Math.round(m/60); if (h < 36) return `${h} hour${h===1?"":"s"} ago`;
    const d = Math.round(h/24); return `${d} day${d===1?"":"s"} ago`;
  }

  return {SPORTS, sportName, store, settings, setSetting, onSettings, getJSON, norm, pools, loadSport,
          ageOf, adjusted, packageScore, el, injTag, metaText, splitText, toItem, settingsBar, makeSearch, ago,
          matchupWord, matchupTag, insightText, aiLine,
          signalOf, signalText, signalTag, newsFor, allNews, newsLine, newsWhen, HURT};
})();
