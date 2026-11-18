"""The trigger on day t may use only data up to day t.

Two checks:
1. Truncation: running the trigger on data cut off at day t gives the same decision for
   every day <= t as running it on the full record.
2. Future tampering: replacing every value after day t with garbage never changes any
   decision made on or before day t.
"""
import numpy as np
import pandas as pd
import pytest

from src.drought import antecedent_pct
from src.trigger import alert_for_spring


def _flow(seed=3):
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2000-01-01", "2014-12-31", freq="D")
    base = 100 * np.exp(np.sin(2 * np.pi * (idx.day_of_year - 60) / 365.25))
    q = pd.Series(base * np.exp(rng.normal(0, 0.35, len(idx))), index=idx)
    q[(q.index >= "2012-03-01") & (q.index < "2013-03-01")] *= 0.3   # drought year
    q[(q.index >= "2013-04-20") & (q.index < "2013-05-10")] *= 6      # first wet spring rise
    return q


def _decision_by(q, year, t, rise=50):
    """Alert date if it is known by day t, else None."""
    r = alert_for_spring(q[q.index <= t], year, rise, 25)
    a = r["alert_date"]
    return a if a is not None and a <= t else None


@pytest.mark.parametrize("year", [2013, 2014])
def test_truncation_invariance(year):
    q = _flow()
    full = alert_for_spring(q, year, 50, 25)["alert_date"]
    for t in pd.date_range(f"{year}-03-01", f"{year}-06-30", freq="5D"):
        expect = full if (full is not None and full <= t) else None
        assert _decision_by(q, year, t) == expect, f"lookahead at {t.date()}"


def test_future_tampering_does_not_change_past_decisions():
    q = _flow()
    year = 2013
    full = alert_for_spring(q, year, 50, 25)
    assert full["post_drought"], "fixture should be a post-drought spring"
    assert full["alert_date"] is not None
    for t in pd.date_range("2013-03-01", "2013-06-30", freq="7D"):
        q2 = q.copy()
        q2[q2.index > t] = 1e9  # absurd future flood
        tampered = alert_for_spring(q2, year, 50, 25)
        a_full = full["alert_date"] if full["alert_date"] <= t else None
        a_tamp = tampered["alert_date"] if (tampered["alert_date"] is not None and tampered["alert_date"] <= t) else None
        assert a_full == a_tamp, f"future data changed a decision made by {t.date()}"
        assert tampered["antecedent_pct"] == full["antecedent_pct"]


def test_antecedent_uses_only_past():
    q = _flow()
    d = pd.Timestamp("2013-03-01")
    q2 = q.copy()
    q2[q2.index > d] = 0.001
    assert antecedent_pct(q, d) == antecedent_pct(q2, d)


def test_real_site_truncation_if_cached():
    from src.common import PROC
    p = PROC / "sensor_daily.parquet"
    if not p.exists():
        pytest.skip("processed data not built")
    s = pd.read_parquet(p)
    q = s[s.site == "USGS-05484500"].set_index("date")["Q"].sort_index()
    for year in (2013, 2024, 2025):
        full = alert_for_spring(q, year, 25, 25)["alert_date"]
        for t in pd.date_range(f"{year}-03-01", f"{year}-06-30", freq="10D"):
            expect = full if (full is not None and full <= t) else None
            assert _decision_by(q, year, t, rise=25) == expect
