// Live daily flow from the USGS Water Data OGC API (api.waterdata.usgs.gov), fetched in the
// browser on request. Free, no key, CORS-open. Values are provisional USGS daily means.
const API = "https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/items";
const BATCH = 85; // site IDs per request, keeps the URL well under 2 kB

export interface LiveFlow {
  last: string;          // latest day with a value (YYYY-MM-DD)
  q: number;             // that day's mean flow, cfs
  q7: number | null;     // 7-day mean ending on `last` (needs at least 5 of the 7 days, as the rule does)
  rise3: number | null;  // % change vs 3 days before `last`
  series: [string, number][]; // every daily value fetched, oldest first
}

/** Inputs to slide a gauge's 12-month window forward (see src/watchlist.py). */
export interface Rerank {
  as_of: string; candidate_pct: number; qt_step: number; window_days: number; rerank_days: number;
  sites: Record<string, { sum: number; n: number; old: (number | null)[]; N: number; qt: (number | null)[]; med: number | null }>;
}

export interface Ranked { pct: number | null; normal: number | null; added: number; newMean: number | null; oldMean: number | null; stale?: boolean }

/** Same statistic as antecedent_pct(): trailing 365-row mean, ranked against every earlier day's. */
export function rerankSite(rr: Rerank, site: string, asOf: string, L: LiveFlow | undefined): Ranked | null {
  const R = rr.sites[site];
  if (!R) return null;
  const fresh = (L?.series ?? []).filter(([d]) => d > asOf);
  if (fresh.length > rr.rerank_days) return { pct: null, normal: null, added: fresh.length, newMean: null, oldMean: null, stale: true };
  let sum = R.sum, n = R.n;
  const means: number[] = [], drop: number[] = [];
  const meanNow = sum / n;
  fresh.forEach(([, v], i) => {
    const o = R.old[i];
    if (o != null) { sum -= o; n--; drop.push(o); }
    sum += v; n++;
    means.push(sum / n);
  });
  const v = means.length ? means[means.length - 1] : meanNow;
  // percentile of v in the earlier-days table, plus the days in between (the as-of day and each new day but the last)
  const qt = R.qt, step = rr.qt_step;
  let pq: number | null;
  if (qt[qt.length - 1] != null && v >= qt[qt.length - 1]!) pq = null;
  else {
    let i = -1;
    while (i + 1 < qt.length && qt[i + 1] != null && qt[i + 1]! <= v) i++;
    pq = i < 0 ? 0 : i * step + step * (v - qt[i]!) / Math.max(qt[i + 1]! - qt[i]!, 1e-12);
  }
  const extra = means.length ? [meanNow, ...means.slice(0, -1)] : [];
  const pct = pq == null ? null : 100 * (pq / 100 * R.N + extra.filter((e) => e < v).length) / (R.N + extra.length);
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  return { pct, normal: R.med ? 100 * v / R.med : null, added: fresh.length, newMean: avg(fresh.map((f) => f[1])), oldMean: avg(drop) };
}

export interface Triggers { start: string; days: number; rise_pct_3d: number; sites: Record<string, (number | null)[]>; }

const dayMs = 864e5;
const toDay = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));

async function batch(ids: string[], days: number, signal: AbortSignal) {
  const u = new URL(API);
  u.search = new URLSearchParams({
    f: "json", monitoring_location_id: ids.join(","), parameter_code: "00060", statistic_id: "00003",
    time: `P${days}D`, limit: "10000", properties: "monitoring_location_id,time,value", skipGeometry: "true",
  }).toString();
  const r = await fetch(u, { signal });
  if (!r.ok) throw new Error(r.status === 429 ? "USGS is rate-limiting requests. Try again in a minute." : `USGS answered ${r.status}.`);
  const j = await r.json();
  return (j.features ?? []) as { properties: { monitoring_location_id: string; time: string; value: string | null } }[];
}

/** Last 14 days of daily flow for every site, reduced to what the alert rule reads. */
export async function fetchLive(ids: string[], days = 14, timeoutMs = 30000): Promise<Map<string, LiveFlow>> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const chunks: string[][] = [];
    const per = Math.max(10, Math.floor(9000 / days)); // stay under the 10,000-row page limit
    for (let i = 0; i < ids.length; i += Math.min(BATCH, per)) chunks.push(ids.slice(i, i + Math.min(BATCH, per)));
    const feats = (await Promise.all(chunks.map((c) => batch(c, days, ctl.signal)))).flat();
    const series = new Map<string, Map<number, number>>();
    for (const { properties: p } of feats) {
      const v = p.value == null ? NaN : parseFloat(p.value);
      if (!Number.isFinite(v)) continue;
      if (!series.has(p.monitoring_location_id)) series.set(p.monitoring_location_id, new Map());
      series.get(p.monitoring_location_id)!.set(toDay(p.time), v);
    }
    const out = new Map<string, LiveFlow>();
    for (const [id, s] of series) {
      const last = Math.max(...s.keys());
      const win = [...Array(7)].map((_, i) => s.get(last - i * dayMs)).filter((v): v is number => v != null);
      const q = s.get(last)!, prev = s.get(last - 3 * dayMs);
      out.set(id, {
        last: new Date(last).toISOString().slice(0, 10), q,
        q7: win.length >= 5 ? win.reduce((a, b) => a + b, 0) / win.length : null,
        rise3: prev != null && prev > 0 ? 100 * (q / prev - 1) : null,
        series: [...s].sort((a, b) => a[0] - b[0]).map(([d, v]) => [new Date(d).toISOString().slice(0, 10), v]),
      });
    }
    return out;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("USGS did not answer in time. Try again in a minute.");
    if (e instanceof TypeError) throw new Error("Could not reach USGS. Check the connection and try again.");
    throw e;
  } finally {
    clearTimeout(t);
  }
}

/** Trigger flow for a given day, or null outside Mar 1 - Jun 30 of the season. */
export function triggerOn(tr: Triggers, site: string, day: string): number | null {
  const i = Math.round((toDay(day) - toDay(tr.start)) / dayMs);
  if (i < 0 || i >= tr.days) return null;
  return tr.sites[site]?.[i] ?? null;
}

export type Phase = "before" | "season" | "after";
export function phaseOf(tr: Triggers, day: string): Phase {
  const i = Math.round((toDay(day) - toDay(tr.start)) / dayMs);
  return i < 0 ? "before" : i < tr.days ? "season" : "after";
}
