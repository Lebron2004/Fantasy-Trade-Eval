#!/usr/bin/env python3
"""
Trade Scale daily updater.

Pulls every rostered player for NFL, NBA, MLB and NHL from free public APIs,
gives each one a 1-100 trade value, and writes:

  site/data/<sport>.json   players for the app
  site/data/moves.json     team changes (trades, signings, releases) detected since the last run
  site/data/meta.json      when each sport last updated and whether it worked

If one sport's source fails, its previous file is kept so the site never goes blank.
Standard library only, no pip installs needed.

Run locally:  python scripts/update_players.py          (all sports)
              python scripts/update_players.py nfl nhl  (just some)
"""
import json, math, os, sys, time, urllib.parse, urllib.request
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
UA = {"User-Agent": "TradeScale/1.0 (personal fantasy trade analyzer)"}
BROWSER_UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
IDMAPS = {}   # sport -> {"espn": {...}, "yahoo": {...}}, written for the league sync script
TODAY = date.today()
MAX_MOVES = 300


# ---------------------------------------------------------------- helpers
def get_json(url, params=None, tries=3, browser=False):
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params, doseq=True)
    last = None
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers=BROWSER_UA if browser else UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # network hiccup, 5xx, bad JSON
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def rank_value(rank, k):
    """Rank 1 -> 100, then exponential decay. k controls how fast value drops."""
    return max(1, round(100 * math.exp(-(rank - 1) / k)))


def values_from_scores(scores, k, rank_negatives=False):
    """scores: {id: number}. Returns {id: value} ranked best to worst."""
    ordered = sorted(scores, key=lambda i: scores[i], reverse=True)
    return {pid: (rank_value(i + 1, k) if (rank_negatives or scores[pid] > 0) else 1) for i, pid in enumerate(ordered)}


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def make_row(pid, name, team, pos, born, inj, prod, outlook, elig, extra=None):
    """[id, name, team, pos, born, value, injury, track_record, outlook, eligible_positions]
    value is the default blend (60% outlook, 40% track record); the app lets people re-weight it."""
    if prod is not None and outlook is not None:
        value = round(0.6 * outlook + 0.4 * prod)
    else:
        value = outlook if outlook is not None else (prod if prod is not None else 1)
    return [pid, name, team, pos, born, value, inj, prod, outlook, elig or pos, extra or None]


def age_on(born):
    try:
        b = date.fromisoformat(born[:10])
    except (TypeError, ValueError):
        return None
    return TODAY.year - b.year - ((TODAY.month, TODAY.day) < (b.month, b.day))


def age_mult(born, peak):
    """Outlook bump for players still climbing toward their peak, discount for those past it."""
    age = age_on(born)
    if age is None:
        return 1.0
    if age < peak - 3:
        return 1 + min(0.12, (peak - 3 - age) * 0.03)
    if age > peak + 1:
        return max(0.6, 1 - (age - peak - 1) * 0.05)
    return 1.0


def outlook_score(cur_pts, cur_g, prev_pts, prev_g, prev_w, full_games, shrink, born, peak):
    """Per-game quality (recent games weighted more) projected over a full healthy season."""
    g = cur_g + prev_w * prev_g
    if g <= 0:
        return None
    rate = (cur_pts + prev_w * prev_pts) / g
    return rate * (g / (g + shrink)) * full_games * age_mult(born, peak)


# ---------------------------------------------------------------- NFL / NBA (Sleeper)
SLEEPER_POS = {
    "nfl": {"QB", "RB", "WR", "TE", "K", "DEF"},
    "nba": {"PG", "SG", "SF", "PF", "C", "G", "F"},
}
SLEEPER_K = {"nfl": 180, "nba": 110}
FULL_GAMES = {"nfl": 17, "nba": 82}
# How many players at each spot a typical 12-team league starts (incl. flex share): the replacement line.
NFL_REPLACEMENT = {"QB": 13, "RB": 30, "WR": 38, "TE": 13, "K": 12, "DEF": 12}
# Share of rest-of-season production a player is expected to keep, by injury designation.
HEALTH = {"IR": 0.35, "PUP": 0.4, "NA": 0.5, "Out": 0.8, "Sus": 0.8, "Doubtful": 0.9, "Questionable": 0.97}
ESPN_TO_SLEEPER = {"WSH": "WAS"}
DEF_POS = ("QB", "RB", "WR", "TE")


def sleeper_stats(sport, season):
    """Season totals keyed by player id. Undocumented endpoint, so parse defensively."""
    try:
        data = get_json(f"https://api.sleeper.app/v1/stats/{sport}/regular/{season}", tries=2)
    except RuntimeError as e:
        print(f"  {sport} {season} stats unavailable: {e}", file=sys.stderr)
        return {}
    if isinstance(data, list):
        data = {str(r.get("player_id")): (r.get("stats") or r) for r in data if isinstance(r, dict)}
    return data if isinstance(data, dict) else {}


def sleeper_points(sport, st):
    if not isinstance(st, dict):
        return 0.0, 0
    gp = st.get("gp") or st.get("gms_active") or 0
    if sport == "nfl":
        pts = st.get("pts_ppr") or 0
    else:
        pts = ((st.get("pts") or 0) + 1.2 * (st.get("reb") or 0) + 1.5 * (st.get("ast") or 0)
               + 3 * (st.get("stl") or 0) + 3 * (st.get("blk") or 0) - (st.get("to") or 0))
        if not pts:
            pts = st.get("pts_std") or st.get("pts_ppr") or 0
    return float(pts), gp


# ---- NFL deep model: schedule, weekly lines, defense vs position, projections
def nfl_schedule(season):
    """{week: [(home, away, completed), ...]} from ESPN's public scoreboard."""
    sched = {}
    for w in range(1, 19):
        try:
            d = get_json("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard",
                         {"seasontype": 2, "week": w, "dates": season}, tries=2)
        except RuntimeError:
            continue
        games = []
        for ev in d.get("events") or []:
            comp = (ev.get("competitions") or [{}])[0]
            side = {}
            for c in comp.get("competitors") or []:
                ab = ((c.get("team") or {}).get("abbreviation") or "").upper()
                side[c.get("homeAway")] = ESPN_TO_SLEEPER.get(ab, ab)
            done = bool(((ev.get("status") or {}).get("type") or {}).get("completed"))
            if "home" in side and "away" in side:
                games.append((side["home"], side["away"], done))
        if games:
            sched[w] = games
    return sched


def sleeper_week(season, week):
    """{pid: {pts, team, opp, tgt, att}} for one week. Tries the endpoint Sleeper's own app uses
    (includes team/opponent), then falls back to the older v1 endpoint."""
    rows = None
    try:
        data = get_json(f"https://api.sleeper.com/stats/nfl/{season}/{week}", {"season_type": "regular"},
                        tries=1, browser=True)
        if isinstance(data, list) and data:
            rows = {str(r.get("player_id")): r for r in data if isinstance(r, dict)}
    except RuntimeError:
        pass
    if rows is None:
        try:
            d = get_json(f"https://api.sleeper.app/v1/stats/nfl/regular/{season}/{week}", tries=2)
        except RuntimeError:
            return {}
        if isinstance(d, list):
            rows = {str(r.get("player_id")): r for r in d if isinstance(r, dict)}
        elif isinstance(d, dict):
            rows = {k: {"stats": v} for k, v in d.items()}
        else:
            return {}
    out = {}
    for pid, r in rows.items():
        st = r.get("stats") if isinstance(r.get("stats"), dict) else r
        if not isinstance(st, dict):
            continue
        pts = st.get("pts_ppr")
        if pts is None and not st.get("gp"):
            continue
        opp = r.get("opponent")
        out[pid] = {"pts": float(pts or 0), "team": r.get("team"),
                    "opp": ESPN_TO_SLEEPER.get(opp, opp) if opp else None,
                    "tgt": st.get("rec_tgt") or 0, "att": st.get("rush_att") or 0}
    return out


def defense_table(sched, weeks, pos_of, team_now):
    """Fantasy points each defense allows per game to QB/RB/WR/TE, relative to league average.
    Returns {team: {pos: [factor, games]}}; factor 1.10 = allows 10% more than average."""
    opp_of, games = {}, {}
    for w, gl in sched.items():
        for h, a, done in gl:
            if done:
                opp_of[(w, h)], opp_of[(w, a)] = a, h
                games[h] = games.get(h, 0) + 1
                games[a] = games.get(a, 0) + 1
    allowed = {}
    for w, lines in weeks.items():
        for pid, ln in lines.items():
            pos = pos_of.get(pid)
            if pos not in DEF_POS:
                continue
            team = ln.get("team") or team_now.get(pid)
            opp = opp_of.get((w, team)) or ln.get("opp")
            if not opp or opp not in games:
                continue
            a = allowed.setdefault(opp, {})
            a[pos] = a.get(pos, 0) + ln["pts"]
    table = {}
    for pos in DEF_POS:
        rates = {d: allowed.get(d, {}).get(pos, 0) / g for d, g in games.items() if g}
        avg = sum(rates.values()) / len(rates) if rates else 0
        for d, r in rates.items():
            table.setdefault(d, {})[pos] = [round(r / avg, 3) if avg else 1.0, games[d]]
    return table


def prior_defense(season, pos_of, team_now):
    """Last season's defense table, computed once and cached (it never changes)."""
    path = os.path.join(DATA, "cache", f"nfl-def-{season}.json")
    cached = load(path, None)
    if cached is not None:
        return cached
    sched = nfl_schedule(season)
    if not sched:
        return {}
    weeks = {w: sleeper_week(season, w) for w in sorted(sched)}
    tbl = defense_table(sched, weeks, pos_of, team_now)
    if tbl:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        save(path, tbl)
    return tbl


def sleeper_projections(season):
    """Season projections {pid: (pts_ppr, games)} from the endpoint Sleeper's app uses. Optional."""
    try:
        data = get_json(f"https://api.sleeper.com/projections/nfl/{season}",
                        {"season_type": "regular", "position[]": ["QB", "RB", "WR", "TE", "K", "DEF"]},
                        tries=2, browser=True)
    except RuntimeError as e:
        print(f"  nfl projections unavailable: {e}", file=sys.stderr)
        return {}
    rows = data if isinstance(data, list) else [{"player_id": k, "stats": v} for k, v in (data or {}).items()]
    out = {}
    for r in rows:
        if not isinstance(r, dict):
            continue
        st = r.get("stats") if isinstance(r.get("stats"), dict) else r
        pts = st.get("pts_ppr") if isinstance(st, dict) else None
        if pts:
            out[str(r.get("player_id"))] = (float(pts), st.get("gp") or 17)
    return out


def nfl_context(season, raw):
    """Everything the NFL model needs beyond season totals."""
    sched = nfl_schedule(season)
    pos_of = {str(k): v.get("position") for k, v in raw.items()}
    team_now = {str(k): v.get("team") for k, v in raw.items()}
    done_weeks = sorted({w for w, gl in sched.items() if any(g[2] for g in gl)})
    weeks = {w: sleeper_week(season, w) for w in done_weeks}
    cur = defense_table(sched, weeks, pos_of, team_now)
    prior = prior_defense(season - 1, pos_of, team_now)
    # Blend: last season (regressed 30% toward average, rosters change) as a 6-game prior, then this season.
    K, dfac = 6, {}
    for d in set(cur) | set(prior):
        for pos in DEF_POS:
            c, g = (cur.get(d, {}).get(pos) or [1.0, 0])
            pr = 1 + ((prior.get(d, {}).get(pos) or [1.0])[0] - 1) * 0.7
            dfac.setdefault(d, {})[pos] = round((pr * K + c * g) / (K + g), 3)
    remaining, nxt = {}, {}
    open_weeks = [w for w, gl in sched.items() if any(not g[2] for g in gl)]
    this_week = min(open_weeks) if open_weeks else None
    # Teams with a game this week, played or not: everyone else is on bye. (Comparing next-game week to
    # this_week alone marks every team that already played as on bye while a Monday game is still open.)
    playing = {t for g in sched.get(this_week, []) for t in g[:2]}
    for w in sorted(sched):
        for h, a, done in sched[w]:
            if done:
                continue
            remaining.setdefault(h, []).append(a)
            remaining.setdefault(a, []).append(h)
            nxt.setdefault(h, (w, "vs " + a, a))
            nxt.setdefault(a, (w, "@" + h, h))
    return {"sched": sched, "weeks": weeks, "dfac": dfac, "remaining": remaining, "next": nxt,
            "this_week": this_week, "playing": playing, "proj": sleeper_projections(season), "season_over": bool(sched) and not open_weeks}


def recent_form(pid, weeks, n=4):
    lines = [weeks[w][pid] for w in sorted(weeks, reverse=True) if pid in weeks[w]][:n]
    if len(lines) < 2:
        return None, None
    ppg = sum(l["pts"] for l in lines) / len(lines)
    use = sum(l["tgt"] + l["att"] for l in lines) / len(lines)
    return ppg, use


def write_defense_report(ctx):
    teams = {}
    for d, row in ctx["dfac"].items():
        teams[d] = {pos: row.get(pos, 1.0) for pos in DEF_POS}
    for pos in DEF_POS:  # rank 1 = toughest (allows the fewest points)
        for i, d in enumerate(sorted(teams, key=lambda t: teams[t][pos])):
            teams[d][pos] = [teams[d][pos], i + 1]
    save(os.path.join(DATA, "nfl-defense.json"),
         {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "week": ctx["this_week"],
          "next": {t: v[1] for t, v in ctx["next"].items()}, "teams": teams})


def write_results(ctx, pos_of):
    """Each finished week's PPR points and opponent per player, so the league page can grade its own
    projections against what actually happened and retune itself (see comanager.js)."""
    weeks = {}
    for w, rows in ctx["weeks"].items():
        out = {pid: [round(r["pts"], 1), r["opp"] or ""] for pid, r in rows.items() if pos_of.get(pid) in DEF_POS}
        if out:
            weeks[str(w)] = out
    save(os.path.join(DATA, "nfl-results.json"),
         {"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "week": ctx["this_week"], "weeks": weeks})


def fetch_sleeper(sport):
    # Sleeper asks that this be called at most once a day, which is exactly what we do.
    raw = get_json(f"https://api.sleeper.app/v1/players/{sport}")
    try:
        season = int(get_json(f"https://api.sleeper.app/v1/state/{sport}")["season"])
    except Exception:
        season = TODAY.year if TODAY.month >= (9 if sport == "nfl" else 10) else TODAY.year - 1
    cur_stats, prev_stats = sleeper_stats(sport, season), sleeper_stats(sport, season - 1)
    max_gp = max([sleeper_points(sport, v)[1] for v in cur_stats.values()] or [0])
    prev_w = max(0.2, 1 - max_gp / FULL_GAMES[sport])
    ctx = None
    if sport == "nfl":
        try:
            ctx = nfl_context(season, raw)
        except Exception as e:  # the deep model is a bonus; never let it sink the whole sport
            print(f"  nfl matchup model skipped: {e}", file=sys.stderr)

    rows, ids = [], {"espn": {}, "yahoo": {}}
    for pid, p in raw.items():
        team = p.get("team")
        pos = p.get("position")
        if not team or pos not in SLEEPER_POS[sport]:
            continue
        if p.get("active") is False:
            continue
        pid = str(pid)
        name = p.get("full_name") or f"{p.get('first_name') or ''} {p.get('last_name') or ''}".strip()
        elig = [x for x in (p.get("fantasy_positions") or [pos]) if x in SLEEPER_POS[sport]] or [pos]
        cp, cg = sleeper_points(sport, cur_stats.get(pid))
        pp, pg = sleeper_points(sport, prev_stats.get(pid))
        for k in ("espn", "yahoo"):
            if p.get(f"{k}_id"):
                ids[k][str(p[f"{k}_id"])] = pid
        rows.append({"id": pid, "name": name, "team": team, "pos": pos, "elig": "/".join(elig),
                     "born": p.get("birth_date") or "", "rank": p.get("search_rank") or 9_999_999,
                     "inj": p.get("injury_status") or "", "cp": cp, "cg": cg, "pp": pp, "pg": pg,
                     "score": cp + prev_w * pp if (pid in cur_stats or pid in prev_stats) else None})
    if len(rows) < 200:
        raise RuntimeError(f"Sleeper {sport} returned only {len(rows)} players")
    IDMAPS[sport] = ids
    rows.sort(key=lambda r: r["rank"])
    prod = values_from_scores({r["id"]: r["score"] for r in rows if r["score"] is not None}, SLEEPER_K[sport])
    rank_val = {r["id"]: (rank_value(i + 1, SLEEPER_K[sport]) if r["rank"] < 9_999_999 else 1) for i, r in enumerate(rows)}
    extras, model = {}, {}

    if sport == "nfl" and ctx:
        # Expected points per game from four signals, then rest-of-season points with schedule and health.
        ros = {}
        for r in rows:
            pid, pos, team = r["id"], r["pos"], r["team"]
            form, use = recent_form(pid, ctx["weeks"])
            cur_ppg = r["cp"] / r["cg"] if r["cg"] else None
            prev_ppg = r["pp"] / r["pg"] if r["pg"] else None
            pj = ctx["proj"].get(pid)
            proj_ppg = pj[0] / pj[1] if pj and pj[1] else None
            parts = [(proj_ppg, 0.40), (form, 0.25), (cur_ppg, 0.20), (prev_ppg, 0.15)]
            wsum = sum(w for v, w in parts if v is not None)
            exp_ppg = sum(v * w for v, w in parts if v is not None) / wsum if wsum else None
            opps = ctx["remaining"].get(team, [])
            facs = [ctx["dfac"].get(o, {}).get(pos, 1.0) for o in opps] if pos in DEF_POS else []
            sos = sum(facs) / len(facs) if facs else 1.0
            nx = ctx["next"].get(team)
            mu = ctx["dfac"].get(nx[2], {}).get(pos, 1.0) if (nx and pos in DEF_POS) else 1.0
            games_left = len(opps) if not ctx["season_over"] and ctx["sched"] else 17
            health = HEALTH.get(r["inj"], 1.0)
            if exp_ppg is not None:
                ros[pid] = exp_ppg * (1 + 0.6 * (sos - 1)) * games_left * health
            bye = bool(ctx["this_week"]) and team not in ctx["playing"]
            extras[pid] = {k: v for k, v in {
                "nx": "BYE" if bye else (nx[1] if nx else None), "mu": round(mu, 2) if pos in DEF_POS else None,
                "sos": round(sos, 2) if facs else None, "ppg": round(cur_ppg, 1) if cur_ppg else None,
                "form": round(form, 1) if form is not None else None, "proj": round(proj_ppg, 1) if proj_ppg else None,
                "use": round(use, 1) if use and pos in ("RB", "WR", "TE") else None, "gl": games_left}.items() if v is not None}
        # Value over replacement: points above what a free agent at the same position would give you.
        by_pos = {}
        for r in rows:
            if r["id"] in ros:
                by_pos.setdefault(r["pos"], []).append(ros[r["id"]])
        repl = {}
        for pos, lst in by_pos.items():
            lst.sort(reverse=True)
            n = NFL_REPLACEMENT.get(pos, 12)
            repl[pos] = lst[min(n, len(lst) - 1)]
        vor = {r["id"]: ros[r["id"]] - repl[r["pos"]] for r in rows if r["id"] in ros}
        model = values_from_scores(vor, SLEEPER_K[sport], rank_negatives=True)
        write_defense_report(ctx)
        write_results(ctx, {r["id"]: r["pos"] for r in rows})
    elif sport == "nba":
        rates = {}
        for r in rows:
            g = r["cg"] + prev_w * r["pg"]
            if g > 0:
                rate = (r["cp"] + prev_w * r["pp"]) / g
                rates[r["id"]] = rate * (g / (g + 10)) * age_mult(r["born"], 27)
                extras[r["id"]] = {"ppg": round(r["cp"] / r["cg"], 1)} if r["cg"] else {}
        model = values_from_scores(rates, SLEEPER_K[sport])

    out = []
    for r in rows:
        rv, mv = rank_val[r["id"]], model.get(r["id"])
        if mv is None:
            outlook = rv
        elif sport == "nfl":
            outlook = round(0.7 * mv + 0.3 * rv)   # our projection model, checked against Sleeper's market ranking
        else:
            outlook = round(0.6 * rv + 0.4 * mv)
        out.append(make_row(r["id"], r["name"], r["team"], r["pos"], r["born"], r["inj"],
                            prod.get(r["id"]), outlook, r["elig"], extras.get(r["id"])))
    out.sort(key=lambda x: -x[5])
    return out


# ---------------------------------------------------------------- MLB (statsapi.mlb.com)
MLB = "https://statsapi.mlb.com/api/v1"


def ip_to_innings(ip):
    try:
        whole, _, frac = str(ip).partition(".")
        return int(whole or 0) + int(frac or 0) / 3
    except ValueError:
        return 0.0


def mlb_points(season):
    """Head-to-head points style scoring, summed per player (two-way players get both)."""
    pts, starts, hgames = {}, {}, {}
    for group in ("hitting", "pitching"):
        data = get_json(f"{MLB}/stats", {
            "stats": "season", "group": group, "gameType": "R", "season": season,
            "sportId": 1, "playerPool": "ALL", "limit": 3000,
        })
        splits = (data.get("stats") or [{}])[0].get("splits", [])
        for s in splits:
            pid = str(s["player"]["id"]); st = s.get("stat", {})
            if group == "hitting":
                p = (st.get("totalBases", 0) + st.get("runs", 0) + st.get("rbi", 0)
                     + st.get("baseOnBalls", 0) + st.get("stolenBases", 0) - st.get("strikeOuts", 0))
                hgames[pid] = hgames.get(pid, 0) + st.get("gamesPlayed", 0)
            else:
                p = (3 * ip_to_innings(st.get("inningsPitched", 0)) + st.get("strikeOuts", 0)
                     - st.get("hits", 0) - 2 * st.get("earnedRuns", 0) - st.get("baseOnBalls", 0)
                     + 2 * st.get("wins", 0) - 2 * st.get("losses", 0)
                     + 5 * st.get("saves", 0) + 2 * st.get("holds", 0))
                gs, gp = starts.get(pid, (0, 0))
                starts[pid] = (gs + st.get("gamesStarted", 0), gp + st.get("gamesPitched", 0))
            pts[pid] = pts.get(pid, 0) + p
    return pts, starts, hgames


def fetch_mlb():
    year = TODAY.year
    cur, prev = year, year - 1
    opening = date(year, 3, 27)
    progress = clamp((TODAY - opening).days / 185, 0, 1)

    # Map every affiliate (MLB + minors) to its big-league org abbreviation.
    teams = get_json(f"{MLB}/teams", {"sportIds": "1,11,12,13,14,16"}).get("teams", [])
    mlb_abbr = {t["id"]: t["abbreviation"] for t in teams if t.get("sport", {}).get("id") == 1}
    org = {}
    for t in teams:
        parent = t.get("parentOrgId") or t["id"]
        if parent in mlb_abbr:
            org[t["id"]] = mlb_abbr[parent]

    people = get_json(f"{MLB}/sports/1/players", {"season": cur}).get("people", [])
    if len(people) < 500:
        people = get_json(f"{MLB}/sports/1/players", {"season": prev}).get("people", [])

    cur_pts, cur_starts, cur_hg = mlb_points(cur)
    prev_pts, prev_starts, prev_hg = mlb_points(prev)
    prev_w = max(0.2, 1 - progress)  # early season leans on last year, late season on this year

    scores, outlooks, meta = {}, {}, {}
    for p in people:
        if p.get("active") is False:
            continue
        pid = str(p["id"])
        team = org.get((p.get("currentTeam") or {}).get("id"))
        if not team:
            continue
        pos = (p.get("primaryPosition") or {}).get("abbreviation", "")
        if pos in ("LF", "CF", "RF"):
            pos = "OF"
        elif pos == "TWP":
            pos = "DH/SP"
        elif pos == "P":
            gs, gp = cur_starts.get(pid) or prev_starts.get(pid) or (0, 0)
            pos = "SP" if gp and gs / gp >= 0.4 else "RP"
        born = p.get("birthDate", "")
        if pid in cur_pts or pid in prev_pts:
            scores[pid] = cur_pts.get(pid, 0) + prev_w * prev_pts.get(pid, 0)
            if pos == "SP":
                g_cur, g_prev, full, shrink = cur_starts.get(pid, (0, 0))[0], prev_starts.get(pid, (0, 0))[0], 30, 5
            elif pos == "RP":
                g_cur, g_prev, full, shrink = cur_starts.get(pid, (0, 0))[1], prev_starts.get(pid, (0, 0))[1], 65, 12
            else:
                g_cur, g_prev, full, shrink = cur_hg.get(pid, 0), prev_hg.get(pid, 0), 150, 20
            o = outlook_score(cur_pts.get(pid, 0), g_cur, prev_pts.get(pid, 0), g_prev, prev_w, full, shrink, born, 28)
            if o is not None:
                outlooks[pid] = o
        meta[pid] = (p.get("fullName", ""), team, pos, born)
    if len(meta) < 500:
        raise RuntimeError(f"MLB returned only {len(meta)} players")
    prod, look = values_from_scores(scores, 140), values_from_scores(outlooks, 140)
    out = [make_row(pid, m[0], m[1], m[2], m[3], "", prod.get(pid), look.get(pid), m[2]) for pid, m in meta.items()]
    out.sort(key=lambda r: -r[5])
    return out


# ---------------------------------------------------------------- NHL (api-web.nhle.com + api.nhle.com/stats)
NHL_WEB = "https://api-web.nhle.com/v1"
NHL_STATS = "https://api.nhle.com/stats/rest/en"
NHL_POS = {"L": "LW", "R": "RW", "C": "C", "D": "D", "G": "G"}


def nhl_stats(kind, season):
    sort = json.dumps([{"property": "gamesPlayed", "direction": "DESC"},
                       {"property": "playerId", "direction": "ASC"}])
    data = get_json(f"{NHL_STATS}/{kind}/summary", {
        "isAggregate": "false", "isGame": "false", "sort": sort, "start": 0, "limit": -1,
        "cayenneExp": f"seasonId={season} and gameTypeId=2",
    })
    return data.get("data", [])


def nhl_points(season):
    pts, games, max_gp = {}, {}, 0
    for s in nhl_stats("skater", season):
        pid = str(s["playerId"])
        max_gp = max(max_gp, s.get("gamesPlayed") or 0)
        games[pid] = s.get("gamesPlayed") or 0
        pts[pid] = (3 * (s.get("goals") or 0) + 2 * (s.get("assists") or 0)
                    + 0.5 * (s.get("ppPoints") or 0) + 0.3 * (s.get("shots") or 0)
                    + 0.3 * (s.get("plusMinus") or 0))
    for g in nhl_stats("goalie", season):
        pid = str(g["playerId"])
        games[pid] = g.get("gamesPlayed") or 0
        pts[pid] = (5 * (g.get("wins") or 0) + 3 * (g.get("shutouts") or 0)
                    + 0.2 * (g.get("saves") or 0) - (g.get("goalsAgainst") or 0))
    return pts, games, max_gp


def fetch_nhl():
    start = TODAY.year if TODAY.month >= 9 else TODAY.year - 1
    cur, prev = f"{start}{start + 1}", f"{start - 1}{start}"

    standings = get_json(f"{NHL_WEB}/standings/now").get("standings", [])
    abbrs = sorted({t["teamAbbrev"]["default"] for t in standings})
    if len(abbrs) < 30:
        raise RuntimeError(f"NHL standings returned only {len(abbrs)} teams")

    meta = {}
    for abbr in abbrs:
        roster = get_json(f"{NHL_WEB}/roster/{abbr}/current")
        for grp in ("forwards", "defensemen", "goalies"):
            for p in roster.get(grp, []):
                name = f"{p['firstName']['default']} {p['lastName']['default']}"
                meta[str(p["id"])] = (name, abbr, NHL_POS.get(p.get("positionCode"), p.get("positionCode", "")),
                                      p.get("birthDate", ""))
        time.sleep(0.3)  # be polite

    sos = nhl_schedule_strength(standings, abbrs)
    cur_pts, cur_games, cur_gp = nhl_points(cur)
    prev_pts, prev_games, _ = nhl_points(prev)
    prev_w = max(0.2, 1 - cur_gp / 82)
    scores, outlooks, extras = {}, {}, {}
    for pid, m in meta.items():
        team_sos = sos.get(m[1], {})
        s_key = "g" if m[2] == "G" else "s"
        if pid in cur_pts or pid in prev_pts:
            scores[pid] = cur_pts.get(pid, 0) + prev_w * prev_pts.get(pid, 0)
            full = 60 if m[2] == "G" else 82
            o = outlook_score(cur_pts.get(pid, 0), cur_games.get(pid, 0), prev_pts.get(pid, 0),
                              prev_games.get(pid, 0), prev_w, full, 15, m[3], 27)
            if o is not None:
                outlooks[pid] = o * (1 + 0.5 * (team_sos.get(s_key, 1.0) - 1))
        if team_sos:
            extras[pid] = {"sos": round(team_sos.get(s_key, 1.0), 2), "gl": team_sos.get("gl")}
    prod, look = values_from_scores(scores, 120), values_from_scores(outlooks, 120)
    out = [make_row(pid, m[0], m[1], m[2], m[3], "", prod.get(pid), look.get(pid), m[2], extras.get(pid))
           for pid, m in meta.items()]
    out.sort(key=lambda r: -r[5])
    return out


def nhl_schedule_strength(standings, abbrs):
    """Average opponent strength over each team's remaining regular-season games.
    Skaters: how many goals opponents allow. Goalies: how many goals opponents score.
    Early in a season, each team's rate is regressed toward league average."""
    rate = {}
    for t in standings:
        ab, gp = t["teamAbbrev"]["default"], t.get("gamesPlayed") or 0
        if gp:
            rate[ab] = ((t.get("goalAgainst") or 0) / gp, (t.get("goalFor") or 0) / gp, gp)
    if not rate:
        return {}
    avg_ga = sum(v[0] for v in rate.values()) / len(rate)
    avg_gf = sum(v[1] for v in rate.values()) / len(rate)
    fac = {ab: (1 + (ga / avg_ga - 1) * gp / (gp + 15), 1 - (gf / avg_gf - 1) * gp / (gp + 15))
           for ab, (ga, gf, gp) in rate.items()}
    out = {}
    for ab in abbrs:
        try:
            games = get_json(f"{NHL_WEB}/club-schedule-season/{ab}/now").get("games", [])
        except RuntimeError:
            continue
        opps = []
        for g in games:
            if g.get("gameType") != 2 or g.get("gameState") not in ("FUT", "PRE"):
                continue
            home, away = g["homeTeam"]["abbrev"], g["awayTeam"]["abbrev"]
            opps.append(away if home == ab else home)
        if opps:
            sk = [fac.get(o, (1, 1))[0] for o in opps]
            gl = [fac.get(o, (1, 1))[1] for o in opps]
            out[ab] = {"s": sum(sk) / len(sk), "g": sum(gl) / len(gl), "gl": len(opps)}
        time.sleep(0.2)
    return out


# ---------------------------------------------------------------- main
FETCHERS = {"nfl": lambda: fetch_sleeper("nfl"), "nba": lambda: fetch_sleeper("nba"),
            "mlb": fetch_mlb, "nhl": fetch_nhl}


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


def diff_moves(sport, old_players, new_players, stamp):
    """A player whose team changed since the last run is a move (trade, signing or release)."""
    old = {r[0]: r for r in old_players}
    moves = []
    for r in new_players:
        o = old.get(r[0])
        if o and o[2] != r[2]:
            moves.append({"date": stamp, "sport": sport, "id": r[0], "name": r[1],
                          "from": o[2] or "FA", "to": r[2] or "FA", "value": r[5]})
    moves.sort(key=lambda m: -m["value"])
    return moves


def main():
    os.makedirs(DATA, exist_ok=True)
    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    meta = load(os.path.join(DATA, "meta.json"), {})
    moves = load(os.path.join(DATA, "moves.json"), [])
    failures = 0
    only = sys.argv[1:] or list(FETCHERS)

    for sport in only:
        path = os.path.join(DATA, f"{sport}.json")
        try:
            players = FETCHERS[sport]()
            old = load(path, {}).get("players", [])
            new_moves = diff_moves(sport, old, players, stamp) if old else []
            save(path, {"sport": sport, "updated": stamp, "players": players})
            moves = new_moves + moves
            meta[sport] = {"updated": stamp, "ok": True, "count": len(players)}
            print(f"{sport}: {len(players)} players, {len(new_moves)} team changes")
        except Exception as e:
            failures += 1
            prev = meta.get(sport, {})
            meta[sport] = {**prev, "ok": False, "error": str(e)[:300], "tried": stamp}
            print(f"{sport}: FAILED, kept previous data. {e}", file=sys.stderr)

    if IDMAPS:
        os.makedirs(os.path.join(DATA, "ids"), exist_ok=True)
        for sp, m in IDMAPS.items():
            save(os.path.join(DATA, "ids", f"{sp}.json"), m)
    save(os.path.join(DATA, "moves.json"), moves[:MAX_MOVES])
    save(os.path.join(DATA, "meta.json"), meta)
    # Only fail the job if every sport failed, so one flaky API doesn't block the others.
    sys.exit(1 if failures == len(only) else 0)


if __name__ == "__main__":
    main()
