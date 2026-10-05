#!/usr/bin/env python3
"""
Trade Scale trained prop model.

Learns, from every past game in the props data, how much each factor (recent form, the line, the opponent,
home/away, rest, role, game script) actually moves the chance that a player clears a line. One LightGBM model
per sport, trained on point-in-time features: every number for a game is computed only from games before it.

Reads what the props builders wrote and adds to it:
  site/data/props/<sport>/p/<id>.json   "ml": for each prop, the model's chance of the Over at a grid of lines
                                          for the next game, plus what pushed the chance up or down
  site/data/props/<sport>/model.json    when it was trained, how it did on games it never saw (vs the formula
                                          model on the page), and which factors mattered most

Validation is a time split: the model trains on older games and is scored on the most recent ones, next to the
page's hand-tuned formula (ported below, without the NFL scheme step, which needs play-by-play). A sport only
ships its model if it beats the formula on those held-out games; otherwise the page keeps the formula.

Run after update_props.py and update_props_more.py. Needs pandas, numpy and lightgbm.
Run: python scripts/train_props_model.py            (all sports with props data)
     python scripts/train_props_model.py nba nhl    (some)
"""
import json, math, os, sys, warnings
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROPS = os.path.join(ROOT, "site", "data", "props")
RNG = np.random.default_rng(7)

# Mirrors CFG in site/assets/props.js: the props offered per position group and how each is priced.
NBA_ALL = ["pts", "reb", "ast", "pts+reb+ast", "pts+reb", "pts+ast", "reb+ast", "fg3", "stl", "blk", "stl+blk", "tov", "min"]
UFC_ALL = ["win", "ko", "sub", "dec", "dist", "rnd", "sig", "tdl", "kd"]
SPORTS = {
    "nfl": {"props": {"QB": ["pyd", "ptd", "cmp", "att", "int", "ruyd", "pyd+ruyd", "td", "ppr"],
                      "RB": ["ruyd", "car", "ruyd+reyd", "rec", "reyd", "td", "ppr"],
                      "WR": ["reyd", "rec", "tgt", "ruyd+reyd", "td", "ppr"],
                      "TE": ["reyd", "rec", "tgt", "td", "ppr"]},
            "count": ["ptd", "int", "td", "rutd", "retd", "rec", "tgt"], "floats": ["ppr"],
            "cv": {"pyd": .32, "att": .2, "cmp": .24, "ruyd": .5, "reyd": .62, "rec": .45, "tgt": .4, "car": .3, "ppr": .45},
            "disp": {}, "K": 4, "damp": (0.6, 0.3), "rest": None, "usage": ["tgt", "car", "att"]},
    "nba": {"props": {"G": NBA_ALL, "F": NBA_ALL, "C": NBA_ALL},
            "count": ["fg3", "stl", "blk", "tov"], "floats": ["min"],
            "cv": {"pts": .32, "reb": .4, "ast": .45, "min": .18, "pts+reb+ast": .27, "pts+reb": .29, "pts+ast": .3, "reb+ast": .35},
            "disp": {}, "K": 8, "damp": (0.4, 0.15),
            "rest": (0.96, ["pts", "reb", "ast", "fg3", "min", "stl", "blk", "tov"]), "usage": ["min"]},
    "nhl": {"props": {"F": ["sog", "pts", "g", "a", "hit", "blk", "ppg", "toi"], "D": ["sog", "blk", "pts", "a", "hit", "toi"],
                      "G": ["sv", "ga", "sa"]},
            "count": ["g", "a", "pts", "sog", "hit", "blk", "ppg", "ga"], "floats": ["toi"],
            "cv": {"sv": .22, "sa": .2, "toi": .15}, "disp": {}, "K": 8, "damp": (0.5, 0.2),
            "rest": (0.97, ["sog", "pts", "g", "a", "hit", "blk", "toi"]), "usage": ["toi"]},
    "mlb": {"props": {"H": ["h", "tb", "h+r+rbi", "hr", "rbi", "r", "bb", "so", "sb"],
                      "SP": ["k", "outs", "er", "ha", "bba", "pc"], "RP": ["k", "outs", "ha"]},
            "count": ["h", "tb", "hr", "rbi", "r", "bb", "so", "sb", "k", "er", "ha", "bba"], "floats": [],
            "cv": {"outs": .22, "pc": .14}, "disp": {"tb": 1.9, "h+r+rbi": 1.5, "rbi": 1.4, "r": 1.2, "er": 1.4, "ha": 1.2, "k": 1.15},
            "K": 15, "damp": (0.5, 0.2), "rest": None, "usage": ["pc"]},
    "cfb": {"props": {"QB": ["pyd", "ptd", "cmp", "att", "int", "ruyd", "pyd+ruyd", "td"],
                      "RB": ["ruyd", "car", "ruyd+reyd", "rec", "reyd", "td"],
                      "WR": ["reyd", "rec", "ruyd+reyd", "td"],
                      "TE": ["reyd", "rec", "td"]},
            "count": ["ptd", "int", "td", "rutd", "retd", "rec"], "floats": [],
            "cv": {"pyd": .35, "att": .22, "cmp": .26, "ruyd": .55, "reyd": .65, "rec": .45, "car": .32},
            "disp": {}, "K": 4, "damp": (0.6, 0.3), "rest": None, "usage": ["car", "rec", "att"]},
    "cbb": {"props": {"G": NBA_ALL, "F": NBA_ALL, "C": NBA_ALL},
            "count": ["fg3", "stl", "blk", "tov"], "floats": ["min"],
            "cv": {"pts": .36, "reb": .42, "ast": .5, "min": .2, "pts+reb+ast": .3, "pts+reb": .32, "pts+ast": .33, "reb+ast": .38},
            "disp": {}, "K": 8, "damp": (0.4, 0.15), "rest": None, "usage": ["min"]},
    "ufc": {"props": {d: UFC_ALL for d in ("FLY", "BW", "FW", "LW", "WW", "MW", "LHW", "HW", "WSW", "WFLY", "WBW", "WFW")},
            "count": ["win", "ko", "sub", "dec", "dist", "tdl", "kd"], "binary": ["win", "ko", "sub", "dec", "dist"],
            "floats": ["rnd"], "max_default": {"rnd": 2.5},
            "cv": {"sig": .6, "rnd": .4}, "disp": {"tdl": 1.8, "kd": 1.3}, "K": 3, "damp": (0.5, 0.25), "rest": None, "usage": ["rnd"]},
}

# Features, grouped into the plain-language factors the page shows.
GROUPS = {
    "Recent form": ["form_p", "base", "sd", "l5", "l10", "l20", "med10", "cur_mean", "prev_mean", "zero20"],
    "The line vs his history": ["line", "line_gap", "line_ratio", "hit10", "hit20", "hit_w"],
    "Opponent": ["opp_ratio", "opp_n"],
    "Home or away": ["home"],
    "Rest and schedule": ["rest", "gap", "post"],
    "Role and minutes": ["use_l5", "use_trend", "starter", "n_prior", "cur_n"],
    "Game script": ["sp", "total", "imp", "dome", "div"],
    "Fight length": ["sched"],
    "Prop type": ["stat"],
}
FEATURES = [f for fs in GROUPS.values() for f in fs]
GROUP_OF = {f: g for g, fs in GROUPS.items() for f in fs}
# The chance of the Over can only go down as the line goes up.
MONOTONE = {"line": -1, "line_gap": -1, "line_ratio": -1, "form_p": 1, "hit10": 1, "hit20": 1, "hit_w": 1}
MIN_PRIOR = 3          # same as the page: no projection with fewer than 3 games


def components(key):
    return ["rutd", "retd"] if key == "td" else key.split("+")


def is_count(cfg, key):
    return key == "td" or all(c in cfg["count"] for c in components(key))


# ---------------------------------------------------------------- the page's probability math, vectorized
def erf(x):   # Abramowitz-Stegun 7.1.26, same as props.js
    t = 1 / (1 + 0.3275911 * np.abs(x))
    y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-x * x)
    return np.where(x >= 0, y, -y)


def phi(z):
    return 0.5 * (1 + erf(z / math.sqrt(2)))


def count_cdf(k, mu, disp):
    """P(X <= k): negative binomial with variance disp * mu, Poisson when disp is ~1. Vectorized over rows."""
    k = np.asarray(k, float); mu = np.maximum(np.asarray(mu, float), 1e-9); disp = np.asarray(disp, float)
    kmax = int(np.nanmax(k)) if k.size else 0
    pois = disp <= 1.02
    r = np.where(pois, 1.0, mu / np.maximum(disp - 1, 1e-9))
    q = mu / (r + mu)
    p = np.where(pois, np.exp(-mu), np.power(r / (r + mu), r))
    s = np.where(k >= 0, p, 0.0)
    for i in range(kmax):
        p = np.where(pois, p * mu / (i + 1), p * (i + r) / (i + 1) * q)
        s = s + np.where(i + 1 <= k, p, 0.0)
    return np.minimum(1, s)


def prob_over(mu, sd, line, count, disp, binary=None):
    """P(stat > line), matching probOver() in props.js for the half-point lines the model is trained on.
    Yes/no stats (a UFC win, a KO) are 1 with chance mu, so only a line under 1 can go over."""
    mu, sd, line, count, disp = (np.asarray(a, float) for a in (mu, sd, line, count, disp))
    out = np.empty(mu.shape)
    b = np.zeros(mu.shape, bool) if binary is None else np.asarray(binary, bool) & np.ones(mu.shape, bool)
    if b.any():
        out[b] = np.where(line[b] < 1, np.clip(mu[b], 0.05, 0.95), 0.0)
    c = count.astype(bool) & ~b
    if c.any():
        out[c] = 1 - count_cdf(np.floor(line[c]), mu[c], disp[c])
    n = ~c & ~b
    if n.any():
        hi = np.floor(line[n]) + 0.5
        out[n] = 1 - phi((hi - mu[n]) / sd[n])
    return np.clip(out, 1e-4, 1 - 1e-4)


# ---------------------------------------------------------------- load what the builders wrote
def load(sport):
    d = os.path.join(PROPS, sport)
    index = json.load(open(os.path.join(d, "index.json"), encoding="utf-8"))
    docs, rows = {}, []
    for name in os.listdir(os.path.join(d, "p")):
        doc = json.load(open(os.path.join(d, "p", name), encoding="utf-8"))
        pid, grp = doc["id"], doc.get("grp") or doc["pos"]
        docs[pid] = doc
        for i, g in enumerate(doc["log"]):
            if not g.get("d") or g.get("x") is None:
                continue
            rows.append({"pid": pid, "grp": grp, "i": i, "s": int(g["s"]), "d": g["d"], "o": g.get("o"), "tm": g.get("tm"),
                         "home": g.get("h"), "rest": g.get("rs"), "post": g.get("post", 0), "st": g.get("st"),
                         "sp": g.get("sp"), "total": g.get("t"), "dome": None if g.get("r") is None else int(g.get("r") == "dome"),
                         "div": g.get("dv"), "sched": g.get("sr"), **{f"x_{k}": v for k, v in g["x"].items()}})
    G = pd.DataFrame(rows)
    stats = sorted(c[2:] for c in G.columns if c.startswith("x_"))
    for k in stats:
        G[k] = pd.to_numeric(G.pop(f"x_{k}"), errors="coerce").fillna(0.0)
    G = G.sort_values(["pid", "d", "i"]).reset_index(drop=True)
    return index, docs, G, stats


# ---------------------------------------------------------------- opponent strength, point in time
def opponent_tables(G, stats, K):
    """What each opponent allows per game to each position group, using only earlier games: this season so far,
    blended with last season's average as K games of prior evidence (the builders' recipe). Also the league average."""
    tg = G.groupby(["grp", "o", "s", "d"])[stats].sum().reset_index().sort_values(["grp", "o", "s", "d"]).reset_index(drop=True)
    by = tg.groupby(["grp", "o", "s"])
    cs = by[stats].cumsum() - tg[stats]
    cn = by.cumcount()
    season_mean = by[stats].mean()
    league_prev = tg.groupby(["grp", "s"])[stats].mean()
    n_teams = max(1, tg["o"].nunique())
    lg_day = tg.groupby(["grp", "s", "d"])[stats].agg(["sum", "count"])
    return {"tg": tg, "cs": cs, "cn": cn, "season_mean": season_mean, "league_prev": league_prev, "lg_day": lg_day,
            "K": K, "n_teams": n_teams, "stats": stats}


def _prior(T, grp, opp, season):
    sm, lp = T["season_mean"], T["league_prev"]
    if (grp, opp, season - 1) in sm.index:
        return sm.loc[(grp, opp, season - 1)].to_numpy(float)
    if (grp, season - 1) in lp.index:
        return lp.loc[(grp, season - 1)].to_numpy(float)
    return None


def opponent_features(G, T):
    """Per player-game: the opponent's blended allowance and the league's, per stat, as of the morning of the game."""
    stats, K = T["stats"], T["K"]
    tg = T["tg"]
    key = pd.MultiIndex.from_frame(tg[["grp", "o", "s", "d"]])
    pos = pd.Series(np.arange(len(tg)), index=key)
    rows = pos.reindex(pd.MultiIndex.from_frame(G[["grp", "o", "s", "d"]])).to_numpy()
    cs, cn = T["cs"].to_numpy(float), T["cn"].to_numpy(float)
    opp = np.full((len(G), len(stats)), np.nan)
    n_ev = np.zeros(len(G))
    prior_cache = {}
    for j, (grp, o, s, r) in enumerate(zip(G["grp"], G["o"], G["s"], rows)):
        if r != r:   # not found
            continue
        r = int(r)
        pk = (grp, o, s)
        if pk not in prior_cache:
            prior_cache[pk] = _prior(T, grp, o, s)
        pv = prior_cache[pk]
        k = K if pv is not None else 0
        n = cn[r]
        if n + k > 0:
            opp[j] = (cs[r] + (pv * k if pv is not None else 0)) / (n + k)
        n_ev[j] = n
    # league: every team-game of this group earlier this season, blended with last season
    lg = np.full((len(G), len(stats)), np.nan)
    day = T["lg_day"]
    for (grp, s), sub in day.groupby(level=[0, 1]):
        sums = sub.xs("sum", axis=1, level=1)[stats].to_numpy(float)
        cnts = sub.xs("count", axis=1, level=1)[stats[0]].to_numpy(float)
        csum = np.cumsum(sums, axis=0) - sums
        ccnt = np.cumsum(cnts) - cnts
        lp = T["league_prev"].loc[(grp, s - 1)].to_numpy(float) if (grp, s - 1) in T["league_prev"].index else None
        k = K * T["n_teams"] if lp is not None else 0
        vals = (csum + (lp * k if lp is not None else 0)) / np.maximum(ccnt + k, 1e-9)[:, None]
        vals[(ccnt + k) == 0] = np.nan
        days = sub.index.get_level_values(2)
        m = (G["grp"] == grp) & (G["s"] == s)
        idx = np.searchsorted(np.asarray(days), G.loc[m, "d"].to_numpy())
        lg[m.to_numpy()] = vals[np.minimum(idx, len(days) - 1)]
    return opp, lg, n_ev


def opponent_now(T, grp, opp, season):
    """The same blend as of today, for the next game."""
    stats, K, tg = T["stats"], T["K"], T["tg"]
    cur = tg[(tg["grp"] == grp) & (tg["o"] == opp) & (tg["s"] == season)]
    pv = _prior(T, grp, opp, season)
    k = K if pv is not None else 0
    n = len(cur)
    o = (cur[stats].sum().to_numpy(float) + (pv * k if pv is not None else 0)) / (n + k) if n + k else np.full(len(stats), np.nan)
    lcur = tg[(tg["grp"] == grp) & (tg["s"] == season)]
    lp = T["league_prev"].loc[(grp, season - 1)].to_numpy(float) if (grp, season - 1) in T["league_prev"].index else None
    kl = K * T["n_teams"] if lp is not None else 0
    nl = len(lcur)
    l = (lcur[stats].sum().to_numpy(float) + (lp * kl if lp is not None else 0)) / (nl + kl) if nl + kl else np.full(len(stats), np.nan)
    return o, l, n


# ---------------------------------------------------------------- features
def line_step(base):
    return float(max(1, round(0.05 * base)))


def default_line(med10):
    """The page's default line: the median of his last 10 games, rounded down to a half point."""
    return np.maximum(0.5, np.floor(np.nan_to_num(med10)) + 0.5)


def nanmedian_rows(A):
    """Row medians ignoring NaN (np.nanmedian is slow on many small rows)."""
    cnt = (~np.isnan(A)).sum(1)
    S = np.sort(np.where(np.isnan(A), np.inf, A), axis=1)
    lo = np.take_along_axis(S, np.maximum((cnt - 1) // 2, 0)[:, None], 1)[:, 0]
    hi = np.take_along_axis(S, np.maximum(cnt // 2, 0)[:, None], 1)[:, 0]
    with np.errstate(invalid="ignore"):
        return np.where(cnt > 0, (lo + hi) / 2, np.nan)


def player_history(vals, seasons, target_season):
    """For each game i (and one more for the next game), summaries of games 0..i-1 only. Row i treats game i's
    season as "this season"; the extra last row uses target_season."""
    n = len(vals)
    out = {}
    ii = np.arange(n + 1)[:, None]
    jj = np.arange(n)[None, :]
    prior = jj < ii
    tseason = np.append(seasons, target_season)[:, None]
    w = np.where(prior, np.power(0.88, np.maximum(ii - 1 - jj, 0)) * np.power(0.6, tseason - seasons[None, :]), 0.0)
    W = w.sum(1)
    with np.errstate(invalid="ignore", divide="ignore"):
        base = (w @ vals) / W
        var = np.maximum((w @ (vals ** 2)) / W - base ** 2, 0)
    out["base"], out["var"], out["W"], out["w"] = base, var, W, w
    pad = np.concatenate([np.full(20, np.nan), vals])
    L20 = np.stack([pad[i:i + 20] for i in range(n + 1)])            # the 20 games before game i
    out["L20"] = L20
    with np.errstate(invalid="ignore"), warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        out["l5"] = np.nanmean(L20[:, -5:], 1)
        out["l10"] = np.nanmean(L20[:, -10:], 1)
        out["l20"] = np.nanmean(L20, 1)
        out["med10"] = nanmedian_rows(L20[:, -10:])
        out["zero20"] = np.nanmean(np.where(np.isnan(L20), np.nan, L20 == 0), 1)
    cur = prior & (seasons[None, :] == tseason)
    prev = prior & (seasons[None, :] == tseason - 1)
    with np.errstate(invalid="ignore", divide="ignore"):
        out["cur_n"] = cur.sum(1).astype(float)
        out["cur_mean"] = np.where(out["cur_n"] > 0, (cur * vals).sum(1) / out["cur_n"], np.nan)
        pn = prev.sum(1)
        out["prev_mean"] = np.where(pn > 0, (prev * vals).sum(1) / pn, np.nan)
    out["n_prior"] = ii[:, 0].astype(float)
    return out


def build_rows(sport, cfg, index, docs, G, stats, T, opp, lg, n_ev, serving_season, train=True):
    """Training rows (every past game, a few lines each) when train=True, else rows for each player's next game
    across a grid of lines."""
    damp, cap = cfg["damp"]
    S = {k: i for i, k in enumerate(stats)}
    avg_team_total = None
    if sport == "nfl":
        tt = G["total"].dropna()
        avg_team_total = float(tt.mean() / 2) if len(tt) else 22.5
    out = []
    for pid, P in G.groupby("pid", sort=False):
        grp = P["grp"].iat[0]
        keys = cfg["props"].get(grp) or next(iter(cfg["props"].values()))
        n = len(P)
        seasons = P["s"].to_numpy(int)
        dates = pd.to_datetime(P["d"]).to_numpy()
        doc = docs[pid]
        ng = (index.get("next") or {}).get(doc["team"]) if not train else None
        if not train and not ng:
            continue
        tseason = serving_season if not train else None
        # context for each row (past games, or the next game)
        if train:
            ctx = {c: P[c].to_numpy(float) for c in ("home", "rest", "post", "sp", "total", "dome", "div", "sched")}
            gap = np.append(np.nan, np.diff(dates).astype("timedelta64[D]").astype(float))
            o_allow, l_allow, oev = opp[P.index], lg[P.index], n_ev[P.index]
        else:
            next_date = np.datetime64(ng["date"])
            ctx = {"home": np.array([float(ng["home"]) if ng.get("home") is not None else np.nan]), "rest": np.array([ng.get("rest", np.nan) if ng.get("rest") is not None else np.nan], float),
                   "post": np.array([0.0]), "sp": np.array([ng.get("sp") if ng.get("sp") is not None else np.nan], float),
                   "total": np.array([ng.get("t") if ng.get("t") is not None else np.nan], float),
                   "dome": np.array([float(ng.get("roof") == "dome") if ng.get("roof") else np.nan]),
                   "div": np.array([float(ng.get("div", np.nan)) if ng.get("div") is not None else np.nan]),
                   "sched": np.array([float(ng["sr"]) if ng.get("sr") is not None else np.nan])}
            gap = np.array([(next_date - dates[-1]).astype("timedelta64[D]").astype(float)])
            o_now, l_now, oev_now = opponent_now(T, grp, ng["opp"], tseason)
            o_allow, l_allow, oev = o_now[None, :], l_now[None, :], np.array([float(oev_now)])
        rows_idx = np.arange(n) if train else np.array([n])
        st = P["st"].to_numpy(float)
        use_keys = [u for u in cfg["usage"] if u in S]
        use_vals = P[use_keys].sum(axis=1).to_numpy(float) if use_keys else np.zeros(n)
        use_h = player_history(use_vals, seasons, seasons[-1] if train else tseason)
        st_pad = np.concatenate([np.full(10, np.nan), st])
        starter = np.array([np.nanmean(st_pad[i:i + 10]) if np.isfinite(st_pad[i:i + 10]).any() else np.nan for i in range(n + 1)])
        for key in keys:
            comps = components(key)
            if any(c not in S for c in comps):
                continue
            vals = P[comps].sum(axis=1).to_numpy(float)
            H = player_history(vals, seasons, seasons[-1] if train else tseason)
            sel = rows_idx[H["n_prior"][rows_idx] >= MIN_PRIOR]
            if not len(sel):
                continue
            count = is_count(cfg, key)
            binary = key in cfg.get("binary", ())
            base, var = H["base"][sel], H["var"][sel]
            nprior = H["n_prior"][sel]
            # hand model: per-component base x opponent x schedule/script, as in project() on the page
            mu_hand = np.zeros(len(sel))
            num = np.zeros(len(sel)); den = np.zeros(len(sel))
            ci = sel if train else np.zeros(len(sel), int)
            for c in comps:
                vc = P[c].to_numpy(float)
                Hc = player_history(vc, seasons, seasons[-1] if train else tseason)
                bc = Hc["base"][sel]
                oa, la = o_allow[ci, S[c]], l_allow[ci, S[c]]
                with np.errstate(invalid="ignore", divide="ignore"):
                    raw = np.where((la > 0) & np.isfinite(oa), oa / la, 1.0)
                f_opp = np.clip(1 + (raw - 1) * damp, 1 - cap, 1 + cap)
                f_scr = np.ones(len(sel))
                if cfg["rest"] and c in cfg["rest"][1]:
                    f_scr = np.where(ctx["rest"][ci] == 0, cfg["rest"][0], 1.0)
                if sport == "nfl":
                    sp_ = np.nan_to_num(ctx["sp"][ci]); tot = ctx["total"][ci]
                    imp = (tot + sp_) / 2
                    R = np.where(np.isfinite(imp), imp / avg_team_total, 1.0)
                    spx = np.where(np.isfinite(tot), sp_, 0.0)
                    if c in ("ptd", "rutd", "retd"):
                        f = np.power(R, 0.8)
                    elif c in ("car", "ruyd"):
                        f = 1 + 0.012 * spx
                    elif c in ("att", "cmp", "pyd", "rec", "reyd", "tgt"):
                        f = (1 - 0.006 * spx) * np.power(R, 0.35)
                    elif c == "ppr":
                        f = np.power(R, 0.5)
                    else:
                        f = np.ones(len(sel))
                    f_scr = np.clip(f, 0.85, 1.2)
                mu_hand += bc * f_opp * f_scr
                num += np.nan_to_num(oa); den += np.nan_to_num(la)
            with np.errstate(invalid="ignore", divide="ignore"):
                opp_ratio = np.where(den > 0, num / den, np.nan)
            cv = cfg["cv"].get(key, 0.42 if "+" in key else 0.5)
            sd_hand = np.maximum(0.5, np.sqrt((nprior * var + 6 * (cv * mu_hand) ** 2) / (nprior + 6)))
            sd_form = np.maximum(0.5, np.sqrt((nprior * var + 6 * (cv * base) ** 2) / (nprior + 6)))
            with np.errstate(invalid="ignore", divide="ignore"):
                d_emp = np.where(base > 0, var / base, 1.0)
            d0 = cfg["disp"].get(key, 1.15)
            disp = np.maximum(1, (nprior * d_emp + 10 * d0) / (nprior + 10))
            # lines
            dl = np.full(len(sel), 0.5) if key == "td" or binary else default_line(H["med10"][sel])
            if key in cfg.get("max_default", {}):
                dl = np.minimum(dl, cfg["max_default"][key])
            if train:
                lines = [dl]
                if key != "td" and not binary:
                    step = np.array([line_step(b) for b in base])
                    off = RNG.choice([-3, -2, -1, 1, 2, 3], size=len(sel))
                    lines.append(np.maximum(0.5, dl + off * step))
                grid = None
            else:
                if binary:
                    grid = np.array([0.5])
                elif key == "td":
                    grid = np.array([0.5, 1.5, 2.5])
                else:
                    step = line_step(base[0])
                    grid = np.unique(np.maximum(0.5, dl[0] + step * np.arange(-14, 15)))
                lines = [np.full(len(sel), g) for g in grid]
            for li, line in enumerate(lines):
                L = H["L20"][sel]
                with np.errstate(invalid="ignore"), warnings.catch_warnings():
                    warnings.simplefilter("ignore", RuntimeWarning)
                    over = np.where(np.isnan(L), np.nan, L > line[:, None])
                    hit10 = np.nanmean(over[:, -10:], 1)
                    hit20 = np.nanmean(over, 1)
                wsel = H["w"][sel]
                # weighted hit rate over all his earlier games
                prior_vals = vals[None, :]
                hw = (wsel * (prior_vals > line[:, None])).sum(1) / np.maximum(H["W"][sel], 1e-9)
                f = {
                    "pid": pid, "key": key, "default": li == 0 if train else np.isclose(line, dl),
                    "row": sel if train else np.full(len(sel), -1),
                    "d": P["d"].to_numpy()[sel] if train else np.full(len(sel), ng["date"]),
                    "y": (vals[sel] > line).astype(float) if train else np.full(len(sel), np.nan),
                    "push": (vals[sel] == line) if train else np.zeros(len(sel), bool),
                    "stat": key, "line": line, "line_gap": line - base, "line_ratio": line / (base + 0.25),
                    "form_p": prob_over(base, sd_form, line, np.full(len(sel), count), disp, binary),
                    "hand_p": prob_over(mu_hand, sd_hand, line, np.full(len(sel), count), disp, binary),
                    "mu_hand": mu_hand, "base": base, "sd": np.sqrt(var), "l5": H["l5"][sel], "l10": H["l10"][sel],
                    "l20": H["l20"][sel], "med10": H["med10"][sel], "cur_mean": H["cur_mean"][sel], "prev_mean": H["prev_mean"][sel],
                    "zero20": H["zero20"][sel], "hit10": hit10, "hit20": hit20, "hit_w": hw,
                    "opp_ratio": opp_ratio, "opp_n": oev[ci], "home": ctx["home"][ci], "rest": np.minimum(ctx["rest"][ci], 10),
                    "gap": np.minimum(gap[ci], 30), "post": ctx["post"][ci],
                    "use_l5": use_h["l5"][sel], "use_trend": use_h["l5"][sel] / np.maximum(use_h["l20"][sel], 1e-6),
                    "starter": starter[sel], "n_prior": nprior, "cur_n": H["cur_n"][sel],
                    "sp": ctx["sp"][ci], "total": ctx["total"][ci],
                    "imp": (ctx["total"][ci] + np.nan_to_num(ctx["sp"][ci])) / 2, "dome": ctx["dome"][ci], "div": ctx["div"][ci],
                    "sched": ctx["sched"][ci],
                }
                m = len(sel)
                out.append({c: (v if isinstance(v, np.ndarray) and v.shape == (m,) else np.full(m, v)) for c, v in f.items()})
    if not out:
        return pd.DataFrame()
    D = pd.DataFrame({c: np.concatenate([b[c] for b in out]) for c in out[0]})
    num_cols = [c for c in D.columns if c not in ("pid", "key", "stat", "d", "default", "push")]
    D[num_cols] = D[num_cols].astype("float32")
    return D


# ---------------------------------------------------------------- metrics
def logloss(y, p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def brier(y, p):
    return float(np.mean((p - y) ** 2))


def auc(y, p):
    order = np.argsort(p)
    r = np.empty(len(p)); r[order] = np.arange(1, len(p) + 1)
    pos = y == 1
    npos, nneg = pos.sum(), (~pos).sum()
    return float((r[pos].sum() - npos * (npos + 1) / 2) / max(npos * nneg, 1))


def calibration(y, p, bins=10):
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (p >= lo) & (p < hi)
        if m.sum() >= 30:
            out.append([round(float(lo), 1), round(float(hi), 1), int(m.sum()), round(float(p[m].mean()), 3), round(float(y[m].mean()), 3)])
    return out


def scores(y, p):
    return {"log_loss": round(logloss(y, p), 4), "brier": round(brier(y, p), 4), "auc": round(auc(y, p), 4)}


# ---------------------------------------------------------------- train, validate, ship
PARAMS = {"objective": "binary", "learning_rate": 0.04, "num_leaves": 31, "min_data_in_leaf": 300, "feature_fraction": 0.8,
          "bagging_fraction": 0.8, "bagging_freq": 1, "lambda_l2": 5.0, "verbose": -1, "num_threads": 4, "seed": 7}


def dataset(D, lgb, cats, ref=None):
    X = D[FEATURES].copy()
    X["stat"] = pd.Categorical(X["stat"], categories=cats)
    return X if lgb is None else lgb.Dataset(X, label=D["y"].to_numpy(), categorical_feature=["stat"], reference=ref, free_raw_data=False)


def train_sport(sport, lgb):
    cfg = SPORTS[sport]
    index, docs, G, stats = load(sport)
    if G.empty:
        raise RuntimeError("no games")
    last = pd.to_datetime(G["d"]).max()
    serving_season = int(G["s"].max())
    nd = [v.get("date") for v in (index.get("next") or {}).values() if v.get("date")]
    if nd and (pd.to_datetime(min(nd)) - last).days > 90:   # next game is in a season that hasn't started
        serving_season += 1
    T = opponent_tables(G, stats, cfg["K"])
    opp, lg, n_ev = opponent_features(G, T)
    D = build_rows(sport, cfg, index, docs, G, stats, T, opp, lg, n_ev, serving_season, train=True)
    D = D[~D["push"]].reset_index(drop=True)
    cats = sorted(D["stat"].unique())
    # time split: most recent 20% of game dates are the test set, the 10% before that stops training early
    days = np.sort(D["d"].unique())
    t_test, t_val = days[int(len(days) * 0.8)], days[int(len(days) * 0.7)]
    tr, va, te = D[D["d"] < t_val], D[(D["d"] >= t_val) & (D["d"] < t_test)], D[D["d"] >= t_test]
    mono = [MONOTONE.get(f, 0) for f in FEATURES]
    params = dict(PARAMS, monotone_constraints=mono, monotone_constraints_method="advanced")
    dtr = dataset(tr, lgb, cats)
    dva = dataset(va, lgb, cats, ref=dtr)
    bst = lgb.train(params, dtr, num_boost_round=2000, valid_sets=[dva], callbacks=[lgb.early_stopping(100, verbose=False)])
    best = bst.best_iteration or bst.current_iteration()
    p_ml = bst.predict(dataset(te, None, cats), num_iteration=best)
    y = te["y"].to_numpy()
    dm = te["default"].to_numpy(bool)
    report = {}
    for name, m in (("default_lines", dm), ("all_lines", np.ones(len(te), bool))):
        report[name] = {"n": int(m.sum()), "over_rate": round(float(y[m].mean()), 3),
                        "trained": scores(y[m], p_ml[m]), "formula": scores(y[m], te["hand_p"].to_numpy()[m]),
                        "form_only": scores(y[m], te["form_p"].to_numpy()[m])}
    report["calibration"] = {"trained": calibration(y[dm], p_ml[dm]), "formula": calibration(y[dm], te["hand_p"].to_numpy()[dm])}
    by_stat = {}
    for k in cats:
        m = dm & (te["stat"].to_numpy() == k)
        if m.sum() >= 200:
            by_stat[k] = {"n": int(m.sum()), "trained": round(logloss(y[m], p_ml[m]), 4), "formula": round(logloss(y[m], te["hand_p"].to_numpy()[m]), 4)}
    report["by_stat"] = by_stat
    beats = report["default_lines"]["trained"]["log_loss"] < report["default_lines"]["formula"]["log_loss"] and \
        report["all_lines"]["trained"]["log_loss"] < report["all_lines"]["formula"]["log_loss"]
    dr = report["default_lines"]
    print(f"{sport}: {len(D)} rows ({int(D['default'].sum())} games x props), test {dr['n']} default lines from {t_test}; "
          f"log loss trained {dr['trained']['log_loss']} vs formula {dr['formula']['log_loss']} (form only {dr['form_only']['log_loss']}); "
          f"brier {dr['trained']['brier']} vs {dr['formula']['brier']}; {best} trees")

    # final model on every game, with a few more trees for the extra data
    final = lgb.train(params, dataset(D, lgb, cats), num_boost_round=max(50, int(best * 1.1)))
    gain = final.feature_importance("gain")
    imp = {}
    for f, g in zip(FEATURES, gain):
        imp[GROUP_OF[f]] = imp.get(GROUP_OF[f], 0) + float(g)
    tot = sum(imp.values()) or 1
    importance = sorted(([g, round(v / tot, 3)] for g, v in imp.items() if v > 0), key=lambda r: -r[1])

    # next-game predictions on a grid of lines, written into each player's file
    S = build_rows(sport, cfg, index, docs, G, stats, T, opp, lg, n_ev, serving_season, train=False) if beats else None
    written = 0
    if S is not None and len(S):
        X = dataset(S, None, cats)
        S["p"] = final.predict(X)
        dflt = np.flatnonzero(S["default"].to_numpy(bool))
        contrib = dict(zip(dflt, final.predict(X.iloc[dflt], pred_contrib=True)))   # what moved the chance, at the default line
        for pid, sub in S.groupby("pid", sort=False):
            ml = {}
            for key, k_rows in sub.groupby("key", sort=False):
                k_rows = k_rows.sort_values("line")
                p = np.minimum.accumulate(k_rows["p"].to_numpy())   # never rises with the line
                at = k_rows.index[k_rows["default"].to_numpy(bool)]
                c_row = contrib.get(at[0]) if len(at) else None
                entry = {"l": [round(float(v), 1) for v in k_rows["line"]], "p": [round(float(v), 3) for v in p]}
                if c_row is not None:
                    grp_c = {}
                    for f, v in zip(FEATURES, c_row[:-1]):
                        grp_c[GROUP_OF[f]] = grp_c.get(GROUP_OF[f], 0) + float(v)
                    entry["at"] = round(float(k_rows.loc[at[0], "line"]), 1)
                    entry["c"] = [[g, round(v, 3)] for g, v in sorted(grp_c.items(), key=lambda r: -abs(r[1])) if abs(v) >= 0.005]
                ml[key] = entry
            path = os.path.join(PROPS, sport, "p", f"{pid}.json")
            doc = docs[pid]
            doc["ml"] = ml
            with open(path, "w", encoding="utf-8") as f:
                json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
            written += 1
    meta = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "sport": sport, "used": bool(beats and written),
            "games": int(D["default"].sum()), "player_games": int(D.loc[D["default"], ["pid", "row"]].drop_duplicates().shape[0]), "rows": int(len(D)), "test_from": str(t_test), "trees": int(best),
            "report": report, "importance": importance, "players": written,
            "note": "Formula comparison leaves out the NFL scheme step, which needs play-by-play data." if sport == "nfl" else None}
    with open(os.path.join(PROPS, sport, "model.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    status = "shipped" if meta["used"] else "beat the formula, but no upcoming games to predict" if beats else "kept the formula"
    print(f"{sport}: {status}; predictions for {written} players; top factors {importance[:4]}")


if __name__ == "__main__":
    try:
        import lightgbm as lgb
    except ImportError:
        print("train_props_model: lightgbm not installed, the page keeps the formula model", file=sys.stderr)
        sys.exit(0)
    todo = sys.argv[1:] or [s for s in SPORTS if os.path.exists(os.path.join(PROPS, s, "index.json"))]
    failures = 0
    for sport in todo:
        try:
            train_sport(sport, lgb)
        except Exception as e:
            failures += 1
            import traceback; traceback.print_exc()
            print(f"{sport} model: FAILED, the page keeps the formula. {e}", file=sys.stderr)
    sys.exit(1 if todo and failures == len(todo) else 0)
