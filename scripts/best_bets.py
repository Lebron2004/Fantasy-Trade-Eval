#!/usr/bin/env python3
"""
Trade Scale best bets: the props most likely to hit on each sport's next slate, and the best 3-leg parlays.

Reads the trained model's chances that train_props_model.py wrote into each player's file ("ml") and picks, for every
player on the slate, the side of his main props the model likes most, at a line close to where a book would set it
(see book_line). Then it builds 3-leg parlays from the strongest picks, one leg per game, so the legs
are close to independent and the parlay's chance is the product of the three.

Writes site/data/props/best.json. Sports whose model didn't ship today (it didn't beat the formula, or there are
no upcoming games) are listed with a note and no picks.

Run after train_props_model.py. Standard library only.
"""
import itertools, json, os, unicodedata
from datetime import date, datetime, timedelta, timezone

try:
    from zoneinfo import ZoneInfo
    TODAY = datetime.now(ZoneInfo("America/New_York")).date()   # US slates: the Eastern date, not UTC
except Exception:
    TODAY = date.today()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
PROPS = os.path.join(DATA, "props")

# The props books commonly offer, each with the smallest line that counts. The minimum keeps out lines a book
# wouldn't post (or would price at -400), like the under 0.5 blocks for a player who never blocks a shot, and it
# doubles as a role filter: a bench player's median doesn't reach it.
MARKETS = {
    "nfl": {"pyd": 149.5, "ptd": 1.5, "cmp": 14.5, "ruyd": 24.5, "reyd": 24.5, "rec": 2.5, "ruyd+reyd": 39.5},
    "nba": {"pts": 9.5, "reb": 3.5, "ast": 2.5, "pts+reb+ast": 14.5, "pts+reb": 12.5, "pts+ast": 11.5, "fg3": 1.5},
    "nhl": {"sog": 1.5, "pts": 0.5, "hit": 1.5},
    "mlb": {"h": 0.5, "tb": 1.5, "h+r+rbi": 1.5, "k": 3.5, "outs": 14.5, "ha": 3.5},
    "cfb": {"pyd": 149.5, "ptd": 1.5, "cmp": 12.5, "ruyd": 29.5, "reyd": 29.5, "rec": 2.5, "ruyd+reyd": 39.5},
    "cbb": {"pts": 9.5, "reb": 3.5, "ast": 2.5, "pts+reb+ast": 14.5, "pts+reb": 12.5, "pts+ast": 11.5, "fg3": 1.5},
    # fights: yes/no props have no role minimum; strikes and takedowns need a fighter who actually throws or wrestles
    "ufc": {"win": 0, "dist": 0, "rnd": 0.5, "sig": 19.5, "tdl": 0.5},
    # soccer: shot, foul and save counts; goals, assists and cards price so far under that they'd crowd out everything else
    "soc": {"sot": 0.5, "sh": 1.5, "fc": 0.5, "fs": 0.5, "sv": 1.5},
    "cri": {"r": 14.5, "f4": 1.5, "s6": 0.5, "f4+s6": 1.5, "wk": 0.5, "rc": 20.5},
}
# props about the whole fight, not one fighter: both fighters' pages carry the same bet, so keep one per bout
FIGHT_LEVEL = {"dist", "rnd"}
COLLEGE = {"cfb", "cbb"}
SKIP_GROUPS = {"nhl": {"G"}, "mlb": {"RP"}}   # no starting-goalie data; relievers' roles change night to night
# a player whose last game is older than this (vs the latest game in the data) is probably hurt or out of the lineup
STALE_DAYS = {"nfl": 16, "nba": 10, "nhl": 10, "mlb": 10, "cfb": 16, "cbb": 10, "ufc": 100000,
              "soc": 21, "cri": 400}   # cricketers go months between series and leagues   # fighters go months between fights
# no injury or lineup data: a player who sat out this many of his team's latest matches is probably hurt or dropped
MISSED = {"soc": 2, "cri": 1}
TOP_PICKS = 12
TOP_OVERS = 6     # unders win most props, so the best overs get their own short list
PARLAY_POOL = 24
PARLAYS = 3
NFL_TEAM = {"LAR": "LA", "JAC": "JAX", "WSH": "WAS"}   # Sleeper vs nflverse team codes


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return "".join(ch for ch in s if ch.isalnum() or ch == " ").strip()


def injured(sport):
    """Players with any injury tag in today's player file (football and basketball have them)."""
    try:
        rows = json.load(open(os.path.join(DATA, f"{sport}.json"), encoding="utf-8"))["players"]
    except Exception:
        return set()
    out = set()
    for r in rows:
        if len(r) > 6 and r[6]:
            out.add(norm(r[1]) + ("|" + NFL_TEAM.get(r[2], r[2]) if sport == "nfl" else ""))
    return out


def stat_of(g, key):
    return sum((g["x"].get(c) or 0) for c in key.split("+"))


def slate(index):
    """The teams playing on the next slate: the next NFL week, or the next day with games in the other sports."""
    nxt = {t: g for t, g in (index.get("next") or {}).items() if g.get("date") and g["date"] >= TODAY.isoformat()}
    if not nxt:
        return None, {}
    weeks = [g["week"] for g in nxt.values() if g.get("week") is not None]
    if weeks:
        wk = min(weeks)
        teams = {t: g for t, g in nxt.items() if g.get("week") == wk}
        return f"Week {wk}", teams
    first = min(g["date"] for g in nxt.values())
    return first, {t: g for t, g in nxt.items() if g["date"] == first}


def book_line(entry, vals):
    """A stand-in for the line a book would post, since real lines aren't in the free data: of the lines the model
    priced, the one nearest his average over his last 10 games (books move lines with recent form and role). The
    page's default line (the median, rounded up to the next half point) sits above that for small counts like points
    or receptions, which would make nearly every pick an under."""
    mean10 = sum(vals[-10:]) / len(vals[-10:])
    i = min(range(len(entry["l"])), key=lambda j: (abs(entry["l"][j] - mean10), entry["l"][j]))
    return entry["l"][i], entry["p"][i]


def build_sport(sport):
    d = os.path.join(PROPS, sport)
    if not os.path.exists(os.path.join(d, "index.json")):
        return None
    index = json.load(open(os.path.join(d, "index.json"), encoding="utf-8"))
    try:
        model = json.load(open(os.path.join(d, "model.json"), encoding="utf-8"))
    except Exception:
        model = {}
    label, teams = slate(index)
    out = {"slate": label, "games": len({tuple(sorted((t, g["opp"]))) for t, g in teams.items()}), "picks": [], "parlays": []}
    if not teams:
        out["note"] = "No games on the schedule yet."
        return out
    if not model.get("used"):
        out["note"] = "The trained model didn't ship for this sport today, so there are no picks."
        return out
    hurt = injured(sport)
    starters = {g.get("opp_sp") for g in teams.values() if g.get("opp_sp")}   # MLB probable pitchers
    markets, skip = MARKETS[sport], SKIP_GROUPS.get(sport, set())
    docs = []
    latest = ""
    for name in os.listdir(os.path.join(d, "p")):
        doc = json.load(open(os.path.join(d, "p", name), encoding="utf-8"))
        log = [g for g in doc.get("log", []) if g.get("x") and g.get("d")]
        if log:
            latest = max(latest, log[-1]["d"])
        if doc.get("ml") and doc.get("team") in teams and log:
            docs.append((doc, log))
    season_on = latest and (TODAY - date.fromisoformat(latest)).days <= 30
    team_last = {}
    for doc, log in docs:
        team_last[doc["team"]] = max(team_last.get(doc["team"], ""), log[-1]["d"])
    # each team's latest match dates, from its players' logs (a cricketer's log mixes his franchise and his country)
    team_dates = {}
    for doc, log in docs:
        for g in log[-12:]:
            if g.get("tm"):
                team_dates.setdefault(g["tm"], set()).add(g["d"])
    cutoff = (date.fromisoformat(latest) - timedelta(days=STALE_DAYS[sport])).isoformat() if season_on else ""

    cands, overs = [], []
    for doc, log in docs:
        grp = doc.get("grp") or doc.get("pos")
        if grp in skip:
            continue
        if norm(doc["name"]) + ("|" + doc["team"] if sport == "nfl" else "") in hurt:
            continue
        if cutoff and log[-1]["d"] < cutoff:
            continue
        if sport in COLLEGE and season_on and log[-1]["d"] < team_last.get(doc["team"], ""):
            continue      # sat out his team's latest game: likely hurt, and college teams post no injury tags here
        if sport in MISSED and season_on:
            recent = sorted(team_dates.get(doc["team"], ()))[-MISSED[sport]:]
            mine_d = {g["d"] for g in log if g.get("tm") == doc["team"]}
            if recent and not mine_d & set(recent):
                continue
        if sport == "mlb" and grp == "SP" and doc["name"] not in starters:
            continue
        ng = teams[doc["team"]]
        mine = []
        for key, entry in doc["ml"].items():
            if key not in markets or not entry.get("l"):
                continue
            vals = [stat_of(g, key) for g in log]
            if len(vals) < 5:
                continue
            # college roles change a lot between seasons, so once he has a few games this year a book sets lines off those
            now = [stat_of(g, key) for g in log if g.get("s") == log[-1].get("s")] if sport in COLLEGE else []
            line, p_over = book_line(entry, now if len(now) >= 3 else vals)
            # a book posts this prop only for a player whose current role reaches it (not a backup QB's completions)
            if line < markets[key] or sum(vals[-5:]) / len(vals[-5:]) < markets[key]:
                continue
            side, p = ("over", p_over) if p_over >= 0.5 else ("under", 1 - p_over)
            if sport == "ufc" and key == "win" and side == "under":
                continue      # "doesn't win" is the opponent's win, which his own page already offers
            last10 = vals[-10:]
            hits = sum(1 for v in last10 if (v > line if side == "over" else v < line))
            sign = 1 if side == "over" else -1
            # what moved the chance is only stored at the page's default line
            why = [[g, round(sign * v, 3)] for g, v in entry.get("c", []) if sign * v > 0][:2] if entry.get("at") == line else []
            mine.append({"pid": doc["id"], "name": doc["name"], "team": doc["team"], "grp": grp, "opp": ng["opp"],
                         "home": ng.get("home"), "date": ng["date"], "time": ng.get("time"), "key": key, "line": line,
                         "side": side, "p": round(p, 3), "l10": [hits, len(last10)], "why": why})
        if mine:
            cands.append(max(mine, key=lambda c: c["p"]))     # his single most likely prop
            ov = [c for c in mine if c["side"] == "over"]
            if ov:
                overs.append(max(ov, key=lambda c: c["p"]))
    cands.sort(key=lambda c: -c["p"])
    overs.sort(key=lambda c: -c["p"])
    if sport == "ufc":   # one pick per fight-level prop per bout (both fighters carry it)
        seen = set()
        def first(c):
            k = (c["key"], tuple(sorted((c["team"], c["opp"])))) if c["key"] in FIGHT_LEVEL else (c["pid"], c["key"])
            if k in seen:
                return False
            seen.add(k)
            return True
        cands = [c for c in cands if first(c)]
        seen = set()
        overs = [c for c in overs if first(c)]
    out["picks"] = cands[:TOP_PICKS]
    out["overs"] = overs[:TOP_OVERS]

    # parlays: one leg per game, from the strongest picks; then the best few that share no legs
    game = lambda c: "-".join(sorted((c["team"], c["opp"]))) + c["date"]
    pool = cands[:PARLAY_POOL]
    combos = []
    for trio in itertools.combinations(pool, 3):
        if len({game(c) for c in trio}) < 3:
            continue
        combos.append((trio[0]["p"] * trio[1]["p"] * trio[2]["p"], trio))
    combos.sort(key=lambda r: -r[0])
    used = set()
    for p, trio in combos:
        ids = {c["pid"] for c in trio}
        if ids & used:
            continue
        used |= ids
        out["parlays"].append({"p": round(p, 3), "legs": [c["pid"] + ":" + c["key"] for c in trio]})
        if len(out["parlays"]) == PARLAYS:
            break
    # parlay legs that aren't in the top picks still need their details on the page
    shown = {c["pid"] + ":" + c["key"] for c in out["picks"]}
    extra = [c for c in pool if c["pid"] + ":" + c["key"] not in shown and any(c["pid"] + ":" + c["key"] in pl["legs"] for pl in out["parlays"])]
    out["extra"] = extra
    if not cands:
        out["note"] = "No player on this slate has a main prop the model can price."
    elif len(out["parlays"]) == 0:
        out["note"] = "Not enough games on this slate for a 3-leg parlay with one leg per game."
    return out


def main():
    result = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "date": TODAY.isoformat(), "sports": {}}
    for sport in ("nfl", "nba", "nhl", "mlb", "cfb", "cbb", "ufc", "soc", "cri"):
        try:
            s = build_sport(sport)
        except Exception as e:
            print(f"best bets {sport}: FAILED {e}")
            continue
        if s is None:
            continue
        result["sports"][sport] = s
        top = s["picks"][0] if s["picks"] else None
        print(f"best bets {sport}: slate {s['slate']}, {s['games']} games, {len(s['picks'])} picks, {len(s['parlays'])} parlays"
              + (f"; top {top['name']} {top['side']} {top['line']} {top['key']} {top['p']}" if top else "")
              + (f"; {s['note']}" if s.get("note") else ""))
    os.makedirs(PROPS, exist_ok=True)
    with open(os.path.join(PROPS, "best.json"), "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
