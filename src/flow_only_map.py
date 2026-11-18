"""Scale up: run the flow-only trigger at every active USGS discharge gauge in the target
states. No nitrate sensor is needed. Outputs:

  results/flow_only_gauges.geojson   site, state (OK / WATCH / ALERT), last update
  results/flow_only_replay.csv       per gauge and replay spring: antecedent pct, alert date
"""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from src.common import PROC, RAW, RESULTS, latest_raw, load_config, read_raw
from src.drought import antecedent_pct
from src.prep import complete_index, load_locations, wide_daily
from src.trigger import alert_for_spring

REPLAY_YEARS = [2013, 2024, 2025]


def load_flow() -> tuple[pd.DataFrame, bool]:
    """Daily flow for the flow-only gauges. If the full download has not finished, use the
    chunks cached so far and say so (partial=True); nothing is cached in that case."""
    cfg = load_config()
    p = PROC / "flowonly_daily.parquet"
    if latest_raw("flowonly_daily") is not None:
        if p.exists():
            return pd.read_parquet(p), False
        raw, partial = read_raw("flowonly_daily"), False
    else:
        files = sorted((RAW / "_chunks" / "flowonly").glob("*.parquet"))
        if not files:
            raise FileNotFoundError("No flow-only data yet. Run `make data`.")
        raw, partial = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True), True
    w = wide_daily(raw, {cfg["flow_param"]: "Q"})
    w = complete_index(w[["site", "date", "Q"]])
    if not partial:
        w.to_parquet(p, index=False)
    return w, partial


def selected_gauges() -> int:
    """Gauges chosen for the flow-only map (same rule as src.fetch)."""
    from src.fetch import flow_only_ids
    return len(flow_only_ids())


def run(rise_pct: float | None = None) -> pd.DataFrame:
    cfg = load_config()
    if rise_pct is None:
        rise_pct = json.load(open(RESULTS / "run_info.json"))["rise_pct_tuned"]
    thr = cfg["drought"]["threshold_pct"]
    flow, partial = load_flow()
    loc = load_locations().set_index("site")
    rows, feats = [], []
    for site, g in flow.groupby("site"):
        q = g.set_index("date")["Q"].sort_index()
        last = q.last_valid_index()
        if last is None or site not in loc.index:
            continue
        for y in REPLAY_YEARS:
            r = alert_for_spring(q, y, rise_pct, thr, cfg["drought"]["window_days"], cfg["min_history_years"])
            rows.append({"site": site, "year": y, "antecedent_pct": r["antecedent_pct"],
                         "post_drought": r["post_drought"], "classifiable": r["classifiable"],
                         "alert_date": r["alert_date"]})
        # live status on the last reported day
        pct = antecedent_pct(q, last, cfg["drought"]["window_days"], cfg["min_history_years"])
        state = "OK"
        if not np.isnan(pct) and pct < thr:
            state = "WATCH"
        if last.month in cfg["spring_months"]:
            r = alert_for_spring(q, last.year, rise_pct, thr, cfg["drought"]["window_days"], cfg["min_history_years"])
            if r["alert_date"] is not None and (last - r["alert_date"]).days <= 30:
                state = "ALERT"
        L = loc.loc[site]
        feats.append({"type": "Feature",
                      "geometry": {"type": "Point", "coordinates": [round(float(L["lon"]), 4), round(float(L["lat"]), 4)]},
                      "properties": {"site": site, "name": L.get("monitoring_location_name"),
                                     "state_name": L.get("state_name"),
                                     "antecedent_pct": None if np.isnan(pct) else round(pct, 1),
                                     "status": state if not np.isnan(pct) else "UNRANKED",
                                     "last_update": str(last.date())}})
    rep = pd.DataFrame(rows)
    rep.to_csv(RESULTS / "flow_only_replay.csv", index=False)
    with open(RESULTS / "flow_only_gauges.geojson", "w") as f:
        json.dump({"type": "FeatureCollection", "features": feats}, f)
    info = {"selected": selected_gauges(), "mapped": len(feats), "partial": partial,
            "latest_day": max((x["properties"]["last_update"] for x in feats), default=None)}
    json.dump(info, open(RESULTS / "flow_only_info.json", "w"), indent=1)
    if partial:
        print(f"[flow-only] PARTIAL: {len(feats)} of {info['selected']} gauges downloaded so far")
    st = pd.Series([x["properties"]["status"] for x in feats]).value_counts()
    print(f"[flow-only] {len(feats)} gauges; live status: {st.to_dict()}")
    print(rep.groupby("year").agg(classifiable=("classifiable", "sum"), post_drought=("post_drought", "sum"),
                                  alerts=("alert_date", lambda s: s.notna().sum())).to_string())
    return rep


if __name__ == "__main__":
    run()
