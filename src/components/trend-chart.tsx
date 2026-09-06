import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dailySeries } from "@/lib/freddy/parse";
import { formatDay, formatValue } from "@/lib/freddy/format";
import type { MetricSample } from "@/lib/freddy/types";

type Props = {
  samples: MetricSample[];
  metric: string;
};

export function TrendChart({ samples, metric }: Props) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const data = dailySeries(samples, metric).map((p) => ({
    ...p,
    label: formatDay(p.date),
  }));

  if (!ready) {
    return <div className="h-48 w-full rounded-lg bg-elevated" />;
  }

  if (data.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">
        Pas assez de points pour tracer la courbe.
      </p>
    );
  }

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="fillAccent" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="label"
            tick={{ fill: "var(--color-subtle)", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide domain={["auto", "auto"]} />
          <Tooltip
            contentStyle={{
              background: "var(--color-elevated)",
              border: "1px solid var(--color-border)",
              borderRadius: 12,
              color: "var(--color-fg)",
              fontSize: 12,
            }}
            formatter={(value) => [
              formatValue(metric, Number(value ?? 0)),
              "",
            ]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ""}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-accent)"
            strokeWidth={2}
            fill="url(#fillAccent)"
            dot={false}
            activeDot={{ r: 3, fill: "var(--color-fg)" }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
