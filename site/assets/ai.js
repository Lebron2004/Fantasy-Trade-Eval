/* AI GM: sends the app's analysis to Claude (with live web search for news) and shows the answer.
   Your Anthropic API key is stored only in this browser's localStorage and sent only to api.anthropic.com. */
const AI = (() => {
  const {store, el} = TS;
  const KEY = "tradescale:ai";
  const MODELS = [
    ["claude-sonnet-5-5", "Claude Sonnet 5.5 (recommended)"],
    ["claude-opus-5-5", "Claude Opus 5.5 (deepest analysis)"],
    ["claude-haiku-4-5-20251001", "Claude Haiku 4.5 (fastest, cheapest)"]
  ];
  const cfg = () => Object.assign({key:"", model: MODELS[0][0]}, store.get(KEY) || {});
  const setCfg = c => store.set(KEY, c);

  async function call(system, prompt, search){
    const c = cfg();
    const body = {model: c.model, max_tokens: 2000, system, messages: [{role: "user", content: prompt}]};
    if (search) body.tools = [{type: "web_search_20250305", name: "web_search", max_uses: 5}];
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {"content-type": "application/json", "x-api-key": c.key, "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true"},
      body: JSON.stringify(body)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok){ const e = new Error((data.error && data.error.message) || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return data;
  }

  async function ask(system, prompt){
    let data, searched = true;
    try { data = await call(system, prompt, true); }
    catch(e){
      // Web search must be enabled for the API org; if it isn't, still answer without it.
      if (e.status === 400 && /search|tool/i.test(e.message)){ searched = false; data = await call(system, prompt, false); }
      else throw e;
    }
    const blocks = data.content || [];
    const text = blocks.filter(b => b.type === "text").map(b => b.text).join("");
    const seen = new Map();
    blocks.forEach(b => (b.citations || []).forEach(c => { if (c.url && !seen.has(c.url)) seen.set(c.url, c.title || c.url); }));
    return {text, sources: [...seen].map(([url, title]) => ({url, title})), searched};
  }

  // Minimal, safe markdown: escape everything, then allow bold, headings, and bullet lists.
  function render(text){
    const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const out = []; let list = null;
    text.split(/\n/).forEach(line => {
      const t = line.trim();
      const li = t.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
      if (li){ if (!list){ list = []; } list.push(`<li>${inline(li[1])}</li>`); return; }
      if (list){ out.push(`<ul>${list.join("")}</ul>`); list = null; }
      if (!t) return;
      const h = t.match(/^#{1,4}\s+(.*)/);
      out.push(h ? `<h4>${inline(h[1])}</h4>` : `<p>${inline(t)}</p>`);
    });
    if (list) out.push(`<ul>${list.join("")}</ul>`);
    return out.join("");
  }

  function friendlyError(e){
    if (e.status === 401) return "Anthropic didn't accept that API key. Check it in your Anthropic Console and paste it again.";
    if (e.status === 429) return "Rate limit hit. Wait a minute and try again.";
    if (e.status === 529 || e.status === 503) return "The AI is overloaded right now. Try again in a minute.";
    if (/credit|billing|balance/i.test(e.message || "")) return "Your Anthropic account needs credits. Add some in the Console under Billing.";
    if (e instanceof TypeError) return "Couldn't reach Anthropic. Check your connection and try again.";
    return "The AI couldn't answer: " + (e.message || "unknown error");
  }

  /* Panel: key setup when needed, otherwise question box + presets + answer. */
  function panel(host, {intro, presets, buildPrompt, system}){
    host.innerHTML = "";
    const c = cfg();
    if (!c.key || host.dataset.setup === "1"){
      const key = el("input", {type: "password", placeholder: "sk-ant-...", autocomplete: "off", "aria-label": "Anthropic API key", value: c.key});
      const model = el("select", {"aria-label": "AI model"});
      MODELS.forEach(([id, label]) => model.append(el("option", {value: id, text: label, selected: id === c.model ? "" : false})));
      const save = el("button", {class: "btn primary", text: "Save", onclick: () => {
        if (!key.value.trim().startsWith("sk-")) { key.focus(); return; }
        setCfg({key: key.value.trim(), model: model.value}); host.dataset.setup = "0"; panel(host, {intro, presets, buildPrompt, system});
      }});
      host.append(el("p", {class: "sub", text: "The AI GM reads everything this page knows (your roster, values, matchups, needs, and trade ideas), checks the latest news and injuries on the web, and gives you a straight recommendation. It runs on your own Anthropic API key, usually a few cents per question."}),
        el("div", {class: "ai-setup"},
          el("label", {class: "field"}, "Anthropic API key", key),
          el("label", {class: "field"}, "Model", model),
          el("div", {class: "bar-row", style: "align-self:flex-end"}, save,
            c.key ? el("button", {class: "btn", text: "Cancel", onclick: () => { host.dataset.setup = "0"; panel(host, {intro, presets, buildPrompt, system}); }}) : null)),
        el("p", {class: "split", style: "margin-top:8px", text: "Get a key at console.anthropic.com. It's saved only in this browser and sent only to Anthropic. Don't use this on a shared computer."}));
      return;
    }
    const q = el("textarea", {class: "ai-q", placeholder: "Ask anything about your team, a trade, or this week's lineup", rows: 2, "aria-label": "Question for the AI GM"});
    const out = el("div", {class: "ai-out", "aria-live": "polite"});
    const go = el("button", {class: "btn primary", text: "Ask"});
    const run = async question => {
      const prompt = buildPrompt(question);
      if (!prompt) return;
      go.disabled = true; go.textContent = "Thinking...";
      out.innerHTML = ""; out.append(el("p", {class: "empty", style: "margin:0", text: "Reading your data and checking the latest news. This can take 20–40 seconds."}));
      try {
        const res = await ask(system(), prompt);
        out.innerHTML = render(res.text || "No answer came back.");
        if (res.sources.length){
          const ul = el("ul", {class: "ai-src"});
          res.sources.slice(0, 8).forEach(s => ul.append(el("li", {}, el("a", {href: s.url, target: "_blank", rel: "noopener", text: s.title}))));
          out.append(el("p", {class: "split", style: "margin:12px 0 4px", text: "Sources checked"}), ul);
        }
        if (!res.searched) out.append(el("p", {class: "split", text: "Live web search isn't turned on for your Anthropic organization, so this answer doesn't include today's news. An admin can enable it in the Anthropic Console's privacy settings."}));
      } catch(e){
        out.innerHTML = ""; out.append(el("p", {class: "err", text: friendlyError(e)}));
      }
      go.disabled = false; go.textContent = "Ask";
    };
    go.onclick = () => run(q.value.trim());
    q.onkeydown = e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run(q.value.trim()); };
    const chips = el("div", {class: "bar-row", style: "margin:8px 0"});
    presets.forEach(p => chips.append(el("button", {class: "btn", text: p, onclick: () => { q.value = p; run(p); }})));
    const modelName = (MODELS.find(m => m[0] === c.model) || [, c.model])[1];
    host.append(intro ? el("p", {class: "sub", text: intro}) : null, chips,
      el("div", {class: "bar-row"}, q, go), out,
      el("p", {class: "split", style: "margin-top:10px"}, `Using ${modelName}. `,
        el("a", {href: "#", text: "Change key or model", onclick: e => { e.preventDefault(); host.dataset.setup = "1"; panel(host, {intro, presets, buildPrompt, system}); }}),
        " · ",
        el("a", {href: "#", text: "Remove key", onclick: e => { e.preventDefault(); setCfg({key: "", model: c.model}); panel(host, {intro, presets, buildPrompt, system}); }})));
  }

  function system(sportName){
    const today = new Date().toLocaleDateString(undefined, {weekday:"long", year:"numeric", month:"long", day:"numeric"});
    return `You are a sharp, honest fantasy ${sportName.toLowerCase()} general manager advising one manager. Today is ${today}.

The app gives you its model data. Every player value is on a 1-100 scale that blends track record (fantasy points actually scored this season and last) with outlook (projections, recent form, usage, rest-of-season schedule strength, injuries, and age). A defense factor above 1 means that defense allows more fantasy points than average to that position, so it's a good matchup; below 1 is a tough one.

Before recommending anything, use web search to check the latest news on the key players involved: injuries and practice reports, depth chart and role changes, trades, suspensions. If the news contradicts the model's numbers, say so plainly and weigh the news more heavily.

Start with a clear recommendation in one or two sentences. Then give the 2-4 reasons that matter most, naming specific players. Keep it under 300 words unless asked for more. Don't use tables.`;
  }

  return {panel, render, system};
})();
