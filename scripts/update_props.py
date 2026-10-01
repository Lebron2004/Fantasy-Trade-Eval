#!/usr/bin/env python3
"""
Trade Scale props builder (NFL).

Builds everything the Props page needs from nflverse's free data (CC-BY 4.0):

  site/data/props/nfl/index.json     searchable players + each team's next game (spread, total, implied total)
  site/data/props/nfl/defense.json   what each defense allows by position, plus its blitz / box / man-zone tendencies
  site/data/props/nfl/p/<id>.json    one file per player: game log with context, scheme splits, teammate on/off

Sources (all from github.com/nflverse):
  stats_player_week_<season>   box scores with opponent, every game
  play_by_play_<season>        who threw, ran, and was targeted on every play
  ftn_charting_<season>        FTN hand charting: blitzers and defenders in the box, updated during the season
  pbp_participation_<season>   man vs zone coverage, published after each season ends
  games.csv                    schedule, closing spread and total, roof, weather
  players                      current team and headshot

Needs pandas + pyarrow (the workflow installs them).
"""
import io, json, math, os, shutil, sys, time, urllib.request
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "site", "data", "props", "nfl")
REL = "https://github.com/nflverse/nflverse-data/releases/download/"
GAMES_CSV = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv"
UA = {"User-Agent": "TradeScale/1.0 (personal props research tool)"}
TODAY = date.today()
SEASON = TODAY.year if TODAY.month >= 9 else TODAY.year - 1
POS = {"QB", "RB", "WR", "TE"}

# nflverse column -> short key used in the JSON
STATS = {"completions": "cmp", "attempts": "att", "passing_yards": "pyd", "passing_tds": "ptd",
         "passing_interceptions": "int", "carries": "car", "rushing_yards": "ruyd", "rushing_tds": "rutd",
         "receptions": "rec", "targets": "tgt", "receiving_yards": "reyd", "receiving_tds": "retd",
         "fantasy_points_ppr": "ppr"}
KEYS = list(STATS.values())


# ---------------------------------------------------------------- download helpers
def fetch(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                return r.read()
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def release(tag, name, columns=None, required=False):
    """Read an nflverse release file (parquet). Returns None if it doesn't exist yet (e.g. a new season)."""
    try:
        return pd.read_parquet(io.BytesIO(fetch(f"{REL}{tag}/{name}.parquet")), columns=columns)
    except Exception as e:
        if required:
            raise
        print(f"  skipped {name}: {str(e)[:120]}", file=sys.stderr)
        return None


def r1(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 1)


def r3(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), 4)


# ---------------------------------------------------------------- load
def load():
    seasons = [SEASON - 2, SEASON - 1, SEASON]
    print(f"Season {SEASON}; game logs from {seasons[0]}")

    frames = [release("stats_player", f"stats_player_week_{s}") for s in seasons]
    stats = pd.concat([f for f in frames if f is not None], ignore_index=True)
    stats["position"] = stats["position"].replace({"FB": "RB"})
    stats = stats[stats["position"].isin(POS)].copy()
    for col in STATS:
        if col not in stats:
            stats[col] = 0
        stats[col] = pd.to_numeric(stats[col], errors="coerce").fillna(0)

    games = pd.read_csv(io.BytesIO(fetch(GAMES_CSV)))
    games = games[games["season"] >= seasons[0] - 1].copy()

    pcols = ["game_id", "play_id", "season", "week", "posteam", "defteam", "play_type", "qb_dropback",
             "pass_attempt", "sack", "passer_player_id", "rusher_player_id", "receiver_player_id",
             "passing_yards", "receiving_yards", "rushing_yards", "complete_pass", "pass_touchdown",
             "rush_touchdown", "interception", "two_point_attempt"]
    pbp = [release("pbp", f"play_by_play_{s}", columns=pcols) for s in seasons]
    pbp = pd.concat([p for p in pbp if p is not None], ignore_index=True)
    pbp = pbp[pbp["two_point_attempt"].fillna(0) == 0]

    ftn = [release("ftn_charting", f"ftn_charting_{s}",
                   columns=["nflverse_game_id", "nflverse_play_id", "n_blitzers", "n_defense_box"]) for s in seasons]
    ftn = [f for f in ftn if f is not None]
    if ftn:
        ftn = pd.concat(ftn, ignore_index=True).rename(columns={"nflverse_game_id": "game_id", "nflverse_play_id": "play_id"})
        pbp = pbp.merge(ftn, on=["game_id", "play_id"], how="left")
    else:
        pbp["n_blitzers"], pbp["n_defense_box"] = np.nan, np.nan

    part = [release("pbp_participation", f"pbp_participation_{s}",
                    columns=["nflverse_game_id", "play_id", "defense_man_zone_type"]) for s in seasons]
    cov_seasons = [s for s, p in zip(seasons, part) if p is not None and p["defense_man_zone_type"].fillna("").str.contains("MAN|ZONE").any()]
    part = [p for p in part if p is not None]
    if part:
        part = pd.concat(part, ignore_index=True).rename(columns={"nflverse_game_id": "game_id"})
        pbp = pbp.merge(part, on=["game_id", "play_id"], how="left")
    else:
        pbp["defense_man_zone_type"] = np.nan
    cov = pbp["defense_man_zone_type"].fillna("")
    pbp["cov"] = np.where(cov.str.contains("MAN"), "man", np.where(cov.str.contains("ZONE"), "zone", ""))
    pbp["blitz"] = np.where(pbp["n_blitzers"].isna(), "", np.where(pbp["n_blitzers"] > 0, "yes", "no"))
    box = pbp["n_defense_box"]
    pbp["box"] = np.where(box.isna() | (box <= 0), "", np.where(box <= 6, "light", np.where(box == 7, "base", "stacked")))

    players = release("players", "players",
                      columns=["gsis_id", "display_name", "position", "latest_team", "status", "headshot"], required=True)
    return seasons, stats, games, pbp, players, cov_seasons


# ---------------------------------------------------------------- game context
def game_context(games):
    """(season, week, team) -> context from that team's point of view."""
    ctx = {}
    for g in games.itertuples(index=False):
        roof = "dome" if str(g.roof) in ("dome", "closed") else "outdoors"
        for team, opp, home in ((g.home_team, g.away_team, 1), (g.away_team, g.home_team, 0)):
            sp = g.spread_line if home else (-g.spread_line if pd.notna(g.spread_line) else np.nan)
            ts = g.home_score if home else g.away_score
            os_ = g.away_score if home else g.home_score
            ctx[(int(g.season), int(g.week), team)] = {
                "d": str(g.gameday), "o": opp, "h": home, "sp": r1(sp), "t": r1(g.total_line),
                "ts": None if pd.isna(ts) else int(ts), "os": None if pd.isna(os_) else int(os_),
                "r": roof, "tp": None if pd.isna(g.temp) else int(g.temp), "wd": None if pd.isna(g.wind) else int(g.wind),
                "dv": int(g.div_game) if pd.notna(g.div_game) else 0, "post": int(g.game_type != "REG"),
            }
    return ctx


def next_games(games):
    up = games[(games["season"] == SEASON) & games["result"].isna()].copy()
    up["gameday"] = pd.to_datetime(up["gameday"]).dt.date
    up = up[up["gameday"] >= TODAY].sort_values(["gameday", "gametime"])
    out = {}
    for g in up.itertuples(index=False):
        for team, opp, home in ((g.home_team, g.away_team, 1), (g.away_team, g.home_team, 0)):
            if team in out:
                continue
            sp = g.spread_line if home else (-g.spread_line if pd.notna(g.spread_line) else np.nan)
            implied = (g.total_line + sp) / 2 if pd.notna(g.total_line) and pd.notna(sp) else np.nan
            out[team] = {"opp": opp, "home": home, "week": int(g.week), "date": str(g.gameday),
                         "time": None if pd.isna(g.gametime) else str(g.gametime),
                         "sp": r1(sp), "t": r1(g.total_line), "imp": r1(implied),
                         "roof": "dome" if str(g.roof) in ("dome", "closed") else "outdoors",
                         "div": int(g.div_game) if pd.notna(g.div_game) else 0}
    lines = games[games["season"].isin([SEASON - 1, SEASON]) & games["total_line"].notna()]
    avg_team_total = float(lines["total_line"].mean() / 2) if len(lines) else 22.5
    return out, avg_team_total


# ---------------------------------------------------------------- defenses
def defense_profiles(stats, pbp, seasons, cov_seasons):
    """What each defense allows per game to each position, blended with last season early on, plus scheme tendencies."""
    per_game = (stats.groupby(["season", "week", "opponent_team", "position"])[list(STATS)].sum().reset_index())
    rank_by_season = {}   # (season, def, pos) -> rank 1 = allows fewest PPR points (toughest)
    for (s, pos), grp in per_game.groupby(["season", "position"]):
        avg = grp.groupby("opponent_team")["fantasy_points_ppr"].mean().sort_values()
        for i, d in enumerate(avg.index):
            rank_by_season[(int(s), d, pos)] = i + 1

    cur, prev = per_game[per_game["season"] == SEASON], per_game[per_game["season"] == SEASON - 1]
    K = 4  # last season counts like 4 extra games of evidence
    teams = sorted(set(per_game["opponent_team"]))
    out, league = {}, {}
    for pos in POS:
        c = cur[cur["position"] == pos].groupby("opponent_team")[list(STATS)]
        p = prev[prev["position"] == pos].groupby("opponent_team")[list(STATS)].mean()
        c_sum, c_n = c.sum(), c.size()
        blend = {}
        for d in teams:
            n = int(c_n.get(d, 0))
            pv = p.loc[d] if d in p.index else p.mean()
            cs = c_sum.loc[d] if d in c_sum.index else pd.Series(0, index=list(STATS))
            blend[d] = ((cs + pv * K) / (n + K), n)
        lg = pd.DataFrame({d: b[0] for d, b in blend.items()}).T.mean()
        league[pos] = {STATS[k]: r3(lg[k]) for k in STATS}
        ppr_order = sorted(teams, key=lambda d: blend[d][0]["fantasy_points_ppr"])
        for d in teams:
            vals, n = blend[d]
            keep = [k for k in STATS if pos == "QB" or STATS[k] not in ("cmp", "att", "pyd", "ptd", "int")]
            out.setdefault(d, {"pos": {}})["pos"][pos] = {
                "g": n, "rank": ppr_order.index(d) + 1,
                "allow": {STATS[k]: r3(vals[k]) for k in keep}}

    # scheme tendencies: blitz rate on dropbacks, box counts on runs (FTN, this season blended with last), man rate (participation)
    def rate_blend(mask_cur, total_cur, mask_prev, total_prev, k):
        prior = mask_prev / total_prev if total_prev else np.nan
        if np.isnan(prior):
            return mask_cur / total_cur if total_cur else None
        return (mask_cur + prior * k) / (total_cur + k)

    db = pbp[(pbp["qb_dropback"] == 1) & (pbp["blitz"] != "")]
    runs = pbp[(pbp["play_type"] == "run") & (pbp["box"] != "")]
    covp = pbp[(pbp["qb_dropback"] == 1) & (pbp["cov"] != "")]
    cov_season = max(cov_seasons) if cov_seasons else None
    for d in teams:
        sch = {}
        a, b = db[(db["defteam"] == d) & (db["season"] == SEASON)], db[(db["defteam"] == d) & (db["season"] == SEASON - 1)]
        sch["blitz"] = r3(rate_blend((a["blitz"] == "yes").sum(), len(a), (b["blitz"] == "yes").sum(), len(b), 150))
        a, b = runs[(runs["defteam"] == d) & (runs["season"] == SEASON)], runs[(runs["defteam"] == d) & (runs["season"] == SEASON - 1)]
        for bucket in ("light", "base", "stacked"):
            sch[bucket] = r3(rate_blend((a["box"] == bucket).sum(), len(a), (b["box"] == bucket).sum(), len(b), 100))
        if cov_season:
            c = covp[(covp["defteam"] == d) & (covp["season"] == cov_season)]
            sch["man"] = r3((c["cov"] == "man").mean()) if len(c) else None
        out[d]["scheme"] = sch

    lg_s = {"blitz": r3((db[db["season"] >= SEASON - 1]["blitz"] == "yes").mean())}
    rr = runs[runs["season"] >= SEASON - 1]
    for bucket in ("light", "base", "stacked"):
        lg_s[bucket] = r3((rr["box"] == bucket).mean()) if len(rr) else None
    if cov_season:
        cc = covp[covp["season"] == cov_season]
        lg_s["man"] = r3((cc["cov"] == "man").mean())
    return {"season": SEASON, "cov_season": cov_season, "league": {"pos": league, "scheme": lg_s}, "teams": out}, rank_by_season


# ---------------------------------------------------------------- per-player scheme splits
def shrink(n, rate, k, overall):
    if n <= 0 or overall is None:
        return overall
    return (rate * n + overall * k) / (n + k)


DROPBACKS = None  # set in build(): every dropback with a "game|offense" key for fast filtering


def scheme_splits(pid, pos, pstats, pbp, cov_seasons):
    """Per-play production split by what the defense did. Rates are shrunk toward his overall rate by sample size."""
    out = {}
    my_games = set(zip(pstats["game_id"], pstats["team"]))
    if pos == "QB":
        d = pbp[(pbp["qb_dropback"] == 1) & (pbp["passer_player_id"] == pid)]
        if len(d) >= 100:
            def rates(x):
                return {"att": ((x["pass_attempt"] == 1) & (x["sack"].fillna(0) == 0)).sum(), "cmp": x["complete_pass"].sum(),
                        "pyd": x["passing_yards"].fillna(0).sum(), "ptd": x["pass_touchdown"].sum(),
                        "int": x["interception"].sum(), "sack": x["sack"].sum()}
            out["unit"] = "dropback"
            out.update(split_block(d, rates, k=80))
    else:
        keys = {f"{g}|{t}" for g, t in my_games}
        team_db = DROPBACKS[DROPBACKS["gt"].isin(keys)]
        if len(team_db) >= 150:
            def rates(x):
                mine = x[(x["receiver_player_id"] == pid) & (x["pass_attempt"] == 1) & (x["sack"].fillna(0) == 0)]
                return {"tgt": len(mine), "rec": mine["complete_pass"].sum(),
                        "reyd": mine["receiving_yards"].fillna(0).sum(), "retd": mine["pass_touchdown"].sum()}
            out["unit"] = "team dropback"
            out.update(split_block(team_db, rates, k=120))
            if out.get("all", {}).get("tgt", 0) < 0.02:   # barely targeted, splits would be noise
                out = {}
    if pos in ("RB", "QB"):
        r = pbp[(pbp["play_type"] == "run") & (pbp["rusher_player_id"] == pid)]
        rb = r[r["box"] != ""]
        if len(rb) >= 40:
            overall = {"ruyd": r["rushing_yards"].fillna(0).mean(), "rutd": r["rush_touchdown"].mean()}
            out["box"] = {}
            for bucket in ("light", "base", "stacked"):
                x = rb[rb["box"] == bucket]
                out["box"][bucket] = {"n": int(len(x)),
                                      **{k: r3(shrink(len(x), (x["rushing_yards"].fillna(0).mean() if k == "ruyd" else x["rush_touchdown"].mean()) if len(x) else 0, 40, overall[k])) for k in overall}}
            out["box"]["all"] = {"n": int(len(r)), **{k: r3(v) for k, v in overall.items()}}
    if out:
        out["cov_seasons"] = cov_seasons
    return out


def split_block(plays, rates, k):
    n_all = len(plays)
    base = rates(plays)
    overall = {key: v / n_all for key, v in base.items()}
    block = {"all": {"n": int(n_all), **{key: r3(v) for key, v in overall.items()}}}
    for dim, values in (("blitz", ("yes", "no")), ("cov", ("man", "zone"))):
        sub = plays[plays[dim] != ""]
        if len(sub) < 40:
            continue
        block[dim] = {}
        for v in values:
            x = sub[sub[dim] == v]
            raw = rates(x) if len(x) else {key: 0 for key in base}
            block[dim][v] = {"n": int(len(x)), **{key: r3(shrink(len(x), raw[key] / len(x) if len(x) else 0, k, overall[key])) for key in base}}
    return block


# ---------------------------------------------------------------- main build
def build():
    seasons, stats, games, pbp, players, cov_seasons = load()
    ctx = game_context(games)
    nxt, avg_team_total = next_games(games)
    defense, rank_by_season = defense_profiles(stats, pbp, seasons, cov_seasons)
    defense["avg_team_total"] = round(avg_team_total, 2)

    pl = players[players["status"].eq("ACT") & players["latest_team"].notna()].copy()
    pl["position"] = pl["position"].replace({"FB": "RB"})
    pl = pl[pl["position"].isin(POS)]
    active = stats[stats["season"] >= SEASON - 1]["player_id"].unique()
    pl = pl[pl["gsis_id"].isin(active)]

    # team-week presence for teammate on/off splits
    present = {}
    for (s, w, t), grp in stats.groupby(["season", "week", "team"]):
        present[(int(s), int(w), t)] = set(grp["player_id"])
    team_seasons = {}
    for pid_, s, t in stats[["player_id", "season", "team"]].drop_duplicates().itertuples(index=False):
        team_seasons.setdefault(pid_, set()).add((int(s), t))
    usage = (stats[stats["season"] >= SEASON - 1].assign(u=lambda x: x["targets"] + x["carries"] + 0.5 * x["attempts"])
             .groupby(["player_id", "team"])["u"].sum())

    global DROPBACKS
    DROPBACKS = pbp[pbp["qb_dropback"] == 1].copy()
    DROPBACKS["gt"] = DROPBACKS["game_id"] + "|" + DROPBACKS["posteam"].fillna("")
    tmp_dir = os.path.join(OUT, "p.tmp")
    shutil.rmtree(tmp_dir, ignore_errors=True)
    os.makedirs(tmp_dir)

    index = []
    by_player = dict(tuple(stats.groupby("player_id")))
    for p in pl.itertuples(index=False):
        pid, team, pos = p.gsis_id, p.latest_team, p.position
        ps = by_player.get(pid)
        if ps is None or ps.empty:
            continue
        ps = ps.sort_values(["season", "week"])

        # teammates: most-used current teammates at skill spots
        mates_df = pl[(pl["latest_team"] == team) & (pl["gsis_id"] != pid)]
        mates = sorted(mates_df.itertuples(index=False), key=lambda m: -usage.get((m.gsis_id, team), 0))
        mates = [m for m in mates if usage.get((m.gsis_id, team), 0) > 0][:6]

        log = []
        for r in ps.itertuples(index=False):
            s, w, t = int(r.season), int(r.week), r.team
            c = ctx.get((s, w, t), {"d": None, "o": r.opponent_team, "h": None})
            row = dict(c)
            row.update({"s": s, "w": w, "tm": t, "dr": rank_by_season.get((s, r.opponent_team, pos))})
            row["x"] = {STATS[k]: (round(float(getattr(r, k)), 1) if k == "fantasy_points_ppr" else int(getattr(r, k)))
                        for k in STATS if getattr(r, k)}
            mp = me = 0
            for i, m in enumerate(mates):
                if (s, t) in team_seasons.get(m.gsis_id, set()):
                    me |= 1 << i
                    if m.gsis_id in present.get((s, w, t), set()):
                        mp |= 1 << i
            row["mp"], row["me"] = mp, me
            log.append(row)

        cur = ps[ps["season"] == SEASON]
        recent = cur if len(cur) else ps[ps["season"] == SEASON - 1]
        ppg = float(recent["fantasy_points_ppr"].mean()) if len(recent) else 0.0
        doc = {"id": pid, "name": p.display_name, "team": team, "pos": pos, "headshot": p.headshot if isinstance(p.headshot, str) else None,
               "log": log, "mates": [{"id": m.gsis_id, "name": m.display_name, "pos": m.position} for m in mates],
               "scheme": scheme_splits(pid, pos, ps, pbp, cov_seasons)}
        with open(os.path.join(tmp_dir, f"{pid}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        index.append([pid, p.display_name, team, pos, round(ppg, 1), int(len(cur))])

    if len(index) < 100:
        raise RuntimeError(f"only {len(index)} players built, keeping previous data")
    shutil.rmtree(os.path.join(OUT, "p"), ignore_errors=True)
    os.replace(tmp_dir, os.path.join(OUT, "p"))   # swap in the new files only once everything built
    index.sort(key=lambda r: -r[4])
    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": stamp, "season": SEASON, "next": nxt, "players": index}, f, ensure_ascii=False, separators=(",", ":"))
    defense["updated"] = stamp
    with open(os.path.join(OUT, "defense.json"), "w", encoding="utf-8") as f:
        json.dump(defense, f, ensure_ascii=False, separators=(",", ":"))
    print(f"props: {len(index)} players, {len(nxt)} teams with an upcoming game, coverage seasons {cov_seasons}")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    try:
        build()
    except Exception as e:
        # Keep yesterday's props data rather than failing the whole deploy.
        print(f"props: FAILED, kept previous data. {e}", file=sys.stderr)
        raise
