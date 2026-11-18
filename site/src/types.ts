export interface Series {
  year: number;
  start: string;
  c: (number | null)[];
  q: (number | null)[];
  reg: (number | null)[];
  interp: (number | null)[];
  samples: [string, number][];
  antecedent_pct: number | null;
  post_drought: boolean;
  alert: string | null;
  rise: string | null;
  surge_threshold: number;
  surge_start: string | null;
  peak_date: string | null;
  peak_c7: number | null;
  valid_spring: boolean;
  true_load_kg?: number;
  est_reg_kg?: number;
  est_interp_kg?: number;
}

export interface SeasonInfo {
  post_drought: boolean;
  antecedent_pct: number | null;
  alert: string | null;
  rise: string | null;
  surge_start: string | null;
  peak_date: string | null;
  peak_c7: number | null;
  valid_spring: boolean;
  true_load_kg?: number;
  est_reg_kg?: number;
  est_interp_kg?: number;
}

export interface SensorSite {
  site: string;
  name: string;
  state: string;
  lon: number;
  lat: number;
  springs: number;
  seasons: Record<string, SeasonInfo>;
}

export interface Gauge {
  site: string;
  name: string;
  lon: number;
  lat: number;
  status: "OK" | "WATCH" | "ALERT" | "UNRANKED";
  pct: number | null;
  last: string;
  seasons: Record<string, [number, string | null]>;
}

export interface Summary {
  hero_site: string;
  hero_year: number;
  sensor_sites: number;
  gauges: number | null;
  gauges_mapped?: number | null;
  gauges_partial?: boolean;
  drought_pct: number;
  rise_pct: number;
  chosen_design: string;
  err: Record<string, number>;
  test: Record<string, number>;
  adaptive: Record<string, number | null>;
}

export interface Metric {
  split: string; subset: string; alerts: number; events: number; hits: number; misses: number;
  false_alarms: number; pod: number; far: number; csi: number; median_lead_to_surge_d: number;
}

export interface Evidence {
  box: { type: string; method: string; median: number; q25: number; q75: number; q10: number; q90: number; n_site_springs: number }[];
  load_summary: { spring_type: string; method: string; median_abs_err_pct: number; site_springs: number }[];
  metrics: Metric[];
  lead_to_surge: number[];
  lead_to_peak: number[];
  curves: { spring_type: string; method: string; schedule: string; k: number; median_abs_err_pct: number; site_springs: number }[];
  sensitivity: (Metric & { drought_threshold_pct: number; post_drought_springs: number })[];
}

export interface How {
  start: string; q: (number | null)[]; q7: (number | null)[]; median_start: string; median: (number | null)[];
  antecedent_pct: number; alert: string; samples: string[];
}
