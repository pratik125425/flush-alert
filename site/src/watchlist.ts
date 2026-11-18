// Spring 2027 watchlist: searchable list of Watch gauges, a sampling plan per river,
// a calendar download, and the sensor rivers the forecast will be scored on.
import { ABBR, titleCase } from "./replay";
import { parseDay } from "./util";
import { fetchLive, phaseOf, triggerOn, type LiveFlow, type Triggers } from "./live";

// [site, name, state, pct, flow7_now, [trig Mar1, Apr1, May1, Jun1], nearest sensor, km, is_sensor, as_of, % of normal]
type Row = [string, string, string, number, number | null, (number | null)[], string, number, boolean, string, number | null];
export interface Watchlist {
  season: number; as_of: string; generated_utc: string; watch_gauges: number; gauges_ranked: number;
  states: number; sensor_sites_on_watch: number; sensor_sites_total: number; drought_threshold_pct: number;
  rise_pct_3d: number; final_call: string; score_on: string; scoring: string; excluded_low_flow: number;
  sensor_watch: { site: string; name: string }[]; rows: Row[];
}

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
  const rank = new Map(wl.rows.map((r, i) => [r[0], i + 1]));
  const bySite = new Map(wl.rows.map((r) => [r[0], r]));
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

  const states = new Map<string, number>();
  wl.rows.forEach((r) => states.set(r[2], (states.get(r[2]) ?? 0) + 1));
  [...states].sort((a, b) => a[0].localeCompare(b[0])).forEach(([s, n]) => st.add(new Option(`${s} (${n})`, s)));

  const filtered = () => {
    const t = q.value.trim().toLowerCase(), s = st.value;
    return wl.rows.filter((r) => (!s || r[2] === s) && (!t || r[1].toLowerCase().includes(t) || r[0].includes(t)));
  };

  const flowCell = (r: Row) => {
    if (!live) return r[4] == null ? "n/a" : nf.format(r3(r[4]));
    const s = liveOf(r[0]);
    if (!s || s.L.q7 == null) return `<span class="wl__na">no report</span>`;
    return `${s.fires ? `<span class="tag tag--alert">Alert</span> ` : ""}${nf.format(r3(s.L.q7))}<small>${shortDate.format(parseDay(s.L.last))}</small>`;
  };

  const renderList = () => {
    const rows = filtered();
    const vis = rows.slice(0, shown);
    tbody.innerHTML = vis.map((r) => `<tr class="${r[0] === selected ? "is-sel" : ""}">
      <th scope="row"><button type="button" class="rowbtn" data-site="${r[0]}" aria-pressed="${r[0] === selected}">${esc(titleCase(r[1]))}</button></th>
      <td class="col-opt">${ABBR[r[2]] ?? esc(r[2])}</td>
      <td><span class="dry"><span class="dry__bar" style="--p:${(25 - Math.min(25, r[3])) / 25}"></span><span class="dry__txt">${r[3] <= 0.5 ? "driest on record" : `drier than ${Math.round(100 - r[3])}%`}${r[10] != null ? `<small>${r[10]}% of normal flow</small>` : ""}</span></span></td>
      <td class="col-opt wl__now">${flowCell(r)}</td></tr>`).join("");
    count.textContent = rows.length === wl.rows.length
      ? `${nf.format(rows.length)} rivers on Watch, driest first. Showing ${vis.length}.`
      : `${nf.format(rows.length)} of ${nf.format(wl.rows.length)} rivers match. Showing ${vis.length}.`;
    more.hidden = rows.length <= shown;
    more.textContent = `Show ${Math.min(24, rows.length - shown)} more`;
  };

  const renderPlan = (site: string | undefined, focus = false) => {
    const r = site ? bySite.get(site) : undefined;
    const title = plan.querySelector("#wl-plan-title")!, meta = plan.querySelector("#wl-plan-meta")!, body = plan.querySelector("#wl-plan-body")!;
    if (!r) { title.textContent = "Sampling plan"; meta.textContent = ""; body.innerHTML = "<p>No river matches.</p>"; return; }
    const [id, name, state, pct, now, trig, sName, sKm, isSensor, asOf, normal] = r;
    const nice = titleCase(name);
    const dsm = /raccoon|des moines r/i.test(name);
    title.textContent = nice;
    const lv = live?.get(id);
    meta.textContent = `USGS ${num(id)} · ${state} · forecast on flow through ${fmtDate.format(parseDay(asOf))}${lv ? ` · live flow through ${fmtDate.format(parseDay(lv.last))}` : ""}`;
    body.innerHTML = `
      <p class="plan__status"><span class="tag tag--watch">Watch</span> ${dryness(pct)}${normal != null ? `: the past 12 months carried ${normal}% of this river's normal flow` : ""}. Rank ${rank.get(id)} of ${nf.format(wl.rows.length)}.${dsm ? " Upstream of the Des Moines metro's drinking-water intakes." : ""}</p>
      <h4 class="plan__h">The alert fires on the first day, Mar 1 to Jun 30, that</h4>
      <p class="plan__p">the 7-day mean flow passes this river's trigger:</p>
      <table class="trig"><caption class="visually-hidden">Trigger flow by date</caption>
        <thead><tr>${CHECKS.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
        <tbody><tr>${trig.map((v) => `<td>${cfs(v)}</td>`).join("")}</tr></tbody></table>
      <p class="plan__p">or daily flow rises more than ${wl.rise_pct_3d}% in three days.${live ? "" : ` Its 7-day flow on ${shortDate.format(parseDay(asOf))}: <strong>${cfs(now)}</strong>.`}</p>
      ${live ? liveBox(id, trig[0]) : ""}
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
    if (focus) plan.focus({ preventScroll: window.innerWidth >= 1000 });
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
    const i = wl.rows.findIndex((r) => r[0] === b.dataset.site);
    if (i >= shown) shown = Math.ceil((i + 1) / 24) * 24;
    renderList();
    select(b.dataset.site!, true);
  });

  // "Update with today's USGS flow"
  const btn = root.querySelector<HTMLButtonElement>("#wl-refresh"), status = root.querySelector<HTMLElement>("#wl-live-status");
  btn?.addEventListener("click", async () => {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    const label = btn.textContent;
    btn.textContent = "Fetching from USGS…";
    status!.textContent = `Asking USGS for the past 14 days of flow at ${nf.format(wl.rows.length)} gauges…`;
    try {
      const [t, l] = await Promise.all([
        tr ? Promise.resolve(tr) : fetch("data/triggers.json").then((r) => { if (!r.ok) throw new Error("Trigger file missing."); return r.json() as Promise<Triggers>; }),
        fetchLive(wl.rows.map((r) => r[0])),
      ]);
      tr = t; live = l;
      const ids = wl.rows.map((r) => r[0]).filter((id) => live!.get(id)?.q7 != null);
      const latest = ids.map((id) => live!.get(id)!.last).sort().at(-1);
      const fires = ids.filter((id) => liveOf(id)?.fires).length;
      const phase = latest ? phaseOf(tr, latest) : "before";
      const when = latest ? usDate.format(parseDay(latest)) : "n/a";
      status!.innerHTML = `<strong>Live.</strong> USGS daily flow through ${when}, for ${nf.format(ids.length)} of ${nf.format(wl.rows.length)} rivers, fetched at ${clock.format(new Date())}. `
        + (phase === "before" ? `No alert can fire until Mar 1, ${wl.season}; each plan shows how close its river is to the Mar 1 trigger.`
          : phase === "season" ? `<strong>${nf.format(fires)}</strong> ${fires === 1 ? "river meets" : "rivers meet"} alert conditions today.`
          : `The spring ${wl.season} window has closed.`)
        + ` Provisional USGS data. Watch itself is ranked again on Mar 1.`;
      status!.classList.toggle("is-live", true);
      btn.textContent = "Update again";
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
