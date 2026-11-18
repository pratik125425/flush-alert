"""The Flush Alert rule, using flow only.

In a post-drought spring, the alert fires on the first day between Mar 1 and Jun 30 when
either
  (a) the trailing 7-day mean flow is above that calendar day's median from PRIOR years, or
  (b) daily flow has risen more than X% over the last 3 days (X tuned on training years).
Every quantity on day t uses data up to t only.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.drought import antecedent_pct


def q7(q: pd.Series) -> pd.Series:
    return q.rolling(7, min_periods=5).mean()


def prior_years_doy_median(q: pd.Series, year: int, min_years: int = 5) -> pd.Series:
    """Median 7-day flow for each day of year, from years strictly before `year`,
    smoothed with a 15-day window across day-of-year. Indexed by day of year (1..366)."""
    s = q7(q)
    s = s[s.index.year < year].dropna()
    if s.index.year.nunique() < min_years:
        return pd.Series(dtype=float)
    med = s.groupby(s.index.day_of_year).median().reindex(range(1, 367))
    med = pd.concat([med.iloc[-7:], med, med.iloc[:7]])  # wrap year ends
    med = med.rolling(15, center=True, min_periods=5).median().iloc[7:-7]
    med.index = range(1, 367)
    return med


def rise_date(q: pd.Series, year: int, rise_pct: float, start="03-01", end="06-30",
              min_years: int = 5) -> pd.Timestamp | None:
    """First day in the spring window meeting the flow condition (ignores drought state)."""
    med = prior_years_doy_median(q, year, min_years)
    if med.empty:
        return None
    lo, hi = pd.Timestamp(f"{year}-{start}"), pd.Timestamp(f"{year}-{end}")
    qq = q[q.index <= hi]
    s7 = q7(qq)
    r3 = qq / qq.shift(3) - 1
    win = s7[(s7.index >= lo)]
    if win.empty:
        return None
    above = win > med.reindex(win.index.day_of_year).to_numpy()
    rising = r3.reindex(win.index) > rise_pct / 100
    hit = (above | rising) & win.notna()
    return hit.idxmax() if hit.any() else None


def alert_for_spring(q: pd.Series, year: int, rise_pct: float, drought_threshold: float,
                     window_days=365, min_history_years=5, start="03-01", end="06-30") -> dict:
    pct = antecedent_pct(q, pd.Timestamp(f"{year}-03-01"), window_days, min_history_years)
    rd = rise_date(q, year, rise_pct, start, end, min_history_years)
    post = bool(pct < drought_threshold) if not np.isnan(pct) else False
    return {"year": year, "antecedent_pct": pct, "post_drought": post,
            "classifiable": not np.isnan(pct), "rise_date": rd,
            "alert_date": rd if post else None}


def alerts_for_site(q: pd.Series, years, rise_pct: float, drought_threshold: float, **kw) -> pd.DataFrame:
    return pd.DataFrame([alert_for_spring(q, int(y), rise_pct, drought_threshold, **kw) for y in years])
