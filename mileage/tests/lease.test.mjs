import assert from "node:assert/strict";
import { test } from "node:test";
import { addMonths, computeLease, parseDay } from "../public/lease.js";
import { addReading, parseLease } from "../netlify/lib/readings.mjs";

process.env.SESSION_SECRET ||= "x".repeat(32);

const lease = parseLease({
  unit: "mi", start: "2025-01-01", months: 36, allowancePerYear: "10000", startOdometer: "10", excessRate: "0.25", currency: "USD",
});

test("parseLease stores kilometres", () => {
  assert.equal(Math.round(lease.allowancePerYearKm), 16093);
  assert.ok(Math.abs(lease.excessPerKm * 1.609344 - 0.25) < 1e-9);
  assert.throws(() => parseLease({ ...lease, start: "nope" }), /date/);
});

test("addMonths clamps to month end", () => {
  assert.equal(addMonths(parseDay("2025-01-31"), 1).getDate(), 28);
});

test("on-pace driving shows a small delta and a sensible projection", () => {
  const now = parseDay("2026-01-01");
  const km = lease.startOdometerKm + 16093.44; // exactly one year of allowance
  const m = computeLease(lease, [{ t: now.toISOString(), km, src: "bmw" }], now);
  assert.equal(m.phase, "during");
  assert.ok(Math.abs(m.deltaKm) < 5);
  assert.ok(Math.abs(m.projectedKm - m.totalKm) < 20);
  assert.ok(m.excessCost < 0.01);
});

test("over-pace driving projects an excess charge", () => {
  const now = parseDay("2026-01-01");
  const m = computeLease(lease, [{ t: now.toISOString(), km: lease.startOdometerKm + 24140, src: "bmw" }], now);
  assert.ok(m.deltaKm < 0);
  // 15,000 mi/yr pace over 3 years = 45,000 vs 30,000 allowed → ~15,000 mi × $0.25.
  assert.ok(Math.abs(m.excessCost - 3750) < 15, `got ${m.excessCost}`);
});

test("synced readings collapse to one per day", () => {
  let list = addReading([], { t: "2026-01-01T08:00:00.000Z", km: 100, src: "bmw" });
  list = addReading(list, { t: "2026-01-01T18:00:00.000Z", km: 120, src: "bmw" });
  list = addReading(list, { t: "2026-01-01T12:00:00.000Z", km: 110, src: "manual" });
  list = addReading(list, { t: "2026-01-01T18:00:00.000Z", km: 120, src: "bmw" });
  assert.deepEqual(list.map((r) => [r.src, r.km]), [["manual", 110], ["bmw", 120]]);
});
