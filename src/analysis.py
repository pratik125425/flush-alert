"""Run every analysis module in order, from cached data only.

    python -m src.analysis
"""
from __future__ import annotations

import json
import time

import pandas as pd

from src import adaptive_sampling, backtest, loads
from src.common import RESULTS, load_config
from src.prep import build


def run_all() -> None:
    t0 = time.time()
    cfg = load_config()
    sensor, springs = build()
    print(f"[prep] {sensor['site'].nunique()} sensor sites, {len(springs)} valid site-springs")

    res, alerts, x_time, base = backtest.run(sensor, springs, cfg)
    print(f"[backtest] rise threshold tuned on training years: {x_time}%")
    print(res[["split", "subset", "pod", "far", "median_lead_to_surge_d"]].round(2).to_string(index=False))

    classes = base[["site", "year", "post_drought", "antecedent_pct"]]
    keep = springs.merge(classes[["site", "year"]], on=["site", "year"])
    err = loads.spring_errors(sensor, keep, classes)
    summ = loads.summarize(err)
    print("[loads]\n" + summ.round(1).to_string(index=False))

    ss = alerts[["site", "year", "post_drought", "rise_date"]]
    adaptive_sampling.run(sensor, ss, cfg, rise_pct=x_time)
    choice = adaptive_sampling.choose_design(cfg)
    print("[adaptive] design chosen on training years:\n" + choice.round(2).to_string(index=False))

    with open(RESULTS / "run_info.json", "w") as f:
        json.dump({"rise_pct_tuned": x_time, "chosen_trigger_design": choice.loc[choice.chosen, "design"].item(),
                   "sensor_sites": int(sensor["site"].nunique()), "valid_site_springs": int(len(springs)),
                   "classified_site_springs": int(len(base)),
                   "post_drought_site_springs": int(base["post_drought"].sum()),
                   "years": [int(springs["year"].min()), int(springs["year"].max())],
                   "runtime_s": round(time.time() - t0, 1)}, f, indent=2)
    print(f"analysis done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    run_all()
