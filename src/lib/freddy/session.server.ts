import {
  deleteCookie,
  getCookie,
  setCookie,
} from "@tanstack/react-start/server";

const AT = "cadran_freddy_at";
const RT = "cadran_freddy_rt";
const CID = "cadran_freddy_cid";
const CS = "cadran_freddy_cs";
const DC = "cadran_freddy_dc";

function opts(maxAge: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

export type FreddySession = {
  accessToken: string | null;
  refreshToken: string | null;
  clientId: string | null;
  clientSecret: string | null;
  deviceCode: string | null;
};

export function readFreddySession(): FreddySession {
  return {
    accessToken: getCookie(AT) ?? null,
    refreshToken: getCookie(RT) ?? null,
    clientId: getCookie(CID) ?? null,
    clientSecret: getCookie(CS) ?? null,
    deviceCode: getCookie(DC) ?? null,
  };
}

export function writeClient(clientId: string, clientSecret: string | null) {
  setCookie(CID, clientId, opts(60 * 60 * 24 * 60));
  if (clientSecret) setCookie(CS, clientSecret, opts(60 * 60 * 24 * 60));
}

export function writeDeviceCode(deviceCode: string, expiresIn: number) {
  setCookie(DC, deviceCode, opts(Math.max(60, expiresIn)));
}

export function writeTokens(accessToken: string, refreshToken: string | null) {
  setCookie(AT, accessToken, opts(60 * 60));
  if (refreshToken) setCookie(RT, refreshToken, opts(60 * 60 * 24 * 60));
  deleteCookie(DC, { path: "/" });
}

export function clearFreddySession() {
  const clear = { path: "/" };
  deleteCookie(AT, clear);
  deleteCookie(RT, clear);
  deleteCookie(CID, clear);
  deleteCookie(CS, clear);
  deleteCookie(DC, clear);
}
