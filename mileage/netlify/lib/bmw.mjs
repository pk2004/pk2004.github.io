// Thin client for BMW CarData: the OAuth 2.0 device code flow (with PKCE)
// and the handful of REST endpoints this app needs.
// Docs: https://bmw-cardata.bmwgroup.com/customer/public/api-documentation
import { ConfigError, pkcePair } from "./crypto.mjs";

const AUTH_URL = "https://customer.bmwgroup.com/gcdm/oauth";
const API_URL = "https://api-cardata.bmwgroup.com";
const SCOPE = "authenticate_user openid cardata:api:read";

export const ODOMETER_KEY = "vehicle.vehicle.travelledDistance";
export const CONTAINER_NAME = "Lease Mileage";
export const CONTAINER_PURPOSE = "Odometer readings for lease tracking";

export class BmwError extends Error {
  constructor(message, { status, code } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function clientId() {
  const id = process.env.BMW_CLIENT_ID;
  if (!id) throw new ConfigError("BMW_CLIENT_ID is not set.");
  return id;
}

async function form(path, params) {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export async function startDeviceFlow() {
  const { verifier, challenge } = pkcePair();
  const { ok, status, body } = await form("/device/code", {
    client_id: clientId(),
    response_type: "device_code",
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  if (!ok) {
    throw new BmwError(body.error_description || "BMW could not start the sign-in. Check that your CarData client is subscribed to the CarData API.", { status });
  }
  return { ...body, verifier };
}

// Returns { status: "pending" | "slow_down" | "denied" | "expired" } while
// waiting, or { status: "ok", tokens } once the user has approved.
export async function pollDeviceFlow(deviceCode, verifier) {
  const { ok, status, body } = await form("/token", {
    client_id: clientId(),
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    code_verifier: verifier,
  });
  if (ok) return { status: "ok", tokens: body };
  switch (body.error) {
    case "authorization_pending": return { status: "pending" };
    case "slow_down": return { status: "slow_down" };
    case "access_denied": return { status: "denied" };
    case "expired_token": return { status: "expired" };
    default:
      throw new BmwError(body.error_description || body.error || "BMW sign-in failed.", { status });
  }
}

export async function refreshTokens(refreshToken) {
  const { ok, status, body } = await form("/token", {
    client_id: clientId(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!ok) {
    throw new BmwError(body.error_description || "Your BMW sign-in has expired.", {
      status,
      code: body.error === "invalid_grant" ? "reauth" : body.error,
    });
  }
  return body;
}

async function api(accessToken, path, { method = "GET", body } = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "x-version": "v1",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) {
    const code = data?.exveErrorId || data?.code || data?.errorCode;
    let message = data?.exveErrorMsg || data?.message || data?.error_description || `BMW API error ${res.status}`;
    if (res.status === 429) message = "BMW's daily limit of 50 requests has been reached. Try again tomorrow.";
    throw new BmwError(message, { status: res.status, code });
  }
  return data;
}

export const getMappings = (token) => api(token, "/customers/vehicles/mappings");
export const getBasicData = (token, vin) => api(token, `/customers/vehicles/${encodeURIComponent(vin)}/basicData`);
export const listContainers = (token) => api(token, "/customers/containers");
export const createContainer = (token) => api(token, "/customers/containers", {
  method: "POST",
  body: { name: CONTAINER_NAME, purpose: CONTAINER_PURPOSE, technicalDescriptors: [ODOMETER_KEY] },
});
export const getTelematics = (token, vin, containerId) => api(
  token,
  `/customers/vehicles/${encodeURIComponent(vin)}/telematicData?containerId=${encodeURIComponent(containerId)}`,
);
