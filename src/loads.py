"""True nitrate loads vs. loads estimated from monthly samples.

True daily load  L = C * Q * 2.4466   (kg/day; C in mg/L as N, Q in cfs)

For each day-of-month offset d = 1..28 we simulate one grab sample per month on day d,
taken from the sensor record. Two estimators turn those samples into daily concentration:
  interp  linear interpolation of C between samples (held flat beyond the ends)
  reg     LOADEST-style regression  ln C = b0 + b1 lnQ + b2 sin2πt + b3 cos2πt + b4 t
          fit on the samples only, back-transformed with Duan's smearing estimator.
          Calibrated on the samples from the target year and the year on each side
          (a 3-year moving window), the way agencies calibrate over a few years rather
          than forcing one trend line through 15+ years of record.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.common import RESULTS, load_config

K = 2.4466


def design(dates: pd.DatetimeIndex, q: np.ndarray) -> np.ndarray:
    t = dates.year + (dates.day_of_year - 0.5) / 365.25
    t = np.asarray(t, dtype=float)
    tc = t - 2015.0
    with np.errstate(divide="ignore", invalid="ignore"):
        lq = np.log(np.where(q > 0, q, np.nan))
    return np.column_stack([np.ones_like(t), lq, np.sin(2 * np.pi * t), np.cos(2 * np.pi * t), tc])


def est_interp(day_num: np.ndarray, sample_idx: np.ndarray, c: np.ndarray) -> np.ndarray:
    if len(sample_idx) == 0:
        return np.full(len(day_num), np.nan)
    return np.interp(day_num, day_num[sample_idx], c[sample_idx])


def est_reg(X: np.ndarray, sample_idx: np.ndarray, c: np.ndarray) -> np.ndarray:
    Xs, cs = X[sample_idx], c[sample_idx]
    ok = np.isfinite(Xs).all(1) & (cs > 0)
    if ok.sum() < 12:
        return np.full(len(X), np.nan)
    Xs, y = Xs[ok], np.log(cs[ok])
    b, *_ = np.linalg.lstsq(Xs, y, rcond=None)
    smear = np.mean(np.exp(y - Xs @ b))  # Duan (1983)
    return np.exp(X @ b) * smear


ESTIMATORS = ("interp", "reg")
REG_WINDOW_YEARS = 1  # calibrate on target year +/- 1


class Site:
    """Arrays for one sensor site, precomputed once and reused by every experiment."""

    def __init__(self, df: pd.DataFrame, spring_months):
        df = df.sort_values("date").reset_index(drop=True)
        self.df = df
        self.dates = pd.DatetimeIndex(df["date"])
        self.c = df["C"].to_numpy(float)
        self.q = df["Q"].to_numpy(float)
        self.day_num = (self.dates - self.dates[0]).days.to_numpy(float)
        self.X = design(self.dates, self.q)
        self.has_c = np.isfinite(self.c)
        self.spring = np.isin(self.dates.month, spring_months)
        self.year = self.dates.year.to_numpy()
        self.dom = self.dates.day.to_numpy()

    def monthly_idx(self, offset: int) -> np.ndarray:
        return np.flatnonzero((self.dom == offset) & self.has_c)

    def estimate(self, method: str, idx: np.ndarray, year: int | None = None) -> np.ndarray:
        idx = np.unique(idx)
        if method == "interp":
            return est_interp(self.day_num, idx, self.c)
        if year is not None:
            idx = idx[np.abs(self.year[idx] - year) <= REG_WINDOW_YEARS]
        return est_reg(self.X, idx, self.c)

    def spring_mask(self, year: int) -> np.ndarray:
        return self.spring & (self.year == year) & self.has_c & np.isfinite(self.q)

    def true_load(self, year: int) -> float:
        m = self.spring_mask(year)
        return float(np.sum(self.c[m] * self.q[m]) * K)

    def est_load(self, chat: np.ndarray, year: int) -> float:
        m = self.spring_mask(year)
        return float(np.nansum(chat[m] * self.q[m]) * K)

    def peak7(self, conc: np.ndarray, year: int) -> float:
        m = self.spring & (self.year == year)
        s = pd.Series(conc[m]).rolling(7, min_periods=5).mean()
        return float(s.max())


def spring_errors(sensor: pd.DataFrame, springs: pd.DataFrame, classes: pd.DataFrame) -> pd.DataFrame:
    cfg = load_config()
    rows = []
    for site_id, g in sensor.groupby("site"):
        S = Site(g, cfg["spring_months"])
        years = springs.loc[springs["site"] == site_id, "year"].astype(int).tolist()
        truths = {y: (S.true_load(y), S.peak7(S.c, y)) for y in years}
        for d in range(1, 29):
            idx = S.monthly_idx(d)
            for m in ESTIMATORS:
                chat_all = S.estimate(m, idx) if m == "interp" else None
                for y in years:
                    chat = chat_all if chat_all is not None else S.estimate(m, idx, y)
                    tl, tp = truths[y]
                    el, ep = S.est_load(chat, y), S.peak7(chat, y)
                    rows.append({"site": site_id, "year": y, "offset": d, "method": m,
                                 "true_load_kg": tl, "est_load_kg": el,
                                 "err_pct": (el - tl) / tl * 100 if tl > 0 else np.nan,
                                 "true_peak7": tp, "est_peak7": ep,
                                 "peak_miss_pct": (ep - tp) / tp * 100 if tp > 0 else np.nan})
    out = pd.DataFrame(rows)
    out = out.merge(classes[["site", "year", "post_drought", "antecedent_pct"]], on=["site", "year"], how="left")
    out.to_csv(RESULTS / "spring_load_errors.csv", index=False)
    return out


def summarize(err: pd.DataFrame) -> pd.DataFrame:
    err = err.dropna(subset=["err_pct"]).copy()
    err["abs_err_pct"] = err["err_pct"].abs()
    err["abs_peak_miss_pct"] = err["peak_miss_pct"].abs()
    err["spring_type"] = np.where(err["post_drought"], "post-drought", "normal")
    s = (err.groupby(["spring_type", "method"])
            .agg(site_springs=("year", lambda x: len(set(zip(err.loc[x.index, "site"], x)))),
                 median_abs_err_pct=("abs_err_pct", "median"),
                 mean_abs_err_pct=("abs_err_pct", "mean"),
                 p90_abs_err_pct=("abs_err_pct", lambda x: x.quantile(0.9)),
                 median_signed_err_pct=("err_pct", "median"),
                 median_abs_peak_miss_pct=("abs_peak_miss_pct", "median"))
            .reset_index())
    s.to_csv(RESULTS / "spring_load_error_summary.csv", index=False)
    return s
