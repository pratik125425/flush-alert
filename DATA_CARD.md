# Data card: Flush Alert

## Sources

| Dataset | Provider | Access | Parameters | Period |
|---|---|---|---|---|
| Time-series catalog | USGS Water Data APIs | `dataretrieval.waterdata.get_time_series_metadata` | 99133, 00060, statistic 00003 (daily mean) | as of 2026-11-18 |
| Daily values, sensor sites | USGS Water Data APIs | `dataretrieval.waterdata.get_daily` | 99133 nitrate plus nitrite (mg/L as N), 00060 discharge (cfs) | flow from 1990, nitrate full record, through 2026-11-17 |
| Daily discharge, flow-only gauges | USGS Water Data APIs | `get_daily` | 00060 | 2000-01-01 to 2026-11-17 |
| Monitoring locations | USGS Water Data APIs | `get_monitoring_locations` | name, state, coordinates | as of 2026-11-18 |
| State outlines | U.S. Census Bureau via `us-atlas` 3.0.1 | npm | — | 2017 cartographic boundaries |

All data are free and public. No API key or paid service is used. The legacy `waterservices.usgs.gov` endpoints are not used.

## Caching

Every download is saved to `data/raw/<name>__<UTC timestamp>.parquet`, and the analysis reads the latest file for each name. The analysis, figures and site rebuild offline from these files. The flow-only download is fetched in chunks of 5 gauges (`data/raw/_chunks/`, not committed), then merged into one timestamped file. Chunks are requested in interleaved order so a partial download covers all states. Until the merge, `src.flow_only_map` runs on the cached chunks and writes `partial: true` to `results/flow_only_info.json`.

## Site selection

- **Sensor sites:** every 99133 daily-mean series in IA, IL, IN, MN, WI, OH, MO and NE spanning at least 4.5 years, kept if it has **at least 5 valid springs**. A valid spring has both nitrate and discharge on at least 80% of March–June days. The result is 33 sites and 317 valid site-springs. 269 of these can be classified (at least 5 years of earlier flow to rank against), and 99 are post-drought.
- **Flow-only gauges:** 00060 daily-mean series whose record began by 2016-03-01 and which reported after 2026-10-01, at 8-digit stream-gauge IDs. The result is 1,241 gauges.

## Cleaning

- Values with the qualifiers equipment malfunction, ice, maintenance, discontinued or seasonal (`Eqp`, `Ice`, `Mnt`, `Dis`, `Ssn`) are dropped, as are negative values.
- When a site has more than one series for the same parameter, daily values are averaged.
- Both approved and provisional values are used. Recent data (2025–2026) are largely provisional and may be revised by USGS.

## Derived quantities

- Daily load L = C × Q × 2.4466 kg/day.
- Antecedent percentile: the trailing 365-day mean flow (at least 80% of days present), ranked against all earlier days of the same gauge. It needs 5 years of history.
- Surge: 7-day mean nitrate above min(site 90th percentile, 10 mg/L), March–June.

## Spring 2027 watchlist

- Every flow-only gauge, plus the 33 sensor rivers (ranked on their own discharge record from 1990, as in the backtest), is ranked on its latest reported day (Nov 2026). Those below the 25th percentile are on Watch.
- Triggers: the median 7-day flow for Mar 1, Apr 1, May 1 and Jun 1 across all prior years, smoothed over 15 days, which is exactly what the rule compares against.
- Gauges whose spring triggers are all below 1 cfs (diversions, nearly dry channels) are left out, because a flow trigger has no meaning there (1 gauge).
- Final status is set on March 1, 2027. The forecast will be scored on July 1, 2027 against the sensor rivers on Watch.

## Known gaps and biases

- Sensor sites cluster in Iowa and Illinois, where state and university sensor networks are dense. Other states have few sensors with 5 or more valid springs.
- Sensors are often pulled in winter, so spring records sometimes start after March 1. Those springs fail the 80% coverage test and are excluded.
- Post-drought springs before 2020 are rare in the sensor era, so the training set is small (see README limitations).
- Flow-only status cannot be validated without nitrate data.

## Files behind each published number

| Output | File |
|---|---|
| Load errors per site, spring, sampling day and estimator | `results/spring_load_errors.csv` |
| Load error summary | `results/spring_load_error_summary.csv` |
| Alert, surge and lead per site-spring | `results/backtest_site_springs.csv` |
| Detection metrics, splits and ablations | `results/backtest_metrics.csv` |
| Drought cutoff sensitivity | `results/sensitivity_drought_threshold.csv` |
| Extra-sample curves | `results/adaptive_sampling_summary.csv`, `results/adaptive_sampling_site_springs.csv` |
| Trigger design choice (training years) | `results/adaptive_design_choice.csv` |
| Flow-only replay and current status | `results/flow_only_replay.csv`, `results/flow_only_gauges.geojson`, `results/flow_only_info.json` |
| Spring 2027 watchlist (dated forecast) | `results/watchlist_spring2027.csv`, `results/watchlist_info.json` |
| Run parameters | `results/run_info.json` |
