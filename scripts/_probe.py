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
for q in ("", "?dates=20260927", "?dates=20260920-20260930", "?dates=20260801-20260930", "?dates=20260920-20260930&limit=100",
          "?dates=20260101-20261231", "?dates=2026"):
    d = try_(E + "eng.1/scoreboard" + q)
    if d: print("   events", len(d.get("events", [])))
d = try_(E + "eng.1/scoreboard?dates=20260920-20260930")
evs = (d or {}).get("events", [])
if evs:
    ev = evs[0]; c = ev["competitions"][0]
    print("event keys", list(ev), "comp keys", list(c))
    print("competitor", json.dumps(c["competitors"][0])[:1000])
    print("status", json.dumps(c.get("status"))[:300], "season", ev.get("season"))
    s = try_(E + f"eng.1/summary?event={ev['id']}")
    print("summary keys", list(s))
    for r in s.get("rosters", [])[:1]:
        print("roster keys", list(r), json.dumps(r.get("team"))[:300], "n", len(r.get("roster", [])))
        for p in r.get("roster", [])[:2] + r.get("roster", [])[-3:]:
            print("PLAYER", json.dumps(p)[:3000])
    print("keyEvents", json.dumps((s.get("keyEvents") or [])[:2])[:1500])
    bx = s.get("boxscore") or {}
    print("boxscore keys", list(bx), json.dumps(bx.get("players"))[:600] if bx.get("players") else "")
h = try_("https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket")
if h:
    for lg in h["sports"][0]["leagues"]:
        print("LEAGUE", lg.get("id"), lg.get("name"), [(e.get("date"), e.get("name"), (e.get("class") or {}).get("generalClassCard"), e.get("status")) for e in lg.get("events", [])][:6])
    lg = next((l for l in h["sports"][0]["leagues"] if any((e.get("class") or {}).get("generalClassCard") == "T20I" for e in l.get("events", []))), None)
    if lg:
        ev = [e for e in lg["events"] if (e.get("class") or {}).get("generalClassCard") == "T20I"][0]
        print("EVENT keys", list(ev)); print("competitors", json.dumps(ev.get("competitors"))[:1500])
        s = try_(f"https://site.api.espn.com/apis/site/v2/sports/cricket/{lg['id']}/summary?event={ev['id']}")
        if s:
            print("summary keys", list(s))
            for k in ("rosters", "boxscore", "header", "matchcards"):
                print(k, json.dumps(s.get(k))[:2500])
for q in ("?dates=20261001-20261031", "?dates=20261020", ""):
    try_("https://site.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard" + q)
