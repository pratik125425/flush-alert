"""Export compact JSON for the static site (site/public/data/). Every number shown on
the site is read from these files, and every file is built from results/ CSVs or the
cached data.

    python -m src.export
"""
from __future__ import annotations

import json
import math
import shutil
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from src.common import RESULTS, SITE_DATA, load_config
from src.loads import Site
from src.prep import load_locations, load_sensor
from src.trigger import alert_for_spring

REPLAY_YEARS = [2013, 2024, 2025]
SAMPLE_DAY = 15  # the monthly schedule drawn on charts: mid-month, a common convention


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        return None if (o is None or math.isnan(o)) else round(float(o), 4)
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.strftime("%Y-%m-%d")
    if o is pd.NaT:
        return None
    return o


def dump(name: str, obj) -> None:
    SITE_DATA.mkdir(parents=True, exist_ok=True)
    with open(SITE_DATA / name, "w") as f:
        json.dump(_clean(obj), f, separators=(",", ":"))


def _d(x):
    return None if (x is None or (isinstance(x, float) and math.isnan(x)) or pd.isna(x)) else pd.Timestamp(x)


def site_series(S: Site, q: pd.Series, year: int, rise_pct: float, cfg: dict, surge_thr: float) -> dict:
    lo, hi = pd.Timestamp(f"{year}-02-01"), pd.Timestamp(f"{year}-07-31")
    m = (S.dates >= lo) & (S.dates <= hi)
    idx = S.monthly_idx(SAMPLE_DAY)
    reg = S.estimate("reg", idx, year)
    itp = S.estimate("interp", idx)
    a = alert_for_spring(q, year, rise_pct, cfg["drought"]["threshold_pct"], cfg["drought"]["window_days"],
                         cfg["min_history_years"])
    samp = idx[(S.dates[idx] >= lo) & (S.dates[idx] <= hi)]
    sm = S.spring_mask(year)
    valid = sm.sum() >= 0.8 * 122
    c7 = pd.Series(S.c, index=S.dates).rolling(7, min_periods=5).mean()
    w = c7[(c7.index >= f"{year}-03-01") & (c7.index <= f"{year}-06-30")]
    over = w > surge_thr
    out = {
        "year": year,
        "start": lo, "dates_n": int(m.sum()),
        "c": [None if not np.isfinite(v) else round(float(v), 2) for v in S.c[m]],
        "q": [None if not np.isfinite(v) else round(float(v)) for v in S.q[m]],
        "reg": [None if not np.isfinite(v) else round(float(v), 2) for v in reg[m]],
        "interp": [None if not np.isfinite(v) else round(float(v), 2) for v in itp[m]],
        "samples": [[S.dates[i].strftime("%Y-%m-%d"), round(float(S.c[i]), 2)] for i in samp],
        "antecedent_pct": a["antecedent_pct"], "post_drought": a["post_drought"],
        "alert": a["alert_date"], "rise": a["rise_date"],
        "surge_threshold": surge_thr,
        "surge_start": over.idxmax() if over.any() else None,
        "peak_date": w.idxmax() if w.notna().any() else None,
        "peak_c7": float(w.max()) if w.notna().any() else None,
        "valid_spring": bool(valid),
    }
    if valid:
        tl = S.true_load(year)
        out.update({"true_load_kg": tl, "est_reg_kg": S.est_load(reg, year), "est_interp_kg": S.est_load(itp, year)})
    return out


def run() -> None:
    cfg = load_config()
    info = json.load(open(RESULTS / "run_info.json"))
    x = info["rise_pct_tuned"]
    sensor, springs = load_sensor()
    loc = load_locations().set_index("site")
    surges = pd.read_csv(RESULTS / "backtest_site_springs.csv")
    thr_by_site = surges.groupby("site")["surge_threshold"].first()

    # ---- per-site replay series
    sites_out = []
    (SITE_DATA / "series").mkdir(parents=True, exist_ok=True)
    for site, g in sensor.groupby("site"):
        S = Site(g, cfg["spring_months"])
        q = g.set_index("date")["Q"].sort_index()
        thr = float(thr_by_site.get(site, min(np.nanpercentile(g["C"], 90), 10)))
        seasons = {}
        for y in REPLAY_YEARS:
            if not ((S.year == y) & S.has_c).any():
                continue
            ser = site_series(S, q, y, x, cfg, thr)
            dump(f"series/{site}_{y}.json", ser)
            seasons[str(y)] = {k: ser.get(k) for k in ("post_drought", "antecedent_pct", "alert", "rise", "surge_start",
                                                       "peak_date", "peak_c7", "valid_spring", "true_load_kg",
                                                       "est_reg_kg", "est_interp_kg")}
        L = loc.loc[site]
        sites_out.append({"site": site, "name": L["monitoring_location_name"], "state": L["state_name"],
                          "lon": round(float(L["lon"]), 4), "lat": round(float(L["lat"]), 4),
                          "springs": int((springs["site"] == site).sum()), "seasons": seasons})
    dump("sites.json", sites_out)

    # ---- "how it works" chart: hero flow, Mar of the prior year to Jun of the hero year
    from src.adaptive_sampling import rise_onsets
    from src.trigger import prior_years_doy_median, q7
    hero = cfg["hero_site"]
    hq = sensor[sensor["site"] == hero].set_index("date")["Q"].sort_index()
    hy = 2025
    lo, hi = pd.Timestamp(f"{hy - 1}-03-01"), pd.Timestamp(f"{hy}-06-30")
    w = hq[(hq.index >= lo) & (hq.index <= hi)]
    med = prior_years_doy_median(hq, hy)
    a = alert_for_spring(hq, hy, x, cfg["drought"]["threshold_pct"], cfg["drought"]["window_days"], cfg["min_history_years"])
    arr = hq.to_numpy(float)
    pos = {d: i for i, d in enumerate(hq.index)}
    on = rise_onsets(arr, pos[pd.Timestamp(a["alert_date"])], pos[pd.Timestamp(f"{hy}-06-30")], x)[:6]
    sp = w[w.index >= f"{hy}-02-01"]
    dump("how.json", {"start": lo, "q": [None if not np.isfinite(v) else round(float(v)) for v in w.to_numpy(float)],
                      "q7": [None if not np.isfinite(v) else round(float(v)) for v in q7(hq).reindex(w.index).to_numpy(float)],
                      "median_start": pd.Timestamp(f"{hy}-02-01"),
                      "median": [None if not np.isfinite(v) else round(float(v)) for v in med.reindex(sp.index.day_of_year).to_numpy(float)],
                      "antecedent_pct": a["antecedent_pct"], "alert": a["alert_date"],
                      "samples": [hq.index[i].strftime("%Y-%m-%d") for i in on]})

    # ---- flow-only gauges (optional until the download completes)
    gp = RESULTS / "flow_only_gauges.geojson"
    if gp.exists():
        gj = json.load(open(gp))
        rep = pd.read_csv(RESULTS / "flow_only_replay.csv")
        rep_by = {s: g for s, g in rep.groupby("site")}
        gauges = []
        for f in gj["features"]:
            p = f["properties"]
            r = rep_by.get(p["site"])
            seasons = {}
            if r is not None:
                for _, row in r.iterrows():
                    if row["classifiable"]:
                        seasons[str(int(row["year"]))] = [round(float(row["antecedent_pct"]), 1),
                                                          row["alert_date"] if isinstance(row["alert_date"], str) else None]
            gauges.append({"site": p["site"], "name": p["name"], "lon": f["geometry"]["coordinates"][0],
                           "lat": f["geometry"]["coordinates"][1], "status": p["status"],
                           "pct": p["antecedent_pct"], "last": p["last_update"], "seasons": seasons})
        dump("gauges.json", gauges)
        shutil.copy(gp, SITE_DATA / "flow_only_gauges.geojson")
    else:
        dump("gauges.json", [])  # keeps the site free of 404s before the first flow-only run

    # ---- spring 2027 watchlist (dated forecast)
    wp, wi = RESULTS / "watchlist_spring2027.csv", RESULTS / "watchlist_info.json"
    if wp.exists() and wi.exists():
        wl = pd.read_csv(wp)
        winfo = json.load(open(wi))
        nm = {r["site"]: r["name"] for r in sites_out}
        r0 = lambda v: None if pd.isna(v) else (round(float(v), 1) if v < 100 else int(round(float(v))))
        row = lambda r: [r.site, r["name"], r.state, r.antecedent_pct, r0(r.flow7_now_cfs),
                         [r0(r[c]) for c in ("trigger_cfs_0301", "trigger_cfs_0401", "trigger_cfs_0501", "trigger_cfs_0601")],
                         r.nearest_sensor_name, r.nearest_sensor_km, bool(r.is_sensor_site), r.as_of,
                         None if pd.isna(r.pct_of_normal_flow) else round(float(r.pct_of_normal_flow))]
        cp, rp = RESULTS / "watchlist_candidates_2027.csv", RESULTS / "watchlist_rerank_2027.json"
        if cp.exists() and rp.exists():
            cd = pd.read_csv(cp)
            dump("rerank.json", {**json.load(open(rp)), "candidates": [row(r) for _, r in cd.iterrows()]})
        dump("watchlist.json", {
            **{k: v for k, v in winfo.items() if not k.endswith("_ids")},
            "sensor_watch": [{"site": s, "name": nm.get(s, s)} for s in winfo["sensor_sites_on_watch_ids"]],
            "rows": [row(r) for _, r in wl.iterrows()],
        })
        shutil.copy(wp, SITE_DATA / "watchlist_spring2027.csv")
        tp = RESULTS / "watchlist_triggers_2027.json"
        if tp.exists():
            shutil.copy(tp, SITE_DATA / "triggers.json")

    # ---- evidence
    err = pd.read_csv(RESULTS / "spring_load_errors.csv").dropna(subset=["err_pct"])
    err["spring_type"] = np.where(err["post_drought"], "post-drought", "normal")
    box = []
    for (t, m), g in err.groupby(["spring_type", "method"]):
        a = g["err_pct"].abs()
        box.append({"type": t, "method": m, "n_site_springs": int(g[["site", "year"]].drop_duplicates().shape[0]),
                    "q10": a.quantile(.1), "q25": a.quantile(.25), "median": a.median(),
                    "q75": a.quantile(.75), "q90": a.quantile(.9)})
    summ = pd.read_csv(RESULTS / "spring_load_error_summary.csv")
    metrics = pd.read_csv(RESULTS / "backtest_metrics.csv")
    ad = pd.read_csv(RESULTS / "adaptive_sampling_summary.csv")
    curves = ad[["spring_type", "method", "schedule", "k", "median_abs_err_pct", "site_springs"]].to_dict("records")
    hits = surges[surges["hit"]]
    sens = pd.read_csv(RESULTS / "sensitivity_drought_threshold.csv")
    freq = pd.read_csv(RESULTS / "surge_rate_by_spring_type.csv")
    choice = pd.read_csv(RESULTS / "adaptive_design_choice.csv")
    dump("evidence.json", {
        "box": box, "load_summary": summ.to_dict("records"), "metrics": metrics.to_dict("records"),
        "lead_to_surge": hits["lead_to_surge_d"].dropna().astype(int).tolist(),
        "lead_to_peak": hits["lead_to_peak_d"].dropna().astype(int).tolist(),
        "curves": curves, "sensitivity": sens.to_dict("records"), "surge_rate": freq.to_dict("records"),
        "design_choice": choice.to_dict("records")})

    # ---- headline numbers, all traceable to results/
    def ls(t, m, col="median_abs_err_pct"):
        return summ.loc[(summ.spring_type == t) & (summ.method == m), col].item()

    test = metrics[(metrics.split == "time") & metrics.subset.str.startswith("test (")].iloc[0]
    loso = metrics[metrics.split == "leave-one-site-out"].iloc[0]
    chosen = info["chosen_trigger_design"]

    def cv(sched, k, t="post-drought", m="reg"):
        r = ad[(ad.spring_type == t) & (ad.method == m) & (ad.schedule == sched) & (ad.k == k)]
        return r["median_abs_err_pct"].item() if len(r) else None

    fi = RESULTS / "flow_only_info.json"
    finfo = json.load(open(fi)) if fi.exists() else {}
    n_g = finfo.get("selected")
    if n_g is None:
        from src.fetch import flow_only_ids
        n_g = len(flow_only_ids())
    dump("summary.json", {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "hero_site": cfg["hero_site"], "hero_year": 2025,
        "sensor_sites": info["sensor_sites"], "site_springs": info["classified_site_springs"],
        "post_drought_springs": info["post_drought_site_springs"], "years": info["years"],
        "rise_pct": x, "drought_pct": cfg["drought"]["threshold_pct"], "chosen_design": chosen,
        "err": {"reg_post": ls("post-drought", "reg"), "reg_normal": ls("normal", "reg"),
                "interp_post": ls("post-drought", "interp"), "interp_normal": ls("normal", "interp"),
                "reg_post_p90": ls("post-drought", "reg", "p90_abs_err_pct"),
                "reg_normal_p90": ls("normal", "reg", "p90_abs_err_pct")},
        "test": {k: test[k] for k in ("pod", "far", "pod_lo", "pod_hi", "far_lo", "far_hi", "hits", "misses",
                                      "false_alarms", "alerts", "events", "median_lead_to_surge_d",
                                      "median_lead_to_peak_d")},
        "loso": {k: loso[k] for k in ("pod", "far", "pod_lo", "pod_hi", "far_lo", "far_hi", "median_lead_to_surge_d")},
        "adaptive": {"base": cv("monthly only", 0), "chosen6": cv(chosen, 6), "triggered6": cv("triggered", 6),
                     "random6": cv("random", 6), "fixed6": cv("fixed", 6), "chosen3": cv(chosen, 3),
                     "random3": cv("random", 3), "fixed3": cv("fixed", 3)},
        "gauges": n_g,
        "gauges_mapped": finfo.get("mapped"),
        "gauges_partial": bool(finfo.get("partial", False)),
        "surge_rate": {"post": freq.loc[freq.post_drought, "surge_rate"].item(),
                       "normal": freq.loc[~freq.post_drought, "surge_rate"].item()},
    })
    print(f"exported to {SITE_DATA}")


if __name__ == "__main__":
    run()
