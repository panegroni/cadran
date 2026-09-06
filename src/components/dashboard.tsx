import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ExternalLink,
  Footprints,
  HeartPulse,
  Moon,
  RefreshCw,
  Unplug,
  Watch,
} from "lucide-react";
import {
  disconnectFreddy,
  loadDashboard,
  pollFreddyConnect,
  startFreddyConnect,
} from "@/lib/freddy/server";
import { FREDDY_MCP_URL } from "@/lib/freddy/constants";
import { dailySeries } from "@/lib/freddy/parse";
import {
  buildHero,
  formatDay,
  formatValue,
  formatWhen,
  metricLabel,
  sleepHours,
} from "@/lib/freddy/format";
import type {
  DashboardPayload,
  DeviceStartPayload,
  MetricSample,
} from "@/lib/freddy/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendChart } from "@/components/trend-chart";
import { cn } from "@/lib/utils";

const SECONDARY = [
  "distance_walk_run",
  "exercise_time",
  "flights_climbed",
  "stand_time",
  "mindful_seconds",
  "heart_rate_avg",
  "walking_speed_avg",
] as const;

export function Dashboard() {
  const query = useQuery({
    queryKey: ["freddy-dashboard"],
    queryFn: () => loadDashboard(),
    staleTime: 60_000,
    retry: false,
  });

  if (query.isError && !query.data) {
    return (
      <Gate
        title="Lecture impossible"
        body={query.error instanceof Error ? query.error.message : "Erreur inattendue."}
      />
    );
  }

  if (query.isPending && !query.data) return <LoadingState />;

  const data = query.data;
  if (!data) return <LoadingState />;

  if (data.mode === "login") {
    return (
      <ConnectGate
        message={data.message}
        onConnected={() => query.refetch()}
      />
    );
  }

  if (data.mode === "error") {
    return (
      <Gate
        title="Freddy n’a pas répondu"
        body={data.message ?? "Réessaie dans un instant."}
        action={
          <Button variant="outline" onClick={() => query.refetch()}>
            Réessayer
          </Button>
        }
      />
    );
  }

  return (
    <Loaded
      data={data}
      refreshing={query.isFetching}
      onRefresh={() => query.refetch()}
      onDisconnect={async () => {
        await disconnectFreddy();
        await query.refetch();
      }}
    />
  );
}

function ConnectGate({
  message,
  onConnected,
}: {
  message?: string;
  onConnected: () => void;
}) {
  const [pending, setPending] = useState<DeviceStartPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(message ?? null);
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelRef.current = true;
    };
  }, []);

  async function connect() {
    cancelRef.current = false;
    setBusy(true);
    setError(null);
    try {
      const auth = await startFreddyConnect();
      if (cancelRef.current) return;
      setPending(auth);
      const deadline = Date.now() + auth.expiresIn * 1000;
      let wait = Math.max(auth.interval, 5) * 1000;
      while (!cancelRef.current && Date.now() < deadline) {
        await sleep(wait);
        if (cancelRef.current) return;
        const poll = await pollFreddyConnect();
        if (poll.status === "connected") {
          setPending(null);
          onConnected();
          return;
        }
        if (poll.status === "slow_down") {
          wait = Math.min(wait + 2000, 15_000);
          continue;
        }
        if (poll.status === "pending") continue;
        setPending(null);
        setError(poll.message ?? "Connexion interrompue.");
        setBusy(false);
        return;
      }
      if (!cancelRef.current) {
        setPending(null);
        setError("Le code a expiré. Relance la connexion.");
        setBusy(false);
      }
    } catch (err) {
      setPending(null);
      setError(err instanceof Error ? err.message : "Connexion impossible.");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-start justify-center gap-6 px-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
        Cadran
      </p>
      <h1 className="font-display text-4xl font-medium tracking-tight text-balance">
        Tes métriques, lues chez Freddy
      </h1>
      <p className="text-pretty text-sm leading-relaxed text-muted">
        Cette app appelle {FREDDY_MCP_URL} depuis son serveur. Grok n’est pas
        dans le chemin — ni pour l’auth, ni pour les données.
      </p>
      <EndpointChip />
      {pending ? (
        <div className="flex w-full flex-col gap-4 rounded-xl border border-border bg-surface px-5 py-5">
          <p className="text-xs font-medium uppercase tracking-wider text-subtle">
            Code Freddy
          </p>
          <p className="font-display text-3xl font-medium tracking-[0.18em] tabular-nums">
            {pending.userCode}
          </p>
          <p className="text-sm text-muted">
            Approuve l’accès « Read your health data » dans l’onglet Freddy.
            Cadran attend la confirmation, puis lit le MCP.
          </p>
          <Button variant="outline" asChild>
            <a
              href={pending.verificationUriComplete}
              target="_blank"
              rel="noopener noreferrer"
            >
              Ouvrir Freddy
              <ExternalLink className="size-3.5" />
            </a>
          </Button>
        </div>
      ) : (
        <Button onClick={connect} disabled={busy}>
          {busy ? "Connexion…" : "Connecter Freddy"}
        </Button>
      )}
      {error ? <p className="text-sm text-warn">{error}</p> : null}
    </div>
  );
}

function Loaded({
  data,
  refreshing,
  onRefresh,
  onDisconnect,
}: {
  data: DashboardPayload;
  refreshing: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const [chartMetric, setChartMetric] = useState("steps");
  const hero = useMemo(() => buildHero(data.samples), [data.samples]);
  const sleepDates = useMemo(() => sleepNights(data.samples), [data.samples]);
  const source = data.profile?.sources[0] ?? "Freddy";
  const device = primaryDevice(data.samples);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
            Freddy MCP
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-balance sm:text-5xl">
            Cadran
          </h1>
          <p className="max-w-md text-pretty text-sm leading-relaxed text-muted">
            Sept jours d’Apple Health, demandés en JSON-RPC sur le serveur MCP
            Freddy — pas via Grok.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            <Watch className="mr-1.5 size-3.5" />
            {source}
          </Badge>
          {data.profile?.plan ? <Badge>{data.profile.plan}</Badge> : null}
          <Badge>Live</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Actualiser"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />
            Actualiser
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDisconnect}
            aria-label="Déconnecter Freddy"
          >
            <Unplug className="size-3.5" />
            Couper
          </Button>
        </div>
      </header>

      <EndpointChip />

      {data.message ? (
        <p className="rounded-lg border border-border bg-elevated px-4 py-3 text-sm text-muted">
          {data.message}
        </p>
      ) : null}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {hero.map((stat) => (
          <button
            key={stat.key}
            type="button"
            onClick={() => setChartMetric(stat.key)}
            className={cn(
              "rounded-xl border bg-surface px-4 py-4 text-left transition-colors duration-150",
              chartMetric === stat.key
                ? "border-accent/40"
                : "border-border hover:border-border-strong",
            )}
          >
            <p className="text-xs font-medium uppercase tracking-wider text-subtle">
              {stat.label}
            </p>
            <p className="mt-2 font-display text-2xl font-medium tabular-nums tracking-tight sm:text-3xl">
              {stat.value}
            </p>
            <p className="mt-1 text-xs text-muted">
              {stat.delta ? (
                <span className="tabular-nums">{stat.delta} vs veille</span>
              ) : (
                stat.hint
              )}
            </p>
          </button>
        ))}
      </section>

      <Card className="rounded-xl">
        <CardHeader className="flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>{metricLabel(chartMetric)}</CardTitle>
            <CardDescription>Série quotidienne, 7 jours</CardDescription>
          </div>
          <Activity className="size-4 text-subtle" />
        </CardHeader>
        <CardContent>
          <TrendChart samples={data.samples} metric={chartMetric} />
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SECONDARY.map((key) => {
          const series = dailySeries(data.samples, key);
          const last = series.at(-1);
          return (
            <button
              key={key}
              type="button"
              onClick={() => setChartMetric(key)}
              className="rounded-xl border border-border bg-surface px-5 py-4 text-left transition-colors duration-150 hover:border-border-strong"
            >
              <p className="text-xs font-medium uppercase tracking-wider text-subtle">
                {metricLabel(key)}
              </p>
              <p className="mt-2 font-display text-xl font-medium tabular-nums">
                {last ? formatValue(key, last.value) : "—"}
              </p>
              <MiniBars series={series} />
            </button>
          );
        })}
      </section>

      {sleepDates.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Moon className="size-4 text-subtle" />
              Sommeil
            </CardTitle>
            <CardDescription>Nuits enregistrées par la Watch</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {sleepDates.map((d) => {
              const hours = sleepHours(data.samples, d);
              return (
                <div
                  key={d}
                  className="flex items-center justify-between gap-3 rounded-lg bg-elevated px-4 py-3"
                >
                  <span className="text-sm text-muted">{formatDay(d)}</span>
                  <span className="tabular-nums text-sm font-medium">
                    {hours != null
                      ? `${hours.toFixed(1).replace(".", ",")} h`
                      : "—"}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Separator />

      <footer className="flex flex-col gap-2 text-xs text-subtle">
        <p className="flex items-center gap-2">
          <HeartPulse className="size-3.5" />
          {device ? `Source appareil · ${device}` : "Apple Health via Freddy MCP"}
        </p>
        <p>
          Synchro{" "}
          {formatWhen(data.profile?.lastSynced) ??
            formatWhen(data.fetchedAt) ??
            "—"}
          {data.profile?.historyDays
            ? ` · historique ${data.profile.historyDays} j`
            : null}
        </p>
        <p className="flex items-center gap-2">
          <Footprints className="size-3.5" />
          {data.catalog.length
            ? `${data.catalog.length} métriques cataloguées`
            : "Catalogue chargé avec les séries"}
        </p>
        <p>
          Appels MCP{" "}
          {data.calls
            .map((c) => `${c.tool}${c.ok ? "" : " ×"}`)
            .join(" · ") || "—"}
        </p>
      </footer>
    </div>
  );
}

function EndpointChip() {
  return (
    <a
      href={FREDDY_MCP_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1.5 font-mono text-[11px] text-muted hover:border-border-strong hover:text-fg"
    >
      {FREDDY_MCP_URL.replace("https://", "")}
      <ExternalLink className="size-3 shrink-0" />
    </a>
  );
}

function MiniBars({ series }: { series: { date: string; value: number }[] }) {
  const max = Math.max(...series.map((s) => s.value), 1);
  return (
    <div className="mt-3 flex h-8 items-end gap-1">
      {series.map((s) => (
        <div
          key={s.date}
          className="flex-1 rounded-sm bg-accent/35"
          style={{ height: `${Math.max(12, (s.value / max) * 100)}%` }}
          title={`${s.date}: ${s.value}`}
        />
      ))}
    </div>
  );
}

function sleepNights(samples: MetricSample[]): string[] {
  const dates = new Set<string>();
  for (const s of samples) {
    if (s.metric.startsWith("sleep_analysis_")) dates.add(s.date);
  }
  return [...dates].sort();
}

function primaryDevice(samples: MetricSample[]): string | null {
  const counts = new Map<string, number>();
  for (const s of samples) {
    if (!s.device) continue;
    counts.set(s.device, (counts.get(s.device) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [k, v] of counts) {
    if (v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

function LoadingState() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-16 pt-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
          Freddy MCP
        </p>
        <h1 className="font-display text-4xl font-medium tracking-tight sm:text-5xl">
          Cadran
        </h1>
        <p className="text-sm text-muted">
          Appel de {FREDDY_MCP_URL.replace("https://", "")}…
        </p>
      </header>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

function Gate({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-lg flex-col items-start justify-center gap-5 px-6">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-subtle">
        Cadran
      </p>
      <h1 className="font-display text-4xl font-medium tracking-tight text-balance">
        {title}
      </h1>
      <p className="text-pretty text-sm leading-relaxed text-muted">{body}</p>
      {action}
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
