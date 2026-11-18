import "@fontsource-variable/source-serif-4/opsz.css";
import "@fontsource-variable/public-sans/wght.css";
import "./styles.css";
import { ablationTable, compareChart, heroChart, howChart, kChart, leadChart, sensTable } from "./charts";
import { initReplay, initScaleMap } from "./replay";
import type { Evidence, Gauge, How, SensorSite, Series, Summary } from "./types";
import { bindNumbers, getJSON, reduceMotion } from "./util";

const REPO = "https://github.com/";
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function links(repo: string) {
  document.querySelectorAll<HTMLAnchorElement>("a[data-repo]").forEach((a) => {
    const path = a.dataset.repo;
    a.href = path ? `${repo}/blob/main/${path}` : repo;
  });
}

function reveals() {
  if (reduceMotion() || !("IntersectionObserver" in window)) return;
  const els = document.querySelectorAll<HTMLElement>(".section > h2, .section > .lede, .section .figure, .compare, .steps, .finding, .cols");
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
  }), { rootMargin: "0px 0px -8% 0px" });
  els.forEach((el) => {
    if (el.getBoundingClientRect().top < window.innerHeight) return; // already on screen: no flash
    el.classList.add("reveal");
    io.observe(el);
  });
}

function fail(where: string, err: unknown) {
  console.warn(`${where}:`, err);
}

// Reserve each chart's final height before data arrives, so drawing does not shift the page.
function reserve() {
  const set = (sel: string, h: (w: number) => number) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) el.style.minHeight = `${h(el.clientWidth)}px`;
  };
  set("#compare-chart", (w) => 34 + 2 * (w < 560 ? 84 : 56) + 24);
  set("#how-chart", (w) => (w < 600 ? 300 : 340));
  set("#lead-chart", () => 190);
  set("#k-chart", (w) => (w < 600 ? 390 : 320));
  set("#scale-map", (w) => Math.round(w * 0.62));
  set("#map", (w) => Math.round(w * 0.72));
}

async function main() {
  reserve();
  const repo = (document.documentElement.dataset.repo || REPO).replace(/\/$/, "");
  links(repo);
  const [summary, ev, sites] = await Promise.all([
    getJSON<Summary>("summary.json"), getJSON<Evidence>("evidence.json"), getJSON<SensorSite[]>("sites.json"),
  ]);
  bindNumbers(summary);
  const gauges = await getJSON<Gauge[]>("gauges.json").catch(() => null);

  getJSON<Series>(`series/${summary.hero_site}_${summary.hero_year}.json`).then((s) => heroChart($("#hero-chart"), s)).catch((e) => fail("hero", e));
  compareChart($("#compare-chart"), ev);
  getJSON<How>("how.json").then((h) => howChart($("#how-chart"), h, summary.drought_pct)).catch((e) => fail("how", e));
  leadChart($("#lead-chart"), ev.lead_to_surge);
  ablationTable($<HTMLTableElement>("#ablation-table"), ev.metrics);
  sensTable($<HTMLTableElement>("#sens-table"), ev.sensitivity, summary.drought_pct);
  kChart($("#k-chart"), ev, summary, $("#k-chart").closest(".finding")!);
  initReplay($("#replay"), sites, gauges, summary).catch((e) => fail("replay", e));
  initScaleMap($("#scale-map"), $("#scale-caption"), gauges, sites, summary).catch((e) => fail("scale", e));
}

main().catch((e) => fail("load", e));
