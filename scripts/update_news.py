#!/usr/bin/env python3
"""
Trade Scale player news.

Builds site/data/news.json, the feed the trade calculator and My league pages use to tell you what to do:
  - injury changes: every player whose injury designation changed since the last run (Questionable to Out,
    placed on IR, cleared to play), detected from the player data update_players.py just wrote
  - team changes: trades, signings and releases from moves.json
  - ESPN's latest injury notes and headlines per sport, matched to players in the trade pool

Format: {"updated", "items": [{"d", "sport", "id", "name", "team", "kind", "from", "to", "text", "url"}], "inj": {...}}
  kind  "injury" (from/to are designations, "" means healthy), "team" (from/to are teams), "note" (an ESPN
        injury note), or "headline" (an ESPN story, with url)
  inj   the designations seen on this run, per sport, so the next run can spot changes

Items older than 10 days drop off. A source that fails is skipped; the rest still update.
Standard library only. Run after update_players.py.
Run: python scripts/update_news.py            (writes the file)
     python scripts/update_news.py --dry-run  (prints what it found, writes nothing)
"""
import json, os, re, sys, time, unicodedata, urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "site", "data")
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
ESPN = {"nfl": "football/nfl", "nba": "basketball/nba", "nhl": "hockey/nhl", "mlb": "baseball/mlb"}
KEEP_DAYS = 10
MAX_ITEMS = 1200
# ESPN's injury statuses, in the words the pages already use.
ESPN_STATUS = {"active": "", "out": "Out", "injured reserve": "IR", "day-to-day": "DTD", "questionable": "Questionable", "doubtful": "Doubtful",
               "suspension": "Sus", "suspended": "Sus", "10-day-il": "IL10", "15-day-il": "IL15", "60-day-il": "IL60", "7-day-il": "IL7"}


def norm(name):
    s = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[.'\-]", "", s)
    s = re.sub(r"\b(jr|sr|ii|iii|iv|v)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def get_json(url, tries=2):
    last = None
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def iso(s):
    """ESPN dates ("2026-10-02T14:31Z", with or without seconds) to the minute, UTC."""
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).astimezone(timezone.utc).isoformat(timespec="minutes")
    except ValueError:
        return None


def clean(text, n=400):
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", text or "")).strip()
    return t if len(t) <= n else t[:n - 1].rsplit(" ", 1)[0] + "…"


class Pool:
    """The trade pool for one sport, for matching ESPN names to our player IDs."""
    def __init__(self, sport):
        self.players = load(os.path.join(DATA, f"{sport}.json"), {}).get("players", [])
        self.by_name = {}
        for r in self.players:
            self.by_name.setdefault(norm(r[1]), []).append(r)
        self.espn = (load(os.path.join(DATA, "ids", f"{sport}.json"), {}) or {}).get("espn") or {}
        self.by_id = {str(r[0]): r for r in self.players}

    def match(self, name, espn_id=None):
        r = self.by_id.get(self.espn.get(str(espn_id), "")) if espn_id else None
        if r:
            return r
        cands = self.by_name.get(norm(name), [])
        return max(cands, key=lambda c: c[5] or 0) if cands else None


def injury_changes(sport, pool, prev, stamp):
    """Designation changes since the last run. A player new to the pool isn't news; one who left it isn't either."""
    items, now = [], {}
    for r in pool.players:
        if r[6]:
            now[str(r[0])] = r[6]
    if prev is None:   # first run: just remember today's designations
        return items, now
    for pid in set(now) | set(prev):
        a, b = prev.get(pid, ""), now.get(pid, "")
        r = pool.by_id.get(pid)
        if a == b or r is None:
            continue
        items.append({"d": stamp, "sport": sport, "id": pid, "name": r[1], "team": r[2], "kind": "injury", "from": a, "to": b, "v": r[5]})
    return items, now


def espn_injuries(sport, pool):
    """ESPN's injury report: one note per injured player, with its date. Also designations for sports whose
    player data has none (hockey, baseball)."""
    d = get_json(f"https://site.api.espn.com/apis/site/v2/sports/{ESPN[sport]}/injuries")
    items, status = [], {}
    for tm in d.get("injuries") or []:
        for inj in tm.get("injuries") or []:
            a = inj.get("athlete") or {}
            name = a.get("displayName") or a.get("fullName")
            r = pool.match(name, a.get("id") or ((a.get("links") or [{}])[0].get("href", "").rstrip("/").split("/")[-1] or None))
            if not r:
                continue
            st = ESPN_STATUS.get(str(inj.get("status") or "").lower(), inj.get("status") or "")
            if st:   # ESPN lists healthy players with a fresh note as "Active"; that's news, not a designation
                status[str(r[0])] = st
            text = clean(inj.get("shortComment") or inj.get("longComment") or "")
            when = iso(inj.get("date"))
            if len(text) >= 25 and when:   # skip placeholder notes like "ir"
                items.append({"d": when, "sport": sport, "id": str(r[0]), "name": r[1], "team": r[2], "kind": "note", "to": st, "text": text, "v": r[5]})
    return items, status


def espn_headlines(sport, pool):
    d = get_json(f"https://site.api.espn.com/apis/site/v2/sports/{ESPN[sport]}/news?limit=100")
    items = []
    for art in d.get("articles") or []:
        when = iso(art.get("published") or art.get("lastModified"))
        head = clean(art.get("headline"), 200)
        url = ((art.get("links") or {}).get("web") or {}).get("href")
        if not when or not head or art.get("type") == "Media" or "/video/" in (url or ""):
            continue   # highlight clips tag every star in the game; they aren't news about him
        seen = set()
        for c in art.get("categories") or []:
            if c.get("type") != "athlete":
                continue
            name = c.get("description") or ((c.get("athlete") or {}).get("description"))
            r = pool.match(name, c.get("athleteId") or (c.get("athlete") or {}).get("id"))
            # league-wide stories tag lots of players; keep it only when the headline is about him
            if not r or str(r[0]) in seen or norm(r[1]).split(" ")[-1] not in norm(head):
                continue
            seen.add(str(r[0]))
            items.append({"d": when, "sport": sport, "id": str(r[0]), "name": r[1], "team": r[2], "kind": "headline",
                          "text": head + (". " + clean(art.get("description"), 240) if art.get("description") else ""), "url": url, "v": r[5]})
    return items


def main():
    dry = "--dry-run" in sys.argv
    stamp = datetime.now(timezone.utc).isoformat(timespec="minutes")
    path = os.path.join(DATA, "news.json")
    old = load(path, {})
    prev_inj = old.get("inj") or {}
    items = list(old.get("items") or [])
    inj = {}
    espn_ok = 0
    for sport in ESPN:
        pool = Pool(sport)
        if not pool.players:
            continue
        found = []
        espn_status = {}
        try:
            notes, espn_status = espn_injuries(sport, pool)
            found += notes
            espn_ok += 1
        except Exception as e:
            print(f"{sport} news: ESPN injuries skipped. {e}", file=sys.stderr)
        try:
            found += espn_headlines(sport, pool)
            espn_ok += 1
        except Exception as e:
            print(f"{sport} news: ESPN headlines skipped. {e}", file=sys.stderr)
        # football and basketball designations come from the player data; hockey and baseball from ESPN
        if any(r[6] for r in pool.players):
            changes, inj[sport] = injury_changes(sport, pool, prev_inj.get(sport), stamp)
        elif espn_status:
            changes = []
            p = prev_inj.get(sport)
            if p is not None:
                for pid in set(p) | set(espn_status):
                    a, b, r = p.get(pid, ""), espn_status.get(pid, ""), pool.by_id.get(pid)
                    if a != b and r:
                        changes.append({"d": stamp, "sport": sport, "id": pid, "name": r[1], "team": r[2], "kind": "injury", "from": a, "to": b, "v": r[5]})
            inj[sport] = espn_status
        else:
            changes = []
            if sport in prev_inj:
                inj[sport] = prev_inj[sport]   # ESPN was down: keep the old snapshot so tomorrow's diff is fair
        found += changes
        print(f"{sport} news: {sum(i['kind'] == 'injury' for i in found)} injury changes, {sum(i['kind'] == 'note' for i in found)} injury notes, "
              f"{sum(i['kind'] == 'headline' for i in found)} headline mentions")
        if dry:
            for i in sorted(found, key=lambda i: -(i.get("v") or 0))[:5]:
                print("   ", json.dumps(i, ensure_ascii=False)[:300])
        items += found

    # team changes from update_players.py
    for m in load(os.path.join(DATA, "moves.json"), []):
        items.append({"d": m["date"], "sport": m["sport"], "id": str(m["id"]), "name": m["name"], "kind": "team",
                      "from": m.get("from") or "FA", "to": m.get("to") or "FA", "team": m.get("to") or "", "v": m.get("value")})

    # dedupe (the same note or headline shows up day after day) and drop old items
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat(timespec="minutes")
    seen, out = set(), []
    for i in sorted(items, key=lambda i: i["d"], reverse=True):
        key = (i["sport"], i["id"], i["kind"], i.get("text") or f"{i.get('from')}>{i.get('to')}|{i['d'][:10]}")
        if i["d"] < cutoff or key in seen:
            continue
        seen.add(key)
        out.append(i)
    out = out[:MAX_ITEMS]
    if dry:
        print(f"dry run: {len(out)} items, {espn_ok} ESPN feeds read, nothing written")
        sys.exit(0 if espn_ok else 1)   # the PR check fails if ESPN couldn't be read at all
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"updated": stamp, "items": out, "inj": inj}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"news: {len(out)} items")


if __name__ == "__main__":
    main()
