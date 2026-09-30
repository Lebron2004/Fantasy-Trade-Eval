#!/usr/bin/env python3
"""
Trade Scale daily updater.

Pulls every rostered player for NFL, NBA, MLB and NHL from free public APIs,
gives each one a 1-100 trade value, and writes:

  site/data/<sport>.json   players for the app
  site/data/moves.json     team changes (trades, signings, releases) detected since the last run
  site/data/meta.json      when each sport last updated and whether it worked

If one sport's source fails, its previous file is kept so the site never goes blank.
Standard library only, no pip installs needed.

Run locally:  python scripts/update_players.py          (all sports)
              python scripts/update_players.py nfl nhl  (just some)
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
UA = {"User-Agent": "TradeScale/1.0 (personal fantasy trade analyzer)"}
TODAY = date.today()
MAX_MOVES = 300


# ---------------------------------------------------------------- helpers
def get_json(url, params=None, tries=3):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # network hiccup, 5xx, bad JSON
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def rank_value(rank, k):
    """Rank 1 -> 100, then exponential decay. k controls how fast value drops."""
    return max(1, round(100 * math.exp(-(rank - 1) / k)))


def values_from_scores(scores, k):
    """scores: {id: number}. Returns {id: value} ranked best to worst."""
    ordered = sorted(scores, key=lambda i: scores[i], reverse=True)
    return {pid: (rank_value(i + 1, k) if scores[pid] > 0 else 1) for i, pid in enumerate(ordered)}


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ---------------------------------------------------------------- NFL / NBA (Sleeper)
SLEEPER_POS = {
    "nfl": {"QB", "RB", "WR", "TE", "K", "DEF"},
    "nba": {"PG", "SG", "SF", "PF", "C", "G", "F"},
}
SLEEPER_K = {"nfl": 180, "nba": 110}


def fetch_sleeper(sport):
    # Sleeper asks that this be called at most once a day, which is exactly what we do.
    raw = get_json(f"https://api.sleeper.app/v1/players/{sport}")
    rows = []
    for pid, p in raw.items():
        team = p.get("team")
        pos = p.get("position")
        if not team or pos not in SLEEPER_POS[sport]:
            continue
        if p.get("active") is False:
            continue
        name = p.get("full_name") or f"{p.get('first_name') or ''} {p.get('last_name') or ''}".strip()
        rank = p.get("search_rank") or 9_999_999
        rows.append({
            "id": str(pid), "name": name, "team": team, "pos": pos,
            "born": p.get("birth_date") or "", "rank": rank,
            "inj": p.get("injury_status") or "",
        })
    if len(rows) < 200:
        raise RuntimeError(f"Sleeper {sport} returned only {len(rows)} players")
    rows.sort(key=lambda r: r["rank"])
    out = []
    for i, r in enumerate(rows):
        v = rank_value(i + 1, SLEEPER_K[sport]) if r["rank"] < 9_999_999 else 1
        out.append([r["id"], r["name"], r["team"], r["pos"], r["born"], v, r["inj"]])
    return out


# ---------------------------------------------------------------- MLB (statsapi.mlb.com)
MLB = "https://statsapi.mlb.com/api/v1"


def ip_to_innings(ip):
    try:
        whole, _, frac = str(ip).partition(".")
        return int(whole or 0) + int(frac or 0) / 3
    except ValueError:
        return 0.0


def mlb_points(season):
    """Head-to-head points style scoring, summed per player (two-way players get both)."""
    pts, starts = {}, {}
    for group in ("hitting", "pitching"):
        data = get_json(f"{MLB}/stats", {
            "stats": "season", "group": group, "gameType": "R", "season": season,
            "sportId": 1, "playerPool": "ALL", "limit": 3000,
        })
        splits = (data.get("stats") or [{}])[0].get("splits", [])
        for s in splits:
            pid = str(s["player"]["id"]); st = s.get("stat", {})
            if group == "hitting":
                p = (st.get("totalBases", 0) + st.get("runs", 0) + st.get("rbi", 0)
                     + st.get("baseOnBalls", 0) + st.get("stolenBases", 0) - st.get("strikeOuts", 0))
            else:
                p = (3 * ip_to_innings(st.get("inningsPitched", 0)) + st.get("strikeOuts", 0)
                     - st.get("hits", 0) - 2 * st.get("earnedRuns", 0) - st.get("baseOnBalls", 0)
                     + 2 * st.get("wins", 0) - 2 * st.get("losses", 0)
                     + 5 * st.get("saves", 0) + 2 * st.get("holds", 0))
                gs, gp = starts.get(pid, (0, 0))
                starts[pid] = (gs + st.get("gamesStarted", 0), gp + st.get("gamesPitched", 0))
            pts[pid] = pts.get(pid, 0) + p
    return pts, starts


def fetch_mlb():
    year = TODAY.year
    cur, prev = year, year - 1
    opening = date(year, 3, 27)
    progress = clamp((TODAY - opening).days / 185, 0, 1)

    # Map every affiliate (MLB + minors) to its big-league org abbreviation.
    teams = get_json(f"{MLB}/teams", {"sportIds": "1,11,12,13,14,16"}).get("teams", [])
    mlb_abbr = {t["id"]: t["abbreviation"] for t in teams if t.get("sport", {}).get("id") == 1}
    org = {}
    for t in teams:
        parent = t.get("parentOrgId") or t["id"]
        if parent in mlb_abbr:
            org[t["id"]] = mlb_abbr[parent]

    people = get_json(f"{MLB}/sports/1/players", {"season": cur}).get("people", [])
    if len(people) < 500:
        people = get_json(f"{MLB}/sports/1/players", {"season": prev}).get("people", [])

    cur_pts, cur_starts = mlb_points(cur)
    prev_pts, prev_starts = mlb_points(prev)
    prev_w = max(0.2, 1 - progress)  # early season leans on last year, late season on this year

    scores, meta = {}, {}
    for p in people:
        if p.get("active") is False:
            continue
        pid = str(p["id"])
        team = org.get((p.get("currentTeam") or {}).get("id"))
        if not team:
            continue
        scores[pid] = cur_pts.get(pid, 0) + prev_w * prev_pts.get(pid, 0)
        pos = (p.get("primaryPosition") or {}).get("abbreviation", "")
        if pos in ("LF", "CF", "RF"):
            pos = "OF"
        elif pos == "TWP":
            pos = "DH/SP"
        elif pos == "P":
            gs, gp = cur_starts.get(pid) or prev_starts.get(pid) or (0, 0)
            pos = "SP" if gp and gs / gp >= 0.4 else "RP"
        meta[pid] = (p.get("fullName", ""), team, pos, p.get("birthDate", ""))
    if len(meta) < 500:
        raise RuntimeError(f"MLB returned only {len(meta)} players")
    vals = values_from_scores(scores, 140)
    out = [[pid, *meta[pid][:3], meta[pid][3], vals[pid], ""] for pid in meta]
    out.sort(key=lambda r: -r[5])
    return out


# ---------------------------------------------------------------- NHL (api-web.nhle.com + api.nhle.com/stats)
NHL_WEB = "https://api-web.nhle.com/v1"
NHL_STATS = "https://api.nhle.com/stats/rest/en"
NHL_POS = {"L": "LW", "R": "RW", "C": "C", "D": "D", "G": "G"}


def nhl_stats(kind, season):
    sort = json.dumps([{"property": "gamesPlayed", "direction": "DESC"},
                       {"property": "playerId", "direction": "ASC"}])
    data = get_json(f"{NHL_STATS}/{kind}/summary", {
        "isAggregate": "false", "isGame": "false", "sort": sort, "start": 0, "limit": -1,
        "cayenneExp": f"seasonId={season} and gameTypeId=2",
    })
    return data.get("data", [])


def nhl_points(season):
    pts, max_gp = {}, 0
    for s in nhl_stats("skater", season):
        pid = str(s["playerId"])
        max_gp = max(max_gp, s.get("gamesPlayed") or 0)
        pts[pid] = (3 * (s.get("goals") or 0) + 2 * (s.get("assists") or 0)
                    + 0.5 * (s.get("ppPoints") or 0) + 0.3 * (s.get("shots") or 0)
                    + 0.3 * (s.get("plusMinus") or 0))
    for g in nhl_stats("goalie", season):
        pid = str(g["playerId"])
        pts[pid] = (5 * (g.get("wins") or 0) + 3 * (g.get("shutouts") or 0)
                    + 0.2 * (g.get("saves") or 0) - (g.get("goalsAgainst") or 0))
    return pts, max_gp


def fetch_nhl():
    start = TODAY.year if TODAY.month >= 9 else TODAY.year - 1
    cur, prev = f"{start}{start + 1}", f"{start - 1}{start}"

    standings = get_json(f"{NHL_WEB}/standings/now").get("standings", [])
    abbrs = sorted({t["teamAbbrev"]["default"] for t in standings})
    if len(abbrs) < 30:
        raise RuntimeError(f"NHL standings returned only {len(abbrs)} teams")

    meta = {}
    for abbr in abbrs:
        roster = get_json(f"{NHL_WEB}/roster/{abbr}/current")
        for grp in ("forwards", "defensemen", "goalies"):
            for p in roster.get(grp, []):
                name = f"{p['firstName']['default']} {p['lastName']['default']}"
                meta[str(p["id"])] = (name, abbr, NHL_POS.get(p.get("positionCode"), p.get("positionCode", "")),
                                      p.get("birthDate", ""))
        time.sleep(0.3)  # be polite

    cur_pts, cur_gp = nhl_points(cur)
    prev_pts, _ = nhl_points(prev)
    prev_w = max(0.2, 1 - cur_gp / 82)
    scores = {pid: cur_pts.get(pid, 0) + prev_w * prev_pts.get(pid, 0) for pid in meta}
    vals = values_from_scores(scores, 120)
    out = [[pid, *meta[pid][:3], meta[pid][3], vals[pid], ""] for pid in meta]
    out.sort(key=lambda r: -r[5])
    return out


# ---------------------------------------------------------------- main
FETCHERS = {"nfl": lambda: fetch_sleeper("nfl"), "nba": lambda: fetch_sleeper("nba"),
            "mlb": fetch_mlb, "nhl": fetch_nhl}


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def diff_moves(sport, old_players, new_players, stamp):
    """A player whose team changed since the last run is a move (trade, signing or release)."""
    old = {r[0]: r for r in old_players}
    moves = []
    for r in new_players:
        o = old.get(r[0])
        if o and o[2] != r[2]:
            moves.append({"date": stamp, "sport": sport, "id": r[0], "name": r[1],
                          "from": o[2] or "FA", "to": r[2] or "FA", "value": r[5]})
    moves.sort(key=lambda m: -m["value"])
    return moves


def main():
    os.makedirs(DATA, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    meta = load(os.path.join(DATA, "meta.json"), {})
    moves = load(os.path.join(DATA, "moves.json"), [])
    failures = 0
    only = sys.argv[1:] or list(FETCHERS)

    for sport in only:
        path = os.path.join(DATA, f"{sport}.json")
        try:
            players = FETCHERS[sport]()
            old = load(path, {}).get("players", [])
            new_moves = diff_moves(sport, old, players, stamp) if old else []
            save(path, {"sport": sport, "updated": stamp, "players": players})
            moves = new_moves + moves
            meta[sport] = {"updated": stamp, "ok": True, "count": len(players)}
            print(f"{sport}: {len(players)} players, {len(new_moves)} team changes")
        except Exception as e:
            failures += 1
            prev = meta.get(sport, {})
            meta[sport] = {**prev, "ok": False, "error": str(e)[:300], "tried": stamp}
            print(f"{sport}: FAILED, kept previous data. {e}", file=sys.stderr)

    save(os.path.join(DATA, "moves.json"), moves[:MAX_MOVES])
    save(os.path.join(DATA, "meta.json"), meta)
    # Only fail the job if every sport failed, so one flaky API doesn't block the others.
    sys.exit(1 if failures == len(only) else 0)


if __name__ == "__main__":
    main()
