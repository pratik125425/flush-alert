"""Turn cached raw downloads into tidy daily series per site."""
from __future__ import annotations

import numpy as np
import pandas as pd

from src.common import PROC, load_config, read_raw


def wide_daily(raw: pd.DataFrame, params: dict[str, str]) -> pd.DataFrame:
    """Long USGS daily table -> one row per (site, date), one column per parameter.
    Drops values flagged for equipment problems or ice, and negative values."""
    d = raw.copy()
    d["time"] = pd.to_datetime(d["time"])
    d["value"] = pd.to_numeric(d["value"], errors="coerce")
    q = d["qualifier"].astype(str)
    bad = q.str.contains("Eqp|Ice|Mnt|Dis|Ssn", case=False, na=False)
    d = d[~bad & (d["value"] >= 0)]
    d = d[d["parameter_code"].isin(params)]
    # a site can carry several series for one parameter (e.g. a replaced sensor); average them
    w = (d.groupby(["monitoring_location_id", "time", "parameter_code"])["value"].mean()
           .unstack("parameter_code").rename(columns=params).reset_index())
    for c in params.values():
        if c not in w:
            w[c] = np.nan
    w.columns.name = None
    return w.rename(columns={"monitoring_location_id": "site", "time": "date"})


def complete_index(df: pd.DataFrame) -> pd.DataFrame:
    """Reindex each site to a continuous daily calendar so rolling windows count days."""
    out = []
    for site, g in df.groupby("site"):
        g = g.set_index("date").sort_index()
        idx = pd.date_range(g.index.min(), g.index.max(), freq="D")
        g = g.reindex(idx)
        g["site"] = site
        out.append(g.rename_axis("date").reset_index())
    return pd.concat(out, ignore_index=True)


def spring_coverage(df: pd.DataFrame, months: list[int]) -> pd.DataFrame:
    sp = df[df["date"].dt.month.isin(months)]
    n_days = sum(pd.Period(f"2001-{m:02d}").days_in_month for m in months)
    ok = sp["C"].notna() & sp["Q"].notna()
    cov = ok.groupby([sp["site"], sp["date"].dt.year]).sum() / n_days
    cov.index.names = ["site", "year"]
    return cov.rename("coverage").reset_index()


def build() -> tuple[pd.DataFrame, pd.DataFrame]:
    cfg = load_config()
    sensor = wide_daily(read_raw("sensor_daily"), {cfg["nitrate_param"]: "C", cfg["flow_param"]: "Q"})
    sensor = complete_index(sensor)
    cov = spring_coverage(sensor, cfg["spring_months"])
    good = cov[cov["coverage"] >= cfg["min_spring_coverage"]]
    n_good = good.groupby("site").size()
    keep = n_good[n_good >= cfg["nitrate_min_years"]].index
    sensor = sensor[sensor["site"].isin(keep)].reset_index(drop=True)
    good = good[good["site"].isin(keep)].reset_index(drop=True)
    sensor.to_parquet(PROC / "sensor_daily.parquet", index=False)
    good.to_csv(PROC / "valid_springs.csv", index=False)
    return sensor, good


def load_sensor() -> tuple[pd.DataFrame, pd.DataFrame]:
    p = PROC / "sensor_daily.parquet"
    if not p.exists():
        return build()
    return pd.read_parquet(p), pd.read_csv(PROC / "valid_springs.csv")


def load_locations() -> pd.DataFrame:
    loc = read_raw("locations").rename(columns={"monitoring_location_id": "site"})
    return loc.drop_duplicates("site")


if __name__ == "__main__":
    s, g = build()
    print(f"{s['site'].nunique()} sensor sites, {len(g)} valid site-springs")
