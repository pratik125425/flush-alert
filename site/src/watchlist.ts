// Spring 2027 watchlist: searchable list of Watch gauges, a sampling plan per river,
// a calendar download, and the sensor rivers the forecast will be scored on.
import { ABBR, titleCase } from "./replay";
import { parseDay } from "./util";
import * as d3 from "d3";
import { fetchLive, phaseOf, rerankSite, triggerOn, type LiveFlow, type Ranked, type Rerank, type Triggers } from "./live";

// [site, name, state, pct, flow7_now, [trig Mar1, Apr1, May1, Jun1], nearest sensor, km, is_sensor, as_of, % of normal]
type Row = [string, string, string, number, number | null, (number | null)[], string, number, boolean, string, number | null];
export interface Watchlist {
  season: number; as_of: string; generated_utc: string; watch_gauges: number; gauges_ranked: number;
  states: number; sensor_sites_on_watch: number; sensor_sites_total: number; drought_threshold_pct: number;
  rise_pct_3d: number; final_call: string; score_on: string; scoring: string; excluded_low_flow: number;
  sensor_watch: { site: string; name: string }[]; rows: Row[];
}
type RerankFile = Rerank & { candidates: Row[] };
const longDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
const dryWords = (p: number) => (p <= 0.5 ? "driest on record" : `drier than ${Math.round(100 - p)}%`);

const PAGE = 12;
const DEFAULT_SITE = "USGS-05482300"; // North Raccoon near Sac City: upstream of Des Moines' intakes
const CHECKS = ["Mar 1", "Apr 1", "May 1", "Jun 1"];
const nf = new Intl.NumberFormat("en-US");
const usDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDate = { format: (d: Date) => usDate.format(d) };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const num = (s: string) => s.replace(/^USGS-/, "");
const cfs = (v: number | null) => (v == null ? "n/a" : `${nf.format(v)} cfs`);
const r3 = (v: number) => (v < 100 ? Math.round(v * 10) / 10 : Math.round(v));
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v))}%`;

/** Plain words for "trailing mean ranks at percentile p of the record". */
export function dryness(p: number) {
  const d = Math.round(100 - p);
  return p <= 0.5 ? "Driest on record" : `Drier than ${d}% of its record`;
}

export function initWatchlist(root: HTMLElement, wl: Watchlist) {
  const $ = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
  const q = $<HTMLInputElement>("#wl-q"), st = $<HTMLSelectElement>("#wl-state");
  const tbody = $<HTMLTableElement>("#wl-table").tBodies[0], more = $<HTMLButtonElement>("#wl-more");
  const count = $("#wl-count"), plan = $("#wl-plan");
  const fileRank = new Map(wl.rows.map((r, i) => [r[0], i + 1]));
  const fileRow = new Map(wl.rows.map((r) => [r[0], r]));
  let rows: Row[] = wl.rows;                       // the list as shown: the file, or re-ranked live
  let rank = fileRank;
  const bySite = new Map(wl.rows.map((r) => [r[0], r]));
  const ranked = new Map<string, Ranked | null>(); // live re-rank result per gauge
  let shown = PAGE, selected = bySite.has(DEFAULT_SITE) ? DEFAULT_SITE : wl.rows[0]?.[0];

  // live daily flow (fetched on request) and the daily trigger curves it is checked against
  let live: Map<string, LiveFlow> | null = null, tr: Triggers | null = null;
  const liveOf = (id: string) => {
    const L = live?.get(id);
    if (!L || !tr) return null;
    const phase = phaseOf(tr, L.last);
    const trig = phase === "season" ? triggerOn(tr, id, L.last) : null;
    const fires = phase === "season" && ((L.q7 != null && trig != null && L.q7 > trig) || (L.rise3 != null && L.rise3 > tr.rise_pct_3d));
    return { L, phase, trig, fires };
  };

  const fillStates = () => {
    const keep = st.value, states = new Map<string, number>();
    rows.forEach((r) => states.set(r[2], (states.get(r[2]) ?? 0) + 1));
    st.length = 1;
    [...states].sort((a, b) => a[0].localeCompare(b[0])).forEach(([s, n]) => st.add(new Option(`${s} (${n})`, s)));
    st.value = states.has(keep) ? keep : "";
  };
  fillStates();

  const filtered = () => {
    const t = q.value.trim().toLowerCase(), s = st.value;
    return rows.filter((r) => (!s || r[2] === s) && (!t || r[1].toLowerCase().includes(t) || r[0].includes(t)));
  };

  const flowCell = (r: Row) => {
    if (!live) return r[4] == null ? "n/a" : nf.format(r3(r[4]));
    const s = liveOf(r[0]);
    if (!s || s.L.q7 == null) return `<span class="wl__na">no report</span>`;
    return `${s.fires ? `<span class="tag tag--alert">Alert</span> ` : ""}${nf.format(r3(s.L.q7))}<small>${shortDate.format(parseDay(s.L.last))}</small>`;
  };

  const filteredAll = () => rows.length;
  const rowsCount = (match: number, all: number, vis: number) => match === all
    ? `${nf.format(all)} rivers on Watch${live ? " after today's update" : ""}, driest first. Showing ${vis}.`
    : `${nf.format(match)} of ${nf.format(all)} rivers match. Showing ${vis}.`;
  const badge = (id: string) => {
    if (!live) return "";
    const was = fileRank.get(id), now = rank.get(id);
    if (now == null) return "";
    if (was == null) return ` <span class="chg chg--new">New</span>`;
    const d = was - now;
    return d === 0 ? "" : ` <span class="chg ${d > 0 ? "chg--up" : "chg--down"}" aria-label="${d > 0 ? "up" : "down"} ${Math.abs(d)} since the forecast file">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span>`;
  };

  const renderList = () => {
    const rows = filtered();
    const vis = rows.slice(0, shown);
    tbody.innerHTML = vis.map((r) => `<tr class="${r[0] === selected ? "is-sel" : ""}">
      <th scope="row"><button type="button" class="rowbtn" data-site="${r[0]}" aria-pressed="${r[0] === selected}">${esc(titleCase(r[1]))}</button>${badge(r[0])}</th>
      <td class="col-opt">${ABBR[r[2]] ?? esc(r[2])}</td>
      <td><span class="dry"><span class="dry__bar" style="--p:${(25 - Math.min(25, r[3])) / 25}"></span><span class="dry__txt">${dryWords(r[3])}${r[10] != null ? `<small>${r[10]}% of normal flow</small>` : ""}</span></span></td>
      <td class="col-opt wl__now">${flowCell(r)}</td></tr>`).join("");
    const all = filteredAll();
    count.textContent = vis.length === 0 && all === 0 ? "No rivers on Watch." : rowsCount(rows.length, all, vis.length);
    more.hidden = rows.length <= shown;
    more.textContent = `Show ${Math.min(24, rows.length - shown)} more`;
  };

  const renderPlan = (site: string | undefined, focus = false) => {
    const r = site ? bySite.get(site) : undefined;
    const title = plan.querySelector("#wl-plan-title")!, meta = plan.querySelector("#wl-plan-meta")!, body = plan.querySelector("#wl-plan-body")!;
    if (!r) { title.textContent = "Sampling plan"; meta.textContent = ""; body.innerHTML = "<p>No river matches.</p>"; return; }
    const [id, name, state, pct, now, trig, sName, sKm, isSensor, asOf, normal] = r;
    const onList = rank.has(id), f = fileRow.get(id);
    const nice = titleCase(name);
    const dsm = /raccoon|des moines r/i.test(name);
    title.textContent = nice;
    const lv = live?.get(id);
    meta.textContent = `USGS ${num(id)} · ${state} · forecast on flow through ${fmtDate.format(parseDay(asOf))}${lv ? ` · live flow through ${fmtDate.format(parseDay(lv.last))}` : ""}`;
    body.innerHTML = `
      <p class="plan__status">${onList ? `<span class="tag tag--watch">Watch</span>` : `<span class="tag tag--off">Off Watch</span>`} ${dryness(pct)}${normal != null ? `: the past 12 months carried ${normal}% of this river's normal flow` : ""}. ${onList ? `Rank ${rank.get(id)} of ${nf.format(rows.length)}${live ? (f ? ` (${fileRank.get(id) === rank.get(id) ? "unchanged" : `was ${fileRank.get(id)}`} in the forecast file)` : " (new today)") : ""}.` : ""}${dsm ? " Upstream of the Des Moines metro's drinking-water intakes." : ""}</p>
      ${live ? `<p class="plan__why"><strong>Why ${onList ? "it ranks here" : "it left Watch"}:</strong> ${why(id)}</p>` : ""}
      <h4 class="plan__h">The alert fires on the first day, Mar 1 to Jun 30, that</h4>
      <p class="plan__p">the 7-day mean flow passes this river's trigger:</p>
      <table class="trig"><caption class="visually-hidden">Trigger flow by date</caption>
        <thead><tr>${CHECKS.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
        <tbody><tr>${trig.map((v) => `<td>${cfs(v)}</td>`).join("")}</tr></tbody></table>
      <p class="plan__p">or daily flow rises more than ${wl.rise_pct_3d}% in three days.${live ? "" : ` Its 7-day flow on ${shortDate.format(parseDay(asOf))}: <strong>${cfs(now)}</strong>.`}</p>
      ${live ? liveBox(id, trig[0]) : ""}
      ${live && live.get(id)?.series.length ? `<figure class="plan__fig"><div class="chart" id="wl-chart"></div>
        <figcaption class="source">Daily flow (thin) and 7-day mean (bold), USGS provisional data. Dashed: the trigger the alert checks${phaseNow(id) === "season" ? " each day" : " on Mar 1"}.</figcaption></figure>` : ""}
      <h4 class="plan__h">Then</h4>
      <p class="plan__p">Take a grab sample at the start of each new flow rise after the alert, up to six. In the backtest, samples timed this way cut the spring load error by about a quarter; the same number at random dates did not.</p>
      <p class="plan__p plan__near">Nearest nitrate sensor: ${isSensor ? "this gauge is one, so this spring will be scored directly." : `${esc(titleCase(sName))}, ${nf.format(Math.round(sKm))} km away.`}</p>
      <div class="plan__actions">
        <button type="button" class="act act--primary" id="wl-ics">Add the season to a calendar (.ics)</button>
        <a class="act" href="https://waterdata.usgs.gov/monitoring-location/${num(id)}/" target="_blank" rel="noopener">Today's flow on USGS<span class="visually-hidden"> (opens in a new tab)</span></a>
      </div>
      <div class="msg msg--quiet plan__msg" aria-label="Preview of the alert message for this river">
        <div class="msg__head"><span>To: sampling coordinator</span><span>Preview. No message is sent.</span></div>
        <div class="msg__body"><p class="msg__title">Flush Alert: ${esc(nice)} is on Watch for spring ${wl.season}</p>
          <p>From March 1, sample when the 7-day flow passes ${cfs(trig[0])} or jumps ${wl.rise_pct_3d}% in three days, then at each new rise.</p></div>
      </div>`;
    plan.querySelector<HTMLButtonElement>("#wl-ics")!.addEventListener("click", () => downloadIcs(r, wl));
    const ch = plan.querySelector<HTMLElement>("#wl-chart");
    if (ch && live && tr) drawFlow(ch, id, nice, live.get(id)!, tr, trig[0]);
    if (focus) plan.focus({ preventScroll: window.innerWidth >= 1000 });
  };

  const phaseNow = (id: string) => (tr && live?.get(id) ? phaseOf(tr, live.get(id)!.last) : "before");
  /** Plain-words reason for a river's place on the re-ranked list. */
  const why = (id: string) => {
    const R = ranked.get(id), f = fileRow.get(id), cur = bySite.get(id)!;
    if (!R) return "USGS reported no new flow for this gauge, so its place comes from the forecast file.";
    if (R.stale) return "The saved 12-month window is too old to slide forward in the browser; run the pipeline again for a fresh ranking.";
    if (R.added === 0) return `No new daily flow since ${shortDate.format(parseDay(cur[9]))}, so its 12-month flow is unchanged; ${f ? "it moved only because other rivers did." : "it is unchanged."}`;
    const days = `${R.added} new ${R.added === 1 ? "day" : "days"} of flow averaged ${cfs(R.newMean == null ? null : r3(R.newMean))}, replacing days from a year earlier that averaged ${cfs(R.oldMean == null ? null : r3(R.oldMean))}.`;
    const was = f ? f[3] : candPct.get(id);
    const same = was != null && R.pct != null && Math.round(100 - was) === Math.round(100 - R.pct) && (was <= 0.5) === (R.pct <= 0.5);
    const wasTxt = was == null ? "" : same ? ", about the same as in the forecast file" : ` (was ${dryWords(was)}${f ? "" : ", just outside Watch"})`;
    if (!rank.has(id)) return `${days} That lifted its 12-month flow ${R.pct == null ? "above the 40th percentile of its record" : `to the ${ordinal(R.pct)} percentile of its record`}, out of the driest quarter that defines Watch.`;
    return `${days} Its 12-month flow is now ${dryWords(R.pct ?? 0)} of its record${wasTxt}.`;
  };

  const liveBox = (id: string, mar1: number | null) => {
    const s = liveOf(id);
    if (!s) return `<div class="livebox"><p class="livebox__h">Live from USGS</p><p>No daily flow reported for this gauge in the past 14 days.</p></div>`;
    const { L, phase, trig, fires } = s;
    const d = shortDate.format(parseDay(L.last));
    const q7 = L.q7 == null ? "not enough days reported" : cfs(r3(L.q7));
    const rise = L.rise3 == null ? "" : ` Change over 3 days: ${signed(L.rise3)}.`;
    let verdict: string;
    if (phase === "before") {
      const x = L.q7 != null && mar1 ? L.q7 / mar1 : null;
      verdict = `No alert can fire before Mar 1.${x != null ? ` Right now the 7-day flow is ${x >= 1 ? `${(Math.round(x * 10) / 10).toFixed(1)}×` : `${Math.round(100 * x)}% of`} the Mar 1 trigger.` : ""}`;
    } else if (phase === "after") {
      verdict = "The spring window closed on Jun 30.";
    } else {
      verdict = fires
        ? `<span class="tag tag--alert">Alert</span> Conditions are met today (trigger ${cfs(trig)}). Take a grab sample at the start of this rise.`
        : `Below today's trigger of ${cfs(trig)} and no ${wl.rise_pct_3d}% jump. No alert yet.`;
    }
    return `<div class="livebox${fires ? " is-alert" : ""}"><p class="livebox__h">Live from USGS, ${d}</p>
      <p>7-day flow <strong>${q7}</strong>; ${d}: ${cfs(r3(L.q))}.${rise}</p><p>${verdict}</p></div>`;
  };

  const select = (site: string, focus: boolean) => {
    selected = site;
    tbody.querySelectorAll("tr").forEach((tr) => {
      const b = tr.querySelector<HTMLButtonElement>(".rowbtn")!;
      const on = b.dataset.site === site;
      tr.classList.toggle("is-sel", on);
      b.setAttribute("aria-pressed", String(on));
    });
    renderPlan(site, focus);
    if (focus && window.innerWidth < 1000) plan.scrollIntoView({ block: "start" });
  };

  tbody.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".rowbtn");
    if (b) select(b.dataset.site!, true);
  });
  more.addEventListener("click", () => { shown += 24; renderList(); });
  const refilter = () => {
    shown = PAGE;
    renderList();
    const first = filtered()[0]?.[0];
    if (first && !filtered().some((r) => r[0] === selected)) { selected = first; renderPlan(first); renderList(); }
    if (!first) renderPlan(undefined);
  };
  q.addEventListener("input", refilter);
  st.addEventListener("change", refilter);

  // sensor rivers: the scorecard
  const ul = $("#wl-sensors");
  ul.innerHTML = wl.sensor_watch.map((s) => `<li><span class="scorecard__name">${esc(titleCase(s.name))}</span>
    <span class="scorecard__state"><span class="tag tag--watch">Watch</span> to be scored ${fmtDate.format(parseDay(wl.score_on))}</span>
    ${bySite.has(s.site) ? `<button type="button" class="linkbtn" data-site="${s.site}">See plan</button>` : ""}</li>`).join("");
  ul.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".linkbtn");
    if (!b) return;
    q.value = ""; st.value = ""; shown = PAGE;
    const i = rows.findIndex((r) => r[0] === b.dataset.site);
    if (i >= shown) shown = Math.ceil((i + 1) / 24) * 24;
    renderList();
    select(b.dataset.site!, true);
  });

  // "Update with today's USGS flow": fetch, check triggers, and re-rank the whole list with the new days
  const btn = root.querySelector<HTMLButtonElement>("#wl-refresh"), status = root.querySelector<HTMLElement>("#wl-live-status");
  const changes = root.querySelector<HTMLElement>("#wl-changes");
  let rr: RerankFile | null = null;
  const candPct = new Map<string, number>();
  const getJ = <T,>(u: string) => fetch(u).then((r) => { if (!r.ok) throw new Error(`Missing ${u}.`); return r.json() as Promise<T>; });

  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    const label = btn.textContent;
    btn.textContent = "Fetching from USGS…";
    try {
      [tr, rr] = await Promise.all([tr ?? getJ<Triggers>("data/triggers.json"), rr ?? getJ<RerankFile>("data/rerank.json")]);
      rr!.candidates.forEach((c) => { if (!bySite.has(c[0])) bySite.set(c[0], c); candPct.set(c[0], c[3]); });
      const base = [...wl.rows, ...rr!.candidates];
      const oldest = base.map((r) => r[9]).sort()[0];
      const gap = Math.ceil((Date.now() - parseDay(oldest).getTime()) / 864e5);
      const days = Math.min(75, Math.max(45, gap + 3));
      status!.textContent = `Asking USGS for the past ${days} days of flow at ${nf.format(base.length)} gauges…`;
      live = await fetchLive(base.map((r) => r[0]), days);

      // slide every gauge's 12-month window forward and rank again
      const next: Row[] = [];
      for (const r0 of base) {
        const L = live.get(r0[0]), R = rerankSite(rr!, r0[0], r0[9], L);
        ranked.set(r0[0], L ? R : null);
        const useLive = R && !R.stale && R.added > 0;
        const pct = useLive ? R!.pct : r0[3];
        const row: Row = [...r0] as Row;
        if (useLive) { row[3] = pct ?? 100; row[10] = R!.normal == null ? r0[10] : Math.round(R!.normal); }
        if (L?.q7 != null) { row[4] = L.q7; row[9] = L.last; }
        bySite.set(row[0], row);
        if (pct != null && pct < wl.drought_threshold_pct) next.push(row);
      }
      next.sort((a, b) => a[3] - b[3] || (a[10] ?? 1e9) - (b[10] ?? 1e9) || a[0].localeCompare(b[0]));
      rows = next;
      rank = new Map(rows.map((r, i) => [r[0], i + 1]));

      // what changed, and why
      const added = rows.filter((r) => !fileRank.has(r[0]));
      const dropped = wl.rows.filter((r) => !rank.has(r[0]));
      const moved = rows.filter((r) => fileRank.has(r[0]) && fileRank.get(r[0]) !== rank.get(r[0]))
        .sort((a, b) => Math.abs(fileRank.get(b[0])! - rank.get(b[0])!) - Math.abs(fileRank.get(a[0])! - rank.get(a[0])!));
      const reported = base.filter((r) => live!.get(r[0])?.q7 != null).length;
      const latest = base.map((r) => live!.get(r[0])?.last).filter(Boolean).sort().at(-1) as string | undefined;
      const fires = rows.filter((r) => liveOf(r[0])?.fires).length;
      const phase = latest ? phaseOf(tr!, latest) : "before";
      const when = latest ? usDate.format(parseDay(latest)) : "n/a";

      status!.innerHTML = `<strong>Live.</strong> USGS daily flow through ${when}, for ${nf.format(reported)} of ${nf.format(base.length)} Watch and near-Watch gauges, fetched at ${clock.format(new Date())}. `
        + `<strong>${nf.format(rows.length)}</strong> rivers are on Watch after re-ranking (${nf.format(wl.rows.length)} in the forecast file). `
        + (phase === "before" ? `No alert can fire until Mar 1, ${wl.season}.`
          : phase === "season" ? `<strong>${nf.format(fires)}</strong> ${fires === 1 ? "river meets" : "rivers meet"} alert conditions today.`
          : `The spring ${wl.season} window has closed.`)
        + ` Provisional USGS data.`;
      status!.classList.add("is-live");

      const item = (r: Row) => `<li><button type="button" class="linkbtn" data-site="${r[0]}">${esc(titleCase(r[1]))}</button><span class="changes__why">${why(r[0])}</span></li>`;
      const list = (rs: Row[], max = 6) => `<ul>${rs.slice(0, max).map(item).join("")}</ul>${rs.length > max ? `<p class="changes__more">and ${rs.length - max} more</p>` : ""}`;
      const mv = moved.slice(0, 5).map((r) => { const d = fileRank.get(r[0])! - rank.get(r[0])!; return `<li><button type="button" class="linkbtn" data-site="${r[0]}">${esc(titleCase(r[1]))}</button> <span class="chg ${d > 0 ? "chg--up" : "chg--down"}">${d > 0 ? "▲" : "▼"}${Math.abs(d)}</span> <span class="changes__note">now rank ${rank.get(r[0])}, ${dryWords(r[3])}</span></li>`; }).join("");
      changes!.innerHTML = `<h3 class="changes__h">What changed since the forecast file</h3>
        <p class="changes__sum">${added.length || dropped.length ? `${nf.format(added.length)} ${added.length === 1 ? "river joined" : "rivers joined"} Watch and ${nf.format(dropped.length)} left it. ` : "No river joined or left Watch. "}${nf.format(moved.length)} changed place. A river is on Watch while its past 12 months of flow rank in the driest quarter of its own record; each new day of flow pushes the matching day from a year earlier out of that window.</p>
        <div class="changes__cols">
          <div><h4>Joined Watch</h4>${added.length ? list(added) : "<p class=\"changes__none\">None today.</p>"}</div>
          <div><h4>Left Watch</h4>${dropped.length ? list(dropped) : "<p class=\"changes__none\">None today.</p>"}</div>
        </div>
        ${mv ? `<h4>Biggest moves</h4><ul class="changes__moves">${mv}</ul>` : ""}
        <p class="source">Re-ranked in your browser with the same rule as the pipeline (a check against the full Python run agrees within 0.2 percentile points). The committed forecast, the CSV download and the July 1 scorecard stay as filed.</p>`;
      changes!.hidden = false;

      // headline numbers follow the live list
      document.querySelectorAll<HTMLElement>('[data-k="watch.watch_gauges"]').forEach((e) => (e.textContent = nf.format(rows.length)));
      if (latest) root.querySelectorAll<HTMLElement>('.lede [data-k="watch.as_of"]').forEach((e) => (e.textContent = longDate.format(parseDay(latest))));

      btn.textContent = "Update again";
      shown = PAGE;
      fillStates();
      if (!bySite.has(selected!)) selected = rows[0]?.[0];
      renderList();
      renderPlan(selected);
    } catch (e) {
      status!.textContent = `${(e as Error).message} The list still shows the forecast file.`;
      btn.textContent = label;
    } finally {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
  });
  changes?.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>(".linkbtn");
    if (!b) return;
    const site = b.dataset.site!;
    q.value = ""; st.value = "";
    const i = rows.findIndex((r) => r[0] === site);
    shown = i >= PAGE ? Math.ceil((i + 1) / 24) * 24 : PAGE;
    renderList();
    select(site, true);
  });

  renderList();
  renderPlan(selected);
}

function downloadIcs(r: Row, wl: Watchlist) {
  const [id, name, , , , trig] = r;
  const nice = titleCase(name);
  const y = wl.season;
  const url = `https://waterdata.usgs.gov/monitoring-location/${num(id)}/`;
  const trigTxt = CHECKS.map((c, i) => `${c}: ${cfs(trig[i])}`).join(", ");
  const day = (d: string) => d.replace(/-/g, "");
  const next = (d: string) => { const t = parseDay(d); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10); };
  const fold = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  // RFC 5545: lines longer than 75 octets are folded with CRLF + space
  const wrap = (line: string) => line.length <= 74 ? line : line.match(/.{1,73}/g)!.join("\r\n ");
  const ev = (d: string, sum: string, desc: string, n: number) => [
    "BEGIN:VEVENT", `UID:flush-alert-${num(id)}-${y}-${n}@flush-alert`, `DTSTAMP:${day(wl.generated_utc.slice(0, 10))}T000000Z`,
    `DTSTART;VALUE=DATE:${day(d)}`, `DTEND;VALUE=DATE:${day(next(d))}`,
    `SUMMARY:${fold(sum)}`, `DESCRIPTION:${fold(desc)}`, `URL:${url}`, "END:VEVENT"].map(wrap).join("\r\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Flush Alert//Spring watchlist//EN", "CALSCALE:GREGORIAN",
    ev(`${y}-03-01`, `Flush Alert season starts: ${nice}`,
      `${nice} was on Watch for spring ${y} (forecast of ${wl.as_of}). From today, check daily flow at ${url}\nAlert when the 7-day mean flow passes the trigger (${trigTxt}) or flow rises more than ${wl.rise_pct_3d}% in three days. Then take a grab sample at the start of each new rise, up to six.\nHistorical-backtest rule; not an official advisory.`, 1),
    ev(`${y}-06-30`, `Flush Alert season ends: ${nice}`, "Last day the spring alert can fire.", 2),
    ev(wl.score_on, "Flush Alert forecast is scored", "Team Mustangs scores the spring watchlist on the nitrate-sensor rivers.", 3),
    "END:VCALENDAR"].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `flush-alert-${num(id)}-spring-${y}.ics`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

const ordinal = (p: number) => { const n = Math.round(p), m = n % 100, k = n % 10; return `${n}${m >= 11 && m <= 13 ? "th" : k === 1 ? "st" : k === 2 ? "nd" : k === 3 ? "rd" : "th"}`; };

/** Recent daily flow, its 7-day mean, and the trigger the alert checks. */
function drawFlow(el: HTMLElement, site: string, name: string, L: LiveFlow, tr: Triggers, mar1: number | null) {
  const ser = L.series.slice(-45).map(([d, v]) => ({ d: parseDay(d), v }));
  if (!ser.length) return;
  const byDay = new Map(L.series.map(([d, v]) => [d, v]));
  const iso = (t: Date) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const m7 = ser.map(({ d }) => {
    const vs = [...Array(7)].map((_, i) => { const t = new Date(d); t.setDate(t.getDate() - i); return byDay.get(iso(t)); }).filter((v): v is number => v != null);
    return { d, v: vs.length >= 5 ? vs.reduce((a, b) => a + b, 0) / vs.length : NaN };
  });
  const inSeason = phaseOf(tr, L.last) === "season";
  const trig = inSeason
    ? ser.map(({ d }) => ({ d, v: triggerOn(tr, site, iso(d)) ?? NaN }))
    : mar1 != null ? [{ d: ser[0].d, v: mar1 }, { d: ser[ser.length - 1].d, v: mar1 }] : [];
  el.innerHTML = "";
  const w = Math.max(280, el.clientWidth), h = 210, m = { t: 16, r: 12, b: 26, l: 46 };
  const x = d3.scaleTime().domain(d3.extent(ser, (s) => s.d) as [Date, Date]).range([m.l, w - m.r]);
  const top = d3.max([...ser.map((s) => s.v), ...trig.map((t) => t.v).filter(Number.isFinite)]) ?? 1;
  const y = d3.scaleLinear().domain([0, top * 1.08]).nice().range([h - m.b, m.t]);
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h)
    .attr("role", "img").attr("aria-label", `${name}: daily flow for the last ${ser.length} days, latest 7-day mean ${L.q7 == null ? "n/a" : Math.round(L.q7)} cfs${mar1 != null && !inSeason ? `, Mar 1 trigger ${Math.round(mar1)} cfs` : ""}.`);
  svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(${m.l},0)`)
    .call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r)).tickFormat((v) => d3.format("~s")(v as number)));
  svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`)
    .call(d3.axisBottom(x).ticks(w < 420 ? 3 : 5).tickFormat((v) => shortDate.format(v as Date)));
  const line = d3.line<{ d: Date; v: number }>().defined((p) => Number.isFinite(p.v)).x((p) => x(p.d)).y((p) => y(p.v));
  svg.append("path").attr("d", line(ser)!).attr("fill", "none").attr("stroke", "var(--river-soft)").attr("stroke-width", 1.25);
  svg.append("path").attr("d", line(m7)!).attr("fill", "none").attr("stroke", "var(--river)").attr("stroke-width", 2.5);
  if (trig.length) {
    svg.append("path").attr("d", line(trig)!).attr("fill", "none").attr("stroke", "var(--ink-2)").attr("stroke-width", 1.25).attr("stroke-dasharray", "4 3");
    const lt = trig[trig.length - 1];
    if (Number.isFinite(lt.v)) svg.append("text").attr("class", "lbl").attr("x", w - m.r).attr("y", y(lt.v) - 6).attr("text-anchor", "end")
      .text(`${inSeason ? "Today's trigger" : "Mar 1 trigger"} ${d3.format(",")(Math.round(lt.v))} cfs`);
  }
  const lt0 = trig[trig.length - 1];
  const trigY = lt0 && Number.isFinite(lt0.v) ? y(lt0.v) : null;
  const lastM = [...m7].reverse().find((p) => Number.isFinite(p.v));
  if (lastM) {
    svg.append("circle").attr("cx", x(lastM.d)).attr("cy", y(lastM.v)).attr("r", 3.5).attr("fill", "var(--river)");
    svg.append("text").attr("class", "lbl lbl--river").attr("x", x(lastM.d) - 6).attr("y", y(lastM.v) + (y(lastM.v) < m.t + 30 || (trigY != null && Math.abs(y(lastM.v) - 8 - (trigY - 6)) < 16 && y(lastM.v) > trigY - 10) ? 16 : -8)).attr("text-anchor", "end")
      .text(`7-day ${d3.format(",")(r3(lastM.v))} cfs`);
  }
}
