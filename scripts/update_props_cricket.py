#!/usr/bin/env python3
"""
Trade Scale props builder for T20 cricket: the big franchise leagues and men's T20 internationals.

Leagues: Indian Premier League, Big Bash League, Pakistan Super League, Caribbean Premier League, SA20,
Major League Cricket, ILT20, and men's T20 internationals (World Cup included). ODIs and Tests are left out: a
50-over or five-day game is a different stat line, and books post far fewer props on them.

Per player per match (from ball-by-ball data):
  r    runs scored            bf   balls faced          f4  fours        s6  sixes
  wk   wickets taken          rc   runs conceded        bb  balls bowled (legal)
  ct   catches
Roles ("positions") come from what he's done over the last two years: bowlers bowl at least two overs a game,
all-rounders also bat in the top seven, everyone else is a batter (keepers included).
"Defense" is what each team gives up per match: runs to batters, wickets to bowlers.

Writes, like the other builders:
  site/data/props/cri/index.json     players + each team's next match
  site/data/props/cri/defense.json   what each team allows per match to each role
  site/data/props/cri/p/<id>.json    match log

Sources: Cricsheet (cricsheet.org) ball-by-ball JSON, updated a day or two after each match. Upcoming matches come
from ESPN's public cricket scoreboard. Needs pandas.

Run: python scripts/update_props_cricket.py           (build)
     python scripts/update_props_cricket.py --check   (fetch and summarize, writes nothing)
"""
import io, json, os, re, sys, unicodedata, zipfile
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_props_more import DATA, TODAY, build_sport, fetch  # noqa: E402

CRICSHEET = "https://cricsheet.org/downloads/{}_json.zip"
LEAGUES = {"ipl": "IPL", "bbl": "BBL", "psl": "PSL", "cpl": "CPL", "sat": "SA20", "mlc": "MLC", "ilt": "ILT20", "t20s": "T20I"}
ESPN_HEADER = "https://site.web.api.espn.com/apis/v2/scoreboard/header?sport=cricket"
YEARS = 4                 # matches from this many calendar years back
NOT_BOWLER = {"run out", "retired hurt", "retired out", "retired not out", "obstructing the field"}
# franchises that renamed: keep one name so a team's history and its next match line up
RENAMED = {"Royal Challengers Bangalore": "Royal Challengers Bengaluru", "Delhi Daredevils": "Delhi Capitals",
           "Kings XI Punjab": "Punjab Kings", "Rising Pune Supergiants": "Rising Pune Supergiant"}


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").lower().strip()


def team_name(t):
    t = str(t or "").strip()
    return RENAMED.get(t, t)


def team_key(t):
    """Loose key for matching ESPN's team names to Cricsheet's ("U.A.E." vs "United Arab Emirates")."""
    t = norm(team_name(t)).replace("&", "and")
    t = re.sub(r"\b(men|mens|cricket|team|xi)\b", "", re.sub(r"[^a-z ]", "", t))
    return re.sub(r"\s+", " ", t).strip()


ALIAS = {"uae": "united arab emirates", "usa": "united states of america", "united states": "united states of america",
         "png": "papua new guinea", "sa": "south africa", "nz": "new zealand", "wi": "west indies"}


# ---------------------------------------------------------------- one match -> rows
def match_rows(m, league):
    info = m.get("info", {})
    if info.get("gender") != "male" or info.get("match_type") not in ("T20", "IT20"):
        return []
    date = (info.get("dates") or [None])[0]
    if not date:
        return []
    teams = [team_name(t) for t in info.get("teams", [])]
    if len(teams) != 2:
        return []
    reg = (info.get("registry") or {}).get("people", {})
    xi = {team_name(t): list(ps) for t, ps in (info.get("players") or {}).items()}
    winner = team_name((info.get("outcome") or {}).get("winner"))
    stage = str((info.get("event") or {}).get("stage") or "")
    post = int(bool(re.search(r"final|qualifier|eliminator|playoff|knockout|challenger", stage, re.I)))
    event = str((info.get("event") or {}).get("name") or league)
    stats, total, bpos = {}, {t: 0 for t in teams}, {}

    def S(name):
        return stats.setdefault(name, {"r": 0, "bf": 0, "f4": 0, "s6": 0, "wk": 0, "rc": 0, "bb": 0, "ct": 0})

    for inn in m.get("innings", []):
        if inn.get("super_over"):
            continue
        bat_team = team_name(inn.get("team"))
        order = bpos.setdefault(bat_team, {})
        for ov in inn.get("overs", []):
            for d in ov.get("deliveries", []):
                for who in (d.get("batter"), d.get("non_striker")):
                    if who and who not in order:
                        order[who] = len(order) + 1
                ex, runs = d.get("extras") or {}, d.get("runs") or {}
                if bat_team in total:
                    total[bat_team] += int(runs.get("total", 0))
                b, bw = S(d["batter"]), S(d["bowler"])
                rb = int(runs.get("batter", 0))
                b["r"] += rb
                if "wides" not in ex:
                    b["bf"] += 1
                if not runs.get("non_boundary"):
                    b["f4"] += rb == 4
                    b["s6"] += rb == 6
                bw["rc"] += rb + int(ex.get("wides", 0)) + int(ex.get("noballs", 0))
                if "wides" not in ex and "noballs" not in ex:
                    bw["bb"] += 1
                for w in d.get("wickets", []):
                    kind = str(w.get("kind", ""))
                    if kind not in NOT_BOWLER:
                        bw["wk"] += 1
                    if kind == "caught and bowled":
                        bw["ct"] += 1
                    elif kind == "caught":
                        for f in w.get("fielders", []):
                            if f.get("name") and not f.get("substitute"):
                                S(f["name"])["ct"] += 1
    gid = str(info.get("match_id") or m.get("_id"))
    rows = []
    for t in teams:
        opp = teams[1] if t == teams[0] else teams[0]
        for nm in xi.get(t, []):
            s = stats.get(nm, {"r": 0, "bf": 0, "f4": 0, "s6": 0, "wk": 0, "rc": 0, "bb": 0, "ct": 0})
            rows.append({"pid": reg.get(nm) or norm(nm).replace(" ", "-"), "name": nm, "team": t, "opp": opp, "date": date,
                         "game": gid, "league": league, "event": event, "post": post,
                         "ts": total.get(t), "os": total.get(opp), "won": np.nan if not winner else float(winner == t),
                         "bpos": bpos.get(t, {}).get(nm, np.nan), **s})
    return rows


def matches(check=False):
    rows, seen = [], set()
    for key, league in LEAGUES.items():
        try:
            z = zipfile.ZipFile(io.BytesIO(fetch(CRICSHEET.format(key), timeout=240)))
        except Exception as e:
            print(f"  cricket {league}: unavailable ({str(e)[:100]})", file=sys.stderr)
            continue
        n = 0
        for name in z.namelist():
            if not name.endswith(".json"):
                continue
            mid = name.rsplit("/", 1)[-1][:-5]
            if mid in seen:          # a match can sit in two downloads
                continue
            m = json.loads(z.read(name))
            date = ((m.get("info") or {}).get("dates") or [""])[0]
            if date < f"{TODAY.year - YEARS}-01-01":
                continue
            seen.add(mid)
            m.setdefault("info", {})["match_id"] = mid
            r = match_rows(m, league)
            rows.extend(r)
            n += bool(r)
        print(f"  cricket {league}: {n} matches since {TODAY.year - YEARS}")
    if not rows:
        raise RuntimeError("cricket: no matches from Cricsheet")
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- upcoming matches
def upcoming():
    """Men's T20 matches on ESPN's cricket scoreboard that haven't started: [(date, time, team_a, team_b, event)]."""
    data = json.loads(fetch(ESPN_HEADER, tries=2, timeout=30))
    out = []
    for sp in data.get("sports", []):
        for lg in sp.get("leagues", []):
            lname = str(lg.get("name") or "")
            for ev in lg.get("events", []):
                cls = ev.get("class") or {}
                kind = " ".join(str(cls.get(k) or "") for k in ("eventType", "generalClassCard", "name"))
                if "T20" not in kind and "Twenty20" not in kind:
                    continue
                if re.search(r"women", lname + " " + kind + " " + str(ev.get("name")), re.I):
                    continue
                if str(ev.get("status") or "").lower() not in ("pre", "scheduled") and \
                        (((ev.get("fullStatus") or {}).get("type") or {}).get("state") != "pre"):
                    continue
                names = [c.get("displayName") or c.get("name") for c in (ev.get("competitors") or [])]
                if len(names) != 2 or not all(names):
                    parts = re.split(r"\s+v(?:s\.?)?\s+", str(ev.get("name") or ""))
                    names = parts if len(parts) == 2 else None
                if not names or any(re.search(r"\bTBA|TBC|TBD\b", n) for n in names):
                    continue
                when = ev.get("date") or ""
                out.append((eastern(when), when, names[0], names[1], lname))
    return out


def eastern(iso):
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return str(iso)[:10]


def cricket(check=False):
    try:
        card = upcoming()
        print(f"  cricket schedule: {len(card)} upcoming men's T20 matches on ESPN")
    except Exception as e:
        card = []
        print(f"  cricket schedule unavailable: {str(e)[:120]}", file=sys.stderr)
    df = matches()
    df["season"] = pd.to_datetime(df["date"]).dt.year
    cur = int(df["season"].max())
    # roles from the last two years
    recent = df[df["date"] >= (TODAY - timedelta(days=730)).isoformat()]
    bowl = recent.groupby("pid")["bb"].mean()
    bat_pos = recent.groupby("pid")["bpos"].median()

    def role(pid):
        bb, bp = bowl.get(pid, 0), bat_pos.get(pid, np.nan)
        if bb >= 12:
            return "AR" if bp == bp and bp <= 7 else "BOWL"
        return "BAT"
    roles = {p: role(p) for p in df["pid"].unique()}
    df["grp"] = df["pid"].map(roles)
    df["pos"] = df["grp"]
    # ESPN's names for teams -> ours
    ours = {}
    for t in df["team"].unique():
        ours[team_key(t)] = t
    def find(t):
        k = team_key(t)
        return ours.get(k) or ours.get(ALIAS.get(k, k)) or team_name(t)
    nxt = {}
    for d, tm, a, b, event in sorted(card, key=lambda r: (r[0], str(r[1]))):
        if d < TODAY.isoformat() or d > (TODAY + timedelta(days=21)).isoformat():
            continue
        ta, tb = find(a), find(b)
        for me, them in ((ta, tb), (tb, ta)):
            if me not in nxt:
                nxt[me] = {"opp": them, "home": None, "date": d, "time": tm, "event": event}
    matched = sum(1 for t in nxt if t in set(df["team"]))
    print(f"  cricket schedule: {matched} of {len(nxt)} teams with a match coming up are in the data")
    if check:
        print(df.groupby("league")["game"].nunique().to_string())
        top = df[df["date"] >= f"{cur}-01-01"].groupby("name")[["r", "wk"]].sum().sort_values("r", ascending=False).head(5)
        print(top.to_string())
        return
    # a player who plays for a franchise and his country: whichever of his teams from the last 15 months plays next
    since = (TODAY - timedelta(days=455)).isoformat()
    roster = {}
    for pid, g in df.sort_values("date").groupby("pid"):
        teams = list(dict.fromkeys(reversed(g.loc[g["date"] >= since, "team"].tolist()))) or [g["team"].iat[-1]]
        upcoming_t = [t for t in teams if t in nxt]
        team = min(upcoming_t, key=lambda t: nxt[t]["date"]) if upcoming_t else teams[0]
        roster[pid] = {"name": g["name"].iat[-1], "team": team}
    g = pd.DataFrame({
        "pid": df["pid"], "name": df["name"], "team": df["team"], "opp": df["opp"], "date": df["date"], "season": df["season"],
        "post": df["post"], "home": np.nan, "ts": df["ts"], "os": df["os"], "won": df["won"], "grp": df["grp"], "pos": df["pos"],
        "starter": np.nan, "played": True, "game": df["game"], "headshot": None, "lg": df["league"],
        "use": df["bf"] + df["bb"], **{k: df[k] for k in ("r", "bf", "f4", "s6", "wk", "rc", "bb", "ct")}})
    build_sport("cri", g, {
        "stats": ["r", "bf", "f4", "s6", "wk", "rc", "bb", "ct"],
        "composite": {"BAT": {"r": 1}, "AR": {"r": 1, "wk": 20}, "BOWL": {"wk": 20, "rc": -0.5}},
        "usage": "use", "K": 4, "min_games": 3, "min_usage": 6, "recent_seasons": 1, "max_games": 80,
        "extra": {"lg": "lg"}}, nxt, cur, {y: str(y) for y in range(cur - YEARS, cur + 1)}, roster)


if __name__ == "__main__":
    check = "--check" in sys.argv
    try:
        if not check:
            os.makedirs(os.path.join(DATA, "props", "cri"), exist_ok=True)
        cricket(check)
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f"cricket props: FAILED{'' if check else ', kept previous data'}. {e}", file=sys.stderr)
        sys.exit(1)
