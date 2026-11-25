#!/usr/bin/env python3
"""
Sportsbook odds for the day's picks, from every US book The Odds API carries (DraftKings, FanDuel, BetMGM, Caesars,
ESPN BET, BetRivers, Fanatics and more), so the page can say which app has the best price for each pick and parlay.

Needs a free key from https://the-odds-api.com saved as the repository secret ODDS_API_KEY. Without one it writes
nothing and the page simply leaves the "best app" lines out.

Player props come from the sportsbooks (region "us") and the pick'em apps PrizePicks, Underdog and DraftKings Pick6
(region "us_dfs"). best_bets.py runs again after this script and picks each priced prop at the books' consensus line,
blending the model's chance with the books' no-vig chance, so these lines feed the picks themselves, not just the
"best app" display. Fanatics comes with the "us" region on paid plans only.

What it pulls, most useful first, until the day's share of the plan's credits is spent:
  1. Player props for the games holding the day's best picks, parlay legs and same-game parlay legs, best games first.
     Each game costs one credit per market per region, so only the markets the picks use are asked for.
  2. College football and basketball game lines (moneyline, spread, total): one call per sport covers every game.
  3. UFC fight winners (one call covers the card).
The free plan has 500 credits a month. The daily share is what's left divided by the days left in the month (or
ODDS_DAILY_CREDITS if set), so it never runs dry halfway through the month. A paid plan simply covers more games.

Only books that actually post a player's prop appear under it (a book that doesn't carry a player is never listed).
For every book's line the trained model's chance is worked out at that exact line, so the page can rank books by
what the bet is worth there, not just by the price.

Writes site/data/props/odds.json. Run after best_bets.py (and update_college_games.py). Standard library only.
"""
import json, os, re, sys, time, unicodedata, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
PROPS = os.path.join(DATA, "props")
API = "https://api.the-odds-api.com/v4/sports/"
KEY = os.environ.get("ODDS_API_KEY", "").strip()
REGIONS = os.environ.get("ODDS_REGIONS") or "us"          # "us,us2" adds Hard Rock, ESPN BET and others (twice the credits)
# props also ask the pick'em apps (PrizePicks, Underdog, Pick6); each region is charged per market
PROP_REGIONS = os.environ.get("ODDS_PROP_REGIONS") or "us,us_dfs"

SPORT_KEY = {"nfl": "americanfootball_nfl", "nba": "basketball_nba", "nhl": "icehockey_nhl", "mlb": "baseball_mlb",
             "cfb": "americanfootball_ncaaf", "cbb": "basketball_ncaab", "ufc": "mma_mixed_martial_arts"}
# the props best_bets.py picks -> The Odds API's player markets (props with no market there, like NHL hits, are left out)
MARKET = {
    "nfl": {"pyd": "player_pass_yds", "ptd": "player_pass_tds", "cmp": "player_pass_completions", "ruyd": "player_rush_yds",
            "reyd": "player_reception_yds", "rec": "player_receptions", "ruyd+reyd": "player_rush_reception_yds"},
    "nba": {"pts": "player_points", "reb": "player_rebounds", "ast": "player_assists", "pts+reb+ast": "player_points_rebounds_assists",
            "pts+reb": "player_points_rebounds", "pts+ast": "player_points_assists", "fg3": "player_threes"},
    "nhl": {"sog": "player_shots_on_goal", "pts": "player_points"},
    "mlb": {"h": "batter_hits", "tb": "batter_total_bases", "h+r+rbi": "batter_hits_runs_rbis", "k": "pitcher_strikeouts",
            "outs": "pitcher_outs", "ha": "pitcher_hits_allowed"},
}
FLOAT_STATS = {"nfl": {"ppr"}, "nba": {"min"}, "nhl": {"toi"}, "mlb": set()}
MAX_MARKETS = 6           # per game: the markets most of its picks use
EVENTS_PER_SPORT = 12


def norm(s):
    """A name as both this script and the page compare it: no accents, case, punctuation or Jr./III suffixes."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s.replace("'", "").replace(".", ""))
    return " ".join(w for w in s.split() if w not in ("jr", "sr", "ii", "iii", "iv", "v"))


class Budget:
    def __init__(self):
        self.left = None        # credits this run may still spend
        self.used = 0
        self.remaining = None   # on the plan, as the API last reported

    def update(self, headers):
        try:
            self.remaining = int(float(headers.get("x-requests-remaining")))
        except (TypeError, ValueError):
            return
        if self.left is None:
            cap = os.environ.get("ODDS_DAILY_CREDITS")
            today = date.today()
            nxt = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
            share = self.remaining // max(1, (nxt - today).days)
            self.left = int(cap) if cap else share
            print(f"odds: {self.remaining} credits left on the plan, {self.left} to spend today")


BUDGET = Budget()


def get(path, cost=0, **params):
    """One API call. cost is what it will charge, checked against today's share before calling."""
    if cost and BUDGET.left is not None and cost > BUDGET.left:
        raise RuntimeError("budget")
    q = urllib.parse.urlencode({"apiKey": KEY, **params})
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(API + path + "?" + q, headers={"User-Agent": "trade-scale"}), timeout=30) as r:
                BUDGET.update(r.headers)
                last = r.headers.get("x-requests-last")
                spent = int(float(last)) if last not in (None, "") else cost
                BUDGET.used += spent
                if BUDGET.left is not None:
                    BUDGET.left -= spent
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (401, 403, 422, 429) or i == 2:
                raise RuntimeError(f"{e.code} {e.read()[:200]!r}")
        except Exception:
            if i == 2:
                raise
        time.sleep(2 * (i + 1))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def price(v):
    v = num(v)
    return int(v) if v is not None else None


try:
    from zoneinfo import ZoneInfo
    EASTERN = ZoneInfo("America/New_York")
except Exception:
    EASTERN = timezone(timedelta(hours=-5))


def eastern_date(iso):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(EASTERN).date()
    except Exception:
        return None


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def slip_teams():
    """Team codes and nicknames per pro league, from the slip reader's table in site/assets/slip.js (one list for both)."""
    src = open(os.path.join(ROOT, "site", "assets", "slip.js"), encoding="utf-8").read()
    out = {}
    for sport, rows in re.findall(r"\b(nfl|nba|nhl|mlb): `([^`]*)`", src):
        teams = []
        for row in rows.strip().splitlines():
            parts = (row.split("|") + ["", "", "", ""])[:4]
            codes = {parts[0]} | {c for c in parts[3].split("/") if c}
            nicks = [norm(n) for n in parts[1].split("/") if n]
            cities = [norm(c) for c in parts[2].split("/") if c]
            teams.append((codes, nicks, cities))
        out[sport] = teams
    return out


def codes_for(teams, api_name):
    """The site's codes for a team as the odds feed names it ("Kansas City Chiefs" -> KC)."""
    n = norm(api_name)
    hits = [t for t in teams if any(n.endswith(" " + k) or n == k for k in t[1])]
    if len(hits) > 1:      # same nickname twice in one league: the city decides
        hits = [t for t in hits if any(n.startswith(c) for c in t[2])] or hits[:1]
    return hits[0][0] if hits else set()


def offer_links(bm, m, o):
    return o.get("link") or m.get("link") or bm.get("link")


# ---------- the trained model's chance at any book's line ----------
def model_over(doc, sport, key, line):
    m = (doc or {}).get("ml", {}).get(key)
    if not m or not m.get("l") or line is None:
        return None
    L, P = m["l"], m["p"]
    if len(L) == 1:
        return P[0] if abs(L[0] - line) < 0.01 or sport == "ufc" else None

    def at(x):
        if x < L[0] - 1e-6 or x > L[-1] + 1e-6:
            return None
        i = 0
        while i < len(L) - 2 and L[i + 1] < x:
            i += 1
        if x <= L[i]:
            return P[i]
        t = min(1, (x - L[i]) / (L[i + 1] - L[i]))
        return P[i] + t * (P[i + 1] - P[i])
    whole = not any(c in FLOAT_STATS.get(sport, set()) for c in key.split("+"))
    if whole and float(line).is_integer():
        return at(line + 0.5)        # over 25 on a whole stat wins on 26+, like over 25.5 (a 25 pushes)
    p = at(int(line) + 0.5 if whole else line)
    return round(p, 4) if p is not None else None


def player_docs(sport):
    d = os.path.join(PROPS, sport, "p")
    out = {}
    if not os.path.isdir(d):
        return out
    for name in os.listdir(d):
        doc = load(os.path.join(d, name))
        if doc and doc.get("ml"):
            out.setdefault(norm(doc.get("name")), []).append(doc)
    return out


# ---------- player props ----------
def prop_candidates(sport, best):
    """The picks the page shows for a sport, most important first: top picks, best overs, the parlay pool, then
    every same-game parlay leg (likeliest first)."""
    s = (best or {}).get("sports", {}).get(sport) or {}
    out = list(s.get("picks", [])) + list(s.get("overs", [])) + list(s.get("extra", []))
    sgp = load(os.path.join(PROPS, sport, "sgp.json")) or {}
    legs = [l for g in (sgp.get("games") or {}).values() for l in g.get("legs", [])]
    out += sorted(legs, key=lambda c: -c.get("p", 0))
    return [c for c in out if c.get("key") in MARKET.get(sport, {})]


def plan_props(sport, best, teams):
    """Which games to ask about (best first) and which markets in each, from the free events list."""
    cands = prop_candidates(sport, best)
    if not cands:
        return []
    events = get(f"{SPORT_KEY[sport]}/events")
    ev = []
    for e in events:
        codes = codes_for(teams, e.get("home_team")) | codes_for(teams, e.get("away_team"))
        ev.append((e, codes, eastern_date(e.get("commence_time", ""))))
    order, markets = [], {}
    for c in cands:
        try:
            day = date.fromisoformat(c["date"])
        except Exception:
            day = None
        for e, codes, d in ev:
            if c.get("team") in codes and (day is None or d is None or abs((d - day).days) <= 1):
                if e["id"] not in markets:
                    order.append(e)
                    markets[e["id"]] = {}
                mk = MARKET[sport][c["key"]]
                markets[e["id"]][mk] = markets[e["id"]].get(mk, 0) + 1
                break
    plan = []
    for e in order[:EVENTS_PER_SPORT]:
        mk = sorted(markets[e["id"]], key=lambda k: -markets[e["id"]][k])[:MAX_MARKETS]
        plan.append((sport, e, mk))
    return plan


def read_props(sport, event, docs, books, out):
    back = {v: k for k, v in MARKET[sport].items()}
    found = {}
    for bm in event.get("bookmakers", []):
        books[bm["key"]] = bm.get("title", bm["key"])
        for m in bm.get("markets", []):
            key = back.get(m.get("key"))
            if not key:
                continue
            for o in m.get("outcomes", []):
                who, side = o.get("description"), (o.get("name") or "").lower()
                line = num(o.get("point"))
                if not who or side not in ("over", "under") or line is None:
                    continue
                k = (norm(who), key, bm["key"], line)
                row = found.setdefault(k, {"name": who, "over": None, "under": None, "lo": None, "lu": None})
                row[side] = price(o.get("price"))
                row["lo" if side == "over" else "lu"] = offer_links(bm, m, o)
    # one line per book per prop: the main one (both sides posted, priced closest to even)
    best_line = {}
    for (who, key, book, line), r in found.items():
        both = r["over"] is not None and r["under"] is not None
        even = abs(abs(r["over"] or 200) - 110) + abs(abs(r["under"] or 200) - 110)
        rank = (0 if both else 1, even)
        cur = best_line.get((who, key, book))
        if cur is None or rank < cur[0]:
            best_line[(who, key, book)] = (rank, line, r)
    for (who, key, book), (_, line, r) in best_line.items():
        doc = (docs.get(who) or [None])[0]
        p = model_over(doc, sport, key, line)
        out.setdefault(sport, {}).setdefault(who, {}).setdefault(key, []).append(
            [book, line, r["over"], r["under"], p, r["lo"], r["lu"]])


# ---------- UFC fight winners ----------
def ufc_winners(best, books, out):
    if not ((best or {}).get("sports", {}).get("ufc") or {}).get("picks"):
        return
    docs = player_docs("ufc")
    for e in get(f"{SPORT_KEY['ufc']}/odds", cost=1 * len(REGIONS.split(",")), regions=REGIONS, markets="h2h",
                 oddsFormat="american", includeLinks="true"):
        for bm in e.get("bookmakers", []):
            books[bm["key"]] = bm.get("title", bm["key"])
            for m in bm.get("markets", []):
                if m.get("key") != "h2h":
                    continue
                for o in m.get("outcomes", []):
                    who = norm(o.get("name"))
                    doc = (docs.get(who) or [None])[0]
                    p = model_over(doc, "ufc", "win", 0)
                    out.setdefault("ufc", {}).setdefault(who, {}).setdefault("win", []).append(
                        [bm["key"], 0, price(o.get("price")), None, p, offer_links(bm, m, o), None])


# ---------- college game lines ----------
def college_lines(sport, books, out):
    d = load(os.path.join(PROPS, sport, "games.json"))
    if not d or not d.get("games"):
        return
    rows = {r[0]: r for r in d.get("teams", [])}
    names = lambda a: [norm(f"{rows[a][1]} {rows[a][2]}"), norm(rows[a][1]), norm(rows[a][3])] if a in rows else [norm(a)]
    sim = lambda api, a: max(SequenceMatcher(None, norm(api), n).ratio() for n in names(a) if n)
    events = get(f"{SPORT_KEY[sport]}/odds", cost=3 * len(REGIONS.split(",")), regions=REGIONS,
                 markets="h2h,spreads,totals", oddsFormat="american", includeLinks="true")
    by_day = {}
    for g in d["games"]:
        by_day.setdefault((g.get("start") or "")[:10], []).append(g)
    matched = 0
    for e in events:
        day = eastern_date(e.get("commence_time", ""))
        pool = []
        for dd in (day, day - timedelta(days=1), day + timedelta(days=1)) if day else ():
            pool += by_day.get(dd.isoformat(), [])
        best, flip = None, False
        for g in pool:
            for f in (False, True):
                h, a = (g["away"], g["home"]) if f else (g["home"], g["away"])
                s = min(sim(e["home_team"], h), sim(e["away_team"], a))
                if s >= 0.72 and (best is None or s > best[0]):
                    best, flip = (s, g), f
        if not best:
            continue
        g = best[1]
        matched += 1
        H, A = (e["away_team"], e["home_team"]) if flip else (e["home_team"], e["away_team"])
        offers = []
        for bm in e.get("bookmakers", []):
            books[bm["key"]] = bm.get("title", bm["key"])
            r = {"b": bm["key"], "ln": {}}
            for m in bm.get("markets", []):
                for o in m.get("outcomes", []):
                    nm, link = o.get("name"), offer_links(bm, m, o)
                    if m["key"] in ("h2h", "spreads") and nm in (H, A):
                        side = "H" if nm == H else "A"
                        if m["key"] == "h2h":
                            r["ml" + side] = price(o.get("price"))
                            r["ln"]["ml" + side] = link
                        else:
                            pt = num(o.get("point"))
                            if pt is not None:
                                if side == "H":
                                    r["sp"] = pt
                                r["sp" + side] = price(o.get("price"))
                                r["ln"]["sp" + side] = link
                    elif m["key"] == "totals" and nm in ("Over", "Under"):
                        r["t"] = num(o.get("point"))
                        r["o" if nm == "Over" else "u"] = price(o.get("price"))
                        r["ln"]["o" if nm == "Over" else "u"] = link
            if "sp" not in r and r.get("spA") is not None:
                for m in bm.get("markets", []):
                    for o in m.get("outcomes", []) if m["key"] == "spreads" else ():
                        if o.get("name") == A and num(o.get("point")) is not None:
                            r["sp"] = -num(o.get("point"))
            r["ln"] = {k: v for k, v in r["ln"].items() if v}
            if not r["ln"]:
                del r["ln"]
            if len(r) > 1:
                offers.append(r)
        if offers:
            out.setdefault(sport, {})[g["id"]] = offers
    print(f"odds {sport}: {len(events)} games in the feed, {matched} matched to the site's games")


def main():
    if not KEY:
        print("odds: no ODDS_API_KEY secret, skipping sportsbook odds (the page leaves the best-app lines out)")
        return
    get("")                      # the sports list is free and reports the plan's credits
    best = load(os.path.join(PROPS, "best.json"))
    teams = slip_teams()
    books, props, games = {}, {}, {}
    plans = []
    for sport in ("nfl", "nba", "nhl", "mlb"):
        try:
            plans.append(plan_props(sport, best, teams.get(sport, [])))
        except Exception as e:
            print(f"odds {sport}: couldn't list games ({str(e)[:120]})")
            plans.append([])
    # take turns across sports so every sport's best game gets priced before any sport's second game
    queue = [p for rnd in range(EVENTS_PER_SPORT) for pl in plans if rnd < len(pl) for p in [pl[rnd]]]
    docs, priced = {}, 0
    nreg = len(PROP_REGIONS.split(","))
    # keep enough of today's credits for the college game lines and UFC winners that run after the props
    greg = len(REGIONS.split(","))
    reserve = sum(3 * greg for sp in ("cfb", "cbb") if (load(os.path.join(PROPS, sp, "games.json")) or {}).get("games"))
    reserve += greg if ((best or {}).get("sports", {}).get("ufc") or {}).get("picks") else 0
    for sport, e, mk in queue:
        if BUDGET.left is not None:
            mk = mk[:max(0, (BUDGET.left - reserve) // nreg)]
        if not mk:
            break
        try:
            ev = get(f"{SPORT_KEY[sport]}/events/{e['id']}/odds", cost=len(mk) * nreg, regions=PROP_REGIONS,
                     markets=",".join(mk), oddsFormat="american", includeLinks="true")
        except Exception as ex:
            print(f"odds {sport}: {e.get('away_team')} at {e.get('home_team')} skipped ({str(ex)[:100]})")
            continue
        if sport not in docs:
            docs[sport] = player_docs(sport)
        read_props(sport, ev, docs[sport], books, props)
        priced += 1
        print(f"odds {sport}: {e.get('away_team')} at {e.get('home_team')}, {len(mk)} markets, {len(ev.get('bookmakers', []))} books")
    for job in (lambda: college_lines("cfb", books, games), lambda: college_lines("cbb", books, games),
                lambda: ufc_winners(best, books, props)):
        try:
            job()
        except Exception as e:
            print(f"odds: game lines step skipped ({str(e)[:120]})")
    out = {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "source": "The Odds API", "regions": REGIONS,
           "prop_regions": PROP_REGIONS,
           "credits": {"used": BUDGET.used, "remaining": BUDGET.remaining}, "games_priced": priced,
           "books": books, "props": props, "games": games}
    os.makedirs(PROPS, exist_ok=True)
    with open(os.path.join(PROPS, "odds.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    n = sum(len(v) for s in props.values() for v in s.values())
    print(f"odds: {len(books)} books, {n} player props across {priced} games, {sum(len(v) for v in games.values())} college games; "
          f"{BUDGET.used} credits used, {BUDGET.remaining} left on the plan")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"odds: FAILED ({e}); the page goes without sportsbook odds today")
        sys.exit(0)
