// Thin client for BMW CarData: the OAuth 2.0 device code flow (with PKCE)
// and the handful of REST endpoints this app needs.
// Docs: https://bmw-cardata.bmwgroup.com/customer/public/api-documentation
import { ConfigError, pkcePair } from "./crypto.mjs";

const AUTH_URL = "https://customer.bmwgroup.com/gcdm/oauth";
const API_URL = "https://api-cardata.bmwgroup.com";
// BMW rejects the request outright if the scopes don't match the services
// the CarData client is subscribed to, so try the API-only set first, then
// the set a client subscribed to both the API and streaming expects.
const SCOPES = [
  "authenticate_user openid cardata:api:read",
  "authenticate_user openid cardata:api:read cardata:streaming:read",
];

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

// Tolerates the whitespace and quotes that easily come along when the ID is
// copied from the BMW portal into Netlify.
function clientId() {
  const id = (process.env.BMW_CLIENT_ID || "").trim().replace(/^["']|["']$/g, "").trim();
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
  let last;
  for (const scope of SCOPES) {
    last = await form("/device/code", {
      client_id: clientId(),
      response_type: "device_code",
      scope,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (last.ok) return { ...last.body, verifier };
    if (last.body.error !== "invalid_request") break;
  }
  const { status, body } = last;
  console.error(`BMW device code request failed (${status}): ${JSON.stringify(body)}`);
  if (body.error === "invalid_request" || body.error === "invalid_client" || body.error === "unauthorized_client") {
    throw new BmwError(
      "BMW didn't accept this app's CarData client ID. In the My BMW portal (BMW CarData section), check that BMW_CLIENT_ID in Netlify matches the client ID exactly and that you've clicked \"Request access to CarData API\" for it. New clients can take a few minutes to become active.",
      { status },
    );
  }
  throw new BmwError(body.error_description || "BMW could not start the sign-in. Please try again.", { status });
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
