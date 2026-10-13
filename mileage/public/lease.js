// Lease arithmetic. Pure functions, all distances in kilometres.

export const KM_PER_MILE = 1.609344;
const DAY = 86400000;

// "2025-03-14" -> local midnight that day.
export function parseDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addMonths(date, months) {
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), lastDay));
  return d;
}

export function computeLease(lease, readings, now = new Date()) {
  const start = parseDay(lease.start);
  const end = addMonths(start, lease.months);
  const totalDays = Math.max((end - start) / DAY, 1);
  const totalKm = lease.allowancePerYearKm * (lease.months / 12);
  const phase = now < start ? "before" : now >= end ? "ended" : "during";

  const points = (readings || [])
    .map((r) => ({ ...r, date: new Date(r.t) }))
    .filter((r) => !Number.isNaN(r.date.getTime()))
    .sort((a, b) => a.date - b.date);
  const latest = points[points.length - 1] || null;

  // Pace is measured at the latest reading's date, not today, so a reading
  // that's a few days old isn't judged against today's allowance.
  const asOf = latest ? latest.date : now;
  const elapsedDays = Math.min(Math.max((asOf - start) / DAY, 0), totalDays);
  const expectedKm = totalKm * (elapsedDays / totalDays);
  const drivenKm = latest ? latest.km - lease.startOdometerKm : 0;
  const deltaKm = expectedKm - drivenKm;

  const avgPerDayKm = latest && elapsedDays >= 1 ? Math.max(drivenKm, 0) / elapsedDays : null;
  const projectedKm = latest && elapsedDays >= 7 && phase !== "before"
    ? Math.max(drivenKm, 0) / elapsedDays * totalDays
    : null;

  // Recent pace: change over the readings from the last 30 days.
  let recentPerDayKm = null;
  if (latest) {
    const windowStart = new Date(latest.date - 30 * DAY);
    const first = points.find((p) => p.date >= windowStart && p.date >= start);
    const span = first ? (latest.date - first.date) / DAY : 0;
    if (span >= 7) recentPerDayKm = Math.max(latest.km - first.km, 0) / span;
  }

  const daysLeft = Math.max(Math.ceil((end - now) / DAY), 0);
  const remainingKm = totalKm - drivenKm;
  const perDayKm = daysLeft > 0 ? remainingKm / daysLeft : 0;
  const finalKm = phase === "ended" ? drivenKm : projectedKm;
  const excessCost = finalKm != null && lease.excessPerKm != null
    ? Math.max(finalKm - totalKm, 0) * lease.excessPerKm
    : 0;

  return {
    start, end, totalDays, totalKm, phase, points, latest,
    expectedKm, drivenKm, deltaKm, pacePct: expectedKm / totalKm,
    avgPerDayKm, recentPerDayKm, projectedKm, daysLeft, remainingKm, perDayKm, excessCost,
    startOdometerKm: lease.startOdometerKm, now,
  };
}

// The headline status shown on the dashboard and the widget.
// tone: "good" | "warn" | "bad" | "neutral".
export function leaseStatus(m) {
  if (!m.latest) return { tone: "neutral", label: "Waiting for a reading" };
  if (m.phase === "before") return { tone: "neutral", label: "Lease not started" };
  if (m.phase === "ended") return { tone: m.drivenKm > m.totalKm ? "bad" : "good", label: "Lease ended" };
  if (m.deltaKm >= 0) return { tone: "good", label: "On track" };
  return -m.deltaKm <= m.totalKm * 0.03
    ? { tone: "warn", label: "Slightly over pace" }
    : { tone: "bad", label: "Over pace" };
}
