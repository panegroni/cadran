import { createServerFn } from "@tanstack/react-start";
import { FREDDY_MCP_URL } from "./constants";
import { parseCatalog, parseProfile, parseSamples } from "./parse";
import type {
  DashboardPayload,
  DevicePollPayload,
  DeviceStartPayload,
  McpCallLog,
} from "./types";

const QUERY_METRICS = [
  "steps",
  "distance_walk_run",
  "active_energy",
  "exercise_time",
  "heart_rate_avg",
  "resting_heart_rate_avg",
  "hrv_sdnn_avg",
  "stand_time",
  "flights_climbed",
  "mindful_seconds",
  "walking_speed_avg",
  "body_mass",
  "sleep_analysis_core_seconds",
  "sleep_analysis_deep_seconds",
  "sleep_analysis_rem_seconds",
  "sleep_analysis_awake_seconds",
];

function emptyDashboard(
  mode: DashboardPayload["mode"],
  message?: string,
  calls: McpCallLog[] = [],
): DashboardPayload {
  return {
    mode,
    endpoint: FREDDY_MCP_URL,
    message,
    profile: null,
    catalog: [],
    samples: [],
    calls,
    fetchedAt: new Date().toISOString(),
  };
}

export const startFreddyConnect = createServerFn({ method: "POST" }).handler(
  async (): Promise<DeviceStartPayload> => {
    const { registerClient, startDeviceAuth } = await import("./oauth.server");
    const { writeClient, writeDeviceCode } = await import("./session.server");
    const client = await registerClient();
    writeClient(client.clientId, client.clientSecret);
    const device = await startDeviceAuth(client.clientId);
    writeDeviceCode(device.deviceCode, device.expiresIn);
    return {
      userCode: device.userCode,
      verificationUri: device.verificationUri,
      verificationUriComplete: device.verificationUriComplete,
      expiresIn: device.expiresIn,
      interval: device.interval,
    };
  },
);

export const pollFreddyConnect = createServerFn({ method: "POST" }).handler(
  async (): Promise<DevicePollPayload> => {
    const { pollDeviceToken } = await import("./oauth.server");
    const { readFreddySession, writeTokens, clearFreddySession } = await import(
      "./session.server"
    );
    const session = readFreddySession();
    if (!session.clientId || !session.deviceCode) {
      return {
        status: "error",
        message: "Aucune autorisation en cours. Relance la connexion.",
      };
    }
    const result = await pollDeviceToken({
      clientId: session.clientId,
      clientSecret: session.clientSecret,
      deviceCode: session.deviceCode,
    });
    if (result.status === "ok") {
      writeTokens(result.accessToken, result.refreshToken);
      return { status: "connected" };
    }
    if (result.status === "pending") {
      return { status: "pending" };
    }
    if (result.status === "slow_down") {
      return { status: "slow_down" };
    }
    if (result.status === "expired") {
      clearFreddySession();
      return { status: "expired", message: "Le code a expiré. Recommence." };
    }
    if (result.status === "denied") {
      clearFreddySession();
      return { status: "denied", message: "Autorisation refusée sur Freddy." };
    }
    return { status: "error", message: result.message };
  },
);

export const disconnectFreddy = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const { revokeToken } = await import("./oauth.server");
    const { readFreddySession, clearFreddySession } = await import(
      "./session.server"
    );
    const session = readFreddySession();
    const token = session.accessToken ?? session.refreshToken;
    if (token) {
      await revokeToken(token, session.clientId, session.clientSecret);
    }
    clearFreddySession();
    return { ok: true };
  },
);

export const loadDashboard = createServerFn({ method: "POST" }).handler(
  async (): Promise<DashboardPayload> => {
    const { FreddyMcp, McpHttpError } = await import("./mcp.server");
    const { refreshAccessToken } = await import("./oauth.server");
    const { readFreddySession, writeTokens, clearFreddySession } = await import(
      "./session.server"
    );

    const session = readFreddySession();
    let access = session.accessToken;

    const refresh = async () => {
      if (!session.refreshToken || !session.clientId) return null;
      const next = await refreshAccessToken({
        clientId: session.clientId,
        clientSecret: session.clientSecret,
        refreshToken: session.refreshToken,
      });
      if (!next) return null;
      writeTokens(next.accessToken, next.refreshToken);
      return next.accessToken;
    };

    if (!access) {
      access = await refresh();
    }
    if (!access) {
      return emptyDashboard("login");
    }

    const run = async (token: string) => {
      const mcp = new FreddyMcp(token);
      try {
        await mcp.initialize();
      } catch (error) {
        if (error instanceof McpHttpError && error.status === 401) throw error;
        // Some MCP servers accept tools/call without a prior initialize.
      }

      const calls: McpCallLog[] = [];
      const call = async (tool: string, args: Record<string, unknown>) => {
        try {
          const text = await mcp.callTool(tool, args);
          calls.push({ tool, ok: true });
          return text;
        } catch (error) {
          if (error instanceof McpHttpError) throw error;
          calls.push({
            tool,
            ok: false,
            detail: error instanceof Error ? error.message : String(error),
          });
          return "";
        }
      };

      const [profileText, listText, queryText] = await Promise.all([
        call("get_profile", {}),
        call("list_metrics", { provider: "apple-health" }),
        call("query_metrics", { metrics: QUERY_METRICS, days: 7 }),
      ]);

      if (!calls.some((c) => c.ok)) {
        const detail = calls.map((c) => c.detail).filter(Boolean).join(" · ");
        return emptyDashboard(
          "error",
          detail || "Freddy MCP n’a renvoyé aucune donnée.",
          calls,
        );
      }

      return {
        mode: "live" as const,
        endpoint: FREDDY_MCP_URL,
        profile: profileText ? parseProfile(profileText) : null,
        catalog: listText ? parseCatalog(listText) : [],
        samples: queryText ? parseSamples(queryText) : [],
        calls,
        fetchedAt: new Date().toISOString(),
        message: calls.some((c) => !c.ok)
          ? "Certaines lectures MCP ont échoué."
          : undefined,
      } satisfies DashboardPayload;
    };

    try {
      return await run(access);
    } catch (error) {
      if (error instanceof McpHttpError && error.status === 401) {
        const next = await refresh();
        if (next) {
          try {
            return await run(next);
          } catch {
            /* fall through */
          }
        }
        clearFreddySession();
        return emptyDashboard("login", "Session Freddy expirée. Reconnecte-toi.");
      }
      return emptyDashboard(
        "error",
        error instanceof Error ? error.message : "Appel MCP impossible.",
      );
    }
  },
);
