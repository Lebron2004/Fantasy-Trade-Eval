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

**Props** (`props.html`): pick a sport (football, basketball, hockey, or baseball), any player, and a prop, then set the line. Props include yards, receptions, and TDs (NFL); points, rebounds, assists, threes, and combos (NBA); shots, points, goals, hits, blocks, and goalie saves (NHL); hits, total bases, home runs, RBIs, and pitcher strikeouts and outs (MLB). You get:

- **Best bets for the day**: before you pick a player, each sport shows the props the trained model thinks are most likely to hit on its next slate (today, or the next NFL week), and the three best 3-leg parlays built from them. Every player on the slate gets his strongest main prop (points, rebounds, yards, shots, hits, strikeouts and the like), taking the over or the under of his usual line, whichever the model likes more. Parlays use one leg per game so the legs don't lean on each other, and the combined chance is the three chances multiplied. Chances are colored green (strong), amber (a lean) and red (a long shot). Injured players (any tag in the daily player file), players who haven't played lately, and MLB pitchers who aren't the probable starter are left out. Tap a pick to open it at that line, or send a parlay to the slip checker to track it. `scripts/best_bets.py` rebuilds `data/props/best.json` every morning, right after the model is trained. The lines are each player's usual line, not your book's, so check the line before betting.
- **A game-by-game bar chart** against the line: green for hits, red for misses. Tap a bar for the opponent, score, spread, total, and the full stat line.
- **Hit rates**: last 5, last 10, this season, last season, and against this week's opponent.
- **Situational splits**: home/away, favored/underdog, high/low totals, dome/outdoors, cold and wind, division games, and tough or soft defenses. Rows that match this week's game are highlighted.
- **Scheme matchup** (football): how he does against the blitz, against man vs. zone coverage, and against light or stacked boxes, next to how often this week's opponent does each.
- **Rest and role** (basketball and hockey): back-to-backs, days of rest, starting vs. off the bench, and big-minute games.
- **Opponent profile**: what the next opponent allows per game to his position, compared with the league average.
- **With or without a teammate**: his numbers when a teammate plays vs. sits.
- **Live tracking**: hit **Track this prop** to pin a bet. While the game is on, the Tracked props panel updates every 30 seconds with his current stat vs. the line, the live chance next to the pre-game chance, and a small chart of how it has moved. It marks Won or Lost when the bet is settled, with optional browser alerts. Opening any player whose game is live also shows a live card for the prop you're viewing. Live scores come straight from ESPN's public scoreboard in the visitor's browser (no server or key), polling only while a game is on and the tab is visible.
- **Check a bet slip**: upload a screenshot from DraftKings, FanDuel, or any book, or paste the legs. The page reads the slip in your browser (Tesseract.js OCR, loaded from jsDelivr the first time; the image never leaves your device), finds each player across all four sports, and works out the market, line, and over/under, including alt lines like "25+ Points" and yes-markets like "Anytime TD Scorer." Each leg gets its model chance, and the parlay gets the combined chance next to the book's implied odds, the edge, and the weakest leg. Same-game legs are flagged, since they're correlated. Team bets (spreads, totals, moneylines) can't be modeled, so you enter your own chance for those. One click tracks the whole parlay live.
- **A projection and model chance** built in four visible steps (recent form, opponent defense, scheme fit, game script). Enter the sportsbook's odds to see the implied chance, the no-vig chance, and the edge.
- **A trained model chance.** Every morning a LightGBM model per sport is trained on every past game in the props data (three seasons of game logs) and learns how much recent form, the line vs his history, the opponent, home/away, rest, role and minutes, and (football) the spread and total actually move the chance of clearing a line, instead of using hand-picked weights. Every input for a game uses only games before it. The page shows the trained chance as the headline number with the formula's chance next to it, and lists which factors pushed this prop up or down. Each sport's model is scored on its most recent 20% of games, which it never trains on, against the formula. It ships only if it beats the formula there; otherwise the page keeps the formula. The test results are in `data/props/<sport>/model.json`. The tested lines are the page's default lines (the median of his last 10 games), not real sportsbook lines, which aren't in the free data.

Props data comes from [nflverse](https://github.com/nflverse) (CC-BY 4.0) with charting from FTN Data for football, [SportsDataverse](https://github.com/sportsdataverse) for basketball and hockey, and the MLB Stats API for baseball. Props data is rebuilt on every run and deployed with the site, but not stored in git, so the repo stays small. The one exception is `site/data/props/mlb/_cache.json`, which caches last season's baseball game logs. Man/zone coverage is published only after each season, so coverage splits use past seasons. True receiver-vs-cornerback matchups need paid tracking data and aren't included.

## Model trade signals and player news

Every morning, after the prop model trains, two more steps run:

- **Buy low, sell high** (`scripts/trade_signals.py`): the trained model's next-game Over chances are turned into one fantasy projection per player (PPR for football; points, rebounds, assists, steals, blocks and turnovers for basketball; goals, assists, shots and blocks for hockey; bases, runs, RBIs, walks and steals for baseball hitters, outs and strikeouts for pitchers). Each player is ranked at his position by that projection and by trade value. When the model ranks him well above his trade value he's a **buy**; well below, a **sell**. Players ruled out, doubtful, or on IR get no signal, since the model doesn't know about injuries. Written to `data/signals.json`.
- **Player news** (`scripts/update_news.py`): injury designation changes since yesterday (ruled out, placed on IR, back off the report), team changes, and ESPN's latest injury notes and headlines for every sport, matched to players. Kept for 10 days in `data/news.json`.

On **My league** this adds a **News for your team** panel that says what to do about each item (bench him and who moves into your lineup, move him to IR, game-time call), a **Buy low, sell high** panel with one-click trades, and model chips on every player. Trade ideas are ranked partly by the model's lean, and each idea says when you're buying low or selling high. The **trade calculator** shows the model's view under each player, his latest news, whether the model leans toward your side of the deal, and a news feed for the sport. The AI GM gets all of it too.

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

`update_players.py` uses only the standard library. The props scripts need `pip install pandas pyarrow`, and `python scripts/train_props_model.py` (run after them) also needs `pip install lightgbm`. Run `update_players.py` first, since the props builders read its roster files for current teams and full names. Open the page through the local server rather than by double-clicking `index.html`, because browsers block loading the data files from `file://`.

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
scripts/update_props.py        builds NFL props data from nflverse (needs pandas + pyarrow)
scripts/update_props_more.py   builds NBA, NHL, and MLB props data (needs pandas + pyarrow)
scripts/train_props_model.py   trains the prop model on past games and writes next-game chances (needs lightgbm)
site/index.html                trade calculator
site/league.html               league analysis
site/props.html                player props
site/assets/props.js           props charts, splits, projection model, tracker
site/assets/live.js            live ESPN box scores and in-game chances
site/assets/slip.js            bet slip reader (players, markets, lines, odds)
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
