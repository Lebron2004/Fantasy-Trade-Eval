#!/usr/bin/env python3
"""
Trade Scale model signals for trades.

Turns the trained prop model's next-game predictions (the "ml" grids that train_props_model.py writes into
site/data/props/<sport>/p/<id>.json) into one fantasy projection per player, then compares where the model ranks
him at his position with where his trade value ranks him. A player the model ranks well above his trade value is
a buy; one it ranks well below is a sell. The trade calculator and My league pages use this to rank trade ideas,
flag buy-low and sell-high players, and explain why.

Writes site/data/signals.json:
  {"updated", "sports": {sport: {"label", "players": {pool_id: [proj, avg, model_rank, value_rank, n_at_pos, score]}}}}
  proj        the model's expected fantasy points next game (scoring below)
  avg         his average in the same scoring over his last 20 games
  model_rank  rank at his position by proj, among players with a model projection
  value_rank  rank at his position by trade value, among the same players
  score       log((value_rank + 8) / (model_rank + 8)), clipped to +-1.5: above 0 the model likes him more than his
              value does. The +8 keeps small gaps at the top (2nd vs 1st) from reading as big disagreements.

Only players the model made a prediction for are included, so a sport whose model didn't beat the formula (or has
no upcoming games) is simply left out. Standard library only. Run after train_props_model.py.
"""
import json, math, os, re, sys, unicodedata
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
PROPS = os.path.join(DATA, "props")

# Fantasy scoring built from the props the model predicts. Each prop's expected value comes from its Over chances.
SCORING = {
    "nfl": {"label": "PPR points", "groups": {"_": {"ppr": 1}}},
    "nba": {"label": "fantasy points (pts + 1.2 reb + 1.5 ast + 3 stl + 3 blk - tov)",
            "groups": {"_": {"pts": 1, "reb": 1.2, "ast": 1.5, "stl": 3, "blk": 3, "tov": -1}}},
    "nhl": {"label": "fantasy points (3 per goal, 2 per assist, 0.5 per shot and block; goalies 0.2 per save, -1 per goal allowed)",
            "groups": {"G": {"sv": 0.2, "ga": -1}, "_": {"g": 3, "a": 2, "sog": 0.5, "blk": 0.5}}},
    "mlb": {"label": "fantasy points (total bases, runs, RBIs, walks, 2 per steal; pitchers outs + strikeouts - 2 per earned run - hits and walks)",
            "groups": {"SP": {"outs": 1, "k": 1, "er": -2, "ha": -1, "bba": -1}, "RP": {"outs": 1, "k": 1, "ha": -1},
                       "_": {"tb": 1, "r": 1, "rbi": 1, "bb": 1, "sb": 2}}},
}
# Position buckets for ranking, in the player pool's own position names.
POS_GROUP = {
    "nfl": lambda pos: pos if pos in ("QB", "RB", "WR", "TE") else None,
    "nba": lambda pos: {"PG": "G", "SG": "G", "G": "G", "SF": "F", "PF": "F", "F": "F", "C": "C"}.get(pos.split("/")[0]),
    "nhl": lambda pos: "G" if pos == "G" else "D" if pos == "D" else "F",
    "mlb": lambda pos: "SP" if "SP" in pos.split("/") and not pos.startswith(("C", "1B", "2B", "3B", "SS", "OF", "DH")) else "RP" if pos == "RP" else "H",
}
TEAM_ALIAS = {"LA": "LAR", "GS": "GSW", "NO": "NOP", "NY": "NYK", "SA": "SAS", "UTAH": "UTA", "WSH": "WAS", "TBL": "TB", "NJD": "NJ",
              "SJS": "SJ", "LAK": "LA", "AZ": "ARI", "CWS": "CHW"}
MIN_VALUE = 5          # ignore deep bench players nobody trades for
RANK_SMOOTH = 8
# The model doesn't know about injuries, so players who won't play next game get no signal (and aren't ranked).
SITTING = {"Out", "IR", "PUP", "Sus", "NA", "Doubtful"}


def norm(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'\-]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def team(t):
    return TEAM_ALIAS.get(t, t)


def expected(entry):
    """One number for a prop from the model's Over chances on a grid of lines.
    Small counts (grid starts at 0.5: steals, goals, strikeouts...): the mean, sum of P(X > k) over k = 0, 1, 2...
    Bigger stats (points, yards): the median, where the Over chance crosses 50%. The model is trained on lines near
    each player's usual output, so its far tails are rougher than its middle, and the median only uses the middle."""
    ls, ps = entry.get("l") or [], entry.get("p") or []
    if not ls:
        return None
    if ls[0] <= 0.5:
        e = ps[0] * 1.0
        for i in range(1, len(ls)):
            e += (ls[i] - ls[i - 1]) * ps[i]
        return e
    if ps[0] < 0.5:
        return ls[0]
    for i in range(1, len(ls)):
        if ps[i] < 0.5:
            return ls[i - 1] + (ls[i] - ls[i - 1]) * (ps[i - 1] - 0.5) / max(ps[i - 1] - ps[i], 1e-9)
    return ls[-1]


def recent_avg(doc, weights, n=20):
    """His average in the same scoring over his last 20 games (across seasons, so it's never a 1-game sample)."""
    games = [g for g in doc.get("log", []) if g.get("x") is not None][-n:]
    if not games:
        return None
    return sum(sum(w * float(g["x"].get(k, 0) or 0) for k, w in weights.items()) for g in games) / len(games)


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def build(sport):
    cfg = SCORING[sport]
    pdir = os.path.join(PROPS, sport, "p")
    pool = (load_json(os.path.join(DATA, f"{sport}.json"), {}) or {}).get("players", [])
    if not os.path.isdir(pdir) or not pool:
        return None
    by_name = {}
    for r in pool:
        by_name.setdefault(norm(r[1]), []).append(r)
    espn = ((load_json(os.path.join(DATA, "ids", f"{sport}.json"), {}) or {}).get("espn") or {}) if sport == "nba" else {}
    pool_by_id = {str(r[0]): r for r in pool}

    rows = []
    for name in os.listdir(pdir):
        doc = load_json(os.path.join(pdir, name))
        if not doc or not doc.get("ml"):
            continue
        ml = doc["ml"]
        grp_key = doc.get("grp") or doc.get("pos")
        weights = cfg["groups"].get(grp_key) or cfg["groups"]["_"]
        if not all(k in ml for k, w in weights.items() if abs(w) >= 1):
            continue    # missing a main stat, so the projection would be lopsided
        proj = sum(w * (expected(ml[k]) or 0) for k, w in weights.items() if k in ml)
        # match to the trade pool: ID map, then name and team, then a unique name
        r = pool_by_id.get(espn.get(str(doc["id"]), ""))
        if r is None:
            cands = by_name.get(norm(doc["name"]), [])
            same = [c for c in cands if team(c[2]) == team(doc.get("team"))]
            r = same[0] if len(same) == 1 else cands[0] if len(cands) == 1 else None
        if r is None or (r[5] or 0) < MIN_VALUE or r[6] in SITTING:
            continue
        pg = POS_GROUP[sport](r[3] or "")
        if pg is None:
            continue
        avg = recent_avg(doc, weights)
        rows.append({"id": str(r[0]), "pg": pg, "proj": proj, "avg": avg, "value": r[5]})

    out = {}
    for pg in {x["pg"] for x in rows}:
        grp = [x for x in rows if x["pg"] == pg]
        n = len(grp)
        for i, x in enumerate(sorted(grp, key=lambda x: -x["proj"])):
            x["mr"] = i + 1
        for i, x in enumerate(sorted(grp, key=lambda x: (-x["value"], -x["proj"]))):
            x["vr"] = i + 1
        for x in grp:
            score = max(-1.5, min(1.5, math.log((x["vr"] + RANK_SMOOTH) / (x["mr"] + RANK_SMOOTH))))
            out[x["id"]] = [round(x["proj"], 1), None if x["avg"] is None else round(x["avg"], 1), x["mr"], x["vr"], n, round(score, 2)]
    return {"label": cfg["label"], "players": out} if out else None


def main():
    todo = sys.argv[1:] or list(SCORING)
    path = os.path.join(DATA, "signals.json")
    prev = load_json(path, {}) or {}
    sports = prev.get("sports", {})
    for sport in todo:
        try:
            s = build(sport)
        except Exception as e:
            print(f"{sport} signals: FAILED, kept previous. {e}", file=sys.stderr)
            continue
        if s:
            sports[sport] = dict(s, updated=datetime.now(timezone.utc).isoformat(timespec="minutes"))
            buys = sum(1 for v in s["players"].values() if v[5] >= 0.4)
            sells = sum(1 for v in s["players"].values() if v[5] <= -0.4)
            print(f"{sport} signals: {len(s['players'])} players, {buys} buys, {sells} sells")
        else:
            sports.pop(sport, None)   # no model predictions today: don't show stale ones
            print(f"{sport} signals: no model predictions, skipped")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "sports": sports}, f,
                  ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
