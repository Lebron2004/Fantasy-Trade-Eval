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

## How player values work

Every value (1–100) blends two things:

- **Track record**: fantasy points actually scored, this season plus last season. Last season counts for less as the current season goes on.
- **Outlook**: what the player should do from here. For football and basketball, that's Sleeper's player rankings. For baseball and hockey, it's per-game production projected over a full healthy season, adjusted for age.

The **Value by** slider on both pages sets the mix. Slide toward Track record to trust proven production, or toward Outlook to buy upside. Dynasty mode also rewards youth and discounts players past their peak age.

## Where the data comes from

| Sport | Rosters and injuries | How values are set |
|---|---|---|
| Football | Sleeper public API | Track record from Sleeper season stats, outlook from Sleeper's rankings |
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

Python 3.9+ with only the standard library, so there's nothing to pip install. Open the page through the local server rather than by double-clicking `index.html`, because browsers block loading the data files from `file://`.

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
site/index.html                trade calculator
site/league.html               league analysis
site/assets/style.css          shared styles
site/assets/core.js            shared data loading, valuation, search
site/assets/trade.js           trade calculator logic
site/assets/league.js          league sync, lineups, needs, trade ideas, pickups
site/data/                     written by the script (don't edit)
```
