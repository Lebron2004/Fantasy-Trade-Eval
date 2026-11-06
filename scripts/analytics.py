#!/usr/bin/env python3
"""
Trade Scale analytics: a running track record of every pick the site shows, graded against what happened, plus
each sport's model report card.

Every morning, after best_bets.py:
  1. Records today's picks. Player props come from site/data/props/best.json (top picks and parlays for NFL, NBA,
     NHL, MLB, UFC, soccer and cricket). College game picks (best spreads, totals and likeliest winners) are rebuilt
     from site/data/props/<cfb|cbb>/games.json the same way props.js picks them. Picks for games that haven't been
     played yet are replaced by the latest run's picks, so each game keeps the last picks shown before it started.
  2. Grades older picks. Props use the player's game log in site/data/props/<sport>/p/<id>.json; college picks use
     the final scores games.json carries. A player with no game near the pick's date, once the sport's data has moved
     past it, is a void (he didn't play), like a book would treat it.
  3. Copies each sport's model test report (model.json) and the college backtest, keeping yesterday's copy when a
     sport's data wasn't built today.

Writes site/data/analytics.json (committed, unlike the props data, so the history survives between runs):
  {"updated", "since", "picks": [[id, sport, date, kind, name, team, opp, key, line, side, p, result, actual], ...],
   "parlays": [[id, sport, date, p, [pick ids], result], ...], "models": {sport: {...}}, "college": {sport: {...}}}
  kind     "prop" or a college market: "ml", "spread", "total"
  result   null (not played yet), "W", "L", "P" (push) or "V" (void)

Standard library only. Run: python scripts/analytics.py
"""
import json, math, os
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
    TODAY = datetime.now(EASTERN).date()
except Exception:
    EASTERN = None
    TODAY = date.today()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
PROPS = os.path.join(DATA, "props")
OUT = os.path.join(DATA, "analytics.json")

PROP_SPORTS = ("nfl", "nba", "nhl", "mlb", "ufc", "soc", "cri")
COLLEGE = ("cfb", "cbb")
KEEP_DAYS = 400          # about a full year of every sport's season
VOID_AFTER = {"ufc": 2, "cri": 3}   # days past the pick date, with newer games in the data, before a missing game is a void
VOID_DEFAULT = 3
GONE_AFTER = 14          # a player missing from the data this long after his pick is a void


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def iso(d):
    return d.isoformat()


def day(s):
    return date.fromisoformat(s[:10])


# ---------------------------------------------------------------- record picks
def prop_picks(sport, s):
    """Rows for one sport of best.json: its top picks, and the parlays built from them."""
    rows, by_leg = [], {}
    # "extra" holds parlay legs that aren't top picks: they're kept as kind "leg" to grade the parlays, and left out
    # of the picks' record
    for kind, cands in (("prop", s.get("picks") or []), ("leg", s.get("extra") or [])):
        for c in cands:
            leg = c["pid"] + ":" + c["key"]
            if leg in by_leg:
                continue
            by_leg[leg] = pid = f"{sport}:{leg}:{c['date']}"
            rows.append([pid, sport, c["date"], kind, c["name"], c.get("team"), c.get("opp"), c["key"], c["line"], c["side"], c["p"], None, None])
    parlays = []
    for pl in s.get("parlays") or []:
        legs = [by_leg.get(l) for l in pl["legs"]]
        if None in legs:
            continue
        dates = sorted(r[2] for r in rows if r[0] in legs)
        parlays.append(["|".join(legs), sport, dates[0] if dates else None, pl["p"], legs, None])
    return rows, parlays


def phi(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def game_date(g):
    if not g.get("start"):
        return None
    t = datetime.fromisoformat(g["start"].replace("Z", "+00:00"))
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return (t.astimezone(EASTERN) if EASTERN else t).date().isoformat()


def college_picks(sport, d):
    """The picks props.js shows on a college tab (renderGames): best spreads and totals against posted lines, and
    the likeliest winners. Mirrors expectGame, gameChance and gameBets there."""
    M = d.get("model") or {}
    k, k_t, sd, sd_t = M.get("k", 0), M.get("k_total", 0), M.get("sd") or 15, M.get("sd_total") or 15
    short = {r[0]: (r[3] or r[1] or r[0]) for r in d.get("teams") or []}
    half = lambda v: round(v * 2) / 2
    bets = []
    for g in d.get("games") or []:
        if g.get("m") is None:
            continue
        gd = game_date(g)
        if not gd or gd < iso(TODAY):
            continue
        L = g.get("line") or {}
        m, t = g["m"], g.get("t")
        if L.get("spread") is not None:
            m = -L["spread"] + k * (g["m"] + L["spread"])
        if L.get("total") is not None and t is not None:
            t = L["total"] + k_t * (t - L["total"])
        H, A = g["home"], g["away"]
        p_home = phi(m / sd)
        base = {"id": g.get("id") or f"{A}@{H}", "date": gd, "home": H, "away": A}
        bets.append(dict(base, market="ml", side="home", line=None, p=p_home, book=True, team=H, opp=A))
        bets.append(dict(base, market="ml", side="away", line=None, p=1 - p_home, book=True, team=A, opp=H))
        if L.get("spread") is not None:
            s = L["spread"]
            c = phi((m + s) / sd)
            bets.append(dict(base, market="spread", side="home", line=s, p=c, book=True, team=H, opp=A))
            bets.append(dict(base, market="spread", side="away", line=-s, p=1 - c, book=True, team=A, opp=H))
        if L.get("total") is not None and t is not None:
            o = phi((t - L["total"]) / sd_t)
            bets.append(dict(base, market="total", side="over", line=L["total"], p=o, book=True, team=A, opp=H))
            bets.append(dict(base, market="total", side="under", line=L["total"], p=1 - o, book=True, team=A, opp=H))
    def top(market, n):
        return sorted((b for b in bets if b["market"] == market and b["p"] > 0.5), key=lambda b: -b["p"])[:n]
    rows = []
    for b in top("spread", 8) + top("total", 6) + top("ml", 8):
        if b["market"] == "ml":
            name = f"{short.get(b['team'], b['team'])} to win"
        elif b["market"] == "spread":
            name = f"{short.get(b['team'], b['team'])} {'+' if b['line'] > 0 else ''}{b['line'] if b['line'] else 'pick' + chr(39) + 'em'}"
        else:
            name = f"{'Over' if b['side'] == 'over' else 'Under'} {b['line']}: {short.get(b['away'], b['away'])} at {short.get(b['home'], b['home'])}"
        rid = f"{sport}:{b['id']}:{b['market']}:{b['side']}"
        rows.append([rid, sport, b["date"], b["market"], name, b["team"], b["opp"], b["market"], b["line"], b["side"], round(b["p"], 3), None, None])
    return rows


def record(hist, sport, rows, parlays=None):
    """Swap in today's picks for games that haven't been played; picks for earlier dates stay as they were."""
    today = iso(TODAY)
    keep = [r for r in hist["picks"] if r[1] != sport or r[11] is not None or r[2] < today]
    have = {r[0] for r in keep}
    keep += [r for r in rows if r[0] not in have]
    hist["picks"] = keep
    if parlays is not None:
        keep = [p for p in hist["parlays"] if p[1] != sport or p[5] is not None or (p[2] or today) < today]
        have = {p[0] for p in keep}
        hist["parlays"] = keep + [p for p in parlays if p[0] not in have]


# ---------------------------------------------------------------- grade
def stat_of(x, key):
    return sum((x.get(c) or 0) for c in key.split("+"))


def outcome(actual, line, side):
    if actual == line:
        return "P"
    return "W" if (actual > line) == (side == "over") else "L"


def grade_props(hist):
    open_ = [r for r in hist["picks"] if r[3] in ("prop", "leg") and r[11] is None and r[2] < iso(TODAY)]
    by_sport = {}
    for r in open_:
        by_sport.setdefault(r[1], []).append(r)
    for sport, rows in by_sport.items():
        pdir = os.path.join(PROPS, sport, "p")
        if not os.path.isdir(pdir):
            continue
        latest, docs = "", {}   # latest: the newest game in the sport's data
        for r in rows:
            pid = r[0].split(":")[1]
            if pid not in docs:
                docs[pid] = load(os.path.join(pdir, f"{pid}.json"), None)
        for doc in docs.values():
            for g in (doc or {}).get("log", [])[-3:]:
                if g.get("d"):
                    latest = max(latest, g["d"])
        if not latest:   # none of the picked players have dated games; look wider
            for name in os.listdir(pdir)[:400]:
                for g in (load(os.path.join(pdir, name), {}) or {}).get("log", [])[-1:]:
                    if g.get("d"):
                        latest = max(latest, g["d"])
        wait = VOID_AFTER.get(sport, VOID_DEFAULT)
        for r in rows:
            pick_d = day(r[2])
            doc = docs.get(r[0].split(":")[1])
            if doc is None:
                if (TODAY - pick_d).days >= GONE_AFTER:
                    r[11] = "V"
                continue
            near = [g for g in doc.get("log", []) if g.get("d") and abs((day(g["d"]) - pick_d).days) <= 1 and g.get("x") is not None]
            if near:
                g = min(near, key=lambda g: abs((day(g["d"]) - pick_d).days))
                actual = stat_of(g["x"], r[7])
                r[12] = round(actual, 1) if isinstance(actual, float) else actual
                r[11] = outcome(actual, r[8], r[9])
            elif latest and (day(latest) - pick_d).days >= wait:
                r[11] = "V"


def grade_college(hist, sport, d):
    res = {}
    for dt, h, a, hp, ap in d.get("results") or []:
        res[(dt, h, a)] = (hp, ap)
    if not res:
        return
    newest = max(k[0] for k in res)
    known = {k[1] for k in res} | {k[2] for k in res}
    pooled = lambda t: t if t in known else "_OTHER"   # small schools share one rating, and one name, in the results
    for r in hist["picks"]:
        if r[1] != sport or r[11] is not None or r[2] >= iso(TODAY):
            continue
        # the pick id is sport:game:market:side; team and opp hold the two schools
        side, market = r[9], r[3]
        if market == "total":
            away, home = r[5], r[6]
        else:
            home, away = (r[5], r[6]) if side == "home" else (r[6], r[5])
        pick_d = day(r[2])
        score = None
        for off in (0, -1, 1):
            dt = iso(pick_d + timedelta(days=off))
            score = res.get((dt, pooled(home), pooled(away)))
            if score:
                break
        if not score:
            if (day(newest) - pick_d).days >= 3:
                r[11] = "V"
            continue
        hp, ap = score
        if market == "total":
            r[12] = hp + ap
            r[11] = outcome(hp + ap, r[8], side)
            continue
        mine = (hp - ap) if side == "home" else (ap - hp)
        if market == "ml":
            r[12] = mine
            r[11] = "W" if mine > 0 else "L" if mine < 0 else "P"
        else:
            r[12] = mine
            v = mine + (r[8] or 0)
            r[11] = "W" if v > 0 else "L" if v < 0 else "P"


def grade_parlays(hist):
    res = {r[0]: r[11] for r in hist["picks"]}
    for p in hist["parlays"]:
        if p[5] is not None:
            continue
        legs = [res.get(l) for l in p[4]]
        if "L" in legs:
            p[5] = "L"
        elif all(x is not None for x in legs):
            p[5] = "V" if all(x in ("V", "P") for x in legs) else "W"   # a void or push leg drops out, as at a book


# ---------------------------------------------------------------- model report cards
def model_card(m):
    r = m.get("report") or {}
    dl = r.get("default_lines") or {}
    return {"updated": m.get("updated"), "used": m.get("used"), "test_from": m.get("test_from"), "games": m.get("games"),
            "n": dl.get("n"), "over_rate": dl.get("over_rate"), "trained": dl.get("trained"), "formula": dl.get("formula"),
            "form_only": dl.get("form_only"), "calibration": (r.get("calibration") or {}).get("trained"),
            "picks": r.get("picks"), "by_stat": r.get("by_stat"), "importance": m.get("importance"), "note": m.get("note")}


def college_card(d):
    teams = sorted((t for t in d.get("teams") or [] if len(t) > 5 and t[5]), key=lambda t: t[5])[:15]
    return {"updated": d.get("updated"), "season": d.get("season"), "games_this_season": d.get("games_this_season"),
            "model": d.get("model"), "backtest": d.get("backtest"),
            "top": [[t[0], t[3] or t[1], t[4], t[5]] for t in teams], "upcoming": len(d.get("games") or [])}


def main():
    hist = load(OUT, {}) or {}
    hist.setdefault("picks", [])
    hist.setdefault("parlays", [])
    hist.setdefault("models", {})
    hist.setdefault("college", {})
    hist.setdefault("since", iso(TODAY))

    # grade first, so a pick recorded yesterday for a game played yesterday is settled before today's are swapped in
    grade_props(hist)
    for sport in COLLEGE:
        d = load(os.path.join(PROPS, sport, "games.json"), None)
        if d:
            grade_college(hist, sport, d)

    best = load(os.path.join(PROPS, "best.json"), {}) or {}
    sports = (best.get("sports") or {}) if best.get("date") == iso(TODAY) else {}   # an old slate isn't re-recorded
    for sport, s in sports.items():
        rows, parlays = prop_picks(sport, s)
        record(hist, sport, rows, parlays)
    for sport in PROP_SPORTS:
        m = load(os.path.join(PROPS, sport, "model.json"), None)
        if m:
            hist["models"][sport] = model_card(m)
    for sport in COLLEGE:
        d = load(os.path.join(PROPS, sport, "games.json"), None)
        if not d:
            continue
        hist["college"][sport] = college_card(d)
        if d.get("date") == iso(TODAY):
            record(hist, sport, college_picks(sport, d))
    grade_parlays(hist)

    cutoff = iso(TODAY - timedelta(days=KEEP_DAYS))
    hist["picks"] = sorted((r for r in hist["picks"] if r[2] >= cutoff), key=lambda r: (r[2], r[1], -r[10]))
    hist["parlays"] = [p for p in hist["parlays"] if (p[2] or iso(TODAY)) >= cutoff]
    hist["updated"] = datetime.now(timezone.utc).isoformat(timespec="minutes")
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(hist, f, ensure_ascii=False, separators=(",", ":"))

    for sport in PROP_SPORTS + COLLEGE:
        mine = [r for r in hist["picks"] if r[1] == sport]
        if not mine:
            continue
        w = sum(r[11] == "W" for r in mine); l = sum(r[11] == "L" for r in mine)
        pend = sum(r[11] is None for r in mine)
        print(f"analytics {sport}: {len(mine)} picks tracked, {w}-{l} graded" + (f" ({w / (w + l):.1%})" if w + l else "") + f", {pend} pending")


if __name__ == "__main__":
    main()
