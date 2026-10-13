// Pure helpers for odometer readings and lease settings. Distances are
// always stored in kilometres; the browser converts for display.
import { randomId } from "./crypto.mjs";

export const KM_PER_MILE = 1.609344;
const MAX_READINGS = 3000;

export function toKm(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return /^(mi|mile|miles)$/i.test(String(unit || "").trim()) ? n * KM_PER_MILE : n;
}

// Adds a reading, keeping the list sorted by time. Synced readings collapse
// to one per day (the latest wins) so a daily sync plus a few manual
// refreshes don't clutter the history.
export function addReading(readings, { t, km, src }) {
  const list = [...(readings || [])];
  if (src === "bmw") {
    if (list.some((r) => r.src === "bmw" && r.t === t)) return list;
    const day = t.slice(0, 10);
    const sameDay = list.findIndex((r) => r.src === "bmw" && r.t.slice(0, 10) === day);
    if (sameDay >= 0) list.splice(sameDay, 1);
  }
  list.push({ id: randomId(6), t, km: Math.round(km * 10) / 10, src });
  list.sort((a, b) => a.t.localeCompare(b.t));
  return list.slice(-MAX_READINGS);
}

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

// Validates lease settings from the browser. Throws with a user-facing message.
export function parseLease(input) {
  const unit = input?.unit === "km" ? "km" : "mi";
  const months = Number(input?.months);
  const allowance = Number(input?.allowancePerYear);
  const startOdo = Number(input?.startOdometer ?? 0);
  const excess = input?.excessRate === "" || input?.excessRate == null ? null : Number(input.excessRate);

  if (!isDate(input?.start)) throw new Error("Enter the date your lease started.");
  if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("Lease term should be between 1 and 120 months.");
  if (!Number.isFinite(allowance) || allowance <= 0 || allowance > 200000) throw new Error("Enter your yearly mileage allowance.");
  if (!Number.isFinite(startOdo) || startOdo < 0 || startOdo > 2000000) throw new Error("Enter the odometer reading at delivery.");
  if (excess !== null && (!Number.isFinite(excess) || excess < 0 || excess > 100)) throw new Error("Excess charge should be a small amount per mile or km.");

  const perKm = unit === "mi" ? 1 / KM_PER_MILE : 1;
  return {
    unit,
    start: input.start,
    months,
    allowancePerYearKm: toKm(allowance, unit),
    startOdometerKm: toKm(startOdo, unit),
    excessPerKm: excess === null ? null : excess * perKm,
    currency: /^[A-Z]{3}$/.test(input?.currency || "") ? input.currency : "USD",
    nickname: String(input?.nickname || "").trim().slice(0, 40),
  };
}
