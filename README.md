# Flush Alert

**River flow says when to sample nitrate.** Team Mustangs · Xylem Global Student Innovation Challenge 2026 · High School track · Problem Statement 2: Water Quality

> **Historical backtest on USGS sensor data. This is not a live deployment, and no alerts are sent.**

**Site:** https://pratik125425.github.io/flush-alert/ · **Code:** https://github.com/pratik125425/flush-alert

After a drought, nitrate builds up in the soil. The first wet spring flushes it into rivers within a few weeks, and monthly grab sampling usually misses that window. On June 12, 2025, Central Iowa Water Works banned lawn watering across the Des Moines metro because nitrate in the Raccoon and Des Moines rivers was near record ([Iowa Public Radio](https://www.iowapublicradio.org/ipr-news/2025-06-12/central-iowa-des-moines-ban-watering-grass-lawn-nitrate)).

Flush Alert uses **only daily river discharge**, which every USGS stream gauge already reports, to tell sampling programs weeks ahead which rivers need extra samples and when to take them.

## What the backtest shows

Every number below comes from a CSV in [`results/`](results/).

| Finding | Result | Source |
|---|---|---|
| Monthly sampling errs more after a drought | Median error of the Mar–Jun nitrate load with the agency-style regression: **24.6%** in post-drought springs vs **13.7%** in normal springs. The 90th percentile is 151% vs 86%. Interpolation: 10.1% vs 6.9%. | `spring_load_error_summary.csv` |
| The flow-only alert warns ahead of the surge | On held-out springs 2020–2026, it caught **72%** of post-drought surges in advance (bootstrap 95% range 62–82%). The median warning was **17 days** before the surge started and 81 days before the spring peak. False-alarm ratio: 43%. | `backtest_metrics.csv` |
| It generalizes across rivers | With each site held out in turn: 66% caught | `backtest_metrics.csv` |
| Both inputs matter | The full rule has CSI 0.47. Rise only, without the drought gate: 0.36. Drought gate only: 0.43. | `backtest_metrics.csv` |
| Robust to the drought cutoff | Test-year detection is 70%, 72% and 70% at the 20th, 25th and 30th percentile cutoffs | `sensitivity_drought_threshold.csv` |
| Timing beats volume | Six extra post-drought samples timed by flow cut the regression error from 23.9% to **18.1%**. Six random ones leave it at 25.1%, and six evenly spaced ones at 23.6%. With interpolation, extra samples help at any timing, and evenly spaced ones help most. | `adaptive_sampling_summary.csv` |
| No nitrate sensor needed | The same rule runs on every active USGS discharge gauge in the eight states: 1,241 gauges, 330 on Watch as of Nov 17, 2026. | `flow_only_gauges.geojson`, `flow_only_info.json` |

Tested on 33 USGS nitrate-sensor sites (parameter 99133) with at least five valid springs in IA, IL, IN, MN, WI, OH, MO and NE: 269 classifiable site-springs, 2009–2026, 99 of them post-drought.

## The rule

1. **Drought memory.** On March 1, rank the trailing 365-day mean flow against every earlier day of the gauge's own record. Below the 25th percentile, the spring is *Watch*.
2. **First wet-spring rise.** In a Watch spring, alert on the first day from Mar 1 to Jun 30 when the 7-day mean flow exceeds that calendar day's median from prior years, or flow rises more than X% in three days. X = 25% was tuned on springs up to 2019 only.
3. **Extra samples.** After an alert, take a grab sample at the start of each new flow rise, up to six. This design was chosen over "spread k samples over the 30 days after the alert" using training years only. Both are reported.

**No lookahead.** Every decision on day *t* uses data through day *t* only. `tests/test_no_lookahead.py` truncates and tampers with future data and fails if any alert or percentile changes.

## Run it

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
make test        # 14 tests, including the no-lookahead tests
make all         # analysis, figures, export and site build on cached data (about 2 minutes)
make data        # optional: re-download from the USGS Water Data APIs (rate-limited, hours)
```

Make targets:
- `data`: downloads into `data/raw/<name>__<UTC timestamp>.parquet`.
- `analysis`: builds `results/*.csv`.
- `figures`: builds `figures/*.png`.
- `export`: builds `site/public/data/*.json`.
- `site`: runs the Vite build into `site/dist/`.
- `deploy`: publishes `site/dist/` to the `gh-pages` branch, which GitHub Pages serves. `deploy/pages-workflow.yml` is an alternative GitHub Actions workflow that does the same on every push.

The site is a static Vite + TypeScript page with D3 charts and an SVG map (d3-geo + us-atlas). For local development, run `cd site && npm install && npm run dev`.

## Data

- **USGS Water Data APIs** (`api.waterdata.usgs.gov`, OGC API), accessed through `dataretrieval.waterdata` 1.4.0. These are daily means of discharge (00060) and in-situ nitrate plus nitrite (99133). The legacy `waterservices.usgs.gov` is not used.
- **State outlines:** U.S. Census Bureau cartographic boundaries via `us-atlas`.

See [DATA_CARD.md](DATA_CARD.md) for site selection, cleaning, caching and known gaps.

## Limitations

- This is a historical backtest, not a live deployment.
- **Post-drought springs before 2020 are few.** The training period had 5 post-drought surge events, so the tuned rise size (25%, the smallest in the grid) rests on little data. The held-out test period has 75 events.
- The surge definition (7-day mean above min(site 90th percentile, 10 mg/L)) and the drought cutoff are choices. Both live in `config.yaml`, and the cutoff sensitivity is reported.
- The 43% false-alarm ratio means some alerts lead to extra samples with no surge. For sampling this is a cheap error. A missed surge goes unmeasured.
- The flow-only download is rate-limited and takes hours (`make data`). If it is interrupted, `src.flow_only_map` runs on the gauges cached so far and the page says so.
- Only sensor sites can be validated. Status at flow-only gauges extrapolates the same rule to rivers without nitrate data.
- The regression baseline is calibrated on monthly samples within ±1 year of the target spring. That is fairer than a stiff whole-record fit, but agencies may use other variants (for example WRTDS).
- Load errors use the sensor as truth. Sensor records have gaps and qualifiers. Springs with less than 80% Mar–Jun coverage are excluded.
- Flush Alert complements, and does not replace, the University of Iowa's nitrate forecasts at its Iowa sensors. It schedules sampling, and it runs at gauges with no sensor, in any state.

## Outside help and licenses

**AI assistance:** Claude (Anthropic) was used as a coding assistant to write the analysis code, the tests, the website and its copy from the team's written specification. The team chose the problem, the hypothesis and the rule, and checked the results.

**Open-source software:**

| Package | Version | License |
|---|---|---|
| dataretrieval | 1.4.0 | CC0-1.0 (USGS public domain) |
| pandas | 3.1.1 | BSD-3-Clause |
| NumPy | 2.5.5 | BSD-3-Clause |
| PyArrow | 26.0.1 | Apache-2.0 |
| Matplotlib | 3.11.2 | Matplotlib License (PSF-based) |
| PyYAML | 6.0.3 | MIT |
| pytest | 9.2.0 | MIT |
| D3 | 7.9.2 | ISC |
| topojson-client | 3.1.0 | ISC |
| us-atlas | 3.0.1 | ISC (data: U.S. Census Bureau, public domain) |
| Vite | 8.3.5 | MIT |
| TypeScript | 7.0.2 | Apache-2.0 |
| Source Serif 4, Public Sans (via Fontsource) | 5.3.x | SIL Open Font License 1.1 |

**Design process:** the Impeccable design skill (pbakaus/impeccable) guided the site's design review. Inspiration notes are in [`design/inspiration.md`](design/inspiration.md).

## Team

Team Mustangs: [member names]

## License

MIT, see [LICENSE](LICENSE). USGS data are public domain.
