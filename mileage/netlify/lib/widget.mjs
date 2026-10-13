// The compact, display-ready summary served to Home Screen widgets.
// Numbers are already converted to the lease's unit and rounded, so a
// widget only has to lay them out.
import { createHash } from "node:crypto";
import { computeLease, KM_PER_MILE, leaseStatus } from "../../public/lease.js";
import { randomId } from "./crypto.mjs";

export const newWidgetToken = () => `lm_${randomId(24)}`;
export const hashWidgetToken = (token) => createHash("sha256").update(String(token)).digest("hex");

export function buildSummary(user, now = new Date()) {
  const lease = user.lease;
  const unit = lease.unit;
  const conv = (km) => (unit === "mi" ? km / KM_PER_MILE : km);
  const round = (km, digits = 0) => (km == null ? null : Number(conv(km).toFixed(digits)));
  const m = computeLease(lease, user.readings, now);
  const { tone, label } = leaseStatus(m);
  const has = Boolean(m.latest);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  return {
    version: 1,
    generatedAt: now.toISOString(),
    vehicle: lease.nickname || user.vehicle?.model || "My car",
    unit,
    phase: m.phase,
    tone,
    label,
    // Distance ahead of (under) or behind (over) the allowance pace.
    delta: has ? Math.abs(round(m.phase === "ended" ? m.totalKm - m.drivenKm : m.deltaKm)) : null,
    direction: !has || m.phase === "before" ? null
      : (m.phase === "ended" ? m.totalKm - m.drivenKm : m.deltaKm) >= 0 ? "under" : "over",
    perDay: has && m.phase === "during" ? Math.max(round(m.perDayKm), 0) : null,
    perWeek: has && m.phase === "during" ? Math.max(round(m.perDayKm * 7), 0) : null,
    driven: has ? Math.max(round(m.drivenKm), 0) : 0,
    allowance: round(m.totalKm),
    remaining: has ? round(m.remainingKm) : round(m.totalKm),
    usedFraction: has ? Number(Math.max(m.drivenKm / m.totalKm, 0).toFixed(4)) : 0,
    paceFraction: Number(Math.min(Math.max(m.pacePct, 0), 1).toFixed(4)),
    projected: round(m.projectedKm),
    daysLeft: m.daysLeft,
    endDate: iso(m.end),
    excessCost: lease.excessPerKm != null && m.projectedKm != null ? Math.round(m.excessCost) : null,
    currency: lease.currency || null,
    lastReading: has ? { date: m.latest.t, odometer: round(m.latest.km), source: m.latest.src } : null,
    lastSync: user.lastSync ? { at: user.lastSync.at, ok: user.lastSync.ok } : null,
  };
}
