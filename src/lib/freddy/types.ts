export type FreddyMode = "live" | "login" | "error";

export type FreddyProfile = {
  name: string | null;
  plan: string | null;
  sources: string[];
  lastSynced: string | null;
  historyDays: number | null;
  provider: string | null;
};

export type CatalogMetric = {
  name: string;
  records: number;
  from: string | null;
  to: string | null;
  unit: string | null;
  devices: string[];
  raw: boolean;
};

export type MetricSample = {
  date: string;
  metric: string;
  value: number;
  unit: string | null;
  source: string | null;
  device: string | null;
};

export type DailyPoint = {
  date: string;
  value: number;
};

export type HeroStat = {
  key: string;
  label: string;
  value: string;
  delta: string | null;
  hint: string;
};

export type McpCallLog = {
  tool: string;
  ok: boolean;
  detail?: string;
};

export type DashboardPayload = {
  mode: FreddyMode;
  endpoint: string;
  message?: string;
  profile: FreddyProfile | null;
  catalog: CatalogMetric[];
  samples: MetricSample[];
  calls: McpCallLog[];
  fetchedAt: string;
};

export type DeviceStartPayload = {
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
};

export type DevicePollPayload = {
  status: "pending" | "slow_down" | "connected" | "expired" | "denied" | "error";
  message?: string;
};
