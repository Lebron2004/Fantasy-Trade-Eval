#!/usr/bin/env python3
"""
College game lines (spread, moneyline, total) for college football and men's college basketball.

Many states only allow game bets on college sports (no player props), so the college tabs price games instead:
  site/data/props/<sport>/games.json   team ratings, the model's line for every game in the next few days, and the
                                       book's line from ESPN when it has one

The model is a rating for every team, fit by ridge regression on game margins (and on each side's points, for
totals) with a home-field edge. Newer games count more, and last season's games carry the early weeks. Each run
backtests it week by week on last season, picks the recency and shrinkage that predicted best, and measures how
far to trust it against the book's line (college football has past lines; basketball uses the same share).

Sources: SportsDataverse releases (college football schedules, scores and betting lines; men's college basketball box
scores and schedules) and ESPN's public scoreboard and team list for the next few days' games, lines and names.
Needs pandas + pyarrow.

Run: python scripts/update_college_games.py            (both)
     python scripts/update_college_games.py cbb        (one)
     python scripts/update_college_games.py --check    (fetch, fit and backtest, print a summary, write nothing)
"""
import json, os, re, sys
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_props_more import DATA, TODAY, fetch, sdv  # noqa: E402

try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:
    EASTERN = None

ESPN = "https://site.api.espn.com/apis/site/v2/sports/"
OTHER = "_OTHER"     # everyone too small to rate on their own (FCS and below in football, non-D1 in basketball)
CFG = {
    # half: days for a game's weight to halve; lam: ridge shrinkage toward an average team; days: how far ahead to list games
    "cfb": {"path": "football/college-football", "groups": "80", "half": 120, "lam": 3.0, "days": 8},
    "cbb": {"path": "basketball/mens-college-basketball", "groups": "50", "half": 60, "lam": 3.0, "days": 4},
}
K_DEFAULT = 0.3      # share of the gap between the model and the book's line to trust, when there are no past lines


def eastern_date(s):
    t = pd.to_datetime(s, utc=True, errors="coerce")
    if EASTERN is not None:
        t = t.dt.tz_convert(EASTERN)
    return t.dt.strftime("%Y-%m-%d")


def num(s):
    return pd.to_numeric(s, errors="coerce")


def r1(x):
    return None if x is None or not np.isfinite(x) else round(float(x), 1)


# ---------------------------------------------------------------- results
def cfb_results(cur):
    """Completed games with at least one FBS team, plus the book's closing line where ESPN had one."""
    frames, fbs = [], set()
    for s in (cur - 2, cur - 1, cur):
        sch = sdv("cfb_schedules", f"cfb_schedules_{s}")
        if sch is None:
            continue
        sch = sch.copy()
        bt = sdv("espn_cfb_betting", f"betting_{s}")
        if bt is not None:
            bt = bt[["game_id", "home_team_spread", "over_under"]].drop_duplicates("game_id")
            sch = sch.merge(bt, on="game_id", how="left")
        else:
            sch["home_team_spread"], sch["over_under"] = np.nan, np.nan
        for side in ("home", "away"):
            fb = sch.loc[sch[f"{side}_division"] == "fbs", f"{side}_abbreviation"].dropna()
            fbs |= set(fb) if s >= cur - 1 else set()
        frames.append(pd.DataFrame({
            "date": eastern_date(sch["start_date"]), "season": s,
            "home": sch["home_abbreviation"], "away": sch["away_abbreviation"],
            "hp": num(sch["home_points"]), "ap": num(sch["away_points"]),
            "neutral": sch["neutral_site"].fillna(False).astype(bool),
            "spread": num(sch["home_team_spread"]), "total": num(sch["over_under"]),
            "week": num(sch["week"]), "post": sch["season_type"].astype(str).eq("postseason"),
        }))
    if not frames:
        raise RuntimeError("cfb: no schedules")
    g = pd.concat(frames, ignore_index=True)
    g = g[g["hp"].notna() & g["ap"].notna() & g["home"].notna() & g["away"].notna()]
    g = g[g["home"].isin(fbs) | g["away"].isin(fbs)].copy()
    for side in ("home", "away"):
        g.loc[~g[side].isin(fbs), side] = OTHER
    return g.reset_index(drop=True), fbs


def cbb_results(cur):
    """One row per game from ESPN box scores (each team's first player row carries the score)."""
    frames = []
    for s in (cur - 2, cur - 1, cur):
        b = sdv("espn_mens_college_basketball_player_boxscores", f"player_box_{s}")
        if b is None:
            continue
        b = b[b["season_type"].isin([2, 3])].drop_duplicates(["game_id", "team_abbreviation"])
        home = b["home_away"].eq("home")
        frames.append(pd.DataFrame({
            "game": b["game_id"].astype(str), "date": b["game_date"].astype(str).str[:10], "season": s,
            "home": np.where(home, b["team_abbreviation"], b["opponent_team_abbreviation"]),
            "away": np.where(home, b["opponent_team_abbreviation"], b["team_abbreviation"]),
            "hp": np.where(home, num(b["team_score"]), num(b["opponent_team_score"])),
            "ap": np.where(home, num(b["opponent_team_score"]), num(b["team_score"])),
            "post": b["season_type"].eq(3).to_numpy(),
        }))
        sch = sdv("espn_mens_college_basketball_schedules", f"mbb_schedule_{s}")
        if sch is not None and "neutral_site" in sch:
            neutral = {(d, h) for d, h, n in zip(sch["game_date"].astype(str).str[:10], sch["home_abbreviation"], sch["neutral_site"]) if n == True}  # noqa: E712
            frames[-1]["neutral"] = [(d, h) in neutral for d, h in zip(frames[-1]["date"], frames[-1]["home"])]
    if not frames:
        raise RuntimeError("cbb: no box scores")
    g = pd.concat(frames, ignore_index=True).drop_duplicates("game")
    g = g[g["hp"].notna() & g["ap"].notna() & (g["hp"] + g["ap"] > 0) & g["home"].notna() & g["away"].notna()].copy()
    g["neutral"] = g.get("neutral", False)
    g["neutral"] = g["neutral"].fillna(False).astype(bool)
    g["spread"], g["total"] = np.nan, np.nan
    # teams with only a handful of games against Division I are pooled into one rating
    n = pd.concat([g["home"], g["away"]]).value_counts()
    small = set(n[n < 10].index)
    for side in ("home", "away"):
        g.loc[g[side].isin(small), side] = OTHER
    return g.drop(columns="game").reset_index(drop=True), set(n[n >= 10].index)


# ---------------------------------------------------------------- ratings
def _ridge(nvar, cols, vals, y, w, pen):
    """Weighted least squares with a ridge penalty, built straight into the normal equations (rows are sparse)."""
    A = np.zeros((nvar, nvar)); b = np.zeros(nvar)
    k = cols.shape[1]
    for p in range(k):
        np.add.at(b, cols[:, p], w * vals[:, p] * y)
        for q in range(k):
            np.add.at(A, (cols[:, p], cols[:, q]), w * vals[:, p] * vals[:, q])
    A[np.diag_indices(nvar)] += pen
    return np.linalg.solve(A, b)


class Ratings:
    """Margin ratings (home margin = r[home] - r[away] + hfa) and points ratings (pts = mu + off[team] + def[opp] + home)."""

    def __init__(self, g, asof, half, lam):
        teams = sorted(set(g["home"]) | set(g["away"]))
        self.ix = {t: i for i, t in enumerate(teams)}
        T = len(teams)
        h = g["home"].map(self.ix).to_numpy(); a = g["away"].map(self.ix).to_numpy()
        f = (~g["neutral"].to_numpy(bool)).astype(float)
        age = (pd.Timestamp(asof) - pd.to_datetime(g["date"])).dt.days.to_numpy(float)
        w = 0.5 ** (np.maximum(age, 0) / half)
        hp, ap = g["hp"].to_numpy(float), g["ap"].to_numpy(float)
        # margin: one row per game
        pen = np.r_[np.full(T, lam), 1e-6]
        cols = np.c_[h, a, np.full(len(g), T)]
        vals = np.c_[np.ones(len(g)), -np.ones(len(g)), f]
        bm = _ridge(T + 1, cols, vals, hp - ap, w, pen)
        self.r, self.hfa = bm[:T], bm[T]
        # points: one row per side; columns off[T], def[T], home edge, intercept
        cols = np.r_[np.c_[h, T + a, np.full(len(g), 2 * T), np.full(len(g), 2 * T + 1)],
                     np.c_[a, T + h, np.full(len(g), 2 * T), np.full(len(g), 2 * T + 1)]]
        vals = np.r_[np.c_[np.ones(len(g)), np.ones(len(g)), f, np.ones(len(g))],
                     np.c_[np.ones(len(g)), np.ones(len(g)), np.zeros(len(g)), np.ones(len(g))]]
        pen = np.r_[np.full(2 * T, lam), 1e-6, 1e-6]
        bp = _ridge(2 * T + 2, cols, vals, np.r_[hp, ap], np.r_[w, w], pen)
        self.off, self.dfn, self.hpts, self.mu = bp[:T], bp[T:2 * T], bp[2 * T], bp[2 * T + 1]
        # an unrated team plays like the pooled one, or like an average team when there is none
        self.other = self.ix.get(OTHER)

    def _i(self, t):
        return self.ix.get(t, self.other)

    def rating(self, t):
        i = self._i(t)
        return 0.0 if i is None else self.r[i]

    def predict(self, home, away, neutral):
        """Model's home margin and total for each game."""
        f = 0.0 if neutral else 1.0
        hi, ai = self._i(home), self._i(away)
        rv = lambda arr, i: 0.0 if i is None else arr[i]
        m = rv(self.r, hi) - rv(self.r, ai) + self.hfa * f
        t = 2 * self.mu + rv(self.off, hi) + rv(self.dfn, ai) + rv(self.off, ai) + rv(self.dfn, hi) + self.hpts * f
        return m, t


def walk_forward(g, season, sport, half, lam):
    """Predict every game of a past season using only games played before its week (or 7-day block)."""
    test = g[g["season"] == season].sort_values("date")
    if test.empty:
        return None
    start = pd.Timestamp(test["date"].iloc[0])
    block = ((pd.to_datetime(test["date"]) - start).dt.days // 7).to_numpy()
    out = []
    for b in np.unique(block):
        chunk = test[block == b]
        d0 = chunk["date"].min()
        R = Ratings(g[g["date"] < d0], d0, half, lam)
        for row in chunk.itertuples(index=False):
            m, t = R.predict(row.home, row.away, row.neutral)
            out.append((m, t, row.hp - row.ap, row.hp + row.ap, row.spread, row.total))
    return pd.DataFrame(out, columns=["m", "t", "am", "at", "spread", "total"])


def score(bt):
    """How a backtest did: winner picks, margin and total errors, and how far to trust the model against the book."""
    res_m, res_t = bt["am"] - bt["m"], bt["at"] - bt["t"]
    decided = bt["am"] != 0
    s = {"games": int(len(bt)), "winner": round(float((np.sign(bt["m"][decided]) == np.sign(bt["am"][decided])).mean()), 3),
         "mae": round(float(res_m.abs().mean()), 2), "mae_total": round(float(res_t.abs().mean()), 2),
         "sd": float(res_m.std()), "sd_total": float(res_t.std()), "k": K_DEFAULT, "k_total": K_DEFAULT}
    lined = bt[bt["spread"].notna()]
    if len(lined) >= 200:
        book = -lined["spread"]
        gap, miss = lined["m"] - book, lined["am"] - book
        s["k"] = float(np.clip((gap * miss).sum() / max((gap * gap).sum(), 1e-9), 0, 1))
        s["sd"] = float((miss - s["k"] * gap).std())
        s["mae_book"] = round(float(miss.abs().mean()), 2)
        cover = lined["am"] + lined["spread"]           # home's result against the line
        pick = np.sign(gap)
        ok = (cover != 0) & (gap != 0)
        s["ats"] = {"n": int(ok.sum()), "pct": round(float((np.sign(cover[ok]) == pick[ok]).mean()), 3)}
    tl = bt[bt["total"].notna()]
    if len(tl) >= 200:
        gap, miss = tl["t"] - tl["total"], tl["at"] - tl["total"]
        s["k_total"] = float(np.clip((gap * miss).sum() / max((gap * gap).sum(), 1e-9), 0, 1))
        s["sd_total"] = float((miss - s["k_total"] * gap).std())
        ok = (miss != 0) & (gap != 0)
        s["ou"] = {"n": int(ok.sum()), "pct": round(float((np.sign(miss[ok]) == np.sign(gap[ok])).mean()), 3)}
    return s


def tune(g, season, sport):
    """Try a few recency and shrinkage settings on last season; keep the one with the smallest margin error."""
    base = CFG[sport]
    best = None
    for half in (base["half"] * 0.5, base["half"], base["half"] * 2):
        for lam in (1.0, 3.0, 10.0):
            bt = walk_forward(g, season, sport, half, lam)
            if bt is None or len(bt) < 100:
                continue
            s = score(bt)
            print(f"  {sport} backtest {season}: half-life {half:.0f}d, shrink {lam}: MAE {s['mae']}, winners {s['winner']}")
            if best is None or s["mae"] < best[2]["mae"]:
                best = (half, lam, s)
    return best


# ---------------------------------------------------------------- upcoming games from ESPN
def espn(path):
    return json.loads(fetch(ESPN + path, tries=2, timeout=30))


def american(v):
    try:
        n = int(float(str(v).replace("+", "")))
    except (TypeError, ValueError):
        return None
    return n if abs(n) >= 100 else None


def parse_odds(o, h, a):
    """ESPN's odds block -> the home team's spread, the total and both moneylines."""
    if not o:
        return None
    spread = None
    det = str(o.get("details") or "").strip()
    if det.upper() in ("EVEN", "PK", "PICK", "PICK'EM"):
        spread = 0.0
    else:
        m = re.match(r"^(\S+)\s+([+-]?\d+(?:\.\d+)?)$", det)
        if m and m.group(1) in (h, a):
            v = float(m.group(2))
            spread = v if m.group(1) == h else -v
    if spread is None and isinstance(o.get("spread"), (int, float)):
        sp = float(o["spread"])
        if (o.get("awayTeamOdds") or {}).get("favorite"):
            sp = abs(sp)
        elif (o.get("homeTeamOdds") or {}).get("favorite"):
            sp = -abs(sp)
        spread = sp

    def ml(side):
        v = (o.get(f"{side}TeamOdds") or {}).get("moneyLine")
        if v is None:
            v = (((o.get("moneyline") or {}).get(side) or {}).get("close") or {}).get("odds")
        return american(v)

    total = o.get("overUnder")
    total = float(total) if isinstance(total, (int, float)) and total > 0 else None
    out = {"spread": spread, "total": total, "mlH": ml("home"), "mlA": ml("away")}
    return out if any(v is not None for v in out.values()) else None


def team_row(t):
    return [t.get("abbreviation") or "", t.get("location") or t.get("shortDisplayName") or "", t.get("name") or "", t.get("shortDisplayName") or ""]


def upcoming_espn(sport):
    """Games that haven't started in the next few days, with the book's line when ESPN shows one."""
    c = CFG[sport]
    games, teams = {}, {}
    for d in range(c["days"]):
        day = (TODAY + timedelta(days=d)).strftime("%Y%m%d")
        data = espn(f"{c['path']}/scoreboard?dates={day}&groups={c['groups']}&limit=500")
        for ev in data.get("events") or []:
            comp = (ev.get("competitions") or [{}])[0]
            cs = comp.get("competitors") or []
            home = next((x for x in cs if x.get("homeAway") == "home"), None)
            away = next((x for x in cs if x.get("homeAway") == "away"), None)
            state = ((comp.get("status") or ev.get("status") or {}).get("type") or {}).get("state")
            if not home or not away or state not in (None, "pre"):
                continue
            ht, at = home.get("team") or {}, away.get("team") or {}
            for t in (ht, at):
                if t.get("abbreviation"):
                    teams[t["abbreviation"]] = team_row(t)
            games[str(ev.get("id"))] = {"id": str(ev.get("id")), "start": ev.get("date") or comp.get("date"),
                                        "home": ht.get("abbreviation"), "away": at.get("abbreviation"),
                                        "neutral": bool(comp.get("neutralSite")),
                                        "line": parse_odds((comp.get("odds") or [None])[0], ht.get("abbreviation"), at.get("abbreviation"))}
    return list(games.values()), teams


def espn_teams(sport):
    c = CFG[sport]
    data = espn(f"{c['path']}/teams?limit=1000&groups={c['groups']}")
    rows = {}
    for sp in data.get("sports") or []:
        for lg in sp.get("leagues") or []:
            for t in lg.get("teams") or []:
                t = t.get("team") or t
                if t.get("abbreviation"):
                    rows[t["abbreviation"]] = team_row(t)
    return rows


def upcoming_schedule(sport, cur):
    """Fallback without ESPN: the next few days from the SportsDataverse schedule, with no lines."""
    end = (TODAY + timedelta(days=CFG[sport]["days"])).isoformat()
    if sport == "cfb":
        s = sdv("cfb_schedules", f"cfb_schedules_{cur}")
        if s is None:
            return []
        abbr = {}
        for side in ("home", "away"):
            abbr.update({i: a for i, a in zip(s[f"{side}_id"], s[f"{side}_abbreviation"]) if isinstance(a, str)})
        for side in ("home", "away"):
            s[f"{side}_abbreviation"] = s[f"{side}_abbreviation"].fillna(s[f"{side}_id"].map(abbr))
        s = s[~s["completed"].fillna(False).astype(bool)]
        rows = zip(s["game_id"], s["start_date"].astype(str), eastern_date(s["start_date"]), s["home_abbreviation"], s["away_abbreviation"], s["neutral_site"].fillna(False))
    else:
        s = sdv("espn_mens_college_basketball_schedules", f"mbb_schedule_{cur}")
        if s is None:
            return []
        s = s[s["status_type_completed"] == False]  # noqa: E712
        rows = zip(s["game_id"], s["start_date"].astype(str), s["game_date"].astype(str).str[:10], s["home_abbreviation"], s["away_abbreviation"], s["neutral_site"].fillna(False))
    out = []
    for gid, start, d, h, a, n in rows:
        if TODAY.isoformat() <= d < end and isinstance(h, str) and isinstance(a, str):
            out.append({"id": str(gid), "start": start, "home": h, "away": a, "neutral": bool(n), "line": None})
    return out


# ---------------------------------------------------------------- build
def build(sport, check=False):
    if sport == "cfb":
        cur = TODAY.year if TODAY.month >= 3 else TODAY.year - 1        # football seasons are named by the year they start
        g, rated = cfb_results(cur)
        names = {cur - 1: str(cur - 1), cur: str(cur)}
    else:
        cur = TODAY.year + 1 if TODAY.month >= 9 else TODAY.year        # basketball seasons by the year they end
        g, rated = cbb_results(cur)
        names = {cur - 1: f"{cur - 2}-{str(cur - 1)[2:]}", cur: f"{cur - 1}-{str(cur)[2:]}"}
    print(f"{sport}: {len(g)} past games, {len(rated)} rated teams")
    best = tune(g, cur - 1, sport)
    if best is None:
        raise RuntimeError(f"{sport}: not enough games to backtest")
    half, lam, s = best
    R = Ratings(g, TODAY.isoformat(), half, lam)
    print(f"{sport}: picked half-life {half:.0f}d, shrink {lam}; home edge {R.hfa:.2f}; trust vs book {s['k']:.2f} (totals {s['k_total']:.2f}); "
          f"sd {s['sd']:.1f} (totals {s['sd_total']:.1f}); ATS {s.get('ats')}; O/U {s.get('ou')}")

    teams = {}
    try:
        teams = espn_teams(sport)
    except Exception as e:
        print(f"{sport}: ESPN team list unavailable ({str(e)[:80]})", file=sys.stderr)
    try:
        games, seen = upcoming_espn(sport)
        teams.update({k: v for k, v in seen.items() if k not in teams})
        src = "ESPN"
    except Exception as e:
        print(f"{sport}: ESPN scoreboard unavailable ({str(e)[:80]}), using the schedule without lines", file=sys.stderr)
        games, src = upcoming_schedule(sport, cur), "schedule"
    for gm in games:
        m, t = R.predict(gm["home"], gm["away"], gm["neutral"])
        gm["m"], gm["t"] = r1(m), r1(t)
    games.sort(key=lambda x: (x["start"] or "", x["id"]))

    ranked = sorted((t for t in R.ix if t != OTHER), key=lambda t: -R.rating(t))
    rank = {t: i + 1 for i, t in enumerate(ranked)}
    for t in ranked:
        teams.setdefault(t, [t, t, "", t])
    team_rows = [row + [r1(R.rating(k)) if k in R.ix else None, rank.get(k)] for k, row in sorted(teams.items())]
    played = g[g["season"] == cur]
    out = {
        "sport": sport, "updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "date": TODAY.isoformat(),
        "season": names[cur], "games_this_season": int(len(played)), "source": src,
        "model": {"hfa": r1(R.hfa), "sd": r1(s["sd"]), "sd_total": r1(s["sd_total"]), "k": round(s["k"], 2), "k_total": round(s["k_total"], 2),
                  "half_life": int(half), "shrink": lam},
        "backtest": {"season": names[cur - 1], **{k: v for k, v in s.items() if k not in ("sd", "sd_total", "k", "k_total")}},
        "teams": team_rows, "games": games,
    }
    lined = sum(1 for x in games if x["line"] and x["line"].get("spread") is not None)
    top = ", ".join(f"{t} {R.rating(t):+.1f}" for t in ranked[:5])
    print(f"{sport}: {len(games)} upcoming games from {src} ({lined} with a book spread), {len(team_rows)} teams; top: {top}")
    for x in games[:3]:
        print(f"  {x['start']} {x['away']} at {x['home']}: model margin {x['home']} {x['m']}, total {x['t']}, book {x['line']}")
    if check:
        return out
    os.makedirs(os.path.join(DATA, "props", sport), exist_ok=True)
    with open(os.path.join(DATA, "props", sport, "games.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    return out


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    failures = 0
    todo = args or list(CFG)
    for sport in todo:
        try:
            build(sport, check)
        except Exception as e:
            failures += 1
            import traceback; traceback.print_exc()
            print(f"{sport} games: FAILED, kept previous data. {e}", file=sys.stderr)
    sys.exit(1 if failures and (check or failures == len(todo)) else 0)
