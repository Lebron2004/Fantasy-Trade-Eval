"""Temporary: print the shape of ESPN soccer/cricket data from CI (removed before review)."""
import json, urllib.request
UA = {"User-Agent": "TradeScale/1.0 (personal props research tool)"}
def get(u, t=60):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r:
        return r.read()
def try_(u):
    try:
        b = get(u); print(f"== OK {len(b)}: {u}"); return json.loads(b)
    except Exception as e:
        print(f"== FAIL {u}: {e}")
E = "https://site.api.espn.com/apis/site/v2/sports/soccer/"
for q in ("?dates=2026&limit=1000", "?dates=2025&limit=1000", "?dates=202609", "?dates=20260920-20260927", "?dates=20260920-20260921",
          "?dates=20260801-20261231&limit=500", "?season=2025&limit=500"):
    d = try_(E + "eng.1/scoreboard" + q)
    if d:
        evs = d.get("events", [])
        print("   events", len(evs), evs[0]["date"] if evs else "", evs[-1]["date"] if evs else "", (d.get("leagues") or [{}])[0].get("calendarStartDate"))
d = try_(E + "eng.1/scoreboard?dates=20260926")
evs = (d or {}).get("events", []) or (try_(E + "eng.1/scoreboard?dates=20260927") or {}).get("events", [])
if evs:
    ev = evs[0]; c = ev["competitions"][0]
    print("comp keys", list(c)); print("competitor", json.dumps(c["competitors"][0])[:700]); print("season", ev.get("season"))
    s = try_(E + f"eng.1/summary?event={ev['id']}")
    print("summary keys", list(s))
    for r in s.get("rosters", [])[:1]:
        print("roster keys", list(r), json.dumps(r.get("team"))[:200], "n", len(r.get("roster", [])))
        for p in r.get("roster", [])[:1] + r.get("roster", [])[11:12] + r.get("roster", [])[-1:]:
            print("PLAYER", json.dumps(p)[:2500])
    print("keyEvents", json.dumps((s.get("keyEvents") or [])[:2])[:800])
for lg in ("uefa.champions", "usa.1", "esp.1", "ita.1", "ger.1", "fra.1"):
    d = try_(E + lg + "/scoreboard?dates=2026&limit=1000")
    if d: print("   events", len(d.get("events", [])))
for q in ("&dates=20261010", "&dates=20261010-20261020", "&limit=500"):
    h = try_("https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket" + q)
    if h: print("   ", [(l.get("name"), len(l.get("events", [])), [e.get("date")[:10] for e in l.get("events", [])][:3]) for l in h["sports"][0]["leagues"]][:12])
h = try_("https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket")
for lg in h["sports"][0]["leagues"]:
    for ev in lg.get("events", []):
        if ev.get("status") == "in" and "T20" in json.dumps(ev.get("class")):
            print("LIVE EVENT", lg["id"], ev["id"], ev.get("name"), json.dumps(ev.get("fullStatus"))[:400], json.dumps(ev.get("competitors"))[:300])
            s = try_(f"https://site.api.espn.com/apis/site/v2/sports/cricket/{lg['id']}/summary?event={ev['id']}")
            for mc in (s or {}).get("matchcards", []):
                print("MC", mc.get("headline"), mc.get("inningsNumber"), mc.get("teamName"), json.dumps(mc.get("playerDetails", [])[:2])[:600])
            hc = ((s or {}).get("header") or {}).get("competitions", [{}])[0]
            print("STATUS", json.dumps(hc.get("status"))[:500])
            for cp in hc.get("competitors", []):
                print("LS", cp["team"]["displayName"], [(l.get("period"), l.get("runs"), l.get("wickets"), l.get("overs"), l.get("isBatting"), l.get("description")) for l in cp.get("linescores", [])])
            break
