"""Five report figures, each with a source line. Reads results/ and cached data only.

    python -m src.figures
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from src.common import FIGURES, RESULTS, load_config
from src.export import SAMPLE_DAY
from src.loads import Site
from src.prep import load_sensor
from src.trigger import alert_for_spring

INK, INK3, RIVER, RIVER_SOFT, MIST, ALERT, OK = "#18232e", "#56636f", "#1d5c87", "#8fb2cc", "#d6e4ef", "#c43d12", "#a9b7c3"
SRC = "Data: USGS Water Data APIs (api.waterdata.usgs.gov). Historical backtest, not a live deployment. Flush Alert, Team Mustangs."

plt.rcParams.update({
    "font.family": "sans-serif", "font.size": 10, "axes.edgecolor": INK3, "axes.labelcolor": INK, "xtick.color": INK3,
    "ytick.color": INK3, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": "#e3e9ee",
    "grid.linewidth": 0.8, "axes.axisbelow": True, "figure.dpi": 150, "savefig.bbox": "tight",
})


def _finish(fig, name, title, source):
    fig.suptitle(title, x=0.01, y=1.04, ha="left", fontsize=12.5, fontweight="bold", color=INK)
    fig.text(0.01, -0.02, source, fontsize=7.5, color=INK3, ha="left", va="top", wrap=True)
    FIGURES.mkdir(exist_ok=True)
    fig.savefig(FIGURES / f"{name}.png")
    plt.close(fig)
    print("  ", FIGURES / f"{name}.png")


def fig1_hero(cfg, sensor, x):
    site, year = cfg["hero_site"], 2025
    g = sensor[sensor.site == site]
    S = Site(g, cfg["spring_months"])
    q = g.set_index("date")["Q"].sort_index()
    m = (S.dates >= f"{year}-02-01") & (S.dates <= f"{year}-07-31")
    idx = S.monthly_idx(SAMPLE_DAY)
    itp, reg = S.estimate("interp", idx), S.estimate("reg", idx, year)
    a = alert_for_spring(q, year, x, cfg["drought"]["threshold_pct"], cfg["drought"]["window_days"], cfg["min_history_years"])
    d = S.dates[m]
    fig, ax = plt.subplots(figsize=(9, 4.2))
    ax.fill_between(d, itp[m], np.maximum(S.c[m], itp[m]), color=MIST, lw=0, label="Missed by monthly record")
    ax.plot(d, S.c[m], color=RIVER, lw=2, label="Sensor, daily")
    ax.plot(d, reg[m], color=INK3, lw=1.2, ls="--", label="Regression from monthly samples")
    s = idx[(S.dates[idx] >= f"{year}-02-01") & (S.dates[idx] <= f"{year}-07-31")]
    ax.scatter(S.dates[s], S.c[s], s=36, facecolor="white", edgecolor=INK, lw=1.6, zorder=5, label=f"Monthly sample (day {SAMPLE_DAY})")
    ax.axhline(10, color=INK, ls=(0, (5, 4)), lw=1)
    ax.text(d[0], 10.3, "EPA limit 10 mg/L", fontsize=8, color=INK)
    if a["alert_date"] is not None:
        ad = pd.Timestamp(a["alert_date"])
        ax.axvline(ad, color=ALERT, lw=2)
        ax.text(ad, ax.get_ylim()[1] * 0.97, f"  Flush Alert, {ad:%b} {ad.day}", color=ALERT, fontsize=9, fontweight="bold", va="top")
    ax.set_ylabel("Nitrate + nitrite, mg/L as N")
    ax.legend(frameon=False, fontsize=8, loc="lower left", bbox_to_anchor=(0, 1.0), ncol=5, handlelength=1.6, columnspacing=1.2)
    import matplotlib.dates as mdates
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b"))
    _finish(fig, "fig1_hero_van_meter_2025", "Raccoon River at Van Meter, IA, spring 2025: monthly sampling misses the flush",
            f"USGS {site.replace('USGS-', '')}, parameters 99133 and 00060, daily means. Antecedent 12-month flow: "
            f"{a['antecedent_pct']:.0f}th percentile. {SRC}")


def fig2_error(cfg):
    err = pd.read_csv(RESULTS / "spring_load_errors.csv").dropna(subset=["err_pct"])
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.8), sharey=True)
    for ax, (meth, lab) in zip(axes, [("reg", "Regression (LOADEST-style)"), ("interp", "Linear interpolation")]):
        data, labels = [], []
        for pd_, name in [(False, "Normal springs"), (True, "Post-drought springs")]:
            v = err[(err.method == meth) & (err.post_drought == pd_)]["err_pct"].abs()
            data.append(v.values)
            labels.append(f"{name}\nmedian {v.median():.1f}%, n={err[(err.method == meth) & (err.post_drought == pd_)][['site','year']].drop_duplicates().shape[0]}")
        b = ax.boxplot(data, whis=(10, 90), showfliers=False, patch_artist=True, widths=0.5, medianprops=dict(color=INK, lw=2))
        for p, c in zip(b["boxes"], [OK, RIVER_SOFT]):
            p.set_facecolor(c); p.set_edgecolor(INK3)
        ax.set_xticks([1, 2], labels, fontsize=8.5)
        ax.set_title(lab, fontsize=10, loc="left", color=INK)
    axes[0].set_ylabel("Absolute error, Mar–Jun load (%)")
    _finish(fig, "fig2_load_error_by_spring_type", "Monthly sampling errs more after a drought, with either estimator",
            "Boxes: 25th–75th percentile; whiskers: 10th–90th, over sensor sites, springs and 28 monthly sampling days. "
            f"Post-drought: trailing 12-month flow below the {cfg['drought']['threshold_pct']}th percentile on March 1. "
            "results/spring_load_errors.csv. " + SRC)


def fig3_lead(cfg):
    bt = pd.read_csv(RESULTS / "backtest_site_springs.csv")
    met = pd.read_csv(RESULTS / "backtest_metrics.csv")
    t = met[(met.split == "time") & met.subset.str.startswith("test (")].iloc[0]
    lead = bt[bt.hit.astype(bool)]["lead_to_surge_d"].dropna()
    fig, ax = plt.subplots(figsize=(8, 3.6))
    ax.hist(lead, bins=np.arange(-7, 64, 7), color=RIVER, edgecolor="white")
    ax.axvline(lead.median(), color=INK, ls="--", lw=1)
    ax.text(lead.median() + 1, ax.get_ylim()[1] * 0.92, f"median {lead.median():.0f} days", fontsize=9)
    ax.set_xlabel("Days from alert to surge start")
    ax.set_ylabel("Caught surges")
    _finish(fig, "fig3_alert_lead_time",
            f"Held-out springs 2020–2026: {t.pod:.0%} of post-drought surges flagged in advance, false-alarm ratio {t.far:.0%}",
            "Surge: 7-day mean nitrate above min(site 90th percentile, 10 mg/L). Histogram covers every caught surge, 2009–2026. "
            "results/backtest_site_springs.csv, results/backtest_metrics.csv. " + SRC)


def fig4_adaptive(cfg, chosen):
    ad = pd.read_csv(RESULTS / "adaptive_sampling_summary.csv")
    sty = {chosen: (RIVER, "-", 2.6, "Timed by flow"), "random": (INK3, ":", 1.6, "Random dates (200 draws)"),
           "fixed": (INK, "--", 1.4, "Evenly spaced")}
    fig, axes = plt.subplots(2, 2, figsize=(9, 6.2), sharex=True)
    for i, t in enumerate(["post-drought", "normal"]):
        for j, (meth, lab) in enumerate([("reg", "Regression"), ("interp", "Interpolation")]):
            ax = axes[i, j]
            sub = ad[(ad.spring_type == t) & (ad.method == meth)]
            base = sub[sub.schedule == "monthly only"].median_abs_err_pct.item()
            for sch, (c, ls, lw, name) in sty.items():
                r = sub[sub.schedule == sch].sort_values("k")
                ax.plot([0, *r.k], [base, *r.median_abs_err_pct], color=c, ls=ls, lw=lw, marker="o", ms=3, label=name)
            ax.set_title(f"{t.capitalize()} springs, {lab.lower()}", fontsize=9.5, loc="left")
            ax.set_ylim(bottom=0)
    axes[1, 0].set_xlabel("Extra samples per spring"); axes[1, 1].set_xlabel("Extra samples per spring")
    axes[0, 0].set_ylabel("Median abs. load error (%)"); axes[1, 0].set_ylabel("Median abs. load error (%)")
    axes[0, 0].legend(frameon=False, fontsize=8)
    _finish(fig, "fig4_error_vs_extra_samples", "Timing beats volume: flow-timed samples cut the regression error where random ones do not",
            "Flow-timed design (a sample on each new flow rise after the alert) chosen over a 30-day spread on 2009–2019 springs only. "
            "results/adaptive_sampling_summary.csv. " + SRC)


def fig5_map(cfg):
    gp = RESULTS / "flow_only_gauges.geojson"
    fig, ax = plt.subplots(figsize=(8, 5.4))
    sites = json.load(open(FIGURES.parent / "site/public/data/sites.json"))
    if gp.exists():
        gj = json.load(open(gp))
        df = pd.DataFrame([{**f["properties"], "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]} for f in gj["features"]])
        for stt, c, z in [("UNRANKED", "#dfe5ea", 1), ("OK", OK, 2), ("WATCH", RIVER, 3), ("ALERT", ALERT, 4)]:
            d = df[df.status == stt]
            if len(d):
                ax.scatter(d.lon, d.lat, s=7, color=c, zorder=z, label=f"{stt.title()} ({len(d)})", lw=0)
        last = df.last_update.max()
        fi = RESULTS / "flow_only_info.json"
        info = json.load(open(fi)) if fi.exists() else {}
        part = f" ({len(df):,} of {info['selected']:,} downloaded so far)" if info.get("partial") else ""
        sub = f"{len(df):,} active discharge gauges{part}, status on {last}"
    else:
        sub = "flow-only gauges not yet downloaded"
    ax.scatter([s["lon"] for s in sites], [s["lat"] for s in sites], s=30, facecolor="none", edgecolor=INK, lw=1.2, zorder=5, label="Nitrate sensor site")
    ax.set_aspect(1 / np.cos(np.radians(42)))
    ax.set_xlabel("Longitude"); ax.set_ylabel("Latitude")
    ax.legend(frameon=False, fontsize=8, loc="lower left")
    _finish(fig, "fig5_flow_only_scale_map", f"No nitrate sensor required: {sub}",
            "Watch: trailing 12-month flow below the gauge's own 25th percentile. Alert only fires March 1–June 30. "
            "results/flow_only_gauges.geojson. " + SRC)


def run():
    cfg = load_config()
    info = json.load(open(RESULTS / "run_info.json"))
    sensor, _ = load_sensor()
    fig1_hero(cfg, sensor, info["rise_pct_tuned"])
    fig2_error(cfg)
    fig3_lead(cfg)
    fig4_adaptive(cfg, info["chosen_trigger_design"])
    fig5_map(cfg)


if __name__ == "__main__":
    run()
