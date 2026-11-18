// Spring 2027 watchlist: searchable list of Watch gauges, a sampling plan per river,
// a calendar download, and the sensor rivers the forecast will be scored on.
import { ABBR, titleCase } from "./replay";
import { parseDay } from "./util";

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

  const states = new Map<string, number>();
  wl.rows.forEach((r) => states.set(r[2], (states.get(r[2]) ?? 0) + 1));
  [...states].sort((a, b) => a[0].localeCompare(b[0])).forEach(([s, n]) => st.add(new Option(`${s} (${n})`, s)));

  const filtered = () => {
    const t = q.value.trim().toLowerCase(), s = st.value;
    return wl.rows.filter((r) => (!s || r[2] === s) && (!t || r[1].toLowerCase().includes(t) || r[0].includes(t)));
  };

  const renderList = () => {
    const rows = filtered();
    const vis = rows.slice(0, shown);
    tbody.innerHTML = vis.map((r) => `<tr class="${r[0] === selected ? "is-sel" : ""}">
      <th scope="row"><button type="button" class="rowbtn" data-site="${r[0]}" aria-pressed="${r[0] === selected}">${esc(titleCase(r[1]))}</button></th>
      <td class="col-opt">${ABBR[r[2]] ?? esc(r[2])}</td>
      <td><span class="dry"><span class="dry__bar" style="--p:${(25 - Math.min(25, r[3])) / 25}"></span><span class="dry__txt">${r[3] <= 0.5 ? "driest on record" : `drier than ${Math.round(100 - r[3])}%`}${r[10] != null ? `<small>${r[10]}% of normal flow</small>` : ""}</span></span></td></tr>`).join("");
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
    meta.textContent = `USGS ${num(id)} · ${state} · flow data through ${fmtDate.format(parseDay(asOf))}`;
    body.innerHTML = `
      <p class="plan__status"><span class="tag tag--watch">Watch</span> ${dryness(pct)}${normal != null ? `: the past 12 months carried ${normal}% of this river's normal flow` : ""}. Rank ${rank.get(id)} of ${nf.format(wl.rows.length)}.${dsm ? " Upstream of the Des Moines metro's drinking-water intakes." : ""}</p>
      <h4 class="plan__h">The alert fires on the first day, Mar 1 to Jun 30, that</h4>
      <p class="plan__p">the 7-day mean flow passes this river's trigger:</p>
      <table class="trig"><caption class="visually-hidden">Trigger flow by date</caption>
        <thead><tr>${CHECKS.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
        <tbody><tr>${trig.map((v) => `<td>${cfs(v)}</td>`).join("")}</tr></tbody></table>
      <p class="plan__p">or daily flow rises more than ${wl.rise_pct_3d}% in three days. Its 7-day flow today: <strong>${cfs(now)}</strong>.</p>
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
