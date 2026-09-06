import { dailySeries } from "./parse";
import type { HeroStat, MetricSample } from "./types";

const LABELS: Record<string, string> = {
  steps: "Pas",
  active_energy: "Énergie",
  resting_heart_rate_avg: "FC repos",
  hrv_sdnn_avg: "HRV",
  distance_walk_run: "Distance",
  exercise_time: "Exercice",
  flights_climbed: "Étages",
  stand_time: "Debout",
  mindful_seconds: "Pleine conscience",
  heart_rate_avg: "FC moyenne",
  walking_speed_avg: "Marche",
  sleep_analysis_core_seconds: "Sommeil léger",
  sleep_analysis_deep_seconds: "Sommeil profond",
  sleep_analysis_rem_seconds: "REM",
  sleep_analysis_awake_seconds: "Éveil",
};

export function metricLabel(name: string): string {
  return LABELS[name] ?? name.replaceAll("_", " ");
}

export function formatValue(metric: string, value: number): string {
  switch (metric) {
    case "steps":
    case "flights_climbed":
      return Math.round(value).toLocaleString("fr-FR");
    case "active_energy":
      return `${Math.round(value)} kcal`;
    case "distance_walk_run":
      return value >= 1000
        ? `${(value / 1000).toFixed(1).replace(".", ",")} km`
        : `${Math.round(value)} m`;
    case "exercise_time":
    case "stand_time":
      return `${Math.round(value)} min`;
    case "mindful_seconds":
      return value >= 60
        ? `${Math.round(value / 60)} min`
        : `${Math.round(value)} s`;
    case "resting_heart_rate_avg":
    case "heart_rate_avg":
      return `${Math.round(value)} bpm`;
    case "hrv_sdnn_avg":
      return `${Math.round(value)} ms`;
    case "walking_speed_avg":
      return `${(value * 3.6).toFixed(1).replace(".", ",")} km/h`;
    default:
      if (metric.endsWith("_seconds")) {
        const h = value / 3600;
        return `${h.toFixed(1).replace(".", ",")} h`;
      }
      return Number.isInteger(value)
        ? value.toLocaleString("fr-FR")
        : value.toFixed(1).replace(".", ",");
  }
}

export function formatDay(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" });
}

export function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function latestValue(
  samples: MetricSample[],
  metric: string,
): { date: string; value: number } | null {
  const series = dailySeries(samples, metric);
  return series.at(-1) ?? null;
}

export function deltaVsPrev(
  samples: MetricSample[],
  metric: string,
): string | null {
  const series = dailySeries(samples, metric);
  if (series.length < 2) return null;
  const last = series.at(-1)!.value;
  const prev = series.at(-2)!.value;
  if (prev === 0) return null;
  const pct = ((last - prev) / prev) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${Math.round(pct)} %`;
}

export function buildHero(samples: MetricSample[]): HeroStat[] {
  const keys = [
    "steps",
    "active_energy",
    "resting_heart_rate_avg",
    "hrv_sdnn_avg",
  ] as const;
  const hints: Record<string, string> = {
    steps: "Maximum iPhone / Watch du jour",
    active_energy: "Calories actives",
    resting_heart_rate_avg: "Repos, Watch",
    hrv_sdnn_avg: "SDNN",
  };
  return keys.map((key) => {
    const latest = latestValue(samples, key);
    return {
      key,
      label: metricLabel(key),
      value: latest ? formatValue(key, latest.value) : "—",
      delta: deltaVsPrev(samples, key),
      hint: hints[key] ?? "",
    };
  });
}

export function sleepHours(samples: MetricSample[], date: string): number | null {
  const stages = [
    "sleep_analysis_core_seconds",
    "sleep_analysis_deep_seconds",
    "sleep_analysis_rem_seconds",
  ];
  let total = 0;
  let any = false;
  for (const metric of stages) {
    const v = samples.find((s) => s.metric === metric && s.date === date);
    if (v) {
      total += v.value;
      any = true;
    }
  }
  return any ? total / 3600 : null;
}
