import type { CatalogMetric, FreddyProfile, MetricSample } from "./types";

export function extractToolText(data: unknown): string {
  if (data == null) return "";
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  if (Array.isArray(data)) {
    return data.map(extractToolText).filter(Boolean).join("\n");
  }
  if (typeof data === "object") {
    const o = data as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.content)) return extractToolText(o.content);
    if (o.data != null && o.data !== data) return extractToolText(o.data);
    try {
      return JSON.stringify(data);
    } catch {
      return "";
    }
  }
  return "";
}

export function parseProfile(text: string): FreddyProfile {
  const name = matchLine(text, /^Name:\s*(.+)$/im);
  const plan = matchLine(text, /^Plan:\s*(.+)$/im);
  const sourcesLine = matchLine(text, /^Connected sources:\s*(.+)$/im);
  const history = matchLine(text, /^History available:\s*(\d+)/im);
  const provider = matchLine(text, /^Queryable provider:\s*([A-Z0-9_]+)/im);

  const lastSynced = sourcesLine?.match(
    /last synced:\s*([0-9T:\-Z.]+)/i,
  )?.[1] ?? null;

  const sources = sourcesLine
    ? sourcesLine
        .replace(/\s*\(last synced:[^)]+\)/gi, "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  return {
    name: !name || name.toLowerCase() === "not set" ? null : name,
    plan,
    sources,
    lastSynced,
    historyDays: history ? Number(history) : null,
    provider,
  };
}

export function parseCatalog(text: string): CatalogMetric[] {
  const rows: CatalogMetric[] = [];
  const re =
    /^([a-z0-9_]+):\s+(\d+)\s+records\s+\(([^)]*)\)(.*)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const meta = m[3] ?? "";
    const range = meta.match(/(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/);
    const unit = meta.match(/unit:\s*([^,]+)/i)?.[1]?.trim() ?? null;
    const devices = extractDevices(meta);
    rows.push({
      name: m[1]!,
      records: Number(m[2]),
      from: range?.[1] ?? null,
      to: range?.[2] ?? null,
      unit,
      devices,
      raw: /raw available|raw-only/i.test(m[4] ?? "") || /_raw$/.test(m[1]!),
    });
  }
  return rows;
}

export function parseSamples(text: string): MetricSample[] {
  const samples: MetricSample[] = [];
  let currentDate: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const dateHeader = line.match(/^(\d{4}-\d{2}-\d{2})(?:T[\d:.]+Z?)?:?$/);
    if (dateHeader) {
      currentDate = dateHeader[1]!;
      continue;
    }

    const row = line.match(
      /^([a-z0-9_]+):\s+(-?\d+(?:\.\d+)?)\s*([a-zA-Z%/()*,]+)?(?:\s+@\s+\S+\s+\S+)?(?:\s+\(([^)]+)\))?/,
    );
    if (!row || !currentDate) continue;

    const origin = row[4] ?? "";
    const parts = origin.split("·").map((p) => p.trim());
    samples.push({
      date: currentDate,
      metric: row[1]!,
      value: Number(row[2]),
      unit: row[3] && row[3] !== "count" ? row[3] : row[3] ?? null,
      source: parts[0] || null,
      device: parts[1] || null,
    });
  }
  return samples;
}

const OVERLAP = new Set([
  "steps",
  "distance_walk_run",
  "flights_climbed",
]);

export function dailySeries(
  samples: MetricSample[],
  metric: string,
): { date: string; value: number }[] {
  const byDate = new Map<string, number[]>();
  for (const s of samples) {
    if (s.metric !== metric) continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s.value);
    byDate.set(s.date, list);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      value: OVERLAP.has(metric)
        ? Math.max(...values)
        : values.reduce((a, b) => a + b, 0),
    }));
}

function matchLine(text: string, re: RegExp): string | null {
  return text.match(re)?.[1]?.trim() ?? null;
}

function extractDevices(meta: string): string[] {
  const quoted = [...meta.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  if (quoted.length) return quoted;
  const single = meta.match(/device:\s*"?([^",]+)"?/i)?.[1];
  return single ? [single.trim()] : [];
}
