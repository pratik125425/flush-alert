"""Does the flow-only alert work? Historical backtest at nitrate-sensor sites.

Surge truth (from the sensor, never seen by the trigger): the first spring day on which the
7-day mean nitrate exceeds min(site 90th percentile of daily nitrate, 10 mg/L).

Scoring, for a site-spring:
  hit          alert fired and the surge started between 7 days before and 60 days after it
  false alarm  alert fired and no surge started in that window
  miss         post-drought spring with a surge but no hit
POD = hits / (hits + misses)   FAR = false alarms / alerts   CSI = hits / (hits + misses + FA)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.common import RESULTS, load_config
from src.drought import antecedent_pct
from src.trigger import rise_date

PRE, POST = 7, 60


def site_q(sensor: pd.DataFrame, site: str) -> pd.Series:
    g = sensor[sensor["site"] == site].set_index("date")["Q"].sort_index()
    return g


def surge_table(sensor: pd.DataFrame, springs: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    rows = []
    for site, g in sensor.groupby("site"):
        g = g.set_index("date").sort_index()
        thr = min(float(np.nanpercentile(g["C"], cfg["surge"]["site_percentile"])), cfg["surge"]["epa_mgL"])
        c7 = g["C"].rolling(7, min_periods=5).mean()
        for y in springs.loc[springs["site"] == site, "year"].astype(int):
            w = c7[(c7.index >= f"{y}-03-01") & (c7.index <= f"{y}-06-30")]
            over = w > thr
            rows.append({"site": site, "year": y, "surge_threshold": thr,
                         "surge": bool(over.any()),
                         "surge_start": over.idxmax() if over.any() else pd.NaT,
                         "peak_date": w.idxmax() if w.notna().any() else pd.NaT,
                         "peak_c7": float(w.max()),
                         "above_epa": bool((w > cfg["surge"]["epa_mgL"]).any())})
    return pd.DataFrame(rows)


def drought_table(sensor: pd.DataFrame, springs: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    rows = []
    for site in springs["site"].unique():
        q = site_q(sensor, site)
        for y in springs.loc[springs["site"] == site, "year"].astype(int):
            p = antecedent_pct(q, pd.Timestamp(f"{y}-03-01"), cfg["drought"]["window_days"], cfg["min_history_years"])
            rows.append({"site": site, "year": y, "antecedent_pct": p})
    d = pd.DataFrame(rows)
    d["classifiable"] = d["antecedent_pct"].notna()
    d["post_drought"] = d["antecedent_pct"] < cfg["drought"]["threshold_pct"]
    return d


def rise_table(sensor: pd.DataFrame, springs: pd.DataFrame, cfg: dict) -> pd.DataFrame:
    rows = []
    t = cfg["trigger"]
    for site in springs["site"].unique():
        q = site_q(sensor, site)
        for y in springs.loc[springs["site"] == site, "year"].astype(int):
            for x in t["rise_grid_pct"]:
                rows.append({"site": site, "year": y, "rise_pct": x,
                             "rise_date": rise_date(q, y, x, t["window_start"], t["window_end"], cfg["min_history_years"])})
    return pd.DataFrame(rows)


def score(df: pd.DataFrame, gate: str = "drought") -> dict:
    """df: one row per site-spring with post_drought, rise_date, surge, surge_start, peak_date.
    gate='drought' -> alerts only in post-drought springs (Flush Alert);
    gate='none'    -> flow rise alone, every spring (ablation);
    gate='mar1'    -> drought state alone, alert on Mar 1 (ablation)."""
    d = df.copy()
    if gate == "drought":
        d["alert"] = d["rise_date"].where(d["post_drought"])
        pool = d[d["post_drought"]]
    elif gate == "none":
        d["alert"] = d["rise_date"]
        pool = d
    else:
        d["alert"] = pd.to_datetime(d["year"].astype(str) + "-03-01").where(d["post_drought"])
        pool = d[d["post_drought"]]
    a = pd.to_datetime(d["alert"])
    s = pd.to_datetime(d["surge_start"])
    lead = (s - a).dt.days
    d["hit"] = a.notna() & d["surge"] & (lead >= -PRE) & (lead <= POST)
    d["fa"] = a.notna() & ~d["hit"]
    pool = d.loc[pool.index]
    hits, fa = int(d["hit"].sum()), int(d["fa"].sum())
    events = int(pool["surge"].sum())
    misses = events - int(pool["hit"].sum())
    alerts = int(a.notna().sum())
    hl = lead[d["hit"]]
    pl = (pd.to_datetime(d["peak_date"]) - a)[d["hit"]].dt.days
    return {"alerts": alerts, "events": events, "hits": hits, "misses": misses, "false_alarms": fa,
            "pod": hits / events if events else np.nan,
            "far": fa / alerts if alerts else np.nan,
            "csi": hits / (hits + misses + fa) if (hits + misses + fa) else np.nan,
            "median_lead_to_surge_d": float(hl.median()) if len(hl) else np.nan,
            "median_lead_to_peak_d": float(pl.median()) if len(pl) else np.nan,
            "_frame": d}


def bootstrap_ci(df: pd.DataFrame, n: int = 2000, seed: int = 0) -> dict:
    """95% CI for POD and FAR by resampling site-springs with replacement."""
    rng = np.random.default_rng(seed)
    d = score(df)["_frame"]
    pool = d[d["post_drought"]]
    pods, fars = [], []
    arr = pool[["hit", "fa", "surge"]].to_numpy(bool)
    alert = pool["alert"].notna().to_numpy()
    for _ in range(n):
        i = rng.integers(0, len(arr), len(arr))
        h, f, e, al = arr[i, 0].sum(), arr[i, 1].sum(), arr[i, 2].sum(), alert[i].sum()
        if e:
            pods.append(h / e)
        if al:
            fars.append(f / al)
    q = lambda v: (float(np.percentile(v, 2.5)), float(np.percentile(v, 97.5))) if v else (np.nan, np.nan)
    return {"pod_ci": q(pods), "far_ci": q(fars)}


def tune(df: pd.DataFrame, grid) -> float:
    best, best_csi = grid[0], -1
    for x in grid:
        r = score(df[df["rise_pct"] == x])
        c = 0 if np.isnan(r["csi"]) else r["csi"]
        if c > best_csi:
            best, best_csi = x, c
    return best


def run(sensor, springs, cfg=None):
    cfg = cfg or load_config()
    surges = surge_table(sensor, springs, cfg)
    dro = drought_table(sensor, springs, cfg)
    rises = rise_table(sensor, springs, cfg)
    base = surges.merge(dro, on=["site", "year"])
    base = base[base["classifiable"]]
    full = rises.merge(base, on=["site", "year"])
    grid = cfg["trigger"]["rise_grid_pct"]
    tl = cfg["split"]["train_last_year"]

    out = []
    # time split
    train, test = full[full["year"] <= tl], full[full["year"] > tl]
    x_time = tune(train, grid)
    for name, part in (("train (<= %d)" % tl, train), ("test (>= %d)" % (tl + 1), test)):
        r = score(part[part["rise_pct"] == x_time])
        ci = bootstrap_ci(part[part["rise_pct"] == x_time])
        out.append({"split": "time", "subset": name, "rise_pct": x_time, **{k: v for k, v in r.items() if k != "_frame"},
                    "pod_lo": ci["pod_ci"][0], "pod_hi": ci["pod_ci"][1], "far_lo": ci["far_ci"][0], "far_hi": ci["far_ci"][1]})
    # leave-one-site-out
    frames, xs = [], []
    for s in full["site"].unique():
        x = tune(full[full["site"] != s], grid)
        xs.append(x)
        frames.append(full[(full["site"] == s) & (full["rise_pct"] == x)])
    loso = pd.concat(frames)
    r = score(loso)
    ci = bootstrap_ci(loso)
    out.append({"split": "leave-one-site-out", "subset": "all held-out sites", "rise_pct": float(np.median(xs)),
                **{k: v for k, v in r.items() if k != "_frame"},
                "pod_lo": ci["pod_ci"][0], "pod_hi": ci["pod_ci"][1], "far_lo": ci["far_ci"][0], "far_hi": ci["far_ci"][1]})
    # ablations on the test years, same X
    for gate, label in (("none", "flow rise only (no drought gate)"), ("mar1", "drought gate only (alert Mar 1)")):
        r = score(test[test["rise_pct"] == x_time], gate=gate)
        out.append({"split": "time", "subset": f"test, ablation: {label}", "rise_pct": x_time,
                    **{k: v for k, v in r.items() if k != "_frame"}})
    res = pd.DataFrame(out)
    res.to_csv(RESULTS / "backtest_metrics.csv", index=False)

    # alert-level table at the time-split X (all years) for figures and the site
    alerts = score(full[full["rise_pct"] == x_time])["_frame"]
    alerts["lead_to_surge_d"] = (pd.to_datetime(alerts["surge_start"]) - pd.to_datetime(alerts["alert"])).dt.days
    alerts["lead_to_peak_d"] = (pd.to_datetime(alerts["peak_date"]) - pd.to_datetime(alerts["alert"])).dt.days
    alerts.to_csv(RESULTS / "backtest_site_springs.csv", index=False)

    # surge frequency, post-drought vs normal
    freq = base.groupby("post_drought").agg(site_springs=("surge", "size"), surge_rate=("surge", "mean"),
                                            epa_rate=("above_epa", "mean"), median_peak_c7=("peak_c7", "median")).reset_index()
    freq.to_csv(RESULTS / "surge_rate_by_spring_type.csv", index=False)

    # drought-threshold sensitivity, same X
    sens = []
    for thr in cfg["drought"]["sensitivity"]:
        f2 = full[full["rise_pct"] == x_time].copy()
        f2["post_drought"] = f2["antecedent_pct"] < thr
        for part, d in (("all years", f2), ("test years", f2[f2["year"] > tl])):
            r = score(d)
            sens.append({"drought_threshold_pct": thr, "subset": part,
                         "post_drought_springs": int(d["post_drought"].sum()),
                         **{k: v for k, v in r.items() if k != "_frame"}})
    pd.DataFrame(sens).to_csv(RESULTS / "sensitivity_drought_threshold.csv", index=False)
    return res, alerts, x_time, base
