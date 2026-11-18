import * as d3 from "d3";
import type { Evidence, How, Metric, Series, Summary } from "./types";
import { addDays, fmtDay, onceVisible, ord, parseDay, reduceMotion } from "./util";

type Sel = d3.Selection<SVGSVGElement, unknown, null, undefined>;

/** Fresh responsive SVG sized to its container. */
export function frame(el: HTMLElement, height: number | ((w: number) => number)) {
  el.innerHTML = "";
  const w = Math.max(300, el.clientWidth);
  const h = typeof height === "function" ? height(w) : height;
  const svg = d3.select(el).append("svg").attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h) as Sel;
  return { svg, w, h };
}

/** Redraw on width change only (not on height jitter from fonts). */
export function responsive(el: HTMLElement, draw: () => void) {
  let last = el.clientWidth, t = 0;
  draw();
  new ResizeObserver(() => {
    const w = el.clientWidth;
    if (Math.abs(w - last) < 4) return;
    last = w;
    clearTimeout(t);
    t = window.setTimeout(draw, 120);
  }).observe(el);
}

const dates = (start: string, n: number) => {
  const s = parseDay(start);
  return Array.from({ length: n }, (_, i) => addDays(s, i));
};

function halo<T extends d3.BaseType>(sel: d3.Selection<T, unknown, null, undefined>, cls: string, x: number, y: number, text: string, anchor = "start") {
  const g = (sel as unknown as d3.Selection<SVGGElement, unknown, null, undefined>);
  g.append("text").attr("class", `${cls} halo`).attr("x", x).attr("y", y).attr("text-anchor", anchor).text(text);
  return g.append("text").attr("class", cls).attr("x", x).attr("y", y).attr("text-anchor", anchor).text(text);
}

const monthAxis = (x: d3.ScaleTime<number, number>, h: number, w: number) => (g: d3.Selection<SVGGElement, unknown, null, undefined>) => {
  g.attr("class", "axis").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(d3.timeMonth.every(w < 520 ? 2 : 1)).tickFormat((d) => d3.timeFormat("%b")(d as Date)).tickSizeOuter(0));
};

// --------------------------------------------------------------- hero chart
export function heroChart(el: HTMLElement, s: Series) {
  let played = false;
  const draw = () => {
    const narrow = el.clientWidth < 560;
    const { svg, w, h } = frame(el, (w) => Math.round(Math.min(460, Math.max(320, w * 0.46))));
    const m = { t: 24, r: narrow ? 14 : 120, b: 30, l: 40 };
    const ds = dates(s.start, s.c.length);
    const x = d3.scaleTime().domain([ds[0], ds[ds.length - 1]]).range([m.l, w - m.r]);
    const ymax = Math.max(12, d3.max(s.c, (v) => v ?? 0)! * 1.08);
    const y = d3.scaleLinear().domain([0, ymax]).nice().range([h - m.b, m.t]);

    svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSize(-(w - m.l - m.r)).tickFormat((d) => `${d}`))
      .call((g) => g.select(".domain").remove());
    svg.append("text").attr("class", "lbl lbl--muted").attr("x", m.l).attr("y", 12).text("Nitrate, mg/L");
    svg.append("g").call(monthAxis(x, h - m.b, w));

    const id = `clip-${Math.random().toString(36).slice(2)}`;
    const clip = svg.append("clipPath").attr("id", id).append("rect")
      .attr("x", m.l).attr("y", 0).attr("width", w - m.l - m.r).attr("height", h)
      .style("transform-origin", `${m.l}px 0`).style("transform-box", "view-box");
    const body = svg.append("g").attr("clip-path", `url(#${id})`);

    // the part monthly sampling never sees
    const pts = ds.map((d, i) => ({ d, c: s.c[i], it: s.interp[i] }));
    body.append("path").attr("fill", "var(--river-mist)")
      .attr("d", d3.area<typeof pts[0]>().defined((p) => p.c != null && p.it != null)
        .x((p) => x(p.d)).y0((p) => y(p.it!)).y1((p) => y(Math.max(p.c!, p.it!)))(pts));
    body.append("path").attr("fill", "none").attr("stroke", "var(--ink-3)").attr("stroke-width", 1.25).attr("stroke-dasharray", "1 3").attr("stroke-linecap", "round")
      .attr("d", d3.line<typeof pts[0]>().defined((p) => p.it != null).x((p) => x(p.d)).y((p) => y(p.it!))(pts));
    body.append("path").attr("fill", "none").attr("stroke", "var(--river)").attr("stroke-width", 2.25).attr("stroke-linejoin", "round")
      .attr("d", d3.line<typeof pts[0]>().defined((p) => p.c != null).x((p) => x(p.d)).y((p) => y(p.c!))(pts));

    // EPA limit
    svg.append("line").attr("x1", m.l).attr("x2", w - m.r).attr("y1", y(10)).attr("y2", y(10))
      .attr("stroke", "var(--ink)").attr("stroke-dasharray", "5 4").attr("stroke-width", 1);
    halo(svg, "lbl", narrow ? m.l + 4 : w - m.r + 6, y(10) + (narrow ? -6 : 4), "EPA limit, 10 mg/L");

    // alert
    let alertG: d3.Selection<SVGGElement, unknown, null, undefined> | null = null;
    if (s.alert) {
      const ax = x(parseDay(s.alert));
      alertG = svg.append("g").attr("class", "hero-alert");
      alertG.append("line").attr("x1", ax).attr("x2", ax).attr("y1", m.t + 4).attr("y2", h - m.b).attr("stroke", "var(--alert)").attr("stroke-width", 2);
      halo(alertG, "lbl lbl--alert", ax + 6, m.t + 14, `${narrow ? "Alert" : "Flush Alert"}, ${fmtDay.format(parseDay(s.alert))}`);
      if (s.surge_start) {
        const sx = x(parseDay(s.surge_start));
        alertG.append("line").attr("x1", sx).attr("x2", sx).attr("y1", m.t + 36).attr("y2", h - m.b).attr("stroke", "var(--ink-3)").attr("stroke-width", 1).attr("stroke-dasharray", "2 3");
        halo(alertG, "lbl", sx + 5, m.t + 46, `Surge, ${fmtDay.format(parseDay(s.surge_start))}`);
      }
    }

    // samples
    const dots = svg.append("g").selectAll("g").data(s.samples).join("g")
      .attr("transform", ([d, c]) => `translate(${x(parseDay(d))},${y(c)})`);
    const dot = dots.append("circle").attr("r", 5).attr("fill", "var(--ground)").attr("stroke", "var(--ink)").attr("stroke-width", 2);

    // direct labels
    const last = pts.filter((p) => p.c != null).at(-1)!;
    if (!narrow) {
      halo(svg, "lbl lbl--river", w - m.r + 6, y(last.c!) + 4, "Sensor, daily");
      const lastIt = pts.filter((p) => p.it != null).at(-1)!;
      halo(svg, "lbl", w - m.r + 6, y(lastIt.it!) + 4, "Monthly record");
    }
    const peak = pts.reduce((a, p) => ((p.c ?? -1) > (a.c ?? -1) ? p : a), pts[0]);
    if (!narrow) halo(svg, "lbl lbl--river", x(peak.d) + (x(peak.d) > w - m.r - 120 ? -8 : 8), y(peak.c!) - 6, `${peak.c!.toFixed(1)} mg/L`, x(peak.d) > w - m.r - 120 ? "end" : "start");

    // motion: line draws in once, samples settle, alert appears
    if (!played && !reduceMotion()) {
      clip.style("transform", "scaleX(0)");
      dot.style("opacity", 0).style("transform", "translateY(-10px)");
      alertG?.style("opacity", 0);
      onceVisible(el, () => {
        played = true;
        clip.style("transition", "transform 1400ms cubic-bezier(0.33,1,0.68,1)").style("transform", "scaleX(1)");
        dot.style("transition", (_, i) => `opacity 280ms ${300 + i * 160}ms ease-out, transform 280ms ${300 + i * 160}ms cubic-bezier(0.16,1,0.3,1)`)
          .style("opacity", 1).style("transform", "translateY(0)");
        alertG?.style("transition", "opacity 300ms 1200ms ease-out").style("opacity", 1);
      });
    }
  };
  responsive(el, draw);
}

// ---------------------------------------------------- compare (dumbbell) chart
export function compareChart(el: HTMLElement, ev: Evidence) {
  const rows = [
    { key: "reg", label: "Regression (agency standard)" },
    { key: "interp", label: "Interpolation" },
  ].map((r) => ({
    ...r,
    normal: ev.load_summary.find((d) => d.spring_type === "normal" && d.method === r.key)!.median_abs_err_pct,
    post: ev.load_summary.find((d) => d.spring_type === "post-drought" && d.method === r.key)!.median_abs_err_pct,
  }));
  const draw = () => {
    const narrow = el.clientWidth < 560;
    const rowH = narrow ? 84 : 56;
    const { svg, w, h } = frame(el, 34 + rows.length * rowH + 24);
    const m = { l: narrow ? 8 : 210, r: 24 };
    const x = d3.scaleLinear().domain([0, Math.ceil(d3.max(rows, (r) => r.post)! / 5) * 5 + 2]).range([m.l, w - m.r]);
    svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(0,${h - 22})`)
      .call(d3.axisBottom(x).ticks(5).tickFormat((d) => `${d}%`).tickSize(-(h - 46)))
      .call((g) => g.select(".domain").remove());
    rows.forEach((r, i) => {
      const cy = 34 + i * rowH + (narrow ? 42 : rowH / 2);
      const g = svg.append("g");
      g.append("text").attr("class", "lbl").attr("x", narrow ? m.l : m.l - 14).attr("y", narrow ? cy - 26 : cy + 4)
        .attr("text-anchor", narrow ? "start" : "end").style("font-weight", 600).text(r.label);
      g.append("line").attr("x1", x(r.normal)).attr("x2", x(r.post)).attr("y1", cy).attr("y2", cy).attr("stroke", "var(--rule-strong)").attr("stroke-width", 3);
      g.append("circle").attr("cx", x(r.normal)).attr("cy", cy).attr("r", 7).attr("fill", "var(--ground)").attr("stroke", "var(--ink-3)").attr("stroke-width", 2);
      g.append("circle").attr("cx", x(r.post)).attr("cy", cy).attr("r", 7).attr("fill", "var(--river-deep)");
      const vy = narrow ? cy + 22 : cy - 13;
      halo(g, "lbl lbl--muted", x(r.normal), vy, `${r.normal.toFixed(0)}%`, "middle");
      halo(g, "lbl lbl--river", x(r.post), vy, `${r.post.toFixed(0)}%`, "middle");
    });
    const ky = 14;
    svg.append("circle").attr("cx", m.l + 6).attr("cy", ky - 4).attr("r", 5).attr("fill", "var(--ground)").attr("stroke", "var(--ink-3)").attr("stroke-width", 2);
    svg.append("text").attr("class", "lbl").attr("x", m.l + 16).attr("y", ky).text("Normal springs");
    svg.append("circle").attr("cx", m.l + 140).attr("cy", ky - 4).attr("r", 5).attr("fill", "var(--river-deep)");
    svg.append("text").attr("class", "lbl").attr("x", m.l + 150).attr("y", ky).text("Post-drought springs");
  };
  responsive(el, draw);
}

// ------------------------------------------------------------ how it works
export function howChart(el: HTMLElement, hw: How, drought: number) {
  const draw = () => {
    const narrow = el.clientWidth < 600;
    const { svg, w, h } = frame(el, narrow ? 300 : 340);
    const m = { t: 62, r: 16, b: 30, l: 50 };
    const ds = dates(hw.start, hw.q.length);
    const x = d3.scaleTime().domain([ds[0], ds[ds.length - 1]]).range([m.l, w - m.r]);
    const vals = hw.q.filter((v): v is number => v != null && v > 0);
    const y = d3.scaleLog().domain([d3.min(vals)! * 0.8, d3.max(vals)! * 1.3]).range([h - m.b, m.t]);
    const mar1 = parseDay(`${ds[ds.length - 1].getFullYear()}-03-01`);
    const yr0 = addDays(mar1, -365);
    // step 1: the 12-month window (drawn under the grid)
    svg.append("rect").attr("x", x(yr0)).attr("width", x(mar1) - x(yr0)).attr("y", m.t).attr("height", h - m.b - m.t).attr("fill", "var(--wash)");
    const [lo, hi] = y.domain();
    const tv = [10, 30, 100, 300, 1000, 3000, 10000, 30000].filter((v) => v >= lo && v <= hi);
    svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).tickValues(tv).tickFormat((d) => d3.format(",")(d as number)).tickSize(-(w - m.l - m.r)))
      .call((g) => g.select(".domain").remove());
    svg.append("text").attr("class", "lbl lbl--muted").attr("x", m.l).attr("y", m.t - 30).text("Discharge, cubic feet per second (log scale)");
    svg.append("g").call(monthAxis(x, h - m.b, narrow ? 300 : w));
    const mk = (n: number, cx: number, cy: number, label: string, anchor: "start" | "end" = "start", alert = false) => {
      const g = svg.append("g").attr("transform", `translate(${cx},${cy})`);
      g.append("circle").attr("r", 9).attr("fill", alert ? "var(--alert)" : "var(--ink)").attr("stroke", "#fff").attr("stroke-width", 2);
      g.append("text").attr("class", "lbl").attr("text-anchor", "middle").attr("y", 4).style("fill", "#fff").style("font-weight", 700).text(String(n));
      if (label) halo(g as unknown as d3.Selection<SVGGElement, unknown, null, undefined>, alert ? "lbl lbl--alert" : "lbl", anchor === "end" ? -14 : 14, 4, label, anchor);
    };
    const pts = ds.map((d, i) => ({ d, q: hw.q[i], q7: hw.q7[i] }));
    svg.append("path").attr("fill", "none").attr("stroke", "var(--river-soft)").attr("stroke-width", 1)
      .attr("d", d3.line<typeof pts[0]>().defined((p) => p.q != null && p.q > 0).x((p) => x(p.d)).y((p) => y(p.q!))(pts));
    svg.append("path").attr("fill", "none").attr("stroke", "var(--river)").attr("stroke-width", 2)
      .attr("d", d3.line<typeof pts[0]>().defined((p) => p.q7 != null && p.q7 > 0).x((p) => x(p.d)).y((p) => y(p.q7!))(pts));
    // step 2: past-years median
    const md = dates(hw.median_start, hw.median.length).map((d, i) => ({ d, v: hw.median[i] }));
    svg.append("path").attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1.25).attr("stroke-dasharray", "4 3")
      .attr("d", d3.line<typeof md[0]>().defined((p) => p.v != null && p.v > 0).x((p) => x(p.d)).y((p) => y(p.v!))(md));
    const lastMd = md.filter((p) => p.v != null).at(-1)!;
    if (!narrow) halo(svg, "lbl", x(lastMd.d) - 4, y(lastMd.v!) + 16, "past-years median", "end");

    const al = parseDay(hw.alert);
    svg.append("line").attr("x1", x(al)).attr("x2", x(al)).attr("y1", m.t).attr("y2", h - m.b).attr("stroke", "var(--alert)").attr("stroke-width", 2);
    // step 4: sample dates
    svg.append("g").selectAll("line").data(hw.samples).join("line")
      .attr("x1", (d) => x(parseDay(d))).attr("x2", (d) => x(parseDay(d))).attr("y1", h - m.b - 12).attr("y2", h - m.b)
      .attr("stroke", "var(--ink)").attr("stroke-width", 2);
    svg.append("g").selectAll("circle").data(hw.samples).join("circle")
      .attr("cx", (d) => x(parseDay(d))).attr("cy", h - m.b - 16).attr("r", 3.5).attr("fill", "var(--ground)").attr("stroke", "var(--ink)").attr("stroke-width", 1.5);

    const lastS = parseDay(hw.samples.at(-1) ?? hw.alert);
    const mid = addDays(yr0, 182);
    mk(1, narrow ? m.l + 10 : x(mid), m.t - 12, narrow ? `12-month flow: ${ord(Math.round(hw.antecedent_pct))} pct.` : `Last 12 months of flow: ${ord(Math.round(hw.antecedent_pct))} percentile, below the ${ord(drought)}`);
    const mdPt = md.find((p) => p.v != null && p.d >= addDays(al, 20)) ?? lastMd;
    mk(2, x(mdPt.d), y(mdPt.v!) - 18, "", "end");
    mk(3, x(al), m.t - 12, narrow ? "" : `Alert, ${fmtDay.format(al)}`, "start", true);
    mk(4, x(lastS) + 14, h - m.b - 16, "", "start");
  };
  responsive(el, draw);
}

// ----------------------------------------------------------- lead histogram
export function leadChart(el: HTMLElement, lead: number[]) {
  const draw = () => {
    const { svg, w, h } = frame(el, 190);
    const m = { t: 18, r: 12, b: 34, l: 34 };
    const bins = d3.bin().domain([-7, 63]).thresholds(d3.range(-7, 63, 7))(lead);
    const x = d3.scaleLinear().domain([-7, 63]).range([m.l, w - m.r]);
    const y = d3.scaleLinear().domain([0, d3.max(bins, (b) => b.length)!]).nice().range([h - m.b, m.t]);
    svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(4).tickSize(-(w - m.l - m.r))).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`)
      .call(d3.axisBottom(x).tickValues(d3.range(0, 63, 14)).tickFormat((d) => `${d}`).tickSizeOuter(0));
    svg.append("text").attr("class", "lbl lbl--muted").attr("x", w - m.r).attr("y", h - 2).attr("text-anchor", "end").text("days from alert to surge start");
    svg.append("g").selectAll("rect").data(bins).join("rect")
      .attr("x", (b) => x(b.x0!) + 1).attr("width", (b) => Math.max(0, x(b.x1!) - x(b.x0!) - 2))
      .attr("y", (b) => y(b.length)).attr("height", (b) => y(0) - y(b.length))
      .attr("fill", (b) => (b.x1! <= 0 ? "var(--river-soft)" : "var(--river)"));
    const med = d3.median(lead)!;
    svg.append("line").attr("x1", x(med)).attr("x2", x(med)).attr("y1", m.t - 4).attr("y2", h - m.b).attr("stroke", "var(--ink)").attr("stroke-dasharray", "3 3");
    halo(svg, "lbl", x(med) + 5, m.t + 6, `median ${Math.round(med)} days`);
  };
  responsive(el, draw);
}

// ----------------------------------------------------- tables
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ablationTable(el: HTMLTableElement, ms: Metric[]) {
  const rows: [string, Metric | undefined, boolean][] = [
    ["Both inputs (Flush Alert)", ms.find((d) => d.split === "time" && d.subset.startsWith("test (")), true],
    ["Rise only", ms.find((d) => d.subset.includes("flow rise only")), false],
    ["Drought memory only (alert Mar 1)", ms.find((d) => d.subset.includes("drought gate only")), false],
  ];
  el.insertAdjacentHTML("beforeend", `<thead><tr><th scope="col">Rule</th><th scope="col" class="col-opt">Alerts</th><th scope="col">Surges caught</th><th scope="col" class="col-opt">Missed</th><th scope="col">False alarms</th><th scope="col">Critical success index</th></tr></thead>`);
  const tb = document.createElement("tbody");
  rows.forEach(([name, r, key]) => {
    if (!r) return;
    tb.insertAdjacentHTML("beforeend", `<tr${key ? ' class="is-key"' : ""}><th scope="row">${name}</th><td class="col-opt">${r.alerts}</td><td>${r.hits} of ${r.events} (${pct(r.pod)})</td><td class="col-opt">${r.misses}</td><td>${r.false_alarms}</td><td>${r.csi.toFixed(2)}</td></tr>`);
  });
  el.append(tb);
}

export function sensTable(el: HTMLTableElement, rows: Evidence["sensitivity"], current: number) {
  el.insertAdjacentHTML("beforeend", `<thead><tr><th scope="col">Drought cutoff</th><th scope="col" class="col-opt">Post-drought springs</th><th scope="col">Surges caught</th><th scope="col">False alarm ratio</th><th scope="col">Median warning</th></tr></thead>`);
  const tb = document.createElement("tbody");
  rows.filter((r) => r.subset === "test years").forEach((r) => {
    tb.insertAdjacentHTML("beforeend", `<tr${r.drought_threshold_pct === current ? ' class="is-key"' : ""}><th scope="row">Below ${r.drought_threshold_pct}th pct.</th><td class="col-opt">${r.post_drought_springs}</td><td>${pct(r.pod)}</td><td>${pct(r.far)}</td><td>${Math.round(r.median_lead_to_surge_d)} days</td></tr>`);
  });
  el.append(tb);
}

// ----------------------------------------------- error vs extra samples
const SCHED: Record<string, { label: string; color: string; width: number; dash?: string }> = {
  "on-rises": { label: "Timed by flow", color: "var(--river-deep)", width: 3 },
  triggered: { label: "30-day spread", color: "var(--river-soft)", width: 1.75 },
  random: { label: "Random dates", color: "var(--ink-3)", width: 1.75, dash: "2 3" },
  fixed: { label: "Evenly spaced", color: "var(--ink-2)", width: 1.75, dash: "6 3" },
};

export function kChart(el: HTMLElement, ev: Evidence, s: Summary, root: HTMLElement) {
  const state = { type: "post-drought", method: "reg" };
  const order = [s.chosen_design, s.chosen_design === "on-rises" ? "triggered" : "on-rises", "random", "fixed"];
  const draw = () => {
    const narrow = el.clientWidth < 600;
    const { svg, w, h } = frame(el, narrow ? 390 : 320);
    const m = { t: 22, r: narrow ? 12 : 170, b: narrow ? 104 : 34, l: 40 };
    const sub = ev.curves.filter((c) => c.spring_type === state.type && c.method === state.method);
    const base = sub.find((c) => c.schedule === "monthly only")!;
    const lines = order.map((sch) => ({
      sch, pts: [{ k: 0, v: base.median_abs_err_pct }, ...sub.filter((c) => c.schedule === sch).sort((a, b) => a.k - b.k).map((c) => ({ k: c.k, v: c.median_abs_err_pct }))],
    })).filter((l) => l.pts.length > 1);
    const all = lines.flatMap((l) => l.pts.map((p) => p.v));
    const x = d3.scaleLinear().domain([0, 6]).range([m.l, w - m.r]);
    const y = d3.scaleLinear().domain([0, d3.max(all)! * 1.12]).nice().range([h - m.b, m.t]);
    svg.append("g").attr("class", "axis axis--y").attr("transform", `translate(${m.l},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${d}%`).tickSize(-(w - m.l - m.r))).call((g) => g.select(".domain").remove());
    svg.append("g").attr("class", "axis").attr("transform", `translate(0,${h - m.b})`).call(d3.axisBottom(x).ticks(6).tickSizeOuter(0));
    svg.append("text").attr("class", "lbl lbl--muted").attr("x", w - m.r).attr("y", h - m.b + 30).attr("text-anchor", "end").text("extra samples in spring");
    svg.append("text").attr("class", "lbl lbl--muted").attr("x", m.l).attr("y", 12).text("Median spring-load error");

    const line = d3.line<{ k: number; v: number }>().x((p) => x(p.k)).y((p) => y(p.v));
    const ends: { y: number; label: string; color: string; bold: boolean }[] = [];
    [...lines].reverse().forEach((l) => {
      const st = SCHED[l.sch];
      const p = svg.append("path").attr("fill", "none").attr("stroke", st.color).attr("stroke-width", st.width).attr("d", line(l.pts));
      if (st.dash) p.attr("stroke-dasharray", st.dash);
      svg.append("g").selectAll("circle").data(l.pts.slice(1)).join("circle").attr("cx", (d) => x(d.k)).attr("cy", (d) => y(d.v))
        .attr("r", l.sch === s.chosen_design ? 3.5 : 2.5).attr("fill", st.color);
      const e = l.pts.at(-1)!;
      ends.push({ y: y(e.v), label: `${st.label} ${e.v.toFixed(1)}%`, color: st.color === "var(--river-soft)" ? "var(--river)" : st.color, bold: l.sch === s.chosen_design });
    });
    svg.append("circle").attr("cx", x(0)).attr("cy", y(base.median_abs_err_pct)).attr("r", 4.5).attr("fill", "var(--ground)").attr("stroke", "var(--ink)").attr("stroke-width", 2);
    if (!narrow) halo(svg, "lbl", x(0) + 9, y(base.median_abs_err_pct) - 9, `monthly only ${base.median_abs_err_pct.toFixed(1)}%`);
    // the finding: gap between random and flow-timed at the largest k
    const lastOf = (sch: string) => lines.find((l) => l.sch === sch)?.pts.at(-1)?.v;
    const vc = lastOf(s.chosen_design), vr = lastOf("random");
    if (vc != null && vr != null && vr - vc > 1) {
      const bx = x(6) - 10;
      svg.append("path").attr("fill", "none").attr("stroke", "var(--ink)").attr("stroke-width", 1)
        .attr("d", `M${bx + 4},${y(vr)}H${bx}V${y(vc)}H${bx + 4}`);
      halo(svg, "lbl", x(6), y(vr) - 12, `${(vr - vc).toFixed(1)} points below random`, "end").style("font-weight", 700).style("fill", "var(--ink)");
    }

    // de-collide right-hand labels
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 15) ends[i].y = ends[i - 1].y + 15;
    if (narrow) {
      const kg = svg.append("g").attr("transform", `translate(${m.l},${h - m.b + 50})`);
      ends.sort((a, b) => Number(b.bold) - Number(a.bold));
      ends.forEach((e, i) => {
        const t = kg.append("text").attr("class", "lbl").attr("y", i * 15).text(e.label);
        t.style("fill", e.color).style("font-weight", e.bold ? 700 : 500);
      });
    } else {
      ends.forEach((e) => {
        svg.append("text").attr("class", "lbl").attr("x", w - m.r + 8).attr("y", e.y + 4).text(e.label)
          .style("fill", e.color).style("font-weight", e.bold ? 700 : 500);
      });
    }
  };
  responsive(el, draw);
  root.querySelectorAll<HTMLElement>(".seg").forEach((seg) => radioGroup(seg, (btn) => {
    if (btn.dataset.type) state.type = btn.dataset.type;
    if (btn.dataset.method) state.method = btn.dataset.method;
    draw();
  }));
}

/** ARIA radio group made of buttons: click, arrow keys, roving tabindex. */
export function radioGroup(group: HTMLElement, onChange: (b: HTMLButtonElement) => void) {
  const btns = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  const set = (b: HTMLButtonElement, focus = false) => {
    btns.forEach((o) => { o.setAttribute("aria-checked", String(o === b)); o.tabIndex = o === b ? 0 : -1; });
    if (focus) b.focus();
    onChange(b);
  };
  btns.forEach((b) => {
    b.tabIndex = b.getAttribute("aria-checked") === "true" ? 0 : -1;
    b.addEventListener("click", () => set(b));
    b.addEventListener("keydown", (e) => {
      const i = btns.indexOf(b);
      const n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!n) return;
      e.preventDefault();
      set(btns[(i + n + btns.length) % btns.length], true);
    });
  });
  return (b: HTMLButtonElement) => set(b);
}
