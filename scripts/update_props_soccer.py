#!/usr/bin/env python3
"""
Trade Scale props builder for soccer: Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS and the
Champions League, in one sport so a player's league and Champions League matches sit in one log.

Per player per match:
  g    goals              a    assists            sh   shots             sot  shots on target
  fc   fouls committed    fs   fouls drawn        yc   yellow cards
  sv   saves (keepers)    gc   goals conceded (keepers)                    min  minutes played
Positions are goalkeepers (G), defenders (D), midfielders (M) and forwards (F), from where he lines up; a substitute
takes the spot he usually starts in. "Defense" is what each club gives up per match to each position.

Writes, like the other builders:
  site/data/props/soc/index.json     players + each club's next match
  site/data/props/soc/defense.json   what each club allows per match to each position
  site/data/props/soc/p/<id>.json    match log

Source: ESPN's public soccer scoreboards (a calendar year per league per request) and match summaries (lineups and
player stats). A finished match never changes, so each one is fetched once and kept in .cache/soccer_matches.json.gz
(the daily workflow carries that file between runs). Needs pandas.

Run: python scripts/update_props_soccer.py           (build)
     python scripts/update_props_soccer.py --check   (fetch a few matches and print what came back, writes nothing)
"""
import gzip, json, os, re, sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_props_more import DATA, ROOT, TODAY, build_sport, fetch  # noqa: E402

ESPN = "https://site.api.espn.com/apis/site/v2/sports/soccer/"
LEAGUES = {"eng.1": "Premier League", "esp.1": "La Liga", "ita.1": "Serie A", "ger.1": "Bundesliga", "fra.1": "Ligue 1",
           "usa.1": "MLS", "uefa.champions": "Champions League"}
CACHE = os.path.join(ROOT, ".cache", "soccer_matches.json.gz")
YEARS = 2            # calendar years back, plus this one
WORKERS = 12
# ESPN stat names -> ours (first name found wins)
STATS = {"g": ["totalGoals", "goals"], "a": ["goalAssists", "assists"], "sh": ["totalShots", "shotsTotal"],
         "sot": ["shotsOnTarget"], "fc": ["foulsCommitted"], "fs": ["foulsSuffered"], "yc": ["yellowCards"],
         "sv": ["saves"], "gc": ["goalsConceded"]}


def position(abbr):
    a = str(abbr or "").upper()
    if not a or a == "SUB":
        return None
    if a.startswith("G"):
        return "G"
    if a.startswith("DM"):
        return "M"
    if a.startswith(("CD", "LB", "RB", "LWB", "RWB", "SW", "D")) or a in ("CB",):
        return "D"
    if a.startswith(("F", "CF", "ST", "LF", "RF", "LW", "RW", "S")):
        return "F"
    return "M"     # AM, CM, DM, LM, RM, ...


def season_of(d):
    """European seasons run August to May and are named by the year they start (2025 = 2025-26); MLS goes by that too,
    so its spring and autumn halves land in different seasons."""
    return d.year if d.month >= 7 else d.year - 1


# ---------------------------------------------------------------- schedules
def scoreboard(league, year):
    data = json.loads(fetch(f"{ESPN}{league}/scoreboard?dates={year}&limit=1000", tries=3, timeout=120))
    out = []
    for ev in data.get("events", []):
        comp = (ev.get("competitions") or [{}])[0]
        st = (comp.get("status") or {}).get("type") or {}
        teams = []
        for c in comp.get("competitors", []):
            t = c.get("team") or {}
            teams.append({"id": str(t.get("id")), "abbr": t.get("abbreviation"), "name": t.get("shortDisplayName") or t.get("displayName") or t.get("name"),
                          "home": c.get("homeAway") == "home", "score": c.get("score")})
        if len(teams) != 2:
            continue
        out.append({"id": str(ev.get("id")), "league": league, "date": ev.get("date") or comp.get("date"), "teams": teams,
                    "neutral": bool(comp.get("neutralSite")), "state": st.get("state"), "done": bool(st.get("completed")),
                    "detail": st.get("detail") or st.get("shortDetail") or ""})
    return out


def eastern(iso):
    try:
        from zoneinfo import ZoneInfo
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return str(iso)[:10]


# ---------------------------------------------------------------- one match's lineups and stats
def match_players(ev):
    """[[team_id, athlete_id, name, pos_abbr, starter, minutes, {stat: n}], ...] from the match summary."""
    s = json.loads(fetch(f"{ESPN}{ev['league']}/summary?event={ev['id']}", tries=3, timeout=60))
    # when each player came on or went off, from the substitutions
    sub_at = {}
    for k in s.get("keyEvents") or []:
        if "substitution" not in str((k.get("type") or {}).get("type") or (k.get("type") or {}).get("text") or "").lower():
            continue
        t = ((k.get("clock") or {}).get("value") or 0) / 60
        for p in k.get("participants") or []:
            aid = str((p.get("athlete") or {}).get("id") or "")
            if aid:
                sub_at.setdefault(aid, []).append(t)
    end = 90.0
    out = []
    for r in s.get("rosters") or []:
        tid = str((r.get("team") or {}).get("id"))
        for p in r.get("roster") or []:
            a = p.get("athlete") or {}
            vals = {x.get("name"): x.get("value") for x in p.get("stats") or []}
            starter, sub_in, sub_out = bool(p.get("starter")), bool(p.get("subbedIn")), bool(p.get("subbedOut"))
            if not starter and not sub_in and not vals.get("appearances"):
                continue          # an unused substitute
            times = sorted(sub_at.get(str(a.get("id")), []))
            if starter:
                mins = min(times[0], end) if sub_out and times else end
            else:
                on = times[0] if times else end - 15
                off = times[1] if sub_out and len(times) > 1 else end
                mins = max(1.0, off - on)
            st = {}
            for k, names in STATS.items():
                v = next((vals[n] for n in names if vals.get(n) is not None), None)
                if v:
                    st[k] = int(round(float(v)))
            out.append([tid, str(a.get("id")), a.get("displayName") or a.get("fullName"), (p.get("position") or {}).get("abbreviation"),
                        int(starter), round(mins), st, (a.get("headshot") or {}).get("href")])
    return out


def load_cache():
    try:
        with gzip.open(CACHE, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"))
    os.replace(tmp, CACHE)


def soccer(check=False):
    games = []
    for lg in LEAGUES:
        for y in range(TODAY.year - YEARS, TODAY.year + 1 + (TODAY.month == 12)):
            try:
                games.extend(scoreboard(lg, y))
            except Exception as e:
                print(f"  soccer {LEAGUES[lg]} {y}: schedule unavailable ({str(e)[:100]})", file=sys.stderr)
    games = list({g["id"]: g for g in games}.values())
    done = [g for g in games if g["done"]]
    print(f"  soccer: {len(games)} matches on the schedules, {len(done)} finished")
    if not done:
        raise RuntimeError("soccer: no finished matches from ESPN")
    cache = load_cache()
    todo = [g for g in done if g["id"] not in cache]
    if check:
        todo = sorted(todo, key=lambda g: g["date"])[-6:]
    print(f"  soccer: fetching {len(todo)} match summaries ({len(cache)} cached)")
    failed = 0

    def one(g):
        try:
            return g["id"], match_players(g)
        except Exception as e:
            return g["id"], e
    with ThreadPoolExecutor(WORKERS) as ex:
        for gid, res in ex.map(one, todo):
            if isinstance(res, Exception):
                failed += 1
                if failed <= 3:
                    print(f"  soccer match {gid}: {str(res)[:120]}", file=sys.stderr)
            elif res:
                cache[gid] = res
    if failed:
        print(f"  soccer: {failed} summaries failed, they'll be retried tomorrow", file=sys.stderr)
    if check:
        for g in todo:
            rows = cache.get(g["id"]) or []
            print("  ", g["date"][:10], LEAGUES[g["league"]], " v ".join(t["name"] for t in g["teams"]), f"{len(rows)} players;",
                  "e.g.", rows[:2])
        seen = sorted({k for g in todo for r in cache.get(g["id"], []) for k in r[6]})
        print("  stats seen:", seen, "positions seen:", sorted({str(r[3]) for g in todo for r in cache.get(g["id"], [])}))
        if not any(cache.get(g["id"]) for g in todo):
            raise RuntimeError("soccer: no lineups came back")
        return
    # keep only what's on the current schedules (drops matches older than the window)
    cache = {gid: cache[gid] for gid in {g["id"] for g in done} if gid in cache}
    save_cache(cache)

    # team names: ESPN's short name, made unique across leagues
    names = {}
    for g in games:
        for t in g["teams"]:
            names[t["id"]] = t["name"] or t["abbr"]
    clash = {n for n in names.values() if list(names.values()).count(n) > 1}
    team = {tid: (f"{n} ({next((t['abbr'] for g in games for t in g['teams'] if t['id'] == tid), tid)})" if n in clash else n)
            for tid, n in names.items()}

    rows = []
    for g in done:
        players = cache.get(g["id"])
        if not players:
            continue
        d = eastern(g["date"])
        a, b = g["teams"]
        score = {a["id"]: pd.to_numeric(a["score"], errors="coerce"), b["id"]: pd.to_numeric(b["score"], errors="coerce")}
        for tid, aid, nm, pos, starter, mins, st, hs in players:
            opp = b["id"] if tid == a["id"] else a["id"]
            me = a if tid == a["id"] else b
            ts, os_ = score.get(tid), score.get(opp)
            rows.append({"pid": aid, "name": nm, "team": team.get(tid, tid), "opp": team.get(opp, opp), "date": d,
                         "season": season_of(datetime.fromisoformat(d)), "post": 0, "home": np.nan if g["neutral"] else float(me["home"]),
                         "ts": ts, "os": os_, "won": np.nan if pd.isna(ts) or pd.isna(os_) or ts == os_ else float(ts > os_),
                         "pos_raw": pos, "starter": starter, "played": True, "game": g["id"], "headshot": hs,
                         "lg": LEAGUES[g["league"]], "min": mins, **{k: st.get(k, 0) for k in STATS}})
    df = pd.DataFrame(rows)
    # position: where he lines up most often as a starter
    df["p1"] = df["pos_raw"].map(position)
    usual = df[df["p1"].notna()].groupby("pid")["p1"].agg(lambda s: s.value_counts().index[0])
    df["grp"] = df["pid"].map(usual).fillna("M")
    df["pos"] = df["grp"]
    cur = int(df["season"].max())

    # next match per club, in any of the competitions
    nxt = {}
    up = sorted((g for g in games if g["state"] == "pre" and eastern(g["date"]) >= TODAY.isoformat()
                 and eastern(g["date"]) <= (TODAY + timedelta(days=21)).isoformat()), key=lambda g: g["date"])
    for g in up:
        a, b = g["teams"]
        for me, them in ((a, b), (b, a)):
            t = team.get(me["id"])
            if t not in nxt:
                nxt[t] = {"opp": team.get(them["id"]), "home": None if g["neutral"] else int(me["home"]), "date": eastern(g["date"]),
                          "time": g["date"], "event": LEAGUES[g["league"]]}
    # current club: the one he played for most recently
    roster = {pid: {"name": r["name"], "team": r["team"]} for pid, r in df.sort_values("date").groupby("pid").tail(1).set_index("pid").iterrows()}
    build_sport("soc", df, {
        "stats": ["g", "a", "sh", "sot", "fc", "fs", "yc", "sv", "gc", "min"],
        "composite": {"F": {"sh": 0.5, "sot": 1, "g": 3}, "M": {"sh": 0.5, "sot": 1, "g": 3}, "D": {"sh": 0.5, "g": 3, "fs": 0.3},
                      "G": {"sv": 1}},
        "usage": "min", "K": 4, "min_games": 5, "min_usage": 30, "recent_seasons": 1, "max_games": 80, "float_stats": (),
        "extra": {"lg": "lg"}}, nxt, cur, {s: f"{s}-{str(s + 1)[2:]}" for s in range(cur - YEARS - 1, cur + 1)}, roster)


if __name__ == "__main__":
    check = "--check" in sys.argv
    try:
        if not check:
            os.makedirs(os.path.join(DATA, "props", "soc"), exist_ok=True)
        soccer(check)
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f"soccer props: FAILED{'' if check else ', kept previous data'}. {e}", file=sys.stderr)
        sys.exit(1)
