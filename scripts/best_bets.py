#!/usr/bin/env python3
"""
Trade Scale best bets: the props most likely to hit on each sport's next slate, and the best parlays (3 legs here; the page builds any size from the pool).
Also writes "days": each day with games in the next week and its strongest picks, for the page's day picker.

Reads the trained model's chances that train_props_model.py wrote into each player's file ("ml") and picks, for every
player on the slate, the side of his main props the model likes most, at a line close to where a book would set it
(see book_line). Then it builds 3-leg parlays from the strongest picks, one leg per game, so the legs
are close to independent and the parlay's chance is the product of the three.

Writes site/data/props/best.json. Also writes site/data/props/<sport>/sgp.json: every prop the model can price for every
team's next game (not just the next slate), so the page can build the likeliest same-game parlay for any team you search.
Sports whose model didn't ship today (it didn't beat the formula, or there are
no upcoming games) are listed with a note and no picks.

Real lines: when site/data/props/odds.json is from today (update_odds.py, which reads DraftKings, FanDuel, BetMGM,
Caesars, Fanatics and the other books, plus PrizePicks, Underdog and Pick6), a prop the books post is picked at the
books' consensus line instead of the stand-in, and its chance blends the model with the books' no-vig chance (see
blend). The daily run calls this script twice: once to choose which games to price, then again after update_odds.py
so the picks are made at the posted lines. The blend's weight is tuned by analytics.py on graded picks.

Run after train_props_model.py. Standard library only.
"""
import itertools, json, math, os, sys, unicodedata
from collections import Counter
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_odds import MARKET as ODDS_MARKETS, model_over, norm as odds_norm   # the same name key and line pricing the odds file uses

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
    # fights: yes/no props have no role minimum; strikes and takedowns need a fighter who actually throws or wrestles
    "ufc": {"win": 0, "dist": 0, "rnd": 0.5, "sig": 19.5, "tdl": 0.5},
    # soccer: shot, foul and save counts; goals, assists and cards price so far under that they'd crowd out everything else
    "soc": {"sot": 0.5, "sh": 1.5, "fc": 0.5, "fs": 0.5, "sv": 1.5},
    "cri": {"r": 14.5, "f4": 1.5, "s6": 0.5, "f4+s6": 1.5, "wk": 0.5, "rc": 20.5},
}
# props about the whole fight, not one fighter: both fighters' pages carry the same bet, so keep one per bout
FIGHT_LEVEL = {"dist", "rnd"}
SKIP_GROUPS = {"nhl": {"G"}, "mlb": {"RP"}}   # no starting-goalie data; relievers' roles change night to night
# a player whose last game is older than this (vs the latest game in the data) is probably hurt or out of the lineup
STALE_DAYS = {"nfl": 16, "nba": 10, "nhl": 10, "mlb": 10, "ufc": 100000,
              "soc": 21, "cri": 400}   # cricketers go months between series and leagues   # fighters go months between fights
# no injury or lineup data: a player who sat out this many of his team's latest matches is probably hurt or dropped
MISSED = {"soc": 2, "cri": 1}
TOP_PICKS = 12
TOP_OVERS = 6     # unders win most props, so the best overs get their own short list
PARLAY_POOL = 24
PARLAYS = 3
LEG_POOL = 60     # the page builds parlays of any size from this many of the strongest picks
DAY_WINDOW = 7    # days the page's day picker reaches past the first day with games
MAX_DAYS = 8
NFL_TEAM = {"LAR": "LA", "JAC": "JAX", "WSH": "WAS"}   # Sleeper vs nflverse team codes
# pick'em apps: their lines are real but their prices are indicative (payouts depend on the entry), so they set
# a line when no sportsbook has one, and never the market's chance
DFS_BOOKS = {"prizepicks", "underdog", "pick6", "betr_us_dfs"}
# the model's share of the blend (in log-odds; the books' no-vig chance gets the rest) until analytics.py has
# graded enough market-checked picks to tune it. Books' prop lines are sharp, so the market leads.
MODEL_WEIGHT = 0.4
MIN_TUNED = 60
ODDS_MAX_AGE_H = 30


# ---------- sportsbook and pick'em lines ----------
def implied(a):
    if a is None:
        return None
    return -a / (-a + 100) if a < 0 else 100 / (a + 100)


def logit(p):
    p = min(max(p, 0.01), 0.99)
    return math.log(p / (1 - p))


def blend(pm, pk, w):
    """The model's and the market's chance of the over, averaged in log-odds with the model's weight w."""
    if pk is None:
        return pm
    if pm is None:
        return pk
    return 1 / (1 + math.exp(-(w * logit(pm) + (1 - w) * logit(pk))))


def load_market():
    """Today's odds file and the tuned blend weights, or ({}, {}) when there's no fresh odds file."""
    try:
        odds = json.load(open(os.path.join(PROPS, "odds.json"), encoding="utf-8"))
        age = datetime.now(timezone.utc) - datetime.fromisoformat(odds["updated"])
        if age > timedelta(hours=ODDS_MAX_AGE_H) or not odds.get("props"):
            return {}, {}
    except Exception:
        return {}, {}
    weights = {}
    try:
        tuned = json.load(open(os.path.join(DATA, "analytics.json"), encoding="utf-8")).get("market") or {}
    except Exception:
        tuned = {}
    for sport in odds["props"]:
        t = tuned.get(sport) if (tuned.get(sport) or {}).get("n", 0) >= MIN_TUNED else tuned.get("all")
        weights[sport] = t["w"] if t and t.get("n", 0) >= MIN_TUNED and t.get("w") is not None else MODEL_WEIGHT
    return odds, weights


def market_line(rows):
    """One prop's rows from the odds file -> the consensus line, the books' no-vig chance of the over there (None if no
    book prices both sides of it), how many books post it, and the pick'em apps' lines."""
    books = [r for r in rows if r[0] not in DFS_BOOKS]
    dfs = [r for r in rows if r[0] in DFS_BOOKS]
    lines = [r[1] for r in books] or [r[1] for r in dfs]
    if not lines:
        return None
    cnt = Counter(lines)
    top = max(cnt.values())
    tied = sorted(l for l in cnt if cnt[l] == top)
    line = tied[len(tied) // 2]
    fair = []
    for r in books:
        o, u = implied(r[2]), implied(r[3])
        if r[1] == line and o and u:
            fair.append(o / (o + u))
    return {"line": line, "pk": sum(fair) / len(fair) if fair else None, "nb": len({r[0] for r in books if r[1] == line}),
            "dfs": [(r[0], r[1]) for r in dfs]}


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
    upcoming = {t: g for t, g in (index.get("next") or {}).items() if g.get("date") and g["date"] >= TODAY.isoformat()}
    out = {"slate": label, "games": len({tuple(sorted((t, g["opp"]))) for t, g in teams.items()}), "picks": [], "parlays": []}
    if not teams:
        out["note"] = "No games on the schedule yet."
        return out
    if not model.get("used"):
        out["note"] = "The trained model didn't ship for this sport today, so there are no picks."
        return out
    hurt = injured(sport)
    # player props only (UFC's odds rows are fight winners, which the stand-in already prices at the bout)
    mkt_props = ((MARKET_ODDS.get("props") or {}).get(sport) or {}) if sport in ODDS_MARKETS else {}
    w = MARKET_W.get(sport, MODEL_WEIGHT)
    starters = {g.get("opp_sp") for g in upcoming.values() if g.get("opp_sp")}   # MLB probable pitchers
    markets, skip = MARKETS[sport], SKIP_GROUPS.get(sport, set())
    docs = []
    latest = ""
    for name in os.listdir(os.path.join(d, "p")):
        doc = json.load(open(os.path.join(d, "p", name), encoding="utf-8"))
        log = [g for g in doc.get("log", []) if g.get("x") and g.get("d")]
        if log:
            latest = max(latest, log[-1]["d"])
        if doc.get("ml") and doc.get("team") in upcoming and log:
            docs.append((doc, log))
    season_on = latest and (TODAY - date.fromisoformat(latest)).days <= 30
    # each team's latest match dates, from its players' logs (a cricketer's log mixes his franchise and his country)
    team_dates = {}
    for doc, log in docs:
        for g in log[-12:]:
            if g.get("tm"):
                team_dates.setdefault(g["tm"], set()).add(g["d"])
    cutoff = (date.fromisoformat(latest) - timedelta(days=STALE_DAYS[sport])).isoformat() if season_on else ""

    cands, overs, every = [], [], []
    for doc, log in docs:
        grp = doc.get("grp") or doc.get("pos")
        if grp in skip:
            continue
        if norm(doc["name"]) + ("|" + doc["team"] if sport == "nfl" else "") in hurt:
            continue
        if cutoff and log[-1]["d"] < cutoff:
            continue
        if sport in MISSED and season_on:
            recent = sorted(team_dates.get(doc["team"], ()))[-MISSED[sport]:]
            mine_d = {g["d"] for g in log if g.get("tm") == doc["team"]}
            if recent and not mine_d & set(recent):
                continue
        if sport == "mlb" and grp == "SP" and doc["name"] not in starters:
            continue
        ng = upcoming[doc["team"]]
        mine = []
        for key, entry in doc["ml"].items():
            if key not in markets or not entry.get("l"):
                continue
            vals = [stat_of(g, key) for g in log]
            if len(vals) < 5:
                continue
            rows = (mkt_props.get(odds_norm(doc["name"])) or {}).get(key)
            mk = market_line(rows) if rows else None
            pm = model_over(doc, sport, key, mk["line"]) if mk else None
            if pm is None:
                mk = None
                line, p_over = book_line(entry, vals)
                # a book posts this prop only for a player whose current role reaches it (not a backup QB's completions)
                if line < markets[key] or sum(vals[-5:]) / len(vals[-5:]) < markets[key]:
                    continue
                if mkt_props:
                    # other props on this slate are priced against real lines; a stand-in line is where a book would
                    # set it (about even), so pull its chance the same way, or unchecked picks would crowd out checked ones
                    p_over = blend(p_over, 0.5, w)
            else:      # a posted line: pick at it, with the model and the books' chance blended (a pick'em-only line
                       # has no real price, but it's set where the app expects an even split)
                base = mk["pk"] if mk["pk"] is not None else 0.5
                line, p_over = mk["line"], blend(pm, base, w)
                for r in rows:          # every app's line in the odds file gets the same blended chance
                    pr = model_over(doc, sport, key, r[1])
                    if pr is not None:
                        shift = min(0.98, max(0.02, base + pr - pm))
                        r[4] = round(blend(pr, shift, w), 4)
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
            if mk:     # pm/pk: the model's and the books' chance of the over at this line (pk null: pick'em line only)
                mine[-1]["mkt"] = {"pm": round(pm, 3), "pk": None if mk["pk"] is None else round(mk["pk"], 3),
                                   "nb": mk["nb"], "w": round(w, 2)}
                pe = []
                for b, l in mk["dfs"]:
                    pr = model_over(doc, sport, key, l)
                    if pr is None:
                        continue
                    shift = min(0.98, max(0.02, base + pr - pm))
                    po = blend(pr, shift, w)
                    pe.append([b, l, round(po if side == "over" else 1 - po, 3)])
                if pe:
                    mine[-1]["dfs"] = pe
        every.extend(mine)          # every prop he has, for the same-game parlays
        if mine:   # every upcoming player, so the page can show any day, not just the next slate
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
    out["days"] = build_days(upcoming, teams, cands, overs)
    cands = [c for c in cands if c["team"] in teams]
    overs = [c for c in overs if c["team"] in teams]
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
    # the page lets you pick how many legs: it builds those parlays itself from the strongest picks,
    # so ship a deeper pool (as ids) and the details of every pool pick that isn't already in the top picks
    shown = {c["pid"] + ":" + c["key"] for c in out["picks"]}
    deep = cands[:max(LEG_POOL, PARLAY_POOL)]
    out["pool"] = [c["pid"] + ":" + c["key"] for c in deep[:LEG_POOL]]
    out["extra"] = [c for c in deep if c["pid"] + ":" + c["key"] not in shown]
    write_sgp(sport, upcoming, every)
    if not cands:
        out["note"] = "No player on this slate has a main prop the model can price."
    elif len(out["parlays"]) == 0:
        out["note"] = "Not enough games on this slate for a 3-leg parlay with one leg per game."
    return out


def build_days(upcoming, teams, cands, overs):
    """The page's day picker: every day with games in the next week, each with its strongest picks and best overs, so you
    can bet any day (or several at once) instead of only the next slate. Only each team's next game is in the data, so a
    team that plays sooner shows up on its later days after that game is played."""
    dates = sorted({g["date"] for g in upcoming.values()})
    if not dates:
        return []
    last = (date.fromisoformat(dates[0]) + timedelta(days=DAY_WINDOW)).isoformat()
    slate_dates = {g["date"] for g in teams.values()}
    days = []
    for d in [x for x in dates if x <= last][:MAX_DAYS]:
        games = {tuple(sorted((t, g["opp"] or ""))) for t, g in upcoming.items() if g["date"] == d}
        days.append({"date": d, "games": len(games), "slate": d in slate_dates,
                     "picks": [c for c in cands if c["date"] == d][:LEG_POOL],
                     "overs": [c for c in overs if c["date"] == d][:TOP_OVERS]})
    return days


def write_sgp(sport, upcoming, every):
    """Every priced prop for each team's next game, grouped by game, for the page's team search and same-game parlays."""
    games, teams = {}, {}
    for t, g in upcoming.items():
        key = "-".join(sorted((t, g["opp"] or ""))) + g["date"]
        teams[t] = key
        if key not in games:
            home = t if g.get("home") == 1 else g["opp"] if g.get("home") == 0 else None
            games[key] = {"teams": sorted((t, g["opp"] or "")), "home": home, "date": g["date"], "time": g.get("time"),
                          "week": g.get("week"), "event": g.get("event"), "legs": []}
    seen = set()
    for c in sorted(every, key=lambda c: -c["p"]):
        key = teams.get(c["team"])
        if not key:
            continue
        # fight-level props show on both fighters' pages: keep one per bout
        k = (key, c["key"]) if sport == "ufc" and c["key"] in FIGHT_LEVEL else (c["pid"], c["key"])
        if k in seen:
            continue
        seen.add(k)
        games[key]["legs"].append({f: c[f] for f in ("pid", "name", "team", "grp", "key", "line", "side", "p", "l10", "opp", "home", "date",
                                                     "mkt", "dfs") if f in c})
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "teams": teams, "games": games}
    with open(os.path.join(PROPS, sport, "sgp.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"same-game {sport}: {len(games)} games, {sum(len(g['legs']) for g in games.values())} legs")


MARKET_ODDS, MARKET_W = {}, {}


def main():
    global MARKET_ODDS, MARKET_W
    MARKET_ODDS, MARKET_W = load_market()
    if MARKET_ODDS:
        print(f"best bets: picking at posted lines from {MARKET_ODDS.get('source')} ({len(MARKET_ODDS.get('books') or {})} apps), "
              f"model weight {', '.join(f'{k} {v:.2f}' for k, v in MARKET_W.items())}")
    result = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "date": TODAY.isoformat(), "sports": {}}
    for sport in ("nfl", "nba", "nhl", "mlb", "ufc", "soc", "cri"):
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
    if MARKET_ODDS:      # the page's best-app chances now carry the blend too
        result_market = sum(1 for s in result["sports"].values() for c in s.get("picks", []) if c.get("mkt"))
        print(f"best bets: {result_market} top picks made at posted lines")
        with open(os.path.join(PROPS, "odds.json"), "w", encoding="utf-8") as f:
            json.dump(MARKET_ODDS, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main()
