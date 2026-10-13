// Lease Miles widget for Scriptable (https://scriptable.app).
//
// Setup: in the Lease Miles app open Settings → Home Screen widget →
// "Copy Scriptable script", paste it into a new Scriptable script, then add
// a Scriptable widget to your Home Screen or Lock Screen and choose this
// script. Supports small, medium and large Home Screen widgets and the
// circular, rectangular and inline Lock Screen widgets.

const BASE_URL = "__BASE_URL__";
const TOKEN = "__TOKEN__";

// ---------- Look ----------

const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1a1a19")),
  text: Color.dynamic(new Color("#0b0b0b"), new Color("#f0efec")),
  text2: Color.dynamic(new Color("#52514e"), new Color("#c3c2b7")),
  text3: Color.dynamic(new Color("#7c7b76"), new Color("#8f8e86")),
  track: Color.dynamic(new Color("#2a78d6", 0.14), new Color("#3987e5", 0.22)),
  accent: Color.dynamic(new Color("#2a78d6"), new Color("#3987e5")),
  good: Color.dynamic(new Color("#1a7f45"), new Color("#45b977")),
  warn: Color.dynamic(new Color("#a85a00"), new Color("#e5a03b")),
  bad: Color.dynamic(new Color("#c42b2b"), new Color("#ef6b6b")),
  neutral: Color.dynamic(new Color("#52514e"), new Color("#c3c2b7")),
};
const SYMBOL = { good: "checkmark.circle.fill", warn: "exclamationmark.circle.fill", bad: "arrow.up.circle.fill", neutral: "circle.fill" };

const fmt = (n) => Math.round(n).toLocaleString();
const compact = (n) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000)}k` : Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n)}`);
const money = (n, currency) => {
  try { return n.toLocaleString(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }); }
  catch { return `${currency || ""} ${fmt(n)}`.trim(); }
};

// ---------- Data ----------

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "lease-miles-widget.json");

async function load() {
  const req = new Request(`${BASE_URL}/api/widget`);
  req.headers = { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" };
  req.timeoutInterval = 15;
  try {
    const body = await req.loadJSON();
    const status = req.response?.statusCode;
    if (status && status >= 400) return { error: body?.error || `Error ${status}`, revoked: status === 401 };
    fm.writeString(cachePath, JSON.stringify(body));
    return { data: body };
  } catch (err) {
    // Offline: fall back to the last good summary.
    if (fm.fileExists(cachePath)) return { data: JSON.parse(fm.readString(cachePath)), stale: true };
    return { error: "Can't reach Lease Miles right now." };
  }
}

// ---------- Building blocks ----------

function statusRow(parent, d, size = 12) {
  const row = parent.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  const icon = row.addImage(SFSymbol.named(SYMBOL[d.tone] || SYMBOL.neutral).image);
  icon.imageSize = new Size(size, size);
  icon.tintColor = C[d.tone] || C.neutral;
  row.addSpacer(4);
  const t = row.addText(d.label);
  t.font = Font.semiboldSystemFont(size);
  t.textColor = C[d.tone] || C.neutral;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.7;
}

function heroNumber(parent, d, size) {
  const value = d.delta != null ? fmt(d.delta) : "—";
  const big = parent.addText(value);
  big.font = Font.boldRoundedSystemFont(size);
  big.textColor = C.text;
  big.lineLimit = 1;
  big.minimumScaleFactor = 0.5;
  const sub = parent.addText(d.direction ? `${d.unit} ${d.direction} pace` : d.phase === "before" ? "Lease not started" : "No reading yet");
  sub.font = Font.mediumSystemFont(13);
  sub.textColor = C.text2;
  sub.lineLimit = 1;
}

function progressBar(parent, d, width) {
  const used = Math.min(Math.max(d.usedFraction || 0, 0), 1);
  const bar = parent.addStack();
  bar.size = new Size(width, 6);
  bar.cornerRadius = 3;
  bar.backgroundColor = C.track;
  bar.layoutHorizontally();
  if (used > 0) {
    const fill = bar.addStack();
    fill.size = new Size(Math.max(width * used, 6), 6);
    fill.cornerRadius = 3;
    fill.backgroundColor = d.tone === "bad" ? C.bad : d.tone === "warn" ? C.warn : C.accent;
  }
  bar.addSpacer();
}

function caption(parent, text, color = C.text3, size = 11) {
  const t = parent.addText(text);
  t.font = Font.systemFont(size);
  t.textColor = color;
  t.lineLimit = 1;
  t.minimumScaleFactor = 0.8;
  return t;
}

function budgetLine(d) {
  if (d.perDay != null) return d.perDay > 0 ? `${fmt(d.perDay)} ${d.unit}/day to stay on budget` : "Allowance used up";
  if (d.phase === "ended") return `Lease ended ${d.endDate}`;
  return `${fmt(d.allowance)} ${d.unit} allowance`;
}

function statRow(parent, label, value) {
  const row = parent.addStack();
  row.layoutHorizontally();
  const l = row.addText(label);
  l.font = Font.systemFont(12);
  l.textColor = C.text2;
  row.addSpacer();
  const v = row.addText(value);
  v.font = Font.semiboldSystemFont(13);
  v.textColor = C.text;
  v.lineLimit = 1;
}

function updatedLine(parent, d, stale) {
  const row = parent.addStack();
  row.layoutHorizontally();
  const when = d.lastReading?.date;
  if (!when) return caption(row, d.vehicle);
  caption(row, stale ? "Offline · read " : `${d.vehicle} · read `, C.text3, 10);
  const date = row.addDate(new Date(when));
  date.applyRelativeStyle();
  date.font = Font.systemFont(10);
  date.textColor = C.text3;
  date.lineLimit = 1;
}

// ---------- Layouts ----------

function small(w, d, stale) {
  statusRow(w, d);
  w.addSpacer(4);
  heroNumber(w, d, 36);
  w.addSpacer();
  progressBar(w, d, 127);
  w.addSpacer(6);
  caption(w, budgetLine(d));
  if (stale) caption(w, "Offline", C.text3, 10);
}

function medium(w, d, stale, large = false) {
  const top = w.addStack();
  top.layoutHorizontally();
  const left = top.addStack();
  left.layoutVertically();
  left.size = new Size(large ? 150 : 136, 0);
  statusRow(left, d);
  left.addSpacer(4);
  heroNumber(left, d, large ? 44 : 36);
  left.addSpacer();
  progressBar(left, d, large ? 140 : 128);

  top.addSpacer(16);
  const right = top.addStack();
  right.layoutVertically();
  right.spacing = large ? 10 : 7;
  statRow(right, "Allowance left", `${fmt(Math.max(d.remaining, 0))} ${d.unit}`);
  statRow(right, "Per day", d.perDay != null ? `${fmt(d.perDay)} ${d.unit}` : "—");
  statRow(right, "Projected", d.projected != null ? `${fmt(d.projected)} ${d.unit}` : "—");
  if (large) {
    statRow(right, "Days left", fmt(d.daysLeft));
    statRow(right, "Odometer", d.lastReading ? `${fmt(d.lastReading.odometer)} ${d.unit}` : "—");
    if (d.excessCost != null) statRow(right, "Est. excess", money(d.excessCost, d.currency));
  } else {
    statRow(right, "Days left", fmt(d.daysLeft));
  }
  w.addSpacer(large ? 12 : 8);
  updatedLine(w, d, stale);
}

// Lock Screen: circular gauge of allowance used.
function ring(fraction, size = 56, line = 5) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;
  const r = size / 2 - line / 2;
  const arc = (from, to, alpha) => {
    const path = new Path();
    const steps = Math.max(Math.ceil((to - from) * 90), 2);
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (from + ((to - from) * i) / steps) * 2 * Math.PI;
      const p = new Point(size / 2 + r * Math.cos(a), size / 2 + r * Math.sin(a));
      i ? path.addLine(p) : path.move(p);
    }
    ctx.addPath(path);
    ctx.setStrokeColor(new Color("#ffffff", alpha));
    ctx.setLineWidth(line);
    ctx.strokePath();
  };
  arc(0, 1, 0.25);
  if (fraction > 0) arc(0, Math.min(fraction, 1), 1);
  return ctx.getImage();
}

function accessoryCircular(w, d) {
  w.addAccessoryWidgetBackground = true;
  const stack = w.addStack();
  stack.size = new Size(56, 56);
  stack.backgroundImage = ring(d.usedFraction || 0);
  stack.layoutVertically();
  stack.centerAlignContent();
  stack.addSpacer();
  const row = stack.addStack();
  row.addSpacer();
  const t = row.addText(d.delta != null ? compact(d.delta) : "—");
  t.font = Font.boldRoundedSystemFont(14);
  t.minimumScaleFactor = 0.6;
  row.addSpacer();
  const row2 = stack.addStack();
  row2.addSpacer();
  const s = row2.addText(d.direction || d.unit);
  s.font = Font.systemFont(8);
  row2.addSpacer();
  stack.addSpacer();
}

function accessoryRectangular(w, d) {
  const head = w.addText(d.label);
  head.font = Font.semiboldSystemFont(13);
  const body = w.addText(d.delta != null && d.direction ? `${fmt(d.delta)} ${d.unit} ${d.direction} pace` : "No reading yet");
  body.font = Font.boldRoundedSystemFont(15);
  body.minimumScaleFactor = 0.7;
  const foot = w.addText(d.perDay != null ? `${fmt(d.perDay)} ${d.unit}/day · ${fmt(d.daysLeft)} days left` : budgetLine(d));
  foot.font = Font.systemFont(12);
  foot.minimumScaleFactor = 0.7;
}

function accessoryInline(w, d) {
  w.addText(d.delta != null && d.direction ? `${fmt(d.delta)} ${d.unit} ${d.direction} pace` : d.label);
}

function errorView(w, message, family) {
  if (family?.startsWith("accessory")) {
    w.addText(family === "accessoryCircular" ? "!" : "Lease Miles: open app");
    return;
  }
  const t = w.addText("Lease Miles");
  t.font = Font.semiboldSystemFont(13);
  t.textColor = C.text;
  w.addSpacer(6);
  const m = w.addText(message);
  m.font = Font.systemFont(12);
  m.textColor = C.text2;
}

// ---------- Main ----------

const family = config.widgetFamily || (config.runsInApp ? "medium" : "small");
const w = new ListWidget();
w.url = BASE_URL;
w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
if (!family.startsWith("accessory")) {
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
}

if (TOKEN.startsWith("__")) {
  errorView(w, "Copy the script from Lease Miles → Settings → Home Screen widget.", family);
} else {
  const { data, error, stale } = await load();
  if (error) errorView(w, error, family);
  else if (family === "small") small(w, data, stale);
  else if (family === "medium") medium(w, data, stale);
  else if (family === "large" || family === "extraLarge") medium(w, data, stale, true);
  else if (family === "accessoryCircular") accessoryCircular(w, data);
  else if (family === "accessoryRectangular") accessoryRectangular(w, data);
  else if (family === "accessoryInline") accessoryInline(w, data);
  else small(w, data, stale);
}

if (config.runsInWidget) {
  Script.setWidget(w);
} else {
  // Running inside Scriptable: show a preview.
  await w.presentMedium();
}
Script.complete();
