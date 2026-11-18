"""Spring 2027 watchlist: a dated, checkable forecast from the same flow-only rule.

For every gauge on Watch on its latest reported day (trailing 12-month flow below its own
25th percentile), write what a sampling program needs before March 1:
  - how dry the past year ranks,
  - the flow that would trip the alert on Mar 1, Apr 1, May 1 and Jun 1
    (that calendar day's median 7-day flow from all prior years, as the rule uses),
  - the 3-day rise that would also trip it,
  - the nearest nitrate-sensor river, and whether this gauge is one itself.

Outputs
  results/watchlist_spring2027.csv   the forecast record (one row per Watch gauge)
  results/watchlist_info.json        as-of date, counts, and how it will be scored
  results/watchlist_triggers_2027.json  daily trigger flow, Mar 1 - Jun 30, per Watch or near-Watch gauge
  results/watchlist_candidates_2027.csv near-Watch gauges (25th-40th percentile), same columns
  results/watchlist_rerank_2027.json    what a browser needs to re-rank with new daily flow

The status is final only on March 1, 2027, when the 12-month window is re-ranked.
No data after the as-of day is used.

    python -m src.watchlist
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from src.common import RESULTS, load_config
from src.drought import antecedent_pct, trailing_mean
from src.flow_only_map import load_flow
from src.prep import load_locations, load_sensor
from src.trigger import prior_years_doy_median, q7

YEAR = 2027
CHECK_DAYS = ["03-01", "04-01", "05-01", "06-01"]
CANDIDATE_PCT = 40.0  # gauges this dry or drier get live re-rank inputs (they could cross 25 within weeks)
RERANK_DAYS = 60      # oldest days of each 12-month window kept, so the browser can slide it forward
QT_STEP = 0.25        # percentile table resolution, 0..CANDIDATE_PCT
MIN_SPRING_CFS = 1.0  # below this the channel is a diversion or nearly dry; a flow trigger has no meaning


def _km(lat1, lon1, lat2, lon2):
    p = np.pi / 180
    a = np.sin((lat2 - lat1) * p / 2) ** 2 + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def _status(q: pd.Series, cfg) -> tuple[float, pd.Timestamp | None]:
    last = q.last_valid_index()
    if last is None:
        return np.nan, None
    return antecedent_pct(q, last, cfg["drought"]["window_days"], cfg["min_history_years"]), last


def run() -> pd.DataFrame:
    cfg = load_config()
    thr = cfg["drought"]["threshold_pct"]
    rise = json.load(open(RESULTS / "run_info.json"))["rise_pct_tuned"]
    flow, partial = load_flow()
    loc = load_locations().set_index("site")
    sensor, _ = load_sensor()
    sens_sites = sorted(sensor["site"].unique())
    sens_loc = loc.loc[[s for s in sens_sites if s in loc.index]]

    # sensor rivers: their own status today (these are the springs we can score in July)
    sens_watch = []
    for site, g in sensor.groupby("site"):
        pct, last = _status(g.set_index("date")["Q"].sort_index(), cfg)
        if not np.isnan(pct) and pct < thr:
            sens_watch.append(site)

    # every gauge we can rank: flow-only gauges plus the sensor rivers (their own discharge)
    series = {s: g.set_index("date")["Q"].sort_index() for s, g in flow.groupby("site")}
    for s, g in sensor.groupby("site"):  # sensor rivers: full discharge record from 1990, as in the backtest
        series[s] = g.set_index("date")["Q"].sort_index()

    rows, cand_rows, low_flow, curves, rerank = [], [], [], {}, {}
    W = cfg["drought"]["window_days"]
    qs = np.arange(0, CANDIDATE_PCT + QT_STEP / 2, QT_STEP)
    spring = pd.date_range(f"{YEAR}-03-01", f"{YEAR}-06-30")
    for site, q in series.items():
        if site not in loc.index:
            continue
        pct, last = _status(q, cfg)
        if last is None or np.isnan(pct) or pct >= CANDIDATE_PCT:
            continue
        med = prior_years_doy_median(q, YEAR, cfg["min_history_years"])
        tm = trailing_mean(q.loc[:last], cfg["drought"]["window_days"]).dropna()
        normal = float(tm.iloc[:-1].median()) if len(tm) > 1 else np.nan
        pct_normal = round(100 * float(tm.iloc[-1]) / normal, 1) if normal and normal > 0 else np.nan
        trig = {}
        for d in CHECK_DAYS:
            doy = pd.Timestamp(f"{YEAR}-{d}").day_of_year
            v = med.get(doy, np.nan) if not med.empty else np.nan
            trig[f"trigger_cfs_{d.replace('-', '')}"] = None if np.isnan(v) else float(v)
        spring_trig = [v for v in trig.values() if v is not None]
        if not spring_trig or max(spring_trig) < MIN_SPRING_CFS:
            if pct < thr:
                low_flow.append(site)
            continue
        cv = med.reindex(spring.day_of_year).to_numpy(float)
        curves[site] = [None if np.isnan(v) else float(f"{v:.3g}") for v in cv]
        L = loc.loc[site]
        dist = _km(float(L["lat"]), float(L["lon"]), sens_loc["lat"].to_numpy(float), sens_loc["lon"].to_numpy(float))
        j = int(np.argmin(dist))
        # live re-rank inputs: the 12-month window (by rows, as rolling() uses) and the
        # distribution of all earlier trailing means, so a browser can add new days exactly
        qq = q.loc[:last]
        win = qq.iloc[-W:].to_numpy(float)
        hist = np.sort(tm.iloc[:-1].to_numpy(float))
        sig = lambda v: None if np.isnan(v) else float(f"{v:.4g}")
        rerank[site] = {"sum": round(float(np.nansum(win)), 3), "n": int(np.isfinite(win).sum()),
                        "old": [None if np.isnan(v) else float(f"{v:.3g}") for v in win[:RERANK_DAYS]], "N": int(len(hist)),
                        "qt": [sig(v) for v in np.percentile(hist, qs)], "med": sig(normal)}
        (rows if pct < thr else cand_rows).append({
            "site": site, "name": L.get("monitoring_location_name"), "state": L.get("state_name"),
            "lat": round(float(L["lat"]), 4), "lon": round(float(L["lon"]), 4),
            "as_of": str(last.date()), "antecedent_pct": round(pct, 1), "pct_of_normal_flow": pct_normal,
            "flow7_now_cfs": float(q7(q).loc[:last].dropna().iloc[-1]) if q7(q).loc[:last].notna().any() else None,
            **trig, "rise_pct_3d": rise,
            "is_sensor_site": site in sens_sites,
            "nearest_sensor": sens_loc.index[j], "nearest_sensor_name": sens_loc.iloc[j]["monitoring_location_name"],
            "nearest_sensor_km": round(float(dist[j]), 1),
        })
    curves_out = curves
    wl = pd.DataFrame(rows).sort_values(["antecedent_pct", "pct_of_normal_flow", "site"]).reset_index(drop=True)
    wl.insert(0, "rank", np.arange(1, len(wl) + 1))
    wl.to_csv(RESULTS / "watchlist_spring2027.csv", index=False)

    as_of = wl["as_of"].max() if len(wl) else None
    info = {
        "season": YEAR, "as_of": as_of, "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "watch_gauges": int(len(wl)), "gauges_ranked": int(len(series)), "partial_download": bool(partial),
        "excluded_low_flow": len(low_flow), "excluded_low_flow_ids": low_flow, "min_spring_cfs": MIN_SPRING_CFS,
        "states": int(wl["state"].nunique()) if len(wl) else 0,
        "sensor_sites_on_watch": len(sens_watch), "sensor_sites_on_watch_ids": sens_watch,
        "sensor_sites_total": len(sens_sites), "drought_threshold_pct": thr, "rise_pct_3d": rise,
        "final_call": f"{YEAR}-03-01", "score_on": f"{YEAR}-07-01",
        "scoring": ("On July 1, 2027, for each nitrate-sensor river that is on Watch on March 1: did a surge occur "
                    "(7-day mean nitrate above min(site 90th percentile, 10 mg/L), Mar-Jun), and did the alert fire "
                    "before it started? Report detection rate, false-alarm ratio and lead time, as in the backtest."),
    }
    json.dump(info, open(RESULTS / "watchlist_info.json", "w"), indent=1)
    # daily trigger flow (cfs) for every day Mar 1 - Jun 30, so a live check can use the exact day's value
    json.dump({"start": f"{YEAR}-03-01", "days": len(spring), "rise_pct_3d": rise,
               "sites": curves_out},
              open(RESULTS / "watchlist_triggers_2027.json", "w"), separators=(",", ":"))
    cd = pd.DataFrame(cand_rows).sort_values(["antecedent_pct", "site"]).reset_index(drop=True)
    cd.to_csv(RESULTS / "watchlist_candidates_2027.csv", index=False)
    json.dump({"as_of": as_of, "candidate_pct": CANDIDATE_PCT, "qt_step": QT_STEP, "window_days": W,
               "rerank_days": RERANK_DAYS, "sites": rerank},
              open(RESULTS / "watchlist_rerank_2027.json", "w"), separators=(",", ":"))
    print(f"[watchlist] {len(wl)} gauges on Watch as of {as_of} ({len(low_flow)} near-zero-flow channels left out); "
          f"{len(sens_watch)} of {len(sens_sites)} sensor rivers on Watch; {len(cd)} near-Watch candidates")
    return wl


if __name__ == "__main__":
    run()
