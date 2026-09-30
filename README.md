# Trade Scale

A fantasy trade analyzer for football, basketball, baseball, and hockey. Every morning a GitHub Action pulls every rostered player, updates their team, injury status, and trade value, logs any team changes (trades, signings, releases), and redeploys the site. No server, no API keys, no cost.

## Set it up (about 5 minutes)

1. **Create a repo.** On GitHub, make a new repository (public or private) and upload everything in this folder, keeping the folder structure. The `.github` folder is hidden on Mac and Linux; make sure it gets uploaded too.
2. **Turn on Pages.** Go to **Settings → Pages**, and under **Build and deployment → Source**, choose **GitHub Actions**.
3. **Allow the bot to commit.** Go to **Settings → Actions → General → Workflow permissions**, choose **Read and write permissions**, then save.
4. **Run it the first time.** Go to the **Actions** tab, pick **Update players and deploy**, and click **Run workflow**. It takes a couple of minutes. When it finishes, the job summary shows your site's link (usually `https://<your-username>.github.io/<repo-name>/`).

From then on it runs by itself every day at 11:00 UTC. To change the time, edit the `cron` line in `.github/workflows/update.yml`.

> Private repos: GitHub Pages on a private repo needs a paid GitHub plan. On a free account, make the repo public. It contains no secrets.

## Where the data comes from

| Sport | Rosters and injuries | How values are set |
|---|---|---|
| Football | Sleeper public API | Sleeper's player ranking |
| Basketball | Sleeper public API | Sleeper's player ranking |
| Baseball | MLB Stats API (official) | Fantasy points, this season plus last |
| Hockey | NHL web and stats APIs | Fantasy points, this season plus last |

Early in a season, values lean on last season's numbers. As the season goes on, they shift toward the current one.

**Team changes:** each run compares every player's team to yesterday's. Any difference is logged to `site/data/moves.json` and shown in the app, so trades show up the morning after they're official. The first run has nothing to compare against, so the feed starts filling from day two.

## Things to know

- These APIs are free but mostly unofficial, and they can change without notice. If one sport's source breaks, the script keeps that sport's last good data and the app shows a warning for it. The other sports keep updating normally. Check the Actions tab for the error message.
- Sleeper asks that its player list be pulled at most once a day. The daily schedule respects that, so don't set the cron to run more often.
- Values are a starting point, not gospel. In the app, click any value to override it. Your override survives future updates.
- Saved trades and settings live in your browser (localStorage), so they don't sync between devices.

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
- **Star premium:** in `site/index.html`, the `1.6` exponent in `packageScore` sets how much one star outweighs several depth players.
