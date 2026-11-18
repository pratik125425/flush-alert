"""Download and cache USGS data from the new Water Data APIs (api.waterdata.usgs.gov).

Uses dataretrieval.waterdata (v1.4). Never touches the legacy waterservices.usgs.gov.
Every download is written to data/raw/<name>__<UTC timestamp>.parquet. If a cached
file exists it is reused, so the rest of the pipeline runs offline.

    python -m src.fetch            # fetch anything not yet cached
    python -m src.fetch --refresh  # re-download everything
"""
from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd
from dataretrieval import waterdata as wd

from src.common import RAW, latest_raw, load_config, read_raw, save_raw

import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)

PACE_S = 3.8
DAILY_COLS = ["monitoring_location_id", "parameter_code", "time", "value", "approval_status", "qualifier"]


def _retry(fn, *args, tries=8, **kw):
    """Retry with backoff. HTTP 429 (hourly quota) waits for the window to reset."""
    for i in range(tries):
        try:
            return fn(*args, **kw)
        except Exception as e:  # network / 429 / 5xx
            msg = str(e)
            wait = 120 if "429" in msg else 5 * (2 ** i)
            print(f"  retry {i+1}/{tries} after error: {msg[:100]} (sleep {wait}s)", file=sys.stderr, flush=True)
            time.sleep(wait)
    raise RuntimeError("giving up after retries")


def ts_meta(param: str, states: list[str], stat: str) -> pd.DataFrame:
    frames = []
    for s in states:
        df, _ = _retry(wd.get_time_series_metadata, parameter_code=param, statistic_id=stat,
                       state_name=s, skip_geometry=True)
        df["state_name"] = s
        frames.append(df)
        print(f"  {param} {s}: {len(df)} series")
    out = pd.concat(frames, ignore_index=True)
    keep = ["time_series_id", "monitoring_location_id", "parameter_code", "statistic_id", "state_name",
            "begin", "end", "primary", "web_description", "unit_of_measure"]
    return out[[c for c in keep if c in out.columns]]


# One HTTP request per call: no fan-out, no hidden retries (each sub-request and each
# retry spends the 1000 req/h quota). _retry() below is the only retry loop.
import dataretrieval
from dataretrieval.waterdata.configuration import WaterdataConfiguration

WD_CFG = WaterdataConfiguration(parallel_chunks=1, concurrency=1, retries=0)


def _get_daily(**kw):
    with dataretrieval.configure(WD_CFG):
        return wd.get_daily(**kw)


def daily(site_ids: list[str], params: list[str], start: str, end: str, stat: str) -> pd.DataFrame:
    df, _ = _retry(_get_daily, monitoring_location_id=site_ids, parameter_code=params,
                   statistic_id=stat, time=f"{start}/{end}", skip_geometry=True, limit=50000,
                   properties=["monitoring_location_id", "parameter_code", "time", "value",
                               "approval_status", "qualifier"])
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=DAILY_COLS)
    return df[[c for c in DAILY_COLS if c in df.columns]]


def daily_many(site_ids: list[str], params: list[str], start: str, end: str, stat: str,
               chunk: int, workers: int, label: str) -> pd.DataFrame:
    """Fetch in site chunks. Each chunk is cached in data/raw/_chunks/<label>/ so an
    interrupted run (e.g. hourly quota) resumes where it stopped."""
    cdir = RAW / "_chunks" / label
    cdir.mkdir(parents=True, exist_ok=True)
    chunks = [site_ids[i:i + chunk] for i in range(0, len(site_ids), chunk)]

    def one(c):
        path = cdir / ("_".join(x.split("-")[1] for x in c) + ".parquet")
        if path.exists():
            return pd.read_parquet(path)
        df = daily(c, params, start, end, stat)
        df.to_parquet(path, index=False)
        time.sleep(PACE_S)  # stay under the rolling hourly quota (1000 req/h without an API key)
        return df

    frames, done = [], 0
    with ThreadPoolExecutor(max_workers=workers) as ex:
        # interleave so a partial download still spreads across all states (cache keys unchanged)
        step = 8
        order = [c for k in range(step) for c in chunks[k::step]]
        futs = {ex.submit(one, c): c for c in order}
        for f in as_completed(futs):
            frames.append(f.result())
            done += 1
            if done % 25 == 0 or done == len(chunks):
                print(f"  {label}: {done}/{len(chunks)} chunks", flush=True)
    return pd.concat(frames, ignore_index=True)


def _get_locations(**kw):
    with dataretrieval.configure(WD_CFG):
        return wd.get_monitoring_locations(**kw)


def locations(site_ids: list[str]) -> pd.DataFrame:
    frames = []
    for i in range(0, len(site_ids), 100):
        df, _ = _retry(_get_locations, monitoring_location_id=site_ids[i:i + 100])
        frames.append(df)
    df = pd.concat(frames)
    df["lon"] = df.geometry.x
    df["lat"] = df.geometry.y
    keep = ["monitoring_location_id", "monitoring_location_name", "state_name", "county_name", "drainage_area",
            "site_type_code", "hydrologic_unit_code", "lon", "lat"]
    return pd.DataFrame(df[[c for c in keep if c in df.columns]])


def flow_only_ids() -> list[str]:
    """Active discharge gauges with >=10 years of record (8-digit stream gauges)."""
    cfg = load_config()
    fmeta = read_raw("flow_meta").dropna(subset=["begin", "end"])
    fmeta = fmeta[fmeta["monitoring_location_id"].str.len() <= 13]  # USGS- + 8 digit stream gauges
    active = fmeta[(pd.to_datetime(fmeta["end"]) >= cfg["active_since"]) &
                   (pd.to_datetime(fmeta["begin"]) <= "2016-03-01")]
    return sorted(set(active["monitoring_location_id"]))


def run(refresh: bool = False) -> None:
    cfg = load_config()
    states, stat = cfg["states"], cfg["stat_mean"]
    N, Q = cfg["nitrate_param"], cfg["flow_param"]

    def need(name):
        return refresh or latest_raw(name) is None

    if need("nitrate_meta"):
        print("Nitrate (99133) time-series catalog")
        save_raw(ts_meta(N, states, stat), "nitrate_meta")
    nmeta = read_raw("nitrate_meta")
    nmeta = nmeta.dropna(subset=["begin", "end"])
    span = (pd.to_datetime(nmeta["end"]) - pd.to_datetime(nmeta["begin"])).dt.days / 365.25
    yrs = span.groupby(nmeta["monitoring_location_id"]).sum()
    # loose pre-filter; the analysis applies the strict spring-coverage rule later
    cand = sorted(yrs[yrs >= cfg["nitrate_min_years"] - 0.5].index)
    cand = [c for c in cand if len(c.split("-")[1]) <= 10]  # stream gauges, not 15-digit point sites
    print(f"{len(cand)} candidate nitrate sites")

    if need("sensor_daily"):
        print("Daily nitrate + flow at candidate sensor sites")
        df = daily_many(cand, [N, Q], cfg["flow_start"], cfg["end_date"], stat, chunk=3, workers=4,
                        label="sensor")
        save_raw(df, "sensor_daily")

    if need("flow_meta"):
        print("Discharge (00060) time-series catalog")
        save_raw(ts_meta(Q, states, stat), "flow_meta")
    flow_ids = flow_only_ids()
    print(f"{len(flow_ids)} active discharge gauges with >=10 years of record")

    if need("locations"):
        print("Monitoring-location coordinates")
        save_raw(locations(sorted(set(flow_ids) | set(cand))), "locations")

    if need("flowonly_daily"):
        print("Daily flow at every active gauge (flow-only map)")
        df = daily_many(flow_ids, [Q], cfg["flow_only_start"], cfg["end_date"], stat, chunk=5, workers=1,
                        label="flowonly")
        save_raw(df, "flowonly_daily")
    print("fetch complete")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    run(ap.parse_args().refresh)
