"""How many extra samples fix the spring-load error, and does it matter when they are taken?

For every valid site-spring and k = 1..6 extra grab samples on top of the monthly schedule:
  triggered  k samples spread over the 30 days after the flow-rise date
             (day offsets (j + 0.5) * 30 / k, j = 0..k-1, fixed before looking at results)
  on-rises   after the alert date, one sample on the onset day of each new flow rise
             (3-day rise > X%) until Jun 30, up to k samples. Flow only, no lookahead:
             each sample is decided from flow up to that day.
  Which triggered design is "the" Flush Alert schedule is chosen on training years only
  (see choose_design); both are reported.
  random     k samples on random spring days (200 draws, each with a random monthly offset)
  fixed      k samples evenly spaced through Mar 1 - Jun 30
Monthly schedules use all 28 day-of-month offsets; errors are averaged over them.
The rise date is the flow condition alone; in post-drought springs it IS the Flush Alert date.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.common import RESULTS, load_config
from src.loads import K, REG_WINDOW_YEARS, Site


def _fast_err(S: Site, idx: np.ndarray, m: np.ndarray, year: int, truth: float, method: str) -> float:
    idx = np.unique(idx)
    if method == "interp":
        chat = np.interp(S.day_num[m], S.day_num[idx], S.c[idx])
    else:
        idx = idx[np.abs(S.year[idx] - year) <= REG_WINDOW_YEARS]
        Xs, cs = S.X[idx], S.c[idx]
        ok = np.isfinite(Xs).all(1) & (cs > 0)
        if ok.sum() < 12:
            return np.nan
        Xs, y = Xs[ok], np.log(cs[ok])
        b, *_ = np.linalg.lstsq(Xs, y, rcond=None)
        chat = np.exp(S.X[m] @ b) * np.mean(np.exp(y - Xs @ b))
    est = np.nansum(chat * S.q[m]) * K
    return abs(est - truth) / truth * 100


def rise_onsets(q: np.ndarray, start: int, stop: int, rise_pct: float) -> np.ndarray:
    """Indices in [start, stop] where the 3-day rise first exceeds rise_pct (onset days)."""
    r3 = np.full(len(q), np.nan)
    with np.errstate(divide="ignore", invalid="ignore"):
        r3[3:] = q[3:] / q[:-3] - 1
    over = r3 > rise_pct / 100
    onset = over & ~np.concatenate([[False], over[:-1]])
    i = np.flatnonzero(onset)
    return i[(i >= start) & (i <= stop)]


def run(sensor: pd.DataFrame, site_springs: pd.DataFrame, cfg: dict | None = None,
        rise_pct: float = 25) -> pd.DataFrame:
    """site_springs: site, year, post_drought, rise_date."""
    cfg = cfg or load_config()
    a = cfg["adaptive"]
    rng = np.random.default_rng(a["seed"])
    rows = []
    for site, g in sensor.groupby("site"):
        ss = site_springs[site_springs["site"] == site]
        if ss.empty:
            continue
        S = Site(g, cfg["spring_months"])
        date_pos = pd.Series(np.arange(len(S.dates)), index=S.dates)
        monthly = {d: S.monthly_idx(d) for d in range(1, 29)}
        for _, r in ss.iterrows():
            y = int(r["year"])
            m = np.flatnonzero(S.spring_mask(y))
            truth = S.true_load(y)
            if truth <= 0 or len(m) == 0:
                continue
            spring_days = np.flatnonzero(S.spring & (S.year == y) & S.has_c)
            p0 = date_pos.get(pd.Timestamp(f"{y}-03-01"))
            rd = pd.to_datetime(r["rise_date"]) if pd.notna(r["rise_date"]) else None
            pr = date_pos.get(rd) if rd is not None else None
            stype = "post-drought" if r["post_drought"] else "normal"
            for method in ("interp", "reg"):
                base = np.mean([_fast_err(S, monthly[d], m, y, truth, method) for d in range(1, 29)])
                rows.append({"site": site, "year": y, "spring_type": stype, "method": method, "k": 0,
                             "schedule": "monthly only", "abs_err_pct": base})
                for k in range(1, a["k_max"] + 1):
                    offs = np.round((np.arange(k) + 0.5) * a["trigger_window_days"] / k).astype(int)
                    sched = {}
                    if pr is not None:
                        ex = pr + offs
                        sched["triggered"] = ex[(ex < len(S.c))]
                        stop = date_pos.get(pd.Timestamp(f"{y}-06-30"), len(S.c) - 1)
                        on = rise_onsets(S.q, pr, stop, rise_pct)
                        on = on[S.has_c[on]][:k]
                        if len(on):
                            sched["on-rises"] = on
                    if p0 is not None:
                        ex = p0 + np.round((np.arange(k) + 0.5) * 122 / k).astype(int)
                        sched["fixed"] = ex[(ex < len(S.c))]
                    for name, ex in sched.items():
                        ex = ex[S.has_c[ex]]
                        e = np.mean([_fast_err(S, np.concatenate([monthly[d], ex]), m, y, truth, method)
                                     for d in range(1, 29)])
                        rows.append({"site": site, "year": y, "spring_type": stype, "method": method, "k": k,
                                     "schedule": name, "abs_err_pct": e})
                    errs = []
                    for _ in range(a["random_draws"]):
                        ex = rng.choice(spring_days, size=min(k, len(spring_days)), replace=False)
                        d = int(rng.integers(1, 29))
                        errs.append(_fast_err(S, np.concatenate([monthly[d], ex]), m, y, truth, method))
                    rows.append({"site": site, "year": y, "spring_type": stype, "method": method, "k": k,
                                 "schedule": "random", "abs_err_pct": float(np.nanmean(errs))})
    out = pd.DataFrame(rows)
    out.to_csv(RESULTS / "adaptive_sampling_site_springs.csv", index=False)

    # Summary: median over site-springs that have a rise date (so all three schedules are comparable)
    has_rise = set(map(tuple, site_springs.dropna(subset=["rise_date"])[["site", "year"]].to_numpy()))
    o = out[[(s, y) in has_rise for s, y in zip(out["site"], out["year"])]]
    summ = (o.groupby(["spring_type", "method", "schedule", "k"])["abs_err_pct"]
              .agg(site_springs="size", median_abs_err_pct="median", mean_abs_err_pct="mean").reset_index())
    base = summ[summ["k"] == 0][["spring_type", "method", "median_abs_err_pct"]].rename(
        columns={"median_abs_err_pct": "baseline_median"})
    summ = summ.merge(base, on=["spring_type", "method"])
    summ["error_removed_pct"] = (1 - summ["median_abs_err_pct"] / summ["baseline_median"]) * 100
    summ.to_csv(RESULTS / "adaptive_sampling_summary.csv", index=False)
    return summ


def choose_design(cfg: dict | None = None) -> pd.DataFrame:
    """Pick the triggered design on TRAINING years only (all spring types, both estimators):
    the design with the lower mean error across k = 1..6. Written to results/."""
    cfg = cfg or load_config()
    d = pd.read_csv(RESULTS / "adaptive_sampling_site_springs.csv")
    d = d[(d["year"] <= cfg["split"]["train_last_year"]) & d["schedule"].isin(["triggered", "on-rises"])]
    both = d.pivot_table(index=["site", "year", "method", "k"], columns="schedule", values="abs_err_pct").dropna()
    res = pd.DataFrame({"design": ["triggered", "on-rises"],
                        "train_mean_abs_err_pct": [both["triggered"].mean(), both["on-rises"].mean()],
                        "train_cases": [len(both), len(both)]})
    res["chosen"] = res["train_mean_abs_err_pct"] == res["train_mean_abs_err_pct"].min()
    res.to_csv(RESULTS / "adaptive_design_choice.csv", index=False)
    return res
