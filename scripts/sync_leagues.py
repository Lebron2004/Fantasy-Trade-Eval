#!/usr/bin/env python3
"""
Sync ESPN and Yahoo fantasy leagues into the app.

Reads leagues.json (repo root), for example:
  [
    {"platform": "espn",  "sport": "nfl", "league_id": "12345678"},
    {"platform": "yahoo", "sport": "nfl", "league_id": "98765", "dynasty": true}
  ]

Credentials come from GitHub Secrets (environment variables), never from files:
  ESPN private leagues:  ESPN_S2, ESPN_SWID
  Yahoo:                 YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REFRESH_TOKEN
                         (get the refresh token once with scripts/yahoo_auth.py)

Writes site/data/leagues/<id>.json plus site/data/leagues/index.json. The app's
My League page lists these under "Synced from ESPN / Yahoo". Each league fails on
its own without stopping the others. Standard library only.
"""
import base64, json, os, re, sys, unicodedata, urllib.parse, urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
OUT = os.path.join(DATA, "leagues")
CONFIG = os.path.join(ROOT, "leagues.json")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def http(url, headers=None, data=None, timeout=60):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8")


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


# ---------------------------------------------------------------- matching players to the app's pool
SUFFIX = re.compile(r"\b(jr|sr|ii|iii|iv|v)\b")


def norm_name(n):
    n = unicodedata.normalize("NFKD", n or "").encode("ascii", "ignore").decode().lower()
    n = SUFFIX.sub("", re.sub(r"[^a-z ]", "", n.replace("-", " ")))
    return " ".join(n.split())


class Pool:
    def __init__(self, sport):
        d = load(os.path.join(DATA, f"{sport}.json"), {})
        self.players = d.get("players", [])
        self.ids = load(os.path.join(DATA, "ids", f"{sport}.json"), {})
        self.by_name, self.defs = {}, {}
        for r in self.players:
            pid, name, team, pos = str(r[0]), r[1], r[2], r[3]
            self.by_name.setdefault(norm_name(name), []).append((pid, pos, team))
            if pos == "DEF":
                self.defs[(team or "").upper()] = pid
                self.defs[norm_name(name).split(" ")[-1]] = pid   # nickname, e.g. "bills"

    def match(self, platform, ext_id, name, pos=None, team=None):
        hit = self.ids.get(platform, {}).get(str(ext_id)) if ext_id is not None else None
        if hit:
            return hit
        if pos in ("DEF", "D/ST", "DST"):
            key = norm_name(re.sub(r"D/ST|DST", "", name or "")).split(" ")
            return self.defs.get((team or "").upper()) or (self.defs.get(key[-1]) if key and key[-1] else None)
        cands = self.by_name.get(norm_name(name), [])
        if len(cands) == 1:
            return cands[0][0]
        for want in (lambda c: c[1] == pos and (c[2] or "").upper() == (team or "").upper(),
                     lambda c: c[1] == pos):
            narrowed = [c for c in cands if want(c)]
            if len(narrowed) == 1:
                return narrowed[0][0]
        return None


def scoring_from_rec(rec):
    return "ppr" if rec >= 1 else "half" if rec >= 0.5 else "std"


# ---------------------------------------------------------------- ESPN
ESPN_GAME = {"nfl": "ffl", "nba": "fba", "mlb": "flb", "nhl": "fhl"}
ESPN_SLOTS = {
    "nfl": {0: "QB", 2: "RB", 3: "WRRB_FLEX", 4: "WR", 5: "REC_FLEX", 6: "TE", 7: "SUPER_FLEX", 16: "DEF", 17: "K", 23: "FLEX"},
    "nba": {0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 7: "SG/SF", 8: "G/F", 9: "PF/C", 10: "F/C", 11: "UTIL"},
    "mlb": {0: "C", 1: "1B", 2: "2B", 3: "3B", 4: "SS", 5: "OF", 6: "MI", 7: "CI", 8: "OF", 9: "OF", 10: "OF",
            11: "DH", 12: "UTIL", 13: "P", 14: "SP", 15: "RP"},
    "nhl": {0: "C", 1: "LW", 2: "RW", 3: "F", 4: "D", 5: "G", 6: "UTIL"},
}
ESPN_BENCH = {"nfl": {20}, "nba": {12}, "mlb": {16}, "nhl": {7}}
ESPN_NFL_POS = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}


def espn_league(cfg, pool):
    sport, lid = cfg["sport"], str(cfg["league_id"])
    season = cfg.get("season") or (date.today().year if date.today().month >= 7 or sport in ("mlb",) else date.today().year - 1)
    if sport in ("nba", "nhl"):   # ESPN labels these seasons by the year they end
        season = cfg.get("season") or (date.today().year + 1 if date.today().month >= 9 else date.today().year)
    url = (f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/{ESPN_GAME[sport]}/seasons/{season}"
           f"/segments/0/leagues/{lid}?view=mTeam&view=mRoster&view=mSettings")
    headers = {}
    s2, swid = os.environ.get("ESPN_S2"), os.environ.get("ESPN_SWID")
    if s2 and swid:
        headers["Cookie"] = f"espn_s2={s2}; SWID={swid}"
    d = json.loads(http(url, headers))
    settings = d.get("settings") or {}
    counts = ((settings.get("rosterSettings") or {}).get("lineupSlotCounts") or {})
    slots, bench = [], 0
    for sid, n in sorted(counts.items(), key=lambda kv: int(kv[0])):
        sid, n = int(sid), int(n or 0)
        if sid in ESPN_BENCH[sport]:
            bench += n
        elif sid in ESPN_SLOTS[sport]:
            slots += [ESPN_SLOTS[sport][sid]] * n
    rec = 0
    for item in ((settings.get("scoringSettings") or {}).get("scoringItems") or []):
        if item.get("statId") == 53:
            rec = item.get("points") or 0
    teams, mine, unmatched = [], None, 0
    for t in d.get("teams") or []:
        name = t.get("name") or f"{t.get('location', '')} {t.get('nickname', '')}".strip() or f"Team {t.get('id')}"
        ids = []
        for e in ((t.get("roster") or {}).get("entries") or []):
            pl = ((e.get("playerPoolEntry") or {}).get("player") or {})
            pos = ESPN_NFL_POS.get(pl.get("defaultPositionId")) if sport == "nfl" else None
            pid = pool.match("espn", pl.get("id"), pl.get("fullName"), pos)
            if pid:
                ids.append(pid)
            else:
                unmatched += 1
        teams.append({"id": str(t.get("id")), "name": name, "players": ids})
        if swid and swid in (t.get("owners") or []):
            mine = str(t.get("id"))
    if not teams:
        raise RuntimeError("ESPN returned no teams (private league? add ESPN_S2 and ESPN_SWID secrets)")
    return {
        "id": f"espn-{sport}-{lid}", "sport": sport, "source": "espn",
        "name": settings.get("name") or f"ESPN league {lid}", "size": len(teams),
        "slots": slots, "benchSize": bench, "teams": teams, "myTeamId": mine or teams[0]["id"],
        "prefs": {"scoring": scoring_from_rec(rec), "qb": "sf" if "SUPER_FLEX" in slots or slots.count("QB") > 1 else "1qb",
                  "mode": "dynasty" if cfg.get("dynasty") else "redraft"},
        "unmatched": unmatched,
    }


# ---------------------------------------------------------------- Yahoo
YAHOO = "https://fantasysports.yahooapis.com/fantasy/v2"
YAHOO_SLOT = {"W/R/T": "FLEX", "W/R": "WRRB_FLEX", "W/T": "REC_FLEX", "Q/W/R/T": "SUPER_FLEX", "Util": "UTIL", "UTIL": "UTIL"}
YAHOO_SKIP = {"BN", "IR", "IR+", "IL", "IL+", "NA", "DL"}
_token = None


def yahoo_token():
    global _token
    if _token:
        return _token
    cid, secret, refresh = (os.environ.get(k) for k in ("YAHOO_CLIENT_ID", "YAHOO_CLIENT_SECRET", "YAHOO_REFRESH_TOKEN"))
    if not (cid and secret and refresh):
        raise RuntimeError("Yahoo secrets missing: YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET, YAHOO_REFRESH_TOKEN")
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": refresh,
                                   "redirect_uri": os.environ.get("YAHOO_REDIRECT_URI", "https://localhost:8080")}).encode()
    auth = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    resp = json.loads(http("https://api.login.yahoo.com/oauth2/get_token", {
        "Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"}, body))
    _token = resp["access_token"]
    return _token


def ystrip(el):
    for e in el.iter():
        if "}" in e.tag:
            e.tag = e.tag.split("}", 1)[1]
    return el


def yget(path):
    return ystrip(ET.fromstring(http(YAHOO + path, {"Authorization": f"Bearer {yahoo_token()}"})))


def ytext(el, path, default=""):
    f = el.find(path)
    return f.text if f is not None and f.text is not None else default


def yahoo_league(cfg, pool):
    sport, lid = cfg["sport"], str(cfg["league_id"])
    game_key = ytext(yget(f"/game/{sport}"), ".//game_key")
    if not game_key:
        raise RuntimeError(f"Yahoo has no current {sport} game")
    lk = f"{game_key}.l.{lid}"
    st = yget(f"/league/{lk}/settings")
    slots, bench = [], 0
    for rp in st.findall(".//roster_positions/roster_position"):
        pos, n = ytext(rp, "position"), int(ytext(rp, "count", "0") or 0)
        if pos == "BN":
            bench += n
        elif pos not in YAHOO_SKIP:
            slots += [YAHOO_SLOT.get(pos, pos.upper())] * n
    rec = 0
    for s in st.findall(".//stat_modifiers/stats/stat"):
        if ytext(s, "stat_id") == "11" and sport == "nfl":
            rec = float(ytext(s, "value", "0") or 0)
    tr = yget(f"/league/{lk}/teams/roster")
    teams, mine, unmatched = [], None, 0
    for t in tr.findall(".//teams/team"):
        tid = ytext(t, "team_key")
        ids = []
        for p in t.findall(".//roster/players/player"):
            pid = pool.match("yahoo", ytext(p, "player_id"), ytext(p, "name/full"),
                             ytext(p, "display_position").split(",")[0], ytext(p, "editorial_team_abbr"))
            if pid:
                ids.append(pid)
            else:
                unmatched += 1
        teams.append({"id": tid, "name": ytext(t, "name", tid), "players": ids})
        if ytext(t, "is_owned_by_current_login") == "1":
            mine = tid
    if not teams:
        raise RuntimeError("Yahoo returned no teams for this league")
    return {
        "id": f"yahoo-{sport}-{lid}", "sport": sport, "source": "yahoo",
        "name": ytext(st, ".//league/name") or f"Yahoo league {lid}", "size": len(teams),
        "slots": slots, "benchSize": bench, "teams": teams, "myTeamId": mine or teams[0]["id"],
        "prefs": {"scoring": scoring_from_rec(rec), "qb": "sf" if "SUPER_FLEX" in slots or slots.count("QB") > 1 else "1qb",
                  "mode": "dynasty" if cfg.get("dynasty") else "redraft"},
        "unmatched": unmatched,
    }


# ---------------------------------------------------------------- main
def main():
    cfg = load(CONFIG, [])
    if not cfg:
        print("No leagues in leagues.json, nothing to sync.")
        return
    index = {e["id"]: e for e in load(os.path.join(OUT, "index.json"), [])}
    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    pools = {}
    for c in cfg:
        platform, sport = c.get("platform"), c.get("sport")
        key = f"{platform}-{sport}-{c.get('league_id')}"
        if sport not in ESPN_GAME or platform not in ("espn", "yahoo"):
            print(f"{key}: skipped (platform must be espn or yahoo, sport nfl/nba/mlb/nhl)", file=sys.stderr)
            continue
        try:
            pool = pools.setdefault(sport, Pool(sport))
            lg = (espn_league if platform == "espn" else yahoo_league)(c, pool)
            lg["syncedAt"] = stamp
            save(os.path.join(OUT, f"{lg['id']}.json"), lg)
            index[lg["id"]] = {"id": lg["id"], "sport": sport, "source": platform, "name": lg["name"],
                               "syncedAt": stamp, "ok": True, "unmatched": lg["unmatched"]}
            print(f"{key}: {lg['name']}, {len(lg['teams'])} teams, {lg['unmatched']} unmatched players")
        except Exception as e:
            prev = index.get(key, {"id": key, "sport": sport, "source": platform, "name": key})
            msg = str(e)
            if platform == "espn" and ("401" in msg or "403" in msg):
                msg = "ESPN said this league is private. Add the ESPN_S2 and ESPN_SWID secrets (see README)."
            elif platform == "yahoo" and ("401" in msg or "invalid_grant" in msg):
                msg = "Yahoo rejected the login. Re-run scripts/yahoo_auth.py and update YAHOO_REFRESH_TOKEN."
            index[key] = {**prev, "ok": False, "error": msg[:300], "tried": stamp}
            print(f"{key}: FAILED, kept previous data. {e}", file=sys.stderr)
    save(os.path.join(OUT, "index.json"), list(index.values()))


if __name__ == "__main__":
    main()
