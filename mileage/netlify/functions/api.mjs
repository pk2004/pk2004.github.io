// JSON API for the browser app. Every route lives under /api/.
//
// The browser holds only an encrypted, HttpOnly session cookie naming its
// user record. BMW tokens never leave the server.
import * as bmw from "../lib/bmw.mjs";
import { ConfigError, randomId, seal, unseal } from "../lib/crypto.mjs";
import { addReading, parseLease, toKm } from "../lib/readings.mjs";
import * as store from "../lib/store.mjs";
import { storeTokens, syncUser } from "../lib/sync.mjs";

export const config = { path: "/api/*" };

const COOKIE = "lm_session";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const SYNC_COOLDOWN_MS = 5 * 60 * 1000;

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sessionCookie(id) {
  return `${COOKIE}=${seal({ id })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}
const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readSession(req) {
  const raw = (req.headers.get("cookie") || "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${COOKIE}=`));
  return raw ? unseal(raw.slice(COOKIE.length + 1))?.id || null : null;
}

// What the browser is allowed to see: everything except tokens.
function publicState(user) {
  return {
    configured: Boolean(process.env.BMW_CLIENT_ID),
    lease: user?.lease || null,
    vehicle: user?.vehicle || null,
    readings: user?.readings || [],
    lastSync: user?.lastSync || null,
    bmw: user?.bmw
      ? { status: user.bmw.refreshToken ? "connected" : user.bmw.status || "disconnected", refreshExpiresAt: user.bmw.refreshExpiresAt }
      : { status: "disconnected" },
  };
}

async function readJson(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "Invalid request body."); }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const route = `${req.method} ${url.pathname.replace(/^\/api/, "").replace(/\/+$/, "") || "/"}`;

  try {
    // Mutating requests must be same-origin JSON: a cross-site form can't
    // send this content type without a CORS preflight, which we never grant.
    if (req.method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && origin !== url.origin) throw new HttpError(403, "Cross-origin request blocked.");
      if (!/^application\/json/.test(req.headers.get("content-type") || "")) {
        throw new HttpError(415, "Expected JSON.");
      }
    }

    const sessionId = readSession(req);
    let user = sessionId ? await store.getUser(sessionId) : null;
    const setCookie = {};
    const ensureUser = () => {
      if (!user) {
        user = { id: randomId(), createdAt: new Date().toISOString(), readings: [] };
        setCookie["Set-Cookie"] = sessionCookie(user.id);
      }
      return user;
    };

    switch (route) {
      case "GET /state":
        return json(publicState(user));

      case "PUT /lease": {
        ensureUser().lease = parseLease(await readJson(req));
        await store.saveUser(user);
        return json(publicState(user), 200, setCookie);
      }

      case "POST /readings": {
        const body = await readJson(req);
        const km = toKm(body.value, body.unit);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || "") || Number.isNaN(Date.parse(body.date))) {
          throw new HttpError(400, "Pick the date of the reading.");
        }
        if (km === null || km < 0 || km > 2000000) throw new HttpError(400, "Enter the odometer reading.");
        ensureUser().readings = addReading(user.readings, { t: `${body.date}T12:00:00.000Z`, km, src: "manual" });
        await store.saveUser(user);
        return json(publicState(user), 200, setCookie);
      }

      case "POST /readings/delete": {
        const { id } = await readJson(req);
        if (!user) throw new HttpError(404, "Nothing to delete.");
        user.readings = (user.readings || []).filter((r) => r.id !== id);
        await store.saveUser(user);
        return json(publicState(user));
      }

      case "POST /sync": {
        if (!user?.bmw?.refreshToken) throw new HttpError(400, "Connect your BMW account first.");
        const last = user.lastSync?.ok && Date.parse(user.lastSync.at);
        if (last && Date.now() - last < SYNC_COOLDOWN_MS) return json(publicState(user));
        await syncUser(user);
        return json(publicState(user));
      }

      case "POST /connect/start": {
        const flow = await bmw.startDeviceFlow();
        const expiresIn = Number(flow.expires_in) || 600;
        return json({
          userCode: flow.user_code,
          verificationUri: flow.verification_uri,
          verificationUriComplete: flow.verification_uri_complete || flow.verification_uri,
          interval: Math.max(Number(flow.interval) || 5, 3),
          expiresIn,
          flow: seal({ deviceCode: flow.device_code, verifier: flow.verifier, exp: Date.now() + expiresIn * 1000 }),
        });
      }

      case "POST /connect/poll": {
        const pending = unseal((await readJson(req)).flow);
        if (!pending || pending.exp < Date.now()) return json({ status: "expired" });
        const result = await bmw.pollDeviceFlow(pending.deviceCode, pending.verifier);
        if (result.status !== "ok") return json({ status: result.status });
        return json({ status: "connected", state: publicState(await connect(result.tokens)) }, 200, setCookie);
      }

      case "POST /disconnect": {
        if (user?.bmw) {
          if (user.bmw.gcid) await store.unlinkAccount(user.bmw.gcid);
          user.bmw = { status: "disconnected" };
          await store.saveUser(user);
        }
        return json(publicState(user));
      }

      case "POST /delete-account": {
        if (user) {
          if (user.bmw?.gcid) await store.unlinkAccount(user.bmw.gcid);
          await store.deleteUser(user.id);
        }
        return json(publicState(null), 200, { "Set-Cookie": clearCookie });
      }

      default:
        throw new HttpError(404, "Not found.");
    }

    // Links a freshly authorised BMW account to this browser. If the account
    // already belongs to a record (signed in on another device), this browser
    // joins that record, bringing along anything entered here first.
    async function connect(tokens) {
      const linkedId = tokens.gcid ? await store.getUserIdForAccount(tokens.gcid) : null;
      const linked = linkedId && linkedId !== user?.id ? await store.getUser(linkedId) : null;
      if (linked) {
        if (user) {
          linked.lease ||= user.lease;
          for (const r of user.readings || []) {
            if (r.src === "manual") linked.readings = addReading(linked.readings, r);
          }
          await store.deleteUser(user.id);
        }
        user = linked;
        setCookie["Set-Cookie"] = sessionCookie(user.id);
      }
      ensureUser();
      storeTokens(user, tokens);
      await store.saveUser(user);
      if (tokens.gcid) await store.linkAccount(tokens.gcid, user.id);
      try {
        await syncUser(user);
      } catch {
        // The error is recorded in user.lastSync and shown in the app.
      }
      return user;
    }
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof ConfigError) {
      console.error(err.message);
      return json({ error: `Server setup incomplete: ${err.message}` }, 500);
    }
    if (err instanceof bmw.BmwError) {
      return json({ error: err.message, reauth: err.code === "reauth" }, err.status === 429 ? 429 : 502);
    }
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}
