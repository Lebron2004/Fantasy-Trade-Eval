#!/usr/bin/env python3
"""
Trade Scale props builder for college football and men's college basketball.

Writes the same files as the other builders (see update_props_more.py), so the Props page treats them like any sport:
  site/data/props/<sport>/index.json     players + each team's next game
  site/data/props/<sport>/defense.json   what each opponent allows per game to each position group
  site/data/props/<sport>/p/<id>.json    game log with context, teammates on/off

Sources (all free, from the SportsDataverse project's GitHub releases, updated through the season):
  cfb  ESPN college football player box scores, schedules (every division), betting lines and current rosters
  cbb  ESPN men's college basketball player box scores, schedules and current rosters

Both keep only players on this season's rosters (college football: FBS teams), so transfers show on their new team
and players who left drop out. Needs pandas + pyarrow.

Run: python scripts/update_props_college.py            (both)
     python scripts/update_props_college.py cbb        (one)
"""
import os, sys
from datetime import date

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_props_more import DATA, TODAY, build_sport, next_from_schedule, sdv  # noqa: E402

try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:
    EASTERN = None


def eastern_date(iso):
    """Game day in US Eastern time (a 10:30pm ET kickoff is the next day in UTC)."""
    t = pd.to_datetime(iso, utc=True, errors="coerce")
    if EASTERN is not None:
        t = t.dt.tz_convert(EASTERN)
    return t.dt.strftime("%Y-%m-%d")


def num(s):
    return pd.to_numeric(s, errors="coerce")


# ---------------------------------------------------------------- college football
CFB_POS = {"QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE"}


def cfb_games(season):
    """One row per player per game: passing, rushing and receiving, with the game's context."""
    b = sdv("espn_cfb_player_box", f"player_box_{season}")
    if b is None:
        return None
    b = b[b["category"].isin(["passing", "rushing", "receiving"]) & (b["athlete_id"] > 0)].copy()
    ps = b["category"] == "passing"
    # some passing rows only carry ESPN's unnamed columns: C/ATT, YDS, AVG, TD, INT
    for col, alt in (("completions/passingAttempts", "stat_1"), ("passingYards", "stat_2"), ("passingTouchdowns", "stat_4"), ("interceptions", "stat_5")):
        b.loc[ps, col] = b.loc[ps, col].fillna(b.loc[ps, alt])
    ca = b["completions/passingAttempts"].where(ps).fillna("0/0").astype(str).str.split("/", expand=True)
    out = pd.DataFrame({
        "pid": b["athlete_id"].astype(str), "name": b["athlete_name"], "team_id": b["team_id"], "game": b["game_id"].astype(str),
        "cmp": num(ca[0]), "att": num(ca[1] if 1 in ca else 0),
        "pyd": num(b["passingYards"].where(ps)), "ptd": num(b["passingTouchdowns"].where(ps)), "int": num(b["interceptions"].where(ps)),
        "car": num(b["rushingAttempts"]), "ruyd": num(b["rushingYards"]), "rutd": num(b["rushingTouchdowns"]),
        "rec": num(b["receptions"]), "reyd": num(b["receivingYards"]), "retd": num(b["receivingTouchdowns"]),
    })
    stats = ["cmp", "att", "pyd", "ptd", "int", "car", "ruyd", "rutd", "rec", "reyd", "retd"]
    out[stats] = out[stats].fillna(0)
    out = out.groupby(["pid", "game", "team_id"], as_index=False).agg({"name": "first", **{k: "sum" for k in stats}})
    out["season"] = season
    return out


def cfb_schedule(season):
    s = sdv("cfb_schedules", f"cfb_schedules_{season}")
    if s is None:
        return None
    s = s.copy()
    s["game"] = s["game_id"].astype(str)
    s["date"] = eastern_date(s["start_date"])
    return s


def cfb():
    cur = TODAY.year if TODAY.month >= 3 else TODAY.year - 1      # a season is named by the year it starts
    seasons = (cur - 2, cur - 1, cur)
    games = [g for g in (cfb_games(s) for s in seasons) if g is not None]
    scheds = [x for x in (cfb_schedule(s) for s in seasons) if x is not None]
    if not games or not scheds:
        raise RuntimeError("cfb: no box scores or schedules")
    g = pd.concat(games, ignore_index=True)
    sch = pd.concat(scheds, ignore_index=True).drop_duplicates("game")
    abbr, div = {}, {}
    for side in ("home", "away"):
        for tid, ab, dv in sch[[f"{side}_id", f"{side}_abbreviation", f"{side}_division"]].itertuples(index=False):
            if isinstance(ab, str) and ab:
                abbr[tid] = ab
                if isinstance(dv, str):
                    div[ab] = dv
    for side in ("home", "away"):   # games not played yet come without team codes
        sch[f"{side}_abbreviation"] = sch[f"{side}_abbreviation"].fillna(sch[f"{side}_id"].map(abbr))
    lines = []
    for s in seasons:
        bt = sdv("espn_cfb_betting", f"betting_{s}")
        if bt is not None:
            lines.append(bt[["game_id", "home_team_spread", "over_under"]])
    bet = pd.concat(lines, ignore_index=True).drop_duplicates("game_id") if lines else pd.DataFrame(columns=["game_id", "home_team_spread", "over_under"])
    bet["game"] = bet["game_id"].astype(str)
    sch = sch.merge(bet[["game", "home_team_spread", "over_under"]], on="game", how="left")
    meta = sch.set_index("game")
    g = g[g["game"].isin(meta.index)].copy()
    m = meta.loc[g["game"]]
    home = (m["home_id"].to_numpy() == g["team_id"].to_numpy())
    g["team"] = g["team_id"].map(abbr)
    g["opp"] = np.where(home, m["away_abbreviation"], m["home_abbreviation"])
    g["home"] = np.where(m["neutral_site"].fillna(False).to_numpy(bool), np.nan, home.astype(float))
    g["date"] = m["date"].to_numpy()
    g["week"] = m["week"].to_numpy()
    g["post"] = (m["season_type"].to_numpy() == "postseason").astype(int)
    hp, ap = m["home_points"].to_numpy(float), m["away_points"].to_numpy(float)
    g["ts"], g["os"] = np.where(home, hp, ap), np.where(home, ap, hp)
    g["won"] = np.where(np.isnan(hp), np.nan, (g["ts"] > g["os"]).astype(float))
    spread = -m["home_team_spread"].to_numpy(float)                 # home -7.5 means the home team is favored by 7.5
    g["sp"] = np.where(home, spread, -spread)
    g["t"] = m["over_under"].to_numpy(float)

    # positions and current teams from this season's rosters (last season's fill in positions for older games)
    roster, pos_of = {}, {}
    for s in (cur - 1, cur):
        r = sdv("espn_cfb_rosters", f"cfb_rosters_{s}")
        if r is None:
            continue
        for aid, tid, tab, pab, nm, hs in r[["athlete_id", "team_id", "team_abbreviation", "position_abbreviation", "full_name", "headshot_href"]].itertuples(index=False):
            pos_of[str(aid)] = CFB_POS.get(pab)
            if s == cur:
                roster[str(aid)] = {"name": nm, "team": abbr.get(tid) or tab, "pos": CFB_POS.get(pab), "headshot": hs}
    # anyone the roster doesn't place: passers are QBs, then whichever he does more of, carry or catch
    tot = g.groupby("pid")[["att", "car", "rec"]].sum()
    guess = pd.Series(np.where(tot["att"] >= 10, "QB", np.where(tot["car"] > tot["rec"], "RB", "WR")), index=tot.index)
    g["pos"] = g["pid"].map(lambda p: pos_of.get(p)).fillna(g["pid"].map(guess))
    g = g[g["pos"].isin(["QB", "RB", "WR", "TE"])]
    if roster:   # keep only current FBS skill players; everyone else's games still count for defenses
        roster = {k: v for k, v in roster.items() if v["pos"] and div.get(v["team"]) == "fbs"}
        now = g["pid"].map(lambda p: (roster.get(p) or {}).get("pos"))
        g["pos"] = now.fillna(g["pos"])
    g["grp"] = g["pos"]
    g["use"] = g["att"] + g["car"] + g["rec"]
    g["played"] = g["use"] > 0
    g["starter"] = np.nan
    g["headshot"] = g["pid"].map(lambda p: (roster.get(p) or {}).get("headshot") or f"https://a.espncdn.com/i/headshots/college-football/players/full/{p}.png")

    nxt = {}
    cur_s = sch[sch["season"] == cur]
    up = cur_s[(~cur_s["completed"].fillna(False).astype(bool)) & (cur_s["date"] >= TODAY.isoformat())]
    for d, tm, h, a, wk, neutral in sorted(zip(up["date"], up["start_date"].astype(str), up["home_abbreviation"], up["away_abbreviation"],
                                               up["week"], up["neutral_site"].fillna(False)), key=lambda r: (r[0], r[1])):
        if not (isinstance(h, str) and isinstance(a, str)):
            continue
        for team, opp, isH in ((h, a, 1), (a, h, 0)):
            if team not in nxt:
                nxt[team] = {"opp": opp, "home": None if neutral else isH, "date": d, "time": tm, "week": int(wk)}
    build_sport("cfb", g, {
        "stats": ["pyd", "ptd", "cmp", "att", "int", "car", "ruyd", "rutd", "rec", "reyd", "retd"],
        "composite": {"QB": {"pyd": 0.04, "ptd": 4, "int": -2, "ruyd": 0.1, "rutd": 6},
                      "RB": {"ruyd": 0.1, "rutd": 6, "rec": 1, "reyd": 0.1, "retd": 6},
                      "WR": {"rec": 1, "reyd": 0.1, "retd": 6}, "TE": {"rec": 1, "reyd": 0.1, "retd": 6}},
        "usage": "use", "K": 4, "min_games": 4, "min_usage": 3, "roster_required": bool(roster),
        "extra": {"w": "week", "sp": "sp", "t": "t"}}, nxt, cur, {s: str(s) for s in seasons}, roster)


# ---------------------------------------------------------------- men's college basketball
def cbb():
    cur = TODAY.year + 1 if TODAY.month >= 9 else TODAY.year      # labeled by the year the season ends, like the NBA
    frames = [sdv("espn_mens_college_basketball_player_boxscores", f"player_box_{s}") for s in (cur - 2, cur - 1, cur)]
    frames = [f for f in frames if f is not None]
    if not frames:
        raise RuntimeError("cbb: no box scores")
    b = pd.concat(frames, ignore_index=True)
    b = b[b["season_type"].isin([2, 3]) & b["athlete_id"].notna()]
    pos = b["athlete_position_abbreviation"].fillna("G").replace({"PG": "G", "SG": "G", "SF": "F", "PF": "F"})
    df = pd.DataFrame({
        "pid": b["athlete_id"].astype("Int64").astype(str), "name": b["athlete_display_name"], "team": b["team_abbreviation"],
        "opp": b["opponent_team_abbreviation"], "date": b["game_date"].astype(str).str[:10], "season": b["season"].astype(int),
        "post": (b["season_type"] == 3).astype(int), "home": (b["home_away"] == "home").astype(int),
        "ts": b["team_score"], "os": b["opponent_team_score"], "won": b["team_winner"].astype("float"),
        "grp": pos.where(pos.isin(["G", "F", "C"]), "F"), "pos": pos, "starter": b["starter"],
        "played": (~b["did_not_play"].fillna(False).astype(bool)) & (b["minutes"].fillna(0) > 0),
        "game": b["game_id"].astype(str), "headshot": b["athlete_headshot_href"],
        "pts": b["points"], "reb": b["rebounds"], "ast": b["assists"], "fg3": b["three_point_field_goals_made"],
        "stl": b["steals"], "blk": b["blocks"], "tov": b["turnovers"], "min": b["minutes"],
    })
    nxt = {}
    sch = sdv("espn_mens_college_basketball_schedules", f"mbb_schedule_{cur}")
    if sch is not None:
        sch = sch[(sch["status_type_completed"] == False) & sch["home_abbreviation"].notna()]
        sch = sch[pd.to_datetime(sch["game_date"]).dt.date >= TODAY]
        nxt = next_from_schedule(zip(sch["game_date"].astype(str).str[:10], sch["start_date"].astype(str), sch["home_abbreviation"], sch["away_abbreviation"]))
        neutral = {}
        for d, h, a, n in zip(sch["game_date"].astype(str).str[:10], sch["home_abbreviation"], sch["away_abbreviation"], sch["neutral_site"]):
            if n:
                neutral[(d, h)] = neutral[(d, a)] = True
        for t, v in nxt.items():
            if neutral.get((v["date"], t)):
                v["home"] = None
    # this season's rosters place transfers on their new team and drop players who left
    roster = {}
    r = sdv("espn_mens_college_basketball_rosters", f"rosters_{cur}")
    if r is not None:
        for aid, nm, tab in r[["athlete_id", "full_name", "team_abbreviation"]].itertuples(index=False):
            roster[str(aid)] = {"name": nm, "team": tab}
    names_map = {s: f"{s - 1}-{str(s)[2:]}" for s in (cur - 2, cur - 1, cur)}
    build_sport("cbb", df, {
        "stats": ["pts", "reb", "ast", "fg3", "stl", "blk", "tov", "min"],
        "composite": {g: {"pts": 1, "reb": 1.2, "ast": 1.5, "stl": 3, "blk": 3} for g in ("G", "F", "C")},
        "usage": "min", "K": 8, "min_games": 10, "min_usage": 20, "float_stats": ("min",),
        "roster_required": len(roster) > 1000}, nxt, cur, names_map, roster)


BUILDERS = {"cfb": cfb, "cbb": cbb}

if __name__ == "__main__":
    failures = 0
    todo = sys.argv[1:] or list(BUILDERS)
    for sport in todo:
        try:
            os.makedirs(os.path.join(DATA, "props", sport), exist_ok=True)
            BUILDERS[sport]()
        except Exception as e:
            failures += 1
            import traceback; traceback.print_exc()
            print(f"{sport} props: FAILED, kept previous data. {e}", file=sys.stderr)
    sys.exit(1 if failures == len(todo) else 0)
