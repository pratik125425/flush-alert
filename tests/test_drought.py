import numpy as np
import pandas as pd

from src.drought import antecedent_pct, antecedent_pct_series, classify_springs


def _flow(dry_year=2012, years=range(2000, 2015), seed=0):
    rng = np.random.default_rng(seed)
    idx = pd.date_range(f"{min(years)}-01-01", f"{max(years)}-12-31", freq="D")
    q = 100 * np.exp(np.sin(2 * np.pi * idx.day_of_year / 365.25) + rng.normal(0, 0.2, len(idx)))
    q = pd.Series(q, index=idx)
    q[(q.index >= f"{dry_year}-03-01") & (q.index < f"{dry_year + 1}-03-01")] *= 0.25
    return q


def test_drought_spring_is_flagged():
    q = _flow()
    c = classify_springs(q, [2011, 2013], threshold=25)
    assert not c.loc[c.year == 2011, "post_drought"].item()
    assert c.loc[c.year == 2013, "post_drought"].item()
    assert c.loc[c.year == 2013, "antecedent_pct"].item() < 5


def test_insufficient_history_is_unclassifiable():
    q = _flow()
    assert np.isnan(antecedent_pct(q, pd.Timestamp("2002-03-01")))


def test_threshold_monotonic():
    q = _flow()
    p = antecedent_pct(q, pd.Timestamp("2013-03-01"))
    for thr in (20, 25, 30):
        assert classify_springs(q, [2013], thr)["post_drought"].item() == (p < thr)


def test_series_matches_pointwise():
    q = _flow()
    s = antecedent_pct_series(q)
    for d in ("2010-06-01", "2013-03-01"):
        assert abs(s.loc[d] - antecedent_pct(q, pd.Timestamp(d))) < 0.05
