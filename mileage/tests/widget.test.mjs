import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseLease } from "../netlify/lib/readings.mjs";
import { buildSummary, hashWidgetToken, newWidgetToken } from "../netlify/lib/widget.mjs";

process.env.SESSION_SECRET ||= "x".repeat(32);

const user = {
  vehicle: { model: "iX xDrive50" },
  lease: parseLease({ unit: "mi", start: "2025-04-01", months: 36, allowancePerYear: 10000, startOdometer: 8, excessRate: "0.25" }),
  readings: [{ id: "a", t: "2026-10-13T08:00:00.000Z", km: 21537, src: "bmw" }],
  lastSync: { at: "2026-10-13T08:00:00.000Z", ok: true },
};

test("summary is in the lease's unit and ready to display", () => {
  const s = buildSummary(user, new Date("2026-10-13T12:00:00Z"));
  assert.equal(s.unit, "mi");
  assert.equal(s.vehicle, "iX xDrive50");
  assert.equal(s.tone, "good");
  assert.equal(s.direction, "under");
  assert.equal(s.allowance, 30000);
  assert.equal(s.lastReading.odometer, 13382);
  assert.ok(s.delta > 1900 && s.delta < 2000, `delta ${s.delta}`);
  assert.ok(s.perDay > 25 && s.perDay < 40, `perDay ${s.perDay}`);
  assert.ok(s.usedFraction > 0.4 && s.usedFraction < 0.5);
  assert.equal(s.excessCost, 0);
});

test("summary without readings has no headline number", () => {
  const s = buildSummary({ ...user, readings: [] }, new Date("2026-10-13T12:00:00Z"));
  assert.equal(s.delta, null);
  assert.equal(s.direction, null);
  assert.equal(s.label, "Waiting for a reading");
});

test("widget tokens are random and hashed", () => {
  const a = newWidgetToken();
  assert.match(a, /^lm_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(a, newWidgetToken());
  assert.equal(hashWidgetToken(a).length, 64);
});

// ---- Smoke-test the Scriptable script against a minimal fake runtime ----

function fakeScriptable({ family, response, status = 200, cached = null, fail = false }) {
  const texts = [];
  class Node_ {
    constructor() { this.children = []; }
    addText(t) { texts.push(String(t)); const n = new Node_(); this.children.push(n); return n; }
    addStack() { const n = new Node_(); this.children.push(n); return n; }
    addImage() { return new Node_(); }
    addDate(d) { assert.ok(!Number.isNaN(d.getTime())); const n = new Node_(); return Object.assign(n, { applyRelativeStyle() {} }); }
    addSpacer() {}
    layoutHorizontally() {} layoutVertically() {} centerAlignContent() {} setPadding() {}
    async presentMedium() {}
  }
  const files = cached ? { "/docs/lease-miles-widget.json": cached } : {};
  let widget = null;
  return {
    texts,
    get widget() { return widget; },
    globals: {
      Color: Object.assign(function Color(hex, a) { this.hex = hex; this.a = a; }, { dynamic: (l, d) => ({ l, d }) }),
      Font: new Proxy({}, { get: () => (size) => ({ size }) }),
      Size: function Size(w, h) { this.w = w; this.h = h; },
      Point: function Point(x, y) { assert.ok(Number.isFinite(x) && Number.isFinite(y)); },
      Path: class { move() {} addLine() {} },
      DrawContext: class { addPath() {} setStrokeColor() {} setLineWidth() {} strokePath() {} getImage() { return {}; } },
      SFSymbol: { named: (n) => { assert.ok(n); return { image: {} }; } },
      ListWidget: Node_,
      Request: class {
        constructor(url) { this.url = url; }
        async loadJSON() {
          assert.match(this.headers.Authorization, /^Bearer lm_test$/);
          if (fail) throw new Error("offline");
          this.response = { statusCode: status };
          return response;
        }
      },
      FileManager: { local: () => ({
        documentsDirectory: () => "/docs",
        joinPath: (a, b) => `${a}/${b}`,
        writeString: (p, s) => { files[p] = s; },
        readString: (p) => files[p],
        fileExists: (p) => p in files,
      }) },
      config: { widgetFamily: family, runsInWidget: true },
      Script: { setWidget: (w) => { widget = w; }, complete() {} },
    },
  };
}

async function runWidget(opts) {
  const src = (await readFile(new URL("../public/widget/lease-miles.scriptable.js", import.meta.url), "utf8"))
    .replace("__BASE_URL__", "https://example.netlify.app").replace("__TOKEN__", "lm_test");
  const rt = fakeScriptable(opts);
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction(...Object.keys(rt.globals), src)(...Object.values(rt.globals));
  assert.ok(rt.widget, "widget was set");
  return rt.texts.join(" | ");
}

const summary = buildSummary(user, new Date("2026-10-13T12:00:00Z"));

for (const family of ["small", "medium", "large", "accessoryCircular", "accessoryRectangular", "accessoryInline"]) {
  test(`widget renders: ${family}`, async () => {
    const text = await runWidget({ family, response: summary });
    assert.match(text, family === "accessoryCircular" ? /2k|1\.9k/ : /1,9\d\d/);
  });
}

test("widget falls back to the cached summary when offline", async () => {
  const text = await runWidget({ family: "small", fail: true, cached: JSON.stringify(summary) });
  assert.match(text, /Offline/);
});

test("widget explains a revoked link", async () => {
  const text = await runWidget({ family: "medium", status: 401, response: { error: "This widget link has been revoked." } });
  assert.match(text, /revoked/);
});
