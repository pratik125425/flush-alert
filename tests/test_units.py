import numpy as np
import pandas as pd

from src.loads import K, Site, est_reg, design


def test_load_factor():
    # 1 cfs = 28.316846592 L/s; one day = 86400 s; 1 mg/L -> kg
    assert abs(28.316846592 * 86400 / 1e6 - K) < 1e-4


def _site(n_days=800, seed=0):
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2015-01-01", periods=n_days, freq="D")
    q = np.exp(5 + np.sin(np.arange(n_days) / 58) + rng.normal(0, 0.1, n_days))
    c = 5 + np.cos(np.arange(n_days) / 40)
    return Site(pd.DataFrame({"date": dates, "C": c, "Q": q}), [3, 4, 5, 6])


def test_monthly_subsampling_one_per_month():
    S = _site()
    for d in (1, 15, 28):
        idx = S.monthly_idx(d)
        assert (S.dates[idx].day == d).all()
        months = S.dates[idx].to_period("M")
        assert months.is_unique
        assert len(idx) == (S.dates.day == d).sum()  # every month that reaches day d


def test_true_load_matches_formula():
    S = _site()
    m = S.spring_mask(2015)
    assert np.isclose(S.true_load(2015), (S.c[m] * S.q[m]).sum() * K)


def test_regression_recovers_known_model():
    dates = pd.date_range("2015-01-01", periods=1500, freq="D")
    rng = np.random.default_rng(1)
    q = np.exp(rng.normal(6, 1, len(dates)))
    X = design(dates, q)
    b = np.array([0.5, 0.3, 0.2, -0.1, 0.05])
    c = np.exp(X @ b)
    chat = est_reg(X, np.arange(0, len(dates), 30), c)
    assert np.allclose(chat, c, rtol=1e-6)


def test_interpolation_is_exact_at_samples():
    S = _site()
    idx = S.monthly_idx(10)
    chat = S.estimate("interp", idx)
    assert np.allclose(chat[idx], S.c[idx])
