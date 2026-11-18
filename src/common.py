"""Shared helpers: config, paths, cached-file lookup."""
from __future__ import annotations

import glob
import os
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
RESULTS = ROOT / "results"
FIGURES = ROOT / "figures"
SITE_DATA = ROOT / "site" / "public" / "data"


def load_config() -> dict:
    with open(ROOT / "config.yaml") as f:
        return yaml.safe_load(f)


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%MZ")


def latest_raw(name: str) -> Path | None:
    """Most recent cached raw file for a dataset name, or None."""
    hits = sorted(glob.glob(str(RAW / f"{name}__*.parquet")))
    return Path(hits[-1]) if hits else None


def save_raw(df: pd.DataFrame, name: str) -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    path = RAW / f"{name}__{stamp()}.parquet"
    df.to_parquet(path, index=False)
    return path


def read_raw(name: str) -> pd.DataFrame:
    p = latest_raw(name)
    if p is None:
        raise FileNotFoundError(f"No cached raw data for '{name}'. Run `make data` first.")
    return pd.read_parquet(p)


for d in (RAW, PROC, RESULTS, FIGURES):
    os.makedirs(d, exist_ok=True)
