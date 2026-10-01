# Trade Scale

A fantasy trade analyzer for football, basketball, baseball, and hockey. Every morning a GitHub Action pulls every rostered player, updates their team, injury status, and trade value, logs any team changes (trades, signings, releases), and redeploys the site. No server, no API keys, no cost.

## Set it up (about 5 minutes)

1. **Create a repo.** On GitHub, make a new repository (public or private) and upload everything in this folder, keeping the folder structure. The `.github` folder is hidden on Mac and Linux; make sure it gets uploaded too.
2. **Turn on Pages.** Go to **Settings → Pages**, and under **Build and deployment → Source**, choose **GitHub Actions**.
3. **Allow the bot to commit.** Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, then save.
4. **Run it the first time.** Go to the **Actions** tab, pick **Update players and deploy**, and click **Run workflow**. It takes a couple of minutes. When it finishes, the job summary shows your site's link (usually `https://<your-username>.github.io/<repo-name>/`).

From then on it runs by itself every day at 11:00 UTC. To change the time, edit the `cron` line in `.github/workflows/update.yml`.

> Private repos: GitHub Pages on a private repo needs a paid GitHub plan. On a free account, make the repo public. It contains no secrets.

## Two pages

**Trade calculator** (`index.html`): put players on each side and the scale tips toward the side getting more value.

**My league** (`league.html`): sync a Sleeper league (football or basketball) with just your username, or build any league by hand (ESPN, Yahoo, baseball, hockey). It shows:

- **Your best lineup**, filled automatically from your roster using your league's actual lineup slots, flex spots included.
- **Where you stand** at each position, graded against the league average (or against an average team your league's size, if you haven't entered every roster), with your rank at each spot.
- **Trade ideas**: deals within about 15% of even value that improve your starting lineup without gutting your partner's, with the reason each one works for both sides. One click opens any idea in the calculator.
- **Waiver pickups**: available players who'd start for you right away, plus the best depth at your weakest spots.
- **Power rankings**: every team's lineup strength, biggest strength, and biggest need. Click a team to compare side by side.

**Props** (`props.html`): pick any NFL player and prop (yards, receptions, TDs, completions, and more) and set the line. You get:

- **A game-by-game bar chart** against the line: green for hits, red for misses. Tap a bar for the opponent, score, spread, total, and the full stat line.
- **Hit rates**: last 5, last 10, this season, last season, and against this week's opponent.
- **Situational splits**: home/away, favored/underdog, high/low totals, dome/outdoors, cold and wind, division games, and tough or soft defenses. Rows that match this week's game are highlighted.
- **Scheme matchup**: how he does against the blitz, against man vs. zone coverage, and against light or stacked boxes, next to how often this week's opponent does each.
- **With or without a teammate**: his numbers when a teammate plays vs. sits.
- **A projection and model chance** built in four visible steps (recent form, opponent defense, scheme fit, game script). Enter the sportsbook's odds to see the implied chance, the no-vig chance, and the edge.

Props data comes from [nflverse](https://github.com/nflverse) (CC-BY 4.0), with charting data from FTN Data. Man/zone coverage is published only after each season, so coverage splits use past seasons. True receiver-vs-cornerback matchups need paid tracking data and aren't included.

## How player values work

Every value (1–100) blends two things, and the **Value by** slider on both pages sets the mix:

- **Track record**: fantasy points actually scored, this season plus last season. Last season counts for less as the current season goes on.
- **Outlook**: what the player should do from here.

**Football outlook** is a real projection model, rebuilt every morning:

1. **Expected points per game**, blended from four signals: Sleeper's projections (40%), the last 4 games (25%), this season's average (20%), and last season's average (15%).
2. **Defense vs position**: for all 32 defenses, how many fantasy points they allow to QBs, RBs, WRs, and TEs compared with average. Last season's numbers act as a starting point and this season takes over as games are played.
3. **Rest-of-season schedule**: each player's remaining opponents, rated by how they defend his position.
4. **Health**: injury designations reduce expected production (IR the most, Questionable barely).
5. **Value over replacement**: rest-of-season points above what a free agent at the same position would score. That's why a top TE can be worth more than a WR who scores more.
6. A final 30% check against Sleeper's market rankings, so the model never drifts too far from consensus.

**Basketball** adds per-game production (adjusted for age) to Sleeper's rankings. **Baseball** and **hockey** use per-game production projected over a full season, adjusted for age; hockey also adjusts for the strength of each team's remaining schedule.

Dynasty mode also rewards youth and discounts players past their peak age.

## ESPN and Yahoo leagues

Sleeper leagues sync right from the My league page. ESPN and Yahoo require a login, so they sync through your daily GitHub job instead, with your login stored as GitHub Secrets (encrypted, never visible in the repo or on the site).

**1. List your leagues** in `leagues.json` at the top of the repo (see `leagues.example.json`):

```json
[
  {"platform": "espn",  "sport": "nfl", "league_id": "12345678"},
  {"platform": "yahoo", "sport": "nfl", "league_id": "987654"}
]
```

Find the league ID in your league's web address: ESPN shows `leagueId=12345678`; Yahoo shows `football.fantasysports.yahoo.com/f1/987654`. Add `"dynasty": true` for dynasty leagues.

**2. ESPN private leagues** (public leagues need nothing): on a computer, log in to ESPN Fantasy in Chrome, open DevTools (Cmd+Option+I) → **Application** → **Cookies** → `https://fantasy.espn.com`. Copy the values of `espn_s2` and `SWID` (keep the curly braces in SWID). In your repo go to **Settings → Secrets and variables → Actions → New repository secret** and add `ESPN_S2` and `ESPN_SWID`. These cookies last about a year; if ESPN sync starts failing, grab fresh ones.

**3. Yahoo** (one-time, about 5 minutes):
1. Create an app at https://developer.yahoo.com/apps/create/ with Redirect URI `https://localhost:8080` and API permission **Fantasy Sports: Read**.
2. On your computer, run `python scripts/yahoo_auth.py`, paste the Client ID and Secret, open the link it prints, approve, and paste back the `code=` value from the address bar of the page that fails to load.
3. Add the three secrets it prints: `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET`, `YAHOO_REFRESH_TOKEN`.

**4. Run the workflow** (Actions → Update players and deploy → Run workflow). Your leagues then appear on the My league page under **Synced from ESPN or Yahoo**, and refresh every morning. The page tells you which team is yours automatically.

Heads up: synced rosters and team names are published with your site (the secrets are not). Player matching uses ESPN and Yahoo IDs for football and names elsewhere; the sync log and the import list show how many players couldn't be matched.

## AI GM

Both pages have an **Ask the AI GM** panel. It sends everything the page knows (your lineup, bench, values, matchups, position grades, other teams' needs, the model's trade ideas, and pickups) to Claude, which searches the web for the latest injury news and depth charts before answering.

It uses your own Anthropic API key: create one at https://console.anthropic.com, add a few dollars of credit, and paste it into the panel. Most questions cost a few cents. The key is saved only in your browser and sent only to Anthropic; don't save it on a shared computer. If your Anthropic organization hasn't enabled web search, the AI still answers but without today's news (an admin can turn it on in the Console).

## Where the data comes from

| Sport | Rosters and injuries | How values are set |
|---|---|---|
| Football | Sleeper (players, stats, projections), ESPN public scoreboard (schedule) | Projection model above |
| Basketball | Sleeper public API | Track record from Sleeper season stats, outlook from Sleeper's rankings |
| Baseball | MLB Stats API (official) | Both from fantasy points (totals vs. per-game rate) |
| Hockey | NHL web and stats APIs | Both from fantasy points (totals vs. per-game rate) |

**Team changes:** each run compares every player's team to yesterday's. Any difference is logged to `site/data/moves.json` and shown in the app, so trades show up the morning after they're official. The first run has nothing to compare against, so the feed starts filling from day two.

## Things to know

- These APIs are free but mostly unofficial, and they can change without notice. If one sport's source breaks, the script keeps that sport's last good data and the app shows a warning for it. The other sports keep updating normally. Check the Actions tab for the error message.
- Sleeper asks that its player list be pulled at most once a day. The daily schedule respects that, so don't set the cron to run more often.
- Values are a starting point, not gospel. In the app, click any value to override it. Your override survives future updates.
- Saved trades, leagues, and settings live in your browser (localStorage), so they don't sync between devices.
- League sync talks to Sleeper straight from your browser. Hitting "Refresh rosters" pulls the latest rosters after trades or waiver moves in your league.
- ESPN and Yahoo require a login to read league data, so for those leagues you enter rosters by hand on the My league page.

## Run it on your own machine

```bash
python scripts/update_players.py        # all sports
python scripts/update_players.py nfl    # just one
cd site && python -m http.server 8000   # then open http://localhost:8000
```

`update_players.py` uses only the standard library. `update_props.py` needs `pip install pandas pyarrow`. Open the page through the local server rather than by double-clicking `index.html`, because browsers block loading the data files from `file://`.

## Tuning

- **Value curves:** `k` values in `scripts/update_players.py` (`SLEEPER_K`, and the `140` and `120` passed to `values_from_scores`) control how fast value drops from the top player down. A higher number means a flatter curve.
- **Scoring weights:** `mlb_points` and `nhl_points` hold the stat weights. Change them to match your league's scoring.
- **Star premium:** in `site/assets/core.js`, the `1.6` exponent in `packageScore` sets how much one star outweighs several depth players.
- **Trade idea rules:** in `site/assets/league.js`, `tradeIdeas` sets the fairness window (0.85–1.15) and how much lineup value your partner can lose (-4).
- **Default lineups:** `DEFAULT_SLOTS` at the top of `league.js`.

## File layout

```
.github/workflows/update.yml   daily data refresh + deploy
scripts/update_players.py      pulls players, values, team changes
scripts/update_props.py        builds props data from nflverse (needs pandas + pyarrow)
site/index.html                trade calculator
site/league.html               league analysis
site/props.html                player props
site/assets/props.js           props charts, splits, projection model
site/assets/style.css          shared styles
site/assets/core.js            shared data loading, valuation, search
site/assets/trade.js           trade calculator logic
site/assets/league.js          league sync, lineups, needs, trade ideas, pickups, matchups
site/assets/ai.js              AI GM panel (Claude + web search)
scripts/sync_leagues.py        ESPN and Yahoo league sync (runs in the daily job)
scripts/yahoo_auth.py          one-time Yahoo login helper (run on your computer)
leagues.json                   which ESPN/Yahoo leagues to sync
site/data/                     written by the script (don't edit)
```
