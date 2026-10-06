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
d = try_(E + "eng.1/scoreboard?dates=202609")
ev = [e for e in d["events"] if e["competitions"][0]["status"]["type"].get("completed")][0]
c = ev["competitions"][0]
print("comp keys", list(c)); print("competitor", json.dumps(c["competitors"][0])[:600]); print("season", ev.get("season"), "status", json.dumps(c["status"])[:300])
s = try_(E + f"eng.1/summary?event={ev['id']}")
print("summary keys", list(s))
for r in s.get("rosters", [])[:1]:
    print("roster keys", list(r), json.dumps(r.get("team"))[:200], "n", len(r.get("roster", [])))
    ro = r.get("roster", [])
    for p in ro[:1] + ro[11:13] + ro[-1:]:
        print("PLAYER", json.dumps(p)[:2200])
    print("POSITIONS", sorted({(p.get("position") or {}).get("abbreviation") for p in ro if p.get("position")}))
print("keyEvents", json.dumps([(k.get("type"), k.get("clock"), [a.get("athlete", {}).get("displayName") for a in k.get("participants", [])]) for k in (s.get("keyEvents") or []) if "ubstit" in json.dumps(k.get("type"))][:3]))
print("boxscore", json.dumps((s.get("boxscore") or {}).get("players"))[:300])
fut = [e for e in d["events"] if e["competitions"][0]["status"]["type"].get("state") == "pre"]
d2 = try_(E + "eng.1/scoreboard?dates=202610")
fut = [e for e in d2["events"] if e["competitions"][0]["status"]["type"].get("state") == "pre"]
print("future", len(fut), fut and json.dumps([x.get("team", {}).get("abbreviation") for x in fut[0]["competitions"][0]["competitors"]]))
h = try_("https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket")
for lg in h["sports"][0]["leagues"]:
    for ev in lg.get("events", []):
        if ev.get("status") in ("in", "post") and "T20" in json.dumps(ev.get("class")):
            s = try_(f"https://site.api.espn.com/apis/site/v2/sports/cricket/{lg['id']}/summary?event={ev['id']}")
            print("MCs", [(m.get("headline"), m.get("inningsNumber"), m.get("teamName"), len(m.get("playerDetails", []))) for m in s.get("matchcards", [])])
            for m in s.get("matchcards", []):
                if m.get("headline") == "Bowling":
                    print("BOWL", json.dumps(m.get("playerDetails", [])[:1])); break
            for r in s.get("rosters", [])[:1]:
                for p in r.get("roster", [])[:1]:
                    for ls in p.get("linescores", []):
                        for l2 in ls.get("linescores", []):
                            st = (l2.get("statistics") or {}).get("categories", [])
                            print("PERIOD", ls.get("period"), [(x.get("name"), x.get("value")) for cat in st for x in cat.get("stats", []) if x.get("value") not in (0, "0", None)][:60])
                            print("ALLNAMES", [x.get("name") for cat in st for x in cat.get("stats", [])])
            break
