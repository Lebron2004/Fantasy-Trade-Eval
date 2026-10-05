#!/usr/bin/env python3
"""
Trade Scale props builder for basketball, hockey, and baseball.

Writes the same files the NFL builder does, so the Props page treats every sport the same way:
  site/data/props/<sport>/index.json     players + each team's next game (with days of rest)
  site/data/props/<sport>/defense.json   what each opponent allows per game to each position group
  site/data/props/<sport>/p/<id>.json    game log with context, teammates on/off

Sources:
  NBA  sportsdataverse ESPN player box scores + schedules (GitHub releases, updated nightly)
  NHL  sportsdataverse NHL player box scores + schedules (GitHub releases, updated nightly)
  MLB  MLB Stats API game logs (statsapi.mlb.com), last season cached so only this season is refetched

Uses the daily player files (site/data/<sport>.json from update_players.py) for full names and current teams,
so run it after that script. Needs pandas + pyarrow.

Run: python scripts/update_props_more.py            (all three)
     python scripts/update_props_more.py nhl nba    (some)
"""
import io, json, math, os, shutil, sys, time, unicodedata, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
SDV = "https://github.com/sportsdataverse/sportsdataverse-data/releases/download/"
MLB = "https://statsapi.mlb.com/api/v1"
UA = {"User-Agent": "TradeScale/1.0 (personal props research tool)"}
TODAY = date.today()


# ---------------------------------------------------------------- helpers
def fetch(url, tries=3, timeout=120):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e
            if "404" in str(e):
                break
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def sdv(tag, name):
    try:
        return pd.read_parquet(io.BytesIO(fetch(f"{SDV}{tag}/{name}.parquet")))
    except Exception as e:
        print(f"  skipped {name}: {str(e)[:100]}", file=sys.stderr)
        return None


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").lower().strip()


def r3(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 3)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def daily_players(sport):
    """Rows from the daily players file: id, name, team, pos, born, value, ..."""
    d = load_json(os.path.join(DATA, f"{sport}.json"), {}) or {}
    return d.get("players", [])


# ---------------------------------------------------------------- shared builder
def build_sport(sport, df, cfg, nxt, season_cur, season_names, extra_players=None):
    """
    df: one row per player-game with columns
        pid, name, team, opp, date, season, post, home, ts, os, won, grp, pos, starter, played, game, <stat keys>
    cfg: {"stats": [...], "composite": {grp: {stat: weight}}, "usage": stat, "K": prior games, "min_games": n}
    """
    out_dir = os.path.join(DATA, "props", sport)
    stats = cfg["stats"]
    df = df.copy()
    for k in stats:
        df[k] = pd.to_numeric(df.get(k, 0), errors="coerce").fillna(0)
    played = df[df["played"]].copy()

    # days of rest for every team game (0 = back-to-back)
    rest = {}
    for (team, season), grp in df[["team", "season", "date"]].drop_duplicates().groupby(["team", "season"]):
        ds = sorted(set(grp["date"]))
        for i, d in enumerate(ds):
            rest[(team, d)] = None if i == 0 else (date.fromisoformat(ds[i]) - date.fromisoformat(ds[i - 1])).days - 1
    last_game = played.groupby("team")["date"].max().to_dict()

    # what each opponent allows per game to each position group, this season blended with last
    team_game = played.groupby(["season", "game", "opp", "grp"])[stats].sum().reset_index()
    per = team_game.groupby(["season", "opp", "grp"])[stats].agg(["sum", "count"])
    defense = {"season": season_cur, "league": {"pos": {}}, "teams": {}}
    rank_by_season = {}
    comp = cfg["composite"]
    for (s, grp_name), g in team_game.groupby(["season", "grp"]):
        w = comp.get(grp_name, {})
        avg = g.groupby("opp").apply(lambda x: sum(x[k].mean() * wt for k, wt in w.items()), include_groups=False).sort_values()
        for i, t in enumerate(avg.index):
            rank_by_season[(int(s), t, grp_name)] = i + 1
    K = cfg["K"]
    seasons_present = sorted(team_game["season"].unique())
    cur_s = season_cur if season_cur in seasons_present else (seasons_present[-1] if seasons_present else season_cur)
    for grp_name in sorted(team_game["grp"].unique()):
        cur = team_game[(team_game["season"] == cur_s) & (team_game["grp"] == grp_name)]
        prev = team_game[(team_game["season"] == cur_s - 1) & (team_game["grp"] == grp_name)]
        teams = sorted(set(cur["opp"]) | set(prev["opp"]))
        pmean = prev.groupby("opp")[stats].mean()
        csum, cn = cur.groupby("opp")[stats].sum(), cur.groupby("opp").size()
        blend = {}
        for t in teams:
            n = int(cn.get(t, 0))
            pv = pmean.loc[t] if t in pmean.index else (pmean.mean() if len(pmean) else pd.Series(0.0, index=stats))
            cs = csum.loc[t] if t in csum.index else pd.Series(0.0, index=stats)
            k = K if len(pmean) else 0
            blend[t] = ((cs + pv * k) / max(n + k, 1), n)
        if not blend:
            continue
        lg = pd.DataFrame({t: b[0] for t, b in blend.items()}).T.mean()
        defense["league"]["pos"][grp_name] = {k: r3(lg[k]) for k in stats}
        w = comp.get(grp_name, {})
        order = sorted(teams, key=lambda t: sum(blend[t][0][k] * wt for k, wt in w.items()))
        for t in teams:
            vals, n = blend[t]
            defense["teams"].setdefault(t, {"pos": {}})["pos"][grp_name] = {
                "g": n, "rank": order.index(t) + 1, "allow": {k: r3(vals[k]) for k in stats}}

    # presence for teammate on/off
    present = {(g, t): set(x["pid"]) for (g, t), x in played.groupby(["game", "team"])}
    team_seasons = {}
    for pid_, s, t in played[["pid", "season", "team"]].drop_duplicates().itertuples(index=False):
        team_seasons.setdefault(pid_, set()).add((int(s), t))
    recent = played[played["season"] >= cur_s - cfg.get("recent_seasons", 1)]
    usage = recent.groupby(["pid", "team"])[cfg["usage"]].sum()

    # who to include: the daily roster file decides current team and full name when available
    roster = extra_players or {}
    latest = played.sort_values("date").groupby("pid").tail(1).set_index("pid")
    people = []
    recent_counts = recent.groupby("pid").size()
    recent_role = recent.groupby("pid")[cfg["usage"]].mean() if cfg.get("min_usage") else None
    for pid_, row in latest.iterrows():
        games_recent = int(recent_counts.get(pid_, 0))
        if games_recent < cfg["min_games"]:
            continue
        if recent_role is not None and row["grp"] not in cfg.get("usage_exempt", ()) and recent_role.get(pid_, 0) < cfg["min_usage"]:
            continue
        r = roster.get(str(pid_))
        if roster and cfg.get("roster_required") and not r:
            continue
        people.append({"pid": pid_, "name": (r or {}).get("name") or row["name"], "team": (r or {}).get("team") or row["team"],
                       "pos": (r or {}).get("pos") or row["pos"], "grp": row["grp"], "headshot": row.get("headshot")})
    by_team = {}
    for p in people:
        by_team.setdefault(p["team"], []).append(p)

    tmp = os.path.join(out_dir, "p.tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    by_player = dict(tuple(played.groupby("pid")))
    index = []
    for p in people:
        pid_, team = p["pid"], p["team"]
        ps = by_player[pid_].sort_values("date").tail(cfg.get("max_games", 120))
        mates = sorted([m for m in by_team.get(team, []) if m["pid"] != pid_], key=lambda m: -usage.get((m["pid"], team), 0))
        mates = [m for m in mates if usage.get((m["pid"], team), 0) > 0][:6]
        log = []
        for r in ps.itertuples(index=False):
            s, t, g = int(r.season), r.team, r.game
            row = {"s": s, "d": r.date, "o": r.opp, "h": None if pd.isna(r.home) else int(r.home), "post": int(r.post), "tm": t,
                   "rs": rest.get((t, r.date)), "dr": rank_by_season.get((s, r.opp, r.grp)),
                   "x": {k: (round(float(getattr(r, k)), 1) if k in cfg.get("float_stats", ()) else int(getattr(r, k)))
                         for k in stats if getattr(r, k)}}
            if pd.notna(r.ts) and pd.notna(r.os):
                row["ts"], row["os"] = int(r.ts), int(r.os)
            if pd.notna(r.won):
                row["wn"] = int(r.won)
            if pd.notna(r.starter):
                row["st"] = int(bool(r.starter))
            for k, col in cfg.get("extra", {}).items():   # optional per-game context: week, spread, total, rounds
                v = getattr(r, col)
                if pd.notna(v):
                    row[k] = float(v) if isinstance(v, float) and not float(v).is_integer() else int(v)
            mp = me = 0
            for i, m in enumerate(mates):
                if (s, t) in team_seasons.get(m["pid"], set()):
                    me |= 1 << i
                    if m["pid"] in present.get((g, t), set()):
                        mp |= 1 << i
            row["mp"], row["me"] = mp, me
            log.append(row)
        w = cfg["composite"].get(p["grp"], {})
        cur_rows = ps[ps["season"] == cur_s]
        base = cur_rows if len(cur_rows) >= 3 else ps.tail(15)
        score = float(sum(base[k].mean() * wt for k, wt in w.items())) if len(base) else 0.0
        doc = {"id": str(pid_), "name": p["name"], "team": team, "pos": p["pos"], "grp": p["grp"],
               "headshot": p["headshot"] if isinstance(p["headshot"], str) else None,
               "log": log, "mates": [{"id": str(m["pid"]), "name": m["name"], "pos": m["pos"]} for m in mates], "scheme": {}}
        with open(os.path.join(tmp, f"{pid_}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        index.append([str(pid_), p["name"], team, p["pos"], round(score, 1), int(len(cur_rows))])

    if len(index) < 50:
        shutil.rmtree(tmp, ignore_errors=True)
        raise RuntimeError(f"{sport}: only {len(index)} players built, keeping previous data")
    shutil.rmtree(os.path.join(out_dir, "p"), ignore_errors=True)
    os.replace(tmp, os.path.join(out_dir, "p"))
    for t, n in nxt.items():   # days of rest before the next game
        lg = last_game.get(t)
        if lg and n.get("date"):
            n["rest"] = (date.fromisoformat(n["date"]) - date.fromisoformat(lg)).days - 1
    index.sort(key=lambda r: -r[4])
    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": stamp, "sport": sport, "season": int(cur_s), "season_names": season_names,
                   "next": nxt, "players": index}, f, ensure_ascii=False, separators=(",", ":"))
    defense["season"] = int(cur_s)
    defense["updated"] = stamp
    with open(os.path.join(out_dir, "defense.json"), "w", encoding="utf-8") as f:
        json.dump(defense, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{sport} props: {len(index)} players, {len(nxt)} teams with a next game, season {cur_s}")


def next_from_schedule(rows):
    """rows: iterable of (date_str, time_str, home, away). First future game per team."""
    out = {}
    for d, tm, home, away in sorted(rows, key=lambda r: (r[0], r[1] or "")):
        for team, opp, h in ((home, away, 1), (away, home, 0)):
            if team not in out:
                out[team] = {"opp": opp, "home": h, "date": d, "time": tm}
    return out


# ---------------------------------------------------------------- NBA
NBA_TEAMS = {"ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS","HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN",
             "NO","NY","OKC","ORL","PHI","PHX","POR","SA","SAC","TOR","UTAH","WSH"}
SLEEPER_TO_ESPN = {"GSW": "GS", "NOP": "NO", "NYK": "NY", "SAS": "SA", "UTA": "UTAH", "WAS": "WSH"}


def nba():
    cur = TODAY.year + 1 if TODAY.month >= 9 else TODAY.year      # ESPN labels a season by the year it ends
    frames = [sdv("espn_nba_player_boxscores", f"player_box_{s}") for s in (cur - 2, cur - 1, cur)]
    b = pd.concat([f for f in frames if f is not None], ignore_index=True)
    b = b[b["team_abbreviation"].isin(NBA_TEAMS) & b["opponent_team_abbreviation"].isin(NBA_TEAMS)]
    b = b[b["season_type"].isin([2, 3, 5])]
    pos = b["athlete_position_abbreviation"].fillna("G").replace({"PG": "G", "SG": "G", "SF": "F", "PF": "F"})
    df = pd.DataFrame({
        "pid": b["athlete_id"].astype("Int64").astype(str), "name": b["athlete_display_name"], "team": b["team_abbreviation"],
        "opp": b["opponent_team_abbreviation"], "date": b["game_date"].astype(str).str[:10], "season": b["season"].astype(int),
        "post": b["season_type"].isin([3, 5]).astype(int), "home": (b["home_away"] == "home").astype(int),
        "ts": b["team_score"], "os": b["opponent_team_score"], "won": b["team_winner"].astype("float"),
        "grp": pos.where(pos.isin(["G", "F", "C"]), "F"), "pos": pos, "starter": b["starter"],
        "played": (~b["did_not_play"].fillna(False).astype(bool)) & (b["minutes"].fillna(0) > 0),
        "game": b["game_id"].astype(str), "headshot": b["athlete_headshot_href"],
        "pts": b["points"], "reb": b["rebounds"], "ast": b["assists"], "fg3": b["three_point_field_goals_made"],
        "stl": b["steals"], "blk": b["blocks"], "tov": b["turnovers"], "min": b["minutes"],
    })
    roster = {}
    names = {}
    for r in daily_players("nba"):
        names[norm(r[1])] = {"name": r[1], "team": SLEEPER_TO_ESPN.get(r[2], r[2]), "pos": None}
    for pid_, nm in df[["pid", "name"]].drop_duplicates().itertuples(index=False):
        hit = names.get(norm(nm))
        if hit:
            roster[pid_] = {"name": hit["name"], "team": hit["team"]}
    nxt = {}
    sch = sdv("espn_nba_schedules", f"nba_schedule_{cur}")
    if sch is not None:
        sch = sch[(sch["status_type_completed"] == False) & sch["home_abbreviation"].isin(NBA_TEAMS)]
        sch = sch[pd.to_datetime(sch["game_date"]).dt.date >= TODAY]
        nxt = next_from_schedule(zip(sch["game_date"].astype(str).str[:10], sch["start_date"].astype(str), sch["home_abbreviation"], sch["away_abbreviation"]))
    names_map = {s: f"{s - 1}-{str(s)[2:]}" for s in (cur - 2, cur - 1, cur)}
    build_sport("nba", df, {
        "stats": ["pts", "reb", "ast", "fg3", "stl", "blk", "tov", "min"],
        "composite": {g: {"pts": 1, "reb": 1.2, "ast": 1.5, "stl": 3, "blk": 3} for g in ("G", "F", "C")},
        "usage": "min", "K": 8, "min_games": 10, "min_usage": 14, "float_stats": ("min",)}, nxt, cur, names_map, roster)


# ---------------------------------------------------------------- NHL
def toi_minutes(v):
    try:
        m, s = str(v).split(":")
        return int(m) + int(s) / 60
    except (ValueError, AttributeError):
        return 0.0


def nhl():
    cur = TODAY.year + 1 if TODAY.month >= 9 else TODAY.year
    frames = [sdv("nhl_player_boxscores", f"player_box_{s}") for s in (cur - 2, cur - 1, cur)]
    b = pd.concat([f for f in frames if f is not None], ignore_index=True)
    b["gt"] = b["game_id"].astype(str).str[4:6]
    b = b[b["gt"].isin(["02", "03"])].copy()
    scheds = [sdv("nhl_schedules", f"nhl_schedule_{s}") for s in (cur - 2, cur - 1, cur)]
    sch = pd.concat([s for s in scheds if s is not None], ignore_index=True)
    sch["game_id"] = sch["game_id"].astype(str)
    g = sch.set_index("game_id")[["home_team_abbr", "away_team_abbr", "home_score", "away_score"]]
    b["game_id"] = b["game_id"].astype(str)
    b = b.join(g, on="game_id")
    home = b["home_away"] == "home"
    b["opp"] = np.where(home, b["away_team_abbr"], b["home_team_abbr"])
    b["ts"] = np.where(home, b["home_score"], b["away_score"])
    b["os"] = np.where(home, b["away_score"], b["home_score"])
    b["toi_m"] = b["toi"].map(toi_minutes)
    goalie = (b["position"] == "G") | b["shots_against"].notna() | b["saves"].notna()   # goalies have no position label here
    b["season_end"] = b["season"].astype(str).str[4:].astype(int)
    df = pd.DataFrame({
        "pid": b["player_id"].astype(str), "name": b["player_name"], "team": b["team_abbrev"], "opp": b["opp"],
        "date": b["game_date"].astype(str).str[:10], "season": b["season_end"], "post": (b["gt"] == "03").astype(int),
        "home": home.astype(int), "ts": pd.to_numeric(b["ts"], errors="coerce"), "os": pd.to_numeric(b["os"], errors="coerce"),
        "won": np.nan, "grp": np.where(goalie, "G", np.where(b["position"] == "D", "D", "F")),
        "pos": np.where(goalie, "G", b["position"].replace({"L": "LW", "R": "RW"})),
        "starter": np.where(goalie, b["toi_m"] >= 40, np.nan),
        # goalies count only in games they started (or played most of); skaters any game with ice time
        "played": np.where(goalie, b["toi_m"] >= 40, b["toi_m"] > 0),
        "game": b["game_id"], "headshot": None,
        "g": b["goals"], "a": b["assists"], "pts": b["points"], "sog": b["shots_on_goal"], "hit": b["hits"],
        "blk": b["blocked_shots"], "ppg": b["power_play_goals"], "toi": b["toi_m"].round(1),
        "sv": b["saves"], "ga": b["goals_against"], "sa": b["shots_against"],
    })
    df["played"] = df["played"].astype(bool)
    roster = {}
    for r in daily_players("nhl"):
        roster[str(r[0])] = {"name": r[1], "team": r[2], "pos": r[3]}
    nxt = {}
    up = sch[(sch["game_state"].isin(["FUT", "PRE"])) & sch["game_id"].str[4:6].isin(["02", "03"])]
    up = up[pd.to_datetime(up["game_date"]).dt.date >= TODAY]
    nxt = next_from_schedule(zip(up["game_date"].astype(str).str[:10], up["game_time"].astype(str), up["home_team_abbr"], up["away_team_abbr"]))
    names_map = {s: f"{s - 1}-{str(s)[2:]}" for s in (cur - 2, cur - 1, cur)}
    build_sport("nhl", df, {
        "stats": ["g", "a", "pts", "sog", "hit", "blk", "ppg", "toi", "sv", "ga", "sa"],
        "composite": {"F": {"g": 3, "a": 2, "sog": 0.5}, "D": {"g": 3, "a": 2, "sog": 0.5, "blk": 0.3}, "G": {"sv": 1}},
        "usage": "toi", "K": 8, "min_games": 6, "min_usage": 11, "usage_exempt": ("G",), "float_stats": ("toi",),
        "roster_required": bool(roster)}, nxt, cur, names_map, roster)


# ---------------------------------------------------------------- MLB
HIT_KEYS = {"hits": "h", "totalBases": "tb", "homeRuns": "hr", "rbi": "rbi", "runs": "r", "baseOnBalls": "bb",
            "strikeOuts": "so", "stolenBases": "sb"}
PIT_KEYS = {"strikeOuts": "k", "outs": "outs", "earnedRuns": "er", "hits": "ha", "baseOnBalls": "bba", "numberOfPitches": "pc"}


def mlb_game_logs(pid, group, season):
    url = f"{MLB}/people/{pid}/stats?" + urllib.parse.urlencode({"stats": "gameLog", "group": group, "season": season, "gameType": "R,F,D,L,W"})
    try:
        data = json.loads(fetch(url, tries=2, timeout=30))
    except Exception:
        url = f"{MLB}/people/{pid}/stats?" + urllib.parse.urlencode({"stats": "gameLog", "group": group, "season": season})
        data = json.loads(fetch(url, tries=2, timeout=30))
    splits = []
    for block in data.get("stats", []):
        splits.extend(block.get("splits", []))
    return splits


def mlb():
    cur = TODAY.year if TODAY.month >= 3 else TODAY.year - 1
    teams = json.loads(fetch(f"{MLB}/teams?sportId=1")).get("teams", [])
    abbr = {t["id"]: t["abbreviation"] for t in teams}
    roster = daily_players("mlb")
    if not roster:
        raise RuntimeError("mlb: needs site/data/mlb.json from update_players.py")
    hitters = [r for r in roster if r[3] not in ("SP", "RP")][:330]
    sps = [r for r in roster if r[3] in ("SP", "DH/SP")][:160]
    rps = [r for r in roster if r[3] == "RP"][:60]
    cache_path = os.path.join(DATA, "props", "mlb", "_cache.json")
    cache = load_json(cache_path, {}) or {}
    if cache.get("season") != cur - 1:
        cache = {"season": cur - 1, "logs": {}}

    rows = []
    def add(pid, name, team_now, pos, grp, group, splits, season):
        keys = HIT_KEYS if group == "hitting" else PIT_KEYS
        for s in splits:
            st = s.get("stat", {})
            if group == "pitching" and grp == "SP" and not st.get("gamesStarted"):
                continue
            row = {"pid": ("p" if group == "pitching" else "") + str(pid), "name": name, "team": abbr.get((s.get("team") or {}).get("id"), team_now),
                   "opp": abbr.get((s.get("opponent") or {}).get("id"), "?"), "date": str(s.get("date", ""))[:10],
                   "season": int(s.get("season") or season), "post": int(s.get("gameType", "R") != "R"),
                   "home": int(bool(s.get("isHome"))), "ts": np.nan, "os": np.nan,
                   "won": float(bool(s.get("isWin"))) if s.get("isWin") is not None else np.nan,
                   "grp": grp, "pos": pos, "starter": np.nan, "played": True,
                   "game": str((s.get("game") or {}).get("gamePk", s.get("date"))),
                   "headshot": f"https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people/{pid}/headshot/67/current"}
            for src, k in keys.items():
                row[k] = st.get(src, 0) or 0
            rows.append(row)

    calls = 0
    for group, people, grp in (("hitting", hitters, "H"), ("pitching", sps, "SP"), ("pitching", rps, "RP")):
        for r in people:
            pid, name, team, pos = r[0], r[1], r[2], r[3]
            ck = f"{group}:{pid}"
            prev = cache["logs"].get(ck)
            if prev is None:
                try:
                    prev = mlb_game_logs(pid, group, cur - 1); calls += 1
                except Exception:
                    prev = []
                cache["logs"][ck] = prev
            try:
                now = mlb_game_logs(pid, group, cur); calls += 1
            except Exception:
                now = []
            add(pid, name, team, "SP" if grp == "SP" else pos, grp, group, prev, cur - 1)
            add(pid, name, team, "SP" if grp == "SP" else pos, grp, group, now, cur)
            time.sleep(0.05)
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8") as f:
        json.dump(cache, f, separators=(",", ":"))
    print(f"  mlb: {calls} API calls")
    if not rows:
        raise RuntimeError("mlb: no game logs returned")
    df = pd.DataFrame(rows)
    df = df[df["date"] != ""]

    # next games, with the opponent's probable starter when posted
    nxt = {}
    try:
        q = urllib.parse.urlencode({"sportId": 1, "startDate": TODAY.isoformat(), "endDate": (TODAY + timedelta(days=10)).isoformat(),
                                    "gameType": "R,F,D,L,W", "hydrate": "probablePitcher"})
        sched = json.loads(fetch(f"{MLB}/schedule?{q}"))
        games = []
        for d in sched.get("dates", []):
            for g in d.get("games", []):
                if (g.get("status") or {}).get("abstractGameState") == "Final":
                    continue
                h, a = g["teams"]["home"], g["teams"]["away"]
                games.append((d["date"], g.get("gameDate"), abbr.get(h["team"]["id"]), abbr.get(a["team"]["id"]),
                              (h.get("probablePitcher") or {}).get("fullName"), (a.get("probablePitcher") or {}).get("fullName")))
        for d, tm, home, away, hp, ap in sorted(games):
            for team, opp, isH, oppSP in ((home, away, 1, ap), (away, home, 0, hp)):
                if team and team not in nxt:
                    nxt[team] = {"opp": opp, "home": isH, "date": d, "time": tm, "opp_sp": oppSP}
    except Exception as e:
        print(f"  mlb schedule unavailable: {e}", file=sys.stderr)
    current = {}
    for r in roster:   # today's team and position from the daily roster file (catches trades)
        current[str(r[0])] = {"name": r[1], "team": r[2], "pos": r[3]}
        current["p" + str(r[0])] = {"name": r[1], "team": r[2], "pos": "SP" if r[3] in ("SP", "DH/SP") else r[3]}
    build_sport("mlb", df, {
        "stats": ["h", "tb", "hr", "rbi", "r", "bb", "so", "sb", "k", "outs", "er", "ha", "bba", "pc"],
        "composite": {"H": {"tb": 1, "r": 1, "rbi": 1, "bb": 1, "sb": 2}, "SP": {"k": 1, "outs": 1, "er": -2}, "RP": {"k": 1, "outs": 1, "er": -2}},
        "usage": "tb", "K": 15, "min_games": 5}, nxt, cur, {cur - 1: str(cur - 1), cur: str(cur)}, current)


# ---------------------------------------------------------------- main
BUILDERS = {"nba": nba, "nhl": nhl, "mlb": mlb}

if __name__ == "__main__":
    failures = 0
    todo = sys.argv[1:] or list(BUILDERS)
    for sport in todo:
        try:
            os.makedirs(os.path.join(DATA, "props", sport), exist_ok=True)
            BUILDERS[sport]()
        except Exception as e:
            failures += 1
            print(f"{sport} props: FAILED, kept previous data. {e}", file=sys.stderr)
    sys.exit(1 if failures == len(todo) else 0)
