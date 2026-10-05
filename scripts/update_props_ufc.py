#!/usr/bin/env python3
"""
Trade Scale props builder for UFC fights.

Treats every fighter like a player whose "team" is himself, so the Props page, the trained model and best bets handle
fights the same way as games. Per fight it records:
  win   won the fight (1 or 0)             ko / sub / dec   won by KO/TKO, by submission, by decision
  dist  the fight went the distance        rnd              rounds fought (2.5 = halfway through round 3)
  sig   significant strikes landed         str              total strikes landed
  tdl   takedowns landed                   kd               knockdowns          ctrl   control time (minutes)
"Defense" is what each opponent gives up per fight (strikes absorbed, takedowns allowed, losses), by weight class.

Writes, like the other builders:
  site/data/props/ufc/index.json     fighters + each fighter's next bout (opponent, date, scheduled rounds)
  site/data/props/ufc/defense.json   what each fighter allows per fight
  site/data/props/ufc/p/<id>.json    fight log

Sources: UFCStats.com fight results and round-by-round stats, from the scrape_ufc_stats project (refreshed after every
event: github.com/Greco1899/scrape_ufc_stats). The upcoming card comes from ESPN's public MMA scoreboard, with
UFCStats.com's upcoming events page as a fallback. Needs pandas.

Run: python scripts/update_props_ufc.py           (build)
     python scripts/update_props_ufc.py --check   (only fetch and print the upcoming card, writes nothing)
"""
import io, json, os, re, sys, unicodedata, urllib.parse
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from update_props_more import DATA, TODAY, build_sport, fetch  # noqa: E402

RAW = "https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
UFCSTATS = "http://ufcstats.com/statistics/events/upcoming"
YEARS = 6          # fights from this many calendar years back

# weight classes, longest names first so "Light Heavyweight" wins over "Heavyweight"
DIVISIONS = [("Women's Strawweight", "WSW"), ("Women's Flyweight", "WFLY"), ("Women's Bantamweight", "WBW"),
             ("Women's Featherweight", "WFW"), ("Light Heavyweight", "LHW"), ("Flyweight", "FLY"), ("Bantamweight", "BW"),
             ("Featherweight", "FW"), ("Lightweight", "LW"), ("Welterweight", "WW"), ("Middleweight", "MW"), ("Heavyweight", "HW")]
DIV_NAME = {code: name for name, code in DIVISIONS}


def division(text):
    t = str(text or "")
    for name, code in DIVISIONS:
        if name.lower() in t.lower():
            return code
    return None


def norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").lower().strip()


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", norm(s)).strip("-")


def csv(name):
    return pd.read_csv(io.BytesIO(fetch(RAW + name + ".csv", timeout=180)))


def landed(v):
    """'16 of 40' -> 16"""
    m = re.match(r"\s*(\d+)\s+of\s+\d+", str(v))
    return int(m.group(1)) if m else 0


def clock(v):
    """'4:08' -> 4.13 minutes"""
    m = re.match(r"\s*(\d+):(\d+)", str(v))
    return int(m.group(1)) + int(m.group(2)) / 60 if m else 0.0


def scheduled_rounds(fmt):
    m = re.match(r"\s*(\d+)\s*Rnd", str(fmt))
    return int(m.group(1)) if m else np.nan


# ---------------------------------------------------------------- the upcoming card
def card_from_espn():
    """Bouts in the next three weeks: [(date, time, event, name_a, name_b, division_text, rounds)]."""
    q = urllib.parse.urlencode({"dates": f"{TODAY:%Y%m%d}-{TODAY + timedelta(days=21):%Y%m%d}", "limit": 50})
    data = json.loads(fetch(f"{ESPN}?{q}", tries=2, timeout=30))
    out = []
    for ev in data.get("events", []):
        for comp in ev.get("competitions", []):
            st = ((comp.get("status") or {}).get("type") or {})
            if st.get("completed"):
                continue
            names = []
            for c in comp.get("competitors", []):
                a = c.get("athlete") or c.get("team") or {}
                names.append(a.get("displayName") or a.get("fullName") or a.get("name"))
            if len(names) != 2 or not all(names):
                continue
            when = comp.get("date") or ev.get("date") or ""
            rounds = ((comp.get("format") or {}).get("regulation") or {}).get("periods")
            kind = " ".join(str(x) for x in ((comp.get("type") or {}).get("abbreviation"), (comp.get("type") or {}).get("text"),
                                               comp.get("note"), comp.get("name")) if x)
            out.append((eastern(when) or TODAY.isoformat(), when, ev.get("name") or ev.get("shortName") or "", names[0], names[1], kind, rounds))
    return out


def card_from_ufcstats():
    html = fetch(UFCSTATS, tries=2, timeout=30).decode("utf-8", "ignore")
    events = re.findall(r'href="(http://ufcstats\.com/event-details/[0-9a-f]+)"[^>]*>\s*([^<]+?)\s*</a>.*?b-statistics__date">\s*([^<]+?)\s*<', html, re.S)
    out = []
    for url, name, when in events:
        try:
            d = datetime.strptime(when.strip(), "%B %d, %Y").date()
        except ValueError:
            continue
        if d < TODAY or d > TODAY + timedelta(days=21):
            continue
        page = fetch(url, tries=2, timeout=30).decode("utf-8", "ignore")
        rows = re.split(r'<tr class="b-fight-details__table-row', page)[1:]
        for i, row in enumerate(rows):
            names = re.findall(r'fighter-details/[0-9a-f]+"[^>]*>\s*([^<]+?)\s*</a>', row)
            if len(names) < 2:
                continue
            title = "belt" in row or "title" in row.lower()
            out.append((d.isoformat(), d.isoformat(), name.strip(), names[0], names[1], re.sub(r"<[^>]+>", " ", row), 5 if i == 0 or title else 3))
    return out


def eastern(iso):
    try:
        from zoneinfo import ZoneInfo
        t = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        return t.astimezone(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return str(iso)[:10] or None


REACHED = []   # sources that answered, even with no bouts booked


def upcoming_card():
    for source, fn in (("ESPN", card_from_espn), ("UFCStats", card_from_ufcstats)):
        try:
            bouts = fn()
        except Exception as e:
            print(f"  ufc card from {source} unavailable: {str(e)[:120]}", file=sys.stderr)
            continue
        REACHED.append(source)
        if bouts:
            print(f"  ufc card: {len(bouts)} bouts from {source}")
            return bouts
    return []


# ---------------------------------------------------------------- fight logs
def fights():
    ev = csv("ufc_event_details")
    res = csv("ufc_fight_results")
    st = csv("ufc_fight_stats")
    tott = csv("ufc_fighter_tott")
    res = res.rename(columns={"TIME FORMAT": "FORMAT"})
    for d in (ev, res, st):
        for c in ("EVENT", "BOUT"):
            if c in d:
                d[c] = d[c].astype(str).str.strip()
    ev["date"] = pd.to_datetime(ev["DATE"].str.strip(), format="%B %d, %Y", errors="coerce").dt.strftime("%Y-%m-%d")
    res = res.merge(ev[["EVENT", "date"]], on="EVENT", how="left")
    res = res[res["date"].notna() & (res["date"] >= f"{TODAY.year - YEARS}-01-01") & (res["date"] <= TODAY.isoformat())]
    res = res[~res["OUTCOME"].astype(str).str.contains("NC")]
    res = res.drop_duplicates(["EVENT", "BOUT"])
    st = st[st["FIGHTER"].notna()].drop_duplicates(["EVENT", "BOUT", "FIGHTER", "ROUND"]).copy()
    st["FIGHTER"] = st["FIGHTER"].astype(str).str.strip()
    agg = pd.DataFrame({"EVENT": st["EVENT"], "BOUT": st["BOUT"], "FIGHTER": st["FIGHTER"],
                        "sig": st["SIG.STR."].map(landed), "str": st["TOTAL STR."].map(landed), "tdl": st["TD"].map(landed),
                        "kd": pd.to_numeric(st["KD"], errors="coerce").fillna(0), "ctrl": st["CTRL"].map(clock)})
    agg = agg.groupby(["EVENT", "BOUT", "FIGHTER"], as_index=False).sum()
    # names more than one fighter has go by name and weight class
    dup = set(tott["FIGHTER"].astype(str).str.strip()[tott["FIGHTER"].astype(str).str.strip().duplicated()])

    rows = []
    fighters_of = agg.groupby(["EVENT", "BOUT"])["FIGHTER"].apply(list).to_dict()
    stats_of = agg.set_index(["EVENT", "BOUT", "FIGHTER"]).to_dict("index")
    for r in res.itertuples(index=False):
        ev_name, bout = r.EVENT, r.BOUT
        sides = [s.strip() for s in re.split(r"\s+vs\.?\s+", bout, maxsplit=1)]
        if len(sides) != 2:
            continue
        outs = str(r.OUTCOME).strip().split("/")
        method = str(r.METHOD).strip()
        rnd = pd.to_numeric(r.ROUND, errors="coerce")
        mins = (rnd - 1) * 5 + clock(r.TIME) if pd.notna(rnd) else np.nan
        sr = scheduled_rounds(r.FORMAT)
        div = division(r.WEIGHTCLASS)
        title = "title" in str(r.WEIGHTCLASS).lower()
        names = fighters_of.get((ev_name, bout)) or sides
        for i, nm in enumerate(sides):
            # the stats table spells names the same way; fall back to position in the bout
            key_nm = nm if (ev_name, bout, nm) in stats_of else (names[i] if i < len(names) else nm)
            s = stats_of.get((ev_name, bout, key_nm), {})
            won = int(outs[i] == "W") if i < len(outs) else 0
            dist = int(method.startswith("Decision"))
            rows.append({"name": key_nm, "opp_name": sides[1 - i], "event": ev_name, "game": slug(ev_name + " " + bout),
                         "date": r.date, "div": div, "title": int(title), "sr": sr,
                         "win": won, "ko": int(won and ("KO" in method)), "sub": int(won and method.startswith("Submission")),
                         "dec": int(won and dist), "dist": dist, "rnd": round(mins / 5, 2) if pd.notna(mins) else np.nan,
                         "sig": s.get("sig", 0), "str": s.get("str", 0), "tdl": s.get("tdl", 0), "kd": s.get("kd", 0),
                         "ctrl": round(s.get("ctrl", 0.0), 1)})
    df = pd.DataFrame(rows)
    df = df[df["rnd"].notna()]
    # each fighter's division: where he fought most recently, ignoring catchweights
    main_div = df[df["div"].notna()].sort_values("date").groupby("name")["div"].last()
    df["div"] = df["div"].fillna(df["name"].map(main_div)).fillna("LW")

    def key(nm, dv):
        return f"{nm} ({DIV_NAME.get(dv, dv)})" if nm in dup else nm
    df["key"] = [key(n, d) for n, d in zip(df["name"], df["div"])]
    df["opp"] = [key(n, d) for n, d in zip(df["opp_name"], df["div"])]
    return df, dup


def ufc(check=False):
    card = upcoming_card()
    if check:
        for b in card:
            print("  ", b[0], b[2], "|", b[3], "vs", b[4], "|", b[6], "rounds")
        if not REACHED:
            raise RuntimeError("couldn't reach ESPN or UFCStats for the upcoming card")
        print(f"  {len(card)} bouts in the next three weeks (reached {', '.join(REACHED)})")
        return
    df, dup = fights()
    cur = TODAY.year
    df["season"] = pd.to_datetime(df["date"]).dt.year
    # fighters on the card, and their next bout
    last_fight = df.groupby("key")["date"].max().to_dict()
    by_norm = {}
    for k, nm in df[["key", "name"]].drop_duplicates().itertuples(index=False):
        by_norm.setdefault(norm(nm), []).append(k)

    def find(nm, div_text):
        """Our key for a name on the card: by weight class when two fighters share the name, else the active one."""
        cands = by_norm.get(norm(nm), [])
        dv = division(div_text)
        hit = [c for c in cands if len(cands) > 1 and dv and c.endswith(f"({DIV_NAME.get(dv)})")]
        if hit or cands:
            return (hit or sorted(cands, key=lambda c: last_fight.get(c, "")))[-1]
        return nm.strip()
    nxt, on_card = {}, set()
    for d, tm, event, a, b, kind, rounds in sorted(card, key=lambda r: (r[0], str(r[1]))):
        ka, kb = find(a, kind), find(b, kind)
        for me, them in ((ka, kb), (kb, ka)):
            if me not in nxt:
                nxt[me] = {"opp": them, "home": None, "date": d, "time": tm, "event": event, "sr": int(rounds) if rounds else 3}
                on_card.add(me)
    # who gets a page: fought in the last three years and has at least two UFC fights, or is on the card
    n_fights = df.groupby("key").size()
    last = df.groupby("key")["date"].max()
    keep = {k for k in n_fights.index if (n_fights[k] >= 2 and last[k] >= f"{cur - 3}-01-01") or k in on_card}
    g = pd.DataFrame({
        "pid": df["key"].map(slug), "name": df["key"], "team": df["key"], "opp": df["opp"], "date": df["date"],
        "season": df["season"], "post": 0, "home": np.nan, "ts": np.nan, "os": np.nan, "won": df["win"].astype(float),
        "grp": df["div"], "pos": df["div"].map(DIV_NAME), "starter": np.nan, "played": df["key"].isin(keep), "game": df["game"],
        "headshot": None, "sr": df["sr"], "ttl": df["title"],
        **{k: df[k] for k in ("win", "ko", "sub", "dec", "dist", "rnd", "sig", "str", "tdl", "kd", "ctrl")}})
    # defenses need every fight, including against fighters who don't get a page
    g["played"] = True
    roster = {slug(k): {"name": k, "team": k} for k in keep}
    build_sport("ufc", g, {
        "stats": ["win", "ko", "sub", "dec", "dist", "rnd", "sig", "str", "tdl", "kd", "ctrl"],
        "composite": {d: {"win": 10, "sig": 0.1, "tdl": 1, "kd": 3} for _, d in DIVISIONS},
        "usage": "rnd", "K": 3, "min_games": 1, "recent_seasons": 3, "roster_required": True, "max_games": 40,
        "float_stats": ("rnd", "ctrl"), "extra": {"sr": "sr", "ttl": "ttl"}},
        nxt, cur, {y: str(y) for y in range(cur - YEARS, cur + 1)}, roster)


if __name__ == "__main__":
    check = "--check" in sys.argv
    try:
        if not check:
            os.makedirs(os.path.join(DATA, "props", "ufc"), exist_ok=True)
        ufc(check)
    except Exception as e:
        import traceback; traceback.print_exc()
        print(f"ufc props: FAILED{'' if check else ', kept previous data'}. {e}", file=sys.stderr)
        sys.exit(1)
