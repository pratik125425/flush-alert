import * as d3 from "d3";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import statesUrl from "us-atlas/states-10m.json?url";
import { frame, radioGroup, responsive } from "./charts";
import type { Gauge, SensorSite, Series, Summary } from "./types";
import { addDays, fmtDate, fmtDay, getJSON, parseDay, reduceMotion } from "./util";

type Status = "OK" | "WATCH" | "ALERT";
const FIPS = new Set(["19", "17", "18", "27", "55", "39", "29", "31"]);
const ALERT_DAYS = 30;
const MS_PER_DAY = 80;

let statesP: Promise<GeoJSON.FeatureCollection> | null = null;
export function loadStates() {
  statesP ??= fetch(statesUrl).then((r) => r.json()).then((t: Topology) =>
    feature(t, t.objects.states as GeometryCollection) as unknown as GeoJSON.FeatureCollection);
  return statesP;
}

export function statusOn(post: boolean | null, alert: string | null, day: Date): Status {
  if (!post || day < new Date(day.getFullYear(), 2, 1)) return "OK";
  if (alert) {
    const a = parseDay(alert);
    if (day >= a && day < addDays(a, ALERT_DAYS)) return "ALERT";
  }
  return "WATCH";
}

function drawStates(svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, states: GeoJSON.FeatureCollection, w: number, h: number, pad: number) {
  const core = { type: "FeatureCollection", features: states.features.filter((f) => FIPS.has(String(f.id))) } as GeoJSON.FeatureCollection;
  const proj = d3.geoAlbers().rotate([90, 0]).center([0, 41.5]).fitExtent([[pad, pad], [w - pad, h - pad]], core);
  const path = d3.geoPath(proj);
  svg.append("g").selectAll("path").data(states.features.filter((f) => !FIPS.has(String(f.id)))).join("path").attr("class", "state--ctx").attr("d", path);
  svg.append("g").selectAll("path").data(core.features).join("path").attr("class", "state").attr("d", path);
  return proj;
}

// ---------------------------------------------------------------- replay
export async function initReplay(root: HTMLElement, sites: SensorSite[], gauges: Gauge[] | null, s: Summary) {
  const states = await loadStates();
  const mapEl = root.querySelector<HTMLElement>("#map")!;
  const scrub = root.querySelector<HTMLInputElement>("#scrubber")!;
  const playBtn = root.querySelector<HTMLButtonElement>("#play")!;
  const stamp = root.querySelector<HTMLElement>("#date-stamp")!;
  const sel = root.querySelector<HTMLSelectElement>("#site-select")!;
  const nOk = root.querySelector<HTMLElement>("#n-ok")!, nWatch = root.querySelector<HTMLElement>("#n-watch")!, nAlert = root.querySelector<HTMLElement>("#n-alert")!;
  const panel = new Panel(root, s);

  const st = { season: 2025, day: 0, site: s.hero_site, playing: false };
  const byId = new Map(sites.map((d) => [d.site, d]));
  const sorted = [...sites].sort((a, b) => a.state.localeCompare(b.state) || a.name.localeCompare(b.name));
  sel.innerHTML = sorted.map((d) => `<option value="${d.site}">${titleCase(d.name)}</option>`).join("");
  sel.value = st.site;

  const sensorIds = new Set(sites.map((d) => d.site));
  const gs = (gauges ?? []).filter((g) => !sensorIds.has(g.site));
  let gSel: d3.Selection<SVGCircleElement, Gauge, SVGGElement, unknown>;
  let sSel: d3.Selection<SVGCircleElement, SensorSite, SVGGElement, unknown>;
  let pulse: d3.Selection<SVGCircleElement, unknown, null, undefined>;
  let fxLayer: d3.Selection<SVGGElement, unknown, null, undefined>;
  let proj: d3.GeoProjection;
  let prevStatus = new Map<string, Status>();

  const dayDate = () => addDays(parseDay(`${st.season}-02-01`), st.day);
  const sensorStatus = (d: SensorSite, day: Date): Status | null => {
    const x = d.seasons[String(st.season)];
    return x ? statusOn(x.post_drought, x.alert, day) : null;
  };
  const gaugeStatus = (g: Gauge, day: Date): Status | null => {
    const x = g.seasons[String(st.season)];
    return x ? statusOn(x[0] < s.drought_pct, x[1], day) : null;
  };

  const drawMap = () => {
    const w = mapEl.clientWidth;
    const { svg, h } = frame(mapEl, Math.round(w * 0.72));
    svg.attr("role", "group").attr("aria-label", "Gauges and sensor sites");
    proj = drawStates(svg, states, w, h, 10);
    const xy = (lon: number, lat: number) => proj([lon, lat]) ?? [-99, -99];
    gSel = svg.append("g").attr("aria-hidden", "true").selectAll<SVGCircleElement, Gauge>("circle").data(gs).join("circle")
      .attr("class", "g g--ok").attr("r", w < 500 ? 1.8 : 2.6)
      .attr("cx", (g) => xy(g.lon, g.lat)[0]).attr("cy", (g) => xy(g.lon, g.lat)[1]);
    fxLayer = svg.append("g").attr("aria-hidden", "true");
    pulse = svg.append("circle").attr("class", "pulse").attr("r", 7);
    // Sensor dots are a pointer shortcut; the "Sensor site" select is the keyboard and screen-reader path.
    const sg = svg.append("g").attr("aria-hidden", "true");
    sSel = sg.selectAll<SVGCircleElement, SensorSite>("circle.s").data(sites).join("circle")
      .attr("class", "s g g--ok").attr("r", w < 500 ? 5 : 6.5)
      .attr("cx", (d) => xy(d.lon, d.lat)[0]).attr("cy", (d) => xy(d.lon, d.lat)[1]);
    sg.selectAll<SVGCircleElement, SensorSite>("circle.hit").data(sites).join("circle")
      .attr("class", "hit").attr("r", 12).attr("fill", "transparent").style("cursor", "pointer")
      .attr("cx", (d) => xy(d.lon, d.lat)[0]).attr("cy", (d) => xy(d.lon, d.lat)[1])
      .on("click", (_, d) => select(d.site, true))
      .append("title").text((d) => titleCase(d.name));
    prevStatus = new Map();
    update(false);
  };

  const update = (animateFire: boolean) => {
    const day = dayDate();
    stamp.textContent = fmtDate.format(day);
    scrub.value = String(st.day);
    scrub.setAttribute("aria-valuetext", fmtDate.format(day));
    let c = { OK: 0, WATCH: 0, ALERT: 0 } as Record<Status, number>;
    gSel.attr("class", (g) => {
      const v = gaugeStatus(g, day);
      if (v) c[v]++;
      return `g g--${(v ?? "OK").toLowerCase()}`;
    }).style("opacity", (g) => (g.seasons[String(st.season)] ? null : 0.25));
    sSel.attr("class", (d) => {
      const v = sensorStatus(d, day);
      if (v) c[v]++;
      return `s g g--${(v ?? "OK").toLowerCase()}${d.site === st.site ? " s--sel" : ""}`;
    });
    sSel.filter((d) => d.site === st.site).raise();
    nOk.textContent = String(c.OK); nWatch.textContent = String(c.WATCH); nAlert.textContent = String(c.ALERT);

    // one-shot ring where an alert fires
    if (animateFire && !reduceMotion()) {
      const fire = (id: string, v: Status | null, lon: number, lat: number) => {
        if (v === "ALERT" && prevStatus.get(id) !== "ALERT") {
          const [x, y] = proj([lon, lat]) ?? [0, 0];
          const ring = fxLayer.append("circle").attr("cx", x).attr("cy", y).attr("r", 5).attr("fill", "none")
            .attr("stroke", "var(--alert)").attr("stroke-width", 1.5).style("transform-box", "fill-box").style("transform-origin", "center");
          ring.node()!.animate([{ transform: "scale(1)", opacity: 0.9 }, { transform: "scale(3)", opacity: 0 }], { duration: 700, easing: "cubic-bezier(0.16,1,0.3,1)" })
            .finished.then(() => ring.remove()).catch(() => ring.remove());
        }
      };
      sites.forEach((d) => fire(d.site, sensorStatus(d, day), d.lon, d.lat));
      if (gs.length < 1500) gs.forEach((g) => fire(g.site, gaugeStatus(g, day), g.lon, g.lat));
    }
    prevStatus = new Map([...sites.map((d) => [d.site, sensorStatus(d, day)] as const), ...gs.map((g) => [g.site, gaugeStatus(g, day)] as const)]
      .filter((e): e is [string, Status] => e[1] != null));

    // the only looping motion: selected site while its alert is live
    const cur = byId.get(st.site);
    const live = cur && sensorStatus(cur, day) === "ALERT";
    if (cur) {
      const [x, y] = proj([cur.lon, cur.lat]) ?? [0, 0];
      pulse.attr("cx", x).attr("cy", y);
    }
    pulse.classed("pulse--on", !!live).style("opacity", live ? "" : "0");
    panel.cursor(day, cur ? sensorStatus(cur, day) : null, cur);
  };

  const select = async (id: string, fromMap = false) => {
    st.site = id;
    sel.value = id;
    update(false);
    await panel.load(byId.get(id)!, st.season);
    update(false);
    if (fromMap && window.innerWidth < 1000) root.querySelector<HTMLElement>("#panel")!.focus({ preventScroll: false });
  };

  // playback
  let raf = 0, last = 0, acc = 0;
  const maxDay = () => Math.round((parseDay(`${st.season}-07-31`).getTime() - parseDay(`${st.season}-02-01`).getTime()) / 86400000);
  const tick = (t: number) => {
    if (!st.playing) return;
    acc += t - last; last = t;
    let moved = false;
    while (acc >= MS_PER_DAY) { acc -= MS_PER_DAY; if (st.day < maxDay()) { st.day++; moved = true; } }
    if (moved) update(true);
    if (st.day >= maxDay()) { setPlaying(false); return; }
    raf = requestAnimationFrame(tick);
  };
  const setPlaying = (on: boolean) => {
    st.playing = on;
    playBtn.setAttribute("aria-pressed", String(on));
    playBtn.querySelector(".play__label")!.textContent = on ? "Pause" : "Play";
    stamp.parentElement!.setAttribute("aria-live", on ? "off" : "polite"); // don't narrate every frame
    cancelAnimationFrame(raf);
    if (on) {
      if (st.day >= maxDay()) st.day = 0;
      last = performance.now(); acc = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  playBtn.addEventListener("click", () => setPlaying(!st.playing));
  scrub.addEventListener("input", () => { setPlaying(false); st.day = Number(scrub.value); update(false); });
  sel.addEventListener("change", () => select(sel.value));
  radioGroup(root.querySelector<HTMLElement>(".seasons")!, (b) => {
    setPlaying(false);
    st.season = Number(b.dataset.season);
    scrub.max = String(maxDay());
    st.day = Math.min(st.day, maxDay());
    prevStatus = new Map();
    select(st.site);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) setPlaying(false); });

  // open on the day the hero site's 2025 alert has fired, so the first view shows the point
  scrub.max = String(maxDay());
  const heroAlert = byId.get(s.hero_site)?.seasons["2025"]?.alert;
  st.day = heroAlert ? Math.round((parseDay(heroAlert).getTime() - parseDay("2025-02-01").getTime()) / 86400000) + 14 : 40;
  responsive(mapEl, drawMap);
  await panel.load(byId.get(st.site)!, st.season);
  update(false);
}

// ---------------------------------------------------------------- panel
class Panel {
  private title: HTMLElement; private meta: HTMLElement; private chartEl: HTMLElement; private loads: HTMLElement; private msg: HTMLElement;
  private ser: Series | null = null; private site: SensorSite | null = null;
  private x: d3.ScaleTime<number, number> | null = null;
  private veil: d3.Selection<SVGRectElement, unknown, null, undefined> | null = null;
  private cur: d3.Selection<SVGLineElement, unknown, null, undefined> | null = null;
  private lastMsgKey = "";
  private cache = new Map<string, Promise<Series | null>>();
  private day: Date = new Date();

  constructor(root: HTMLElement, private s: Summary) {
    this.title = root.querySelector("#panel-title")!; this.meta = root.querySelector("#panel-meta")!;
    this.chartEl = root.querySelector("#panel-chart")!; this.loads = root.querySelector("#panel-loads")!; this.msg = root.querySelector("#message")!;
    responsive(this.chartEl, () => this.draw());
  }

  async load(site: SensorSite, year: number) {
    this.site = site;
    const key = `${site.site}_${year}`;
    if (!this.cache.has(key)) this.cache.set(key, site.seasons[String(year)] ? getJSON<Series>(`series/${key}.json`).catch(() => null) : Promise.resolve(null));
    this.ser = await this.cache.get(key)!;
    this.title.textContent = titleCase(site.name);
    const info = site.seasons[String(year)];
    const pctTxt = info?.antecedent_pct != null ? `previous 12 months of flow at the ${ordinal(Math.round(info.antecedent_pct))} percentile` : "not enough flow history to rank";
    this.meta.textContent = info ? `${site.site.replace("USGS-", "USGS ")} · ${year}: ${info.post_drought ? "post-drought spring" : "normal spring"}, ${pctTxt}.` : `${site.site.replace("USGS-", "USGS ")} · no sensor record for ${year}. Try another spring.`;
    this.renderLoads();
    this.draw();
    this.lastMsgKey = "";
  }

  private draw() {
    const el = this.chartEl;
    if (!this.ser) { el.innerHTML = `<p class="panel__empty">No sensor record for this spring.</p>`; this.x = null; return; }
    const s = this.ser;
    const { svg, w, h } = frame(el, 220);
    const m = { t: 14, r: 10, b: 26, l: 30 };
    const ds = Array.from({ length: s.c.length }, (_, i) => addDays(parseDay(s.start), i));
    const x = d3.scaleTime().domain([ds[0], ds[ds.length - 1]]).range([m.l, w - m.r]);
    const cmax = d3.max(s.c, (v) => v ?? 0) ?? 10;
    const rmax = Math.min(d3.max(s.reg, (v) => v ?? 0) ?? 0, cmax * 3); // show the overshoot, within reason
    const smax = d3.max(s.samples, (d) => d[1]) ?? 0;
    const y = d3.scaleLinear().domain([0, Math.max(12, cmax * 1.1, rmax * 1.05, smax * 1.1)]).nice().range([h - m.b, m.t]);
    svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r))).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).ticks(d3.timeMonth.every(1)).tickFormat((d) => d3.timeFormat("%b")(d as Date)).tickSizeOuter(0));
    const id = `pc-${Math.random().toString(36).slice(2)}`;
    svg.append("clipPath").attr("id", id).append("rect").attr("x", m.l).attr("y", m.t - 4).attr("width", w - m.l - m.r).attr("height", h - m.b - m.t + 4);
    const body = svg.append("g").attr("clip-path", `url(#${id})`);
    body.append("line").attr("x1", m.l).attr("x2", w - m.r).attr("y1", y(10)).attr("y2", y(10)).attr("stroke", "var(--ink)").attr("stroke-dasharray", "5 4");
    const ln = (arr: (number | null)[]) => d3.line<number | null>().defined((v) => v != null).x((_, i) => x(ds[i])).y((v) => y(v!))(arr);
    body.append("path").attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 1.5).attr("stroke-dasharray", "4 3").attr("d", ln(s.reg));
    body.append("path").attr("fill", "none").attr("stroke", "var(--river)").attr("stroke-width", 2).attr("d", ln(s.c));
    if (s.alert) {
      const ax = x(parseDay(s.alert));
      body.append("line").attr("x1", ax).attr("x2", ax).attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "var(--alert)").attr("stroke-width", 2);
    }
    body.append("g").selectAll("circle").data(s.samples).join("circle").attr("cx", (d) => x(parseDay(d[0]))).attr("cy", (d) => y(d[1]))
      .attr("r", 4).attr("fill", "var(--ground)").attr("stroke", "var(--ink)").attr("stroke-width", 1.75);
    // future veil: moved with transform only
    const vid = `pv-${Math.random().toString(36).slice(2)}`;
    svg.append("clipPath").attr("id", vid).append("rect").attr("x", m.l).attr("y", 0).attr("width", w - m.l - m.r).attr("height", h);
    this.veil = svg.append("g").attr("clip-path", `url(#${vid})`).append("rect").attr("x", 0).attr("y", m.t - 4).attr("width", w - m.l - m.r + 2).attr("height", h - m.b - m.t + 4)
      .attr("fill", "var(--ground)").attr("opacity", 0.72).style("transition", "transform 150ms ease-out");
    this.cur = svg.append("line").attr("y1", m.t - 4).attr("y2", h - m.b).attr("x1", 0).attr("x2", 0).attr("stroke", "var(--ink)").attr("stroke-width", 1)
      .style("transition", "transform 150ms ease-out");
    svg.append("text").attr("class", "lbl lbl--muted").attr("x", w - m.r).attr("y", y(10) - 5).attr("text-anchor", "end").text("10 mg/L");
    this.x = x;
    this.placeCursor();
  }

  private placeCursor() {
    if (!this.x || !this.veil || !this.cur) return;
    const [a, b] = this.x.domain();
    const d = this.day < a ? a : this.day > b ? b : this.day;
    const px = this.x(d);
    this.veil.style("transform", `translate(${px}px,0)`);
    this.cur.style("transform", `translate(${px}px,0)`);
  }

  cursor(day: Date, status: Status | null, site?: SensorSite) {
    this.day = day;
    this.placeCursor();
    this.renderMsg(day, status, site);
  }

  private renderLoads() {
    const s = this.ser;
    if (!s || !s.valid_spring || !s.true_load_kg) {
      this.loads.innerHTML = s ? `<dt class="loads__note">Too many sensor gaps this spring to total the March–June load.</dt>` : "";
      return;
    }
    const t = (kg: number) => `${d3.format(",.0f")(kg / 1000)} t`;
    const e = (kg?: number) => (kg == null ? "" : `${kg >= s.true_load_kg! ? "+" : "−"}${Math.abs(Math.round((kg / s.true_load_kg! - 1) * 100))}%`);
    this.loads.innerHTML = `
      <dt>March–June nitrate load, sensor</dt><dd>${t(s.true_load_kg)}</dd><dd class="err"></dd>
      <dt>Monthly samples, regression</dt><dd>${t(s.est_reg_kg!)}</dd><dd class="err">${e(s.est_reg_kg)}</dd>
      <dt>Monthly samples, interpolation</dt><dd>${t(s.est_interp_kg!)}</dd><dd class="err">${e(s.est_interp_kg)}</dd>
      <dt class="loads__note">Monthly schedule sampling on the 15th. t = metric tonnes of nitrogen.</dt>`;
  }

  private renderMsg(day: Date, status: Status | null, site?: SensorSite) {
    if (!site) return;
    const info = site.seasons[String(day.getFullYear())];
    const key = `${site.site}|${status}|${info?.alert}`;
    if (key === this.lastMsgKey) return;
    const isNew = this.lastMsgKey !== "" && status === "ALERT";
    this.lastMsgKey = key;
    const name = titleCase(site.name);
    let title = "", body = "";
    if (!status || !info) { this.msg.innerHTML = ""; return; }
    if (status === "ALERT") {
      const a = parseDay(info.alert!);
      title = `Flush Alert: ${name}`;
      body = `<p>First wet-spring rise after a dry year (flow ranked ${ordinal(Math.round(info.antecedent_pct ?? 0))} percentile). Nitrate flushes often follow within weeks.</p>
        <p>Take an extra nitrate grab sample on each new flow rise through ${fmtDay.format(addDays(a, ALERT_DAYS))}.</p>`;
    } else if (status === "WATCH") {
      title = `Watch: ${name}`;
      body = info.alert && day >= parseDay(info.alert)
        ? `<p>Alert window closed. Keep sampling on flow rises until nitrate returns to normal.</p>`
        : `<p>The last 12 months of flow ranked in the ${ordinal(Math.round(info.antecedent_pct ?? 0))} percentile. Stand by for the first wet-spring rise.</p>`;
    } else {
      title = `No alert: ${name}`;
      body = day < new Date(day.getFullYear(), 2, 1)
        ? `<p>Springs are classified on March 1 from the previous 12 months of flow.</p>`
        : `<p>Not a post-drought spring. The regular monthly schedule is enough.</p>`;
    }
    this.msg.innerHTML = `<div class="msg${status === "ALERT" ? "" : " msg--quiet"}${isNew ? " is-new" : ""}">
      <div class="msg__head"><span>Preview. No message is sent.</span><span>${fmtDate.format(day)}</span></div>
      <div class="msg__body"><p class="msg__title">${title}</p>${body}</div></div>`;
  }
}

// ---------------------------------------------------------------- scale map
export async function initScaleMap(el: HTMLElement, cap: HTMLElement, gauges: Gauge[] | null, sites: SensorSite[], summary?: Summary) {
  const states = await loadStates();
  const draw = () => {
    const w = el.clientWidth;
    const { svg, h } = frame(el, Math.round(w * 0.62));
    const proj = drawStates(svg, states, w, h, 8);
    const pts = gauges ?? [];
    const order: Record<string, number> = { UNRANKED: 0, OK: 1, WATCH: 2, ALERT: 3 };
    svg.append("g").selectAll("circle").data([...pts].sort((a, b) => order[a.status] - order[b.status])).join("circle")
      .attr("class", (g) => `g g--${g.status === "UNRANKED" ? "ok" : g.status.toLowerCase()}`)
      .style("opacity", (g) => (g.status === "UNRANKED" ? 0.3 : null))
      .attr("r", w < 500 ? 1.8 : 2.8)
      .attr("cx", (g) => proj([g.lon, g.lat])?.[0] ?? -9).attr("cy", (g) => proj([g.lon, g.lat])?.[1] ?? -9);
    svg.append("g").selectAll("circle").data(sites).join("circle").attr("r", w < 500 ? 3.5 : 4.5)
      .attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.25)
      .attr("cx", (d) => proj([d.lon, d.lat])?.[0] ?? -9).attr("cy", (d) => proj([d.lon, d.lat])?.[1] ?? -9);
  };
  responsive(el, draw);
  if (gauges?.length) {
    const n = d3.rollup(gauges, (v) => v.length, (g) => g.status);
    const last = d3.max(gauges, (g) => g.last) ?? "";
    cap.insertAdjacentHTML("afterbegin", `As of ${last ? fmtDate.format(parseDay(last)) : "the latest data"}: ${n.get("WATCH") ?? 0} gauges on Watch, ${n.get("OK") ?? 0} OK, ${n.get("ALERT") ?? 0} on Alert${n.get("UNRANKED") ? `, ${n.get("UNRANKED")} without enough history to rank (faded)` : ""}. Circles: nitrate-sensor sites. `);
    if (summary?.gauges_partial && summary.gauges) {
      cap.insertAdjacentHTML("afterbegin", `<strong>Mapped so far: ${gauges.length.toLocaleString("en-US")} of ${summary.gauges.toLocaleString("en-US")} gauges.</strong> The rate-limited download is still running; the rest appear on the next export. `);
    }
  } else {
    cap.insertAdjacentHTML("afterbegin", `Gauge download in progress; circles show nitrate-sensor sites. `);
  }
}

// ---------------------------------------------------------------- text helpers
const SMALL = new Set(["at", "near", "of", "the", "and", "in", "on", "above", "below", "by"]);
export function titleCase(raw: string) {
  const parts = raw.split(",");
  const head = parts[0].toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a, b, i) => (i > 0 && SMALL.has(m) ? m : a.toUpperCase() + b))
    .replace(/\bR\b/g, "River").replace(/\bCr\b/g, "Creek").replace(/\bNr\b/g, "near");
  const st = parts.slice(1).join(",").trim();
  return st ? `${head}, ${st.toUpperCase()}` : head;
}
const ABBR: Record<string, string> = { Iowa: "IA", Illinois: "IL", Indiana: "IN", Minnesota: "MN", Wisconsin: "WI", Ohio: "OH", Missouri: "MO", Nebraska: "NE" };
const abbr = (s: string) => ABBR[s] ?? s.slice(0, 2).toUpperCase();
function ordinal(n: number) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
