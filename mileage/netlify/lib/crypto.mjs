// Small helpers for sealing secrets (refresh tokens, session cookies, the
// in-progress device-code flow) with AES-256-GCM under SESSION_SECRET.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class ConfigError extends Error {}

function key() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new ConfigError("SESSION_SECRET is missing or shorter than 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

export function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

export function randomId(bytes = 12) {
  return b64url(randomBytes(bytes));
}

export function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return b64url(Buffer.concat([iv, cipher.getAuthTag(), body]));
}

// Returns null for anything tampered with, truncated or sealed under another secret.
export function unseal(token) {
  if (typeof token !== "string" || token.length < 40) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const body = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]);
    return JSON.parse(body.toString("utf8"));
  } catch (err) {
    if (err instanceof ConfigError) throw err;
    return null;
  }
}

export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}
