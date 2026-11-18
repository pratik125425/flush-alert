export const reduceMotion = (): boolean =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const base = import.meta.env.BASE_URL;

export async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${base}data/${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);
}

const nf = new Intl.NumberFormat("en-US");
const fmtLong = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });
export const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function fmt(v: unknown, f: string): string {
  if (v == null || (typeof v === "number" && !Number.isFinite(v))) return "n/a";
  if (f === "range" && Array.isArray(v)) return `${v[0]}–${v[1]}`;
  const n = Number(v);
  switch (f) {
    case "pct0": return `${Math.round(n)}%`;
    case "pct1": return `${n.toFixed(1)}%`;
    case "pctint": return `${Math.round(n)}%`;
    case "frac0": return `${Math.round(n * 100)}%`;
    case "days": return `${Math.round(n)} days`;
    case "int": return nf.format(Math.round(n));
    case "ord": return `${ord(Math.round(n))}`;
    case "date": return typeof v === "string" ? fmtLong.format(parseDay(v)) : String(v);
    default: return String(v);
  }
}

/** Fill every [data-k] element from the summary. Large figures count up once when seen. */
export function bindNumbers(summary: unknown): void {
  const els = document.querySelectorAll<HTMLElement>("[data-k]");
  const counters: HTMLElement[] = [];
  els.forEach((el) => {
    const v = get(summary, el.dataset.k!);
    const f = el.dataset.f || "";
    el.textContent = fmt(v, f);
    if (typeof v === "number" && (el.classList.contains("opening__figure") || el.parentElement?.classList.contains("bignum"))) {
      el.dataset.final = String(v);
      counters.push(el);
    }
  });
  if (reduceMotion()) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target as HTMLElement;
      const end = Number(el.dataset.final), f = el.dataset.f || "";
      const t0 = performance.now(), dur = 900;
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / dur);
        const eased = 1 - Math.pow(1 - p, 4);
        el.textContent = fmt(end * eased, f);
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = fmt(end, f);
      };
      requestAnimationFrame(step);
    });
  }, { threshold: 0.6 });
  counters.forEach((el) => io.observe(el));
}

export function onceVisible(el: Element, fn: () => void, threshold = 0.35): void {
  if (reduceMotion() || !("IntersectionObserver" in window)) { fn(); return; }
  const io = new IntersectionObserver((es) => {
    if (es.some((e) => e.isIntersecting)) { io.disconnect(); fn(); }
  }, { threshold });
  io.observe(el);
}

export const parseDay = (s: string) => new Date(`${s}T12:00:00`);
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);
export const fmtDate = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const fmtDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
