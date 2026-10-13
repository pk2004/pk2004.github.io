// Fetches the latest odometer reading from BMW for one user and records it.
// Used by the "Sync now" button and the daily scheduled function.
import * as bmw from "./bmw.mjs";
import { seal, unseal } from "./crypto.mjs";
import { addReading, toKm } from "./readings.mjs";
import { saveUser } from "./store.mjs";

const REFRESH_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

// Swaps the stored refresh token for a fresh set of tokens and saves the
// rotated refresh token right away, so a failure later in the sync can't
// strand the account with a used-up token.
async function accessToken(user) {
  const refreshToken = unseal(user.bmw?.refreshToken);
  if (!refreshToken) throw new bmw.BmwError("Connect your BMW account first.", { code: "reauth" });
  let tokens;
  try {
    tokens = await bmw.refreshTokens(refreshToken);
  } catch (err) {
    if (err.code === "reauth") {
      user.bmw = { ...user.bmw, refreshToken: null, status: "expired" };
      await saveUser(user);
    }
    throw err;
  }
  storeTokens(user, tokens);
  await saveUser(user);
  return tokens.access_token;
}

export function storeTokens(user, tokens) {
  user.bmw = {
    ...user.bmw,
    gcid: tokens.gcid || user.bmw?.gcid,
    refreshToken: seal(tokens.refresh_token),
    refreshExpiresAt: new Date(Date.now() + REFRESH_TOKEN_LIFETIME_MS).toISOString(),
    status: "connected",
  };
}

async function ensureVehicle(user, token) {
  if (user.vehicle?.vin) return;
  const mappings = await bmw.getMappings(token);
  const list = Array.isArray(mappings) ? mappings : mappings?.mappings || [];
  const mapping = list.find((m) => m.mappingType === "PRIMARY") || list[0];
  if (!mapping?.vin) {
    throw new bmw.BmwError("No vehicle is linked to this BMW account as primary user.");
  }
  let basic = {};
  try { basic = (await bmw.getBasicData(token, mapping.vin)) || {}; } catch { /* name is cosmetic */ }
  user.vehicle = {
    vin: mapping.vin,
    brand: basic.brand || "BMW",
    model: basic.modelName || basic.series || basic.modelRange || null,
    color: basic.colourDescription || null,
  };
  await saveUser(user);
}

async function ensureContainer(user, token) {
  if (user.bmw?.containerId) return;
  const res = await bmw.listContainers(token);
  const existing = (res?.containers || []).find(
    (c) => c.name === bmw.CONTAINER_NAME && (!c.state || c.state === "ACTIVE"),
  );
  const container = existing || (await bmw.createContainer(token));
  if (!container?.containerId) throw new bmw.BmwError("BMW did not return a data container.");
  user.bmw.containerId = container.containerId;
  await saveUser(user);
}

const isMissingContainer = (err) => /CU-10[45]|CU-121|containerId/i.test(`${err.code || ""} ${err.message}`);

async function readOdometer(user, token) {
  const res = await bmw.getTelematics(token, user.vehicle.vin, user.bmw.containerId);
  const entry = res?.telematicData?.[bmw.ODOMETER_KEY];
  const km = toKm(entry?.value, entry?.unit);
  if (entry?.value == null || entry.value === "" || km === null) {
    throw new bmw.BmwError("Your BMW hasn't reported its odometer yet. Drive it and try again later.");
  }
  return { km, t: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString() };
}

export async function syncUser(user) {
  const at = new Date().toISOString();
  try {
    const token = await accessToken(user);
    await ensureVehicle(user, token);
    await ensureContainer(user, token);
    let reading;
    try {
      reading = await readOdometer(user, token);
    } catch (err) {
      if (!isMissingContainer(err)) throw err;
      // The container was deleted in the BMW portal: make a new one.
      user.bmw.containerId = null;
      await ensureContainer(user, token);
      reading = await readOdometer(user, token);
    }
    user.readings = addReading(user.readings, { ...reading, src: "bmw" });
    user.lastSync = { at, ok: true };
  } catch (err) {
    user.lastSync = { at, ok: false, error: err.message };
    await saveUser(user);
    throw err;
  }
  await saveUser(user);
  return user;
}
