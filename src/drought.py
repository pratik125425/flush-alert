"""Classify springs as post-drought using river flow only.

Antecedent dryness on date t = trailing 365-day mean flow ending on t, ranked as a
percentile against the same statistic on every earlier day of that gauge's own record.
Only data up to and including t are used (no lookahead).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def trailing_mean(q: pd.Series, window: int = 365) -> pd.Series:
    """q: daily flow on a continuous DatetimeIndex. Trailing (right-aligned) mean."""
    return q.rolling(window, min_periods=int(window * 0.8)).mean()


def antecedent_pct(q: pd.Series, date: pd.Timestamp, window: int = 365,
                   min_history_years: int = 5) -> float:
    """Percentile (0-100) of the trailing mean on `date` versus all earlier days."""
    q = q[q.index <= date]
    tm = trailing_mean(q, window).dropna()
    if date not in tm.index:
        return np.nan
    hist = tm[tm.index < date]
    if len(hist) < 365 * min_history_years:
        return np.nan
    return float((hist < tm.loc[date]).mean() * 100)


def antecedent_pct_series(q: pd.Series, window: int = 365, min_history_years: int = 5) -> pd.Series:
    """Daily expanding-percentile series (used for the live map). Still no lookahead:
    the value on t uses trailing means from days before t only."""
    tm = trailing_mean(q, window)
    vals = tm.to_numpy()
    out = np.full(len(vals), np.nan)
    seen = []
    import bisect
    for i, v in enumerate(vals):
        if np.isnan(v):
            continue
        if len(seen) >= 365 * min_history_years:
            out[i] = bisect.bisect_left(seen, v) / len(seen) * 100
        bisect.insort(seen, v)
    return pd.Series(out, index=q.index)


def classify_springs(q: pd.Series, years, threshold: float, window: int = 365,
                     min_history_years: int = 5) -> pd.DataFrame:
    rows = []
    for y in years:
        d = pd.Timestamp(f"{y}-03-01")
        p = antecedent_pct(q, d, window, min_history_years)
        rows.append({"year": int(y), "antecedent_pct": p,
                     "post_drought": bool(p < threshold) if not np.isnan(p) else False,
                     "classifiable": not np.isnan(p)})
    return pd.DataFrame(rows)
