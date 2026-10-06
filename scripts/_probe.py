"""Temporary: print the shape of ESPN soccer/cricket and Cricsheet data from CI (removed before review)."""
import io, json, sys, zipfile, urllib.request
UA = {"User-Agent": "TradeScale/1.0 (personal props research tool)"}
def get(u, t=60):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=t) as r:
        return r.read()
def show(label, u, n=1500):
    try:
        b = get(u); print(f"== {label} OK {len(b)} bytes: {u}"); print(b[:n].decode("utf-8", "ignore")); return b
    except Exception as e:
        print(f"== {label} FAIL {u}: {e}")
E = "https://site.api.espn.com/apis/site/v2/sports/"
b = show("soc board", E + "soccer/eng.1/scoreboard?dates=20260920-20260930&limit=100", 300)
if b:
    d = json.loads(b); evs = d.get("events", [])
    print("events", len(evs))
    if evs:
        ev = evs[0]; c = ev["competitions"][0]
        print("event keys", list(ev), "comp keys", list(c))
        print("competitor", json.dumps(c["competitors"][0])[:1200])
        print("status", json.dumps(c.get("status"))[:400], "season", ev.get("season"))
        s = json.loads(get(E + f"soccer/eng.1/summary?event={ev['id']}"))
        print("summary keys", list(s))
        for r in s.get("rosters", [])[:1]:
            print("roster team keys", list(r), json.dumps(r.get("team"))[:300])
            for p in r.get("roster", [])[:2] + r.get("roster", [])[-2:]:
                print("PLAYER", json.dumps(p)[:2500])
        print("keyEvents sample", json.dumps((s.get("keyEvents") or [])[:3])[:1500])
        print("header comp", json.dumps(((s.get("header") or {}).get("competitions") or [{}])[0].get("status"))[:300])
for lg in ("uefa.champions", "usa.1", "esp.1", "ita.1", "ger.1", "fra.1"):
    show("soc " + lg, E + f"soccer/{lg}/scoreboard?dates=20261001-20261031&limit=200", 200)
for u in (E + "cricket/scoreboard", E + "cricket/8048/scoreboard", "https://site.web.api.espn.com/apis/site/v2/sports/cricket/8048/scoreboard",
          "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket", "https://site.api.espn.com/apis/v2/scoreboard/header?sport=cricket&lang=en&region=in",
          "https://hs-consumer-api.espncricinfo.com/v1/pages/matches/current?lang=en&latest=true", "https://hs-consumer-api.espncricinfo.com/v1/pages/matches/upcoming?lang=en"):
    b = show("cric", u, 2500)
for nm in ("ipl", "bbl", "psl", "cpl", "sat", "mlc", "ilt", "t20s", "hnd"):
    try:
        b = get(f"https://cricsheet.org/downloads/{nm}_json.zip", 180)
        z = zipfile.ZipFile(io.BytesIO(b)); names = sorted(z.namelist())
        print(f"== cricsheet {nm}: {len(b)} bytes, {len(names)} files, e.g. {names[:3]}")
        if nm == "ipl":
            js = [n for n in names if n.endswith(".json")]
            m = json.loads(z.read(js[-1])); print(json.dumps(m["info"])[:3000]); print(json.dumps(m["innings"][0]["overs"][0])[:1500])
    except Exception as e:
        print(f"== cricsheet {nm} FAIL {e}")
show("cricsheet people", "https://cricsheet.org/register/people.csv", 400)
