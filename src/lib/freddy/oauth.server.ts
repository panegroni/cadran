import { FREDDY_CLIENT_NAME, FREDDY_ORIGIN, FREDDY_SCOPE } from "./constants";

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Freddy OAuth réponse illisible (HTTP ${res.status})`);
  }
}

export async function registerClient(): Promise<{
  clientId: string;
  clientSecret: string | null;
}> {
  const res = await fetch(`${FREDDY_ORIGIN}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      client_name: FREDDY_CLIENT_NAME,
      redirect_uris: ["http://localhost"],
    }),
  });
  const json = await readJson(res);
  const clientId = typeof json.client_id === "string" ? json.client_id : "";
  if (!res.ok || !clientId) {
    throw new Error(
      typeof json.error_description === "string"
        ? json.error_description
        : "Enregistrement OAuth Freddy impossible.",
    );
  }
  return {
    clientId,
    clientSecret:
      typeof json.client_secret === "string" ? json.client_secret : null,
  };
}

export async function startDeviceAuth(clientId: string): Promise<{
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}> {
  const body = new URLSearchParams({
    client_id: clientId,
    scope: FREDDY_SCOPE,
  });
  const res = await fetch(`${FREDDY_ORIGIN}/oauth/device_authorization`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  const json = await readJson(res);
  const deviceCode =
    typeof json.device_code === "string" ? json.device_code : "";
  const userCode = typeof json.user_code === "string" ? json.user_code : "";
  const verificationUri =
    typeof json.verification_uri === "string"
      ? json.verification_uri
      : `${FREDDY_ORIGIN}/device`;
  const verificationUriComplete =
    typeof json.verification_uri_complete === "string"
      ? json.verification_uri_complete
      : `${verificationUri}?code=${encodeURIComponent(userCode)}`;
  if (!res.ok || !deviceCode || !userCode) {
    throw new Error(
      typeof json.error_description === "string"
        ? json.error_description
        : "Freddy n’a pas démarré l’autorisation.",
    );
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 600,
    interval: typeof json.interval === "number" ? json.interval : 5,
  };
}

function tokenForm(params: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams(params);
  return body;
}

export async function pollDeviceToken(input: {
  clientId: string;
  clientSecret: string | null;
  deviceCode: string;
}): Promise<
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ok"; accessToken: string; refreshToken: string | null }
> {
  const params: Record<string, string> = {
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: input.clientId,
    device_code: input.deviceCode,
  };
  if (input.clientSecret) params.client_secret = input.clientSecret;

  const res = await fetch(`${FREDDY_ORIGIN}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: tokenForm(params),
  });
  const json = (await readJson(res)) as TokenJson;
  const error = json.error ?? "";

  if (error === "authorization_pending") return { status: "pending" };
  if (error === "slow_down") return { status: "slow_down" };
  if (error === "expired_token") return { status: "expired" };
  if (error === "access_denied") return { status: "denied" };
  if (json.access_token) {
    return {
      status: "ok",
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
    };
  }
  return {
    status: "error",
    message: json.error_description ?? error ?? `HTTP ${res.status}`,
  };
}

export async function refreshAccessToken(input: {
  clientId: string;
  clientSecret: string | null;
  refreshToken: string;
}): Promise<{ accessToken: string; refreshToken: string | null } | null> {
  const params: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  };
  if (input.clientSecret) params.client_secret = input.clientSecret;
  const res = await fetch(`${FREDDY_ORIGIN}/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: tokenForm(params),
  });
  const json = (await readJson(res)) as TokenJson;
  if (!json.access_token) return null;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? input.refreshToken,
  };
}

export async function revokeToken(
  token: string,
  clientId: string | null,
  clientSecret: string | null,
) {
  const params: Record<string, string> = { token };
  if (clientId) params.client_id = clientId;
  if (clientSecret) params.client_secret = clientSecret;
  await fetch(`${FREDDY_ORIGIN}/oauth/revoke`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: tokenForm(params),
  }).catch(() => undefined);
}
