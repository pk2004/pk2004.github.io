import { computeLease, KM_PER_MILE } from "./lease.js";
import { renderChart } from "./chart.js";

const $ = (sel, root = document) => root.querySelector(sel);

let state = null;

// ---------- Formatting ----------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const unit = () => state?.lease?.unit || "mi";
const fromKm = (km, u = unit()) => (u === "mi" ? km / KM_PER_MILE : km);
const num = (n, digits = 0) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
const dist = (km, digits = 0) => num(fromKm(km), digits);
const money = (v, currency) => new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(v);
const dateFmt = (d, opts = { month: "short", day: "numeric", year: "numeric" }) => new Intl.DateTimeFormat(undefined, opts).format(d);
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function ago(iso) {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const steps = [[60, "second"], [3600, "minute"], [86400, "hour"], [604800, "day"], [Infinity, "week"]];
  let prev = 1;
  for (const [limit, name] of steps) {
    if (Math.abs(diff) < limit) return rtf.format(Math.round(diff / prev), name);
    prev = limit;
  }
  return rtf.format(Math.round(diff / 604800), "week");
}

// ---------- API ----------

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body !== undefined || method !== "GET" ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== "GET" ? "{}" : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong.");
    err.reauth = data.reauth;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
}

// ---------- Lease form (shared by onboarding and settings) ----------

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD", "CHF", "SEK", "NOK", "DKK", "NZD"];

function leaseFormHTML(lease, submitLabel) {
  const u = lease?.unit || (navigator.language === "en-US" || navigator.language === "en-GB" ? "mi" : "km");
  const round = (v, d = 0) => (v == null ? "" : Number(v.toFixed(d)));
  const perUnit = (perKm) => (perKm == null ? "" : round(u === "mi" ? perKm * KM_PER_MILE : perKm, 2));
  const currency = lease?.currency || (u === "mi" && navigator.language === "en-GB" ? "GBP" : u === "mi" ? "USD" : "EUR");
  return `
    <label class="field full"><span>Car name <span class="hint">optional</span></span>
      <input name="nickname" maxlength="40" placeholder="e.g. My X3" value="${esc(lease?.nickname)}"></label>
    <div class="field full"><span>Distance unit</span>
      <div class="segmented" role="radiogroup">
        <label><input type="radio" name="unit" value="mi" ${u === "mi" ? "checked" : ""}><span>Miles</span></label>
        <label><input type="radio" name="unit" value="km" ${u === "km" ? "checked" : ""}><span>Kilometers</span></label>
      </div></div>
    <label class="field"><span>Lease start date</span>
      <input type="date" name="start" required value="${esc(lease?.start || "")}"></label>
    <label class="field"><span>Term (months)</span>
      <input type="number" name="months" inputmode="numeric" min="1" max="120" step="1" required placeholder="36" value="${esc(lease?.months ?? "")}"></label>
    <label class="field"><span>Allowance per year (<span data-unit-label>${u}</span>)</span>
      <input type="number" name="allowancePerYear" inputmode="numeric" min="1" step="1" required placeholder="${u === "mi" ? "10000" : "15000"}" value="${round(lease && fromKm(lease.allowancePerYearKm, u))}"></label>
    <label class="field"><span>Odometer at delivery (<span data-unit-label>${u}</span>)</span>
      <input type="number" name="startOdometer" inputmode="numeric" min="0" step="1" required placeholder="12" value="${round(lease && fromKm(lease.startOdometerKm, u))}"></label>
    <label class="field"><span>Excess charge per <span data-unit-label>${u === "mi" ? "mile" : "km"}</span> <span class="hint">optional</span></span>
      <input type="number" name="excessRate" inputmode="decimal" min="0" step="0.01" placeholder="0.25" value="${perUnit(lease?.excessPerKm)}"></label>
    <label class="field"><span>Currency</span>
      <select name="currency">${CURRENCIES.map((c) => `<option ${c === currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <p class="form-error full" role="alert"></p>
    <button class="btn btn-primary btn-block" type="submit">${esc(submitLabel)}</button>`;
}

function bindLeaseForm(form, onSaved) {
  // Switching units converts what's already typed, so nothing is lost.
  form.addEventListener("change", (e) => {
    if (e.target.name !== "unit") return;
    const to = e.target.value;
    const factor = to === "km" ? KM_PER_MILE : 1 / KM_PER_MILE;
    for (const name of ["allowancePerYear", "startOdometer"]) {
      const input = form.elements[name];
      if (input.value !== "") input.value = Math.round(Number(input.value) * factor);
    }
    const rate = form.elements.excessRate;
    if (rate.value !== "") rate.value = Number((Number(rate.value) / factor).toFixed(2));
    form.querySelectorAll("[data-unit-label]").forEach((el) => {
      el.textContent = el.textContent.length > 2 ? (to === "mi" ? "mile" : "km") : to;
    });
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $(".form-error", form);
    const btn = $("button[type=submit]", form);
    err.textContent = "";
    btn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      state = await api("/lease", { method: "PUT", body });
      onSaved?.();
      render();
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Rendering ----------

const ICONS = {
  good: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 16.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  bad: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  neutral: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function render() {
  $("#loading").hidden = true;
  const hasLease = Boolean(state.lease);
  $("#onboarding").hidden = hasLease;
  $("#dashboard").hidden = !hasLease;
  $("#open-settings").hidden = !hasLease;

  if (!hasLease) {
    const form = $("#onboarding-form");
    if (!form.childElementCount) {
      form.innerHTML = leaseFormHTML(null, "Start tracking");
      bindLeaseForm(form);
    }
    return;
  }

  document.querySelectorAll("#reading [data-unit-label]").forEach((el) => { el.textContent = unit(); });
  const m = computeLease(state.lease, state.readings);
  renderHeader();
  renderHero(m);
  renderTiles(m);
  renderChart($("#chart"), m, { fromKm, dist, unit: unit(), dateFmt, legend: $("#chart-legend"), tooltip: $("#tooltip") });
  $("#chart-sub").textContent = `${dateFmt(m.start)} – ${dateFmt(m.end)}`;
  renderReadings();
}

function renderHeader() {
  const v = state.vehicle;
  const connected = state.bmw.status === "connected";
  $("#vehicle-name").textContent = state.lease.nickname || v?.model || "My car";
  $("#vehicle-sub").textContent = [v?.brand, v?.color, v?.vin && `VIN ···${v.vin.slice(-6)}`].filter(Boolean).join(" · ") || "Lease tracker";

  const lastBmw = [...state.readings].reverse().find((r) => r.src === "bmw");
  $("#sync-btn").hidden = !connected;
  $("#sync-status").textContent = connected
    ? lastBmw ? `Odometer reported ${ago(lastBmw.t)}` : "Not synced yet"
    : "";

  $("#connect-card").hidden = connected || state.bmw.status === "expired";
  const connectBtn = $("#connect-card [data-action=connect]");
  connectBtn.hidden = !state.configured;
  $("#connect-card .muted").textContent = state.configured
    ? "Sign in with your My BMW account once. We'll read your odometer automatically every day."
    : "BMW syncing isn't set up yet: add your CarData client ID as BMW_CLIENT_ID in Netlify. You can add readings by hand meanwhile.";

  const banner = $("#banner");
  if (state.bmw.status === "expired") {
    banner.innerHTML = `<span>Your BMW sign-in has expired, so daily syncing is paused.</span><button class="btn" type="button" data-action="connect">Reconnect</button>`;
    banner.hidden = false;
  } else if (connected && state.lastSync && !state.lastSync.ok) {
    banner.innerHTML = `<span>Last sync failed ${esc(ago(state.lastSync.at))}: ${esc(state.lastSync.error)}</span>`;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderHero(m) {
  const status = $("#hero-status");
  const u = unit();
  let tone, label, value, caption;

  if (!m.latest) {
    tone = "neutral"; label = "Waiting for a reading";
    value = "—";
    caption = state.bmw.status === "connected"
      ? "Your first odometer reading will appear after the next sync."
      : "Connect your BMW or add an odometer reading to see how you're tracking.";
  } else if (m.phase === "before") {
    tone = "neutral"; label = "Lease not started";
    value = dist(m.totalKm);
    caption = `${u} allowance starts ${esc(dateFmt(m.start))}.`;
  } else if (m.phase === "ended") {
    const over = m.drivenKm > m.totalKm;
    tone = over ? "bad" : "good"; label = "Lease ended";
    value = dist(Math.abs(m.totalKm - m.drivenKm));
    caption = over
      ? `${u} over your allowance${m.excessCost ? ` — about <strong>${money(m.excessCost, state.lease.currency)}</strong> in excess charges` : ""}.`
      : `${u} left unused on your allowance.`;
  } else {
    const under = m.deltaKm >= 0;
    const slight = !under && -m.deltaKm <= m.totalKm * 0.03;
    tone = under ? "good" : slight ? "warn" : "bad";
    label = under ? "On track" : slight ? "Slightly over pace" : "Over pace";
    value = dist(Math.abs(m.deltaKm));
    const budget = m.perDayKm > 0
      ? `Drive up to <strong>${dist(m.perDayKm)} ${u} a day</strong> (${dist(m.perDayKm * 7)} a week) to finish within your allowance.`
      : `You've used your full allowance; every extra ${u === "mi" ? "mile" : "km"} counts as excess.`;
    caption = `${under ? "Ahead of" : "Behind"} your allowance pace. ${budget}`;
  }

  status.className = `hero-status ${tone}`;
  status.innerHTML = `${ICONS[tone]}<span>${esc(label)}</span>`;
  $("#hero-value").textContent = value;
  $("#hero-unit").textContent = m.latest && m.phase === "during" ? `${u} ${m.deltaKm >= 0 ? "under" : "over"}` : m.latest ? u : "";
  $("#hero-caption").innerHTML = caption;

  const pct = m.latest ? Math.min(m.drivenKm / m.totalKm, 1) : 0;
  const pacePct = Math.min(Math.max(m.pacePct, 0), 1);
  const fill = $("#meter-fill");
  fill.style.width = `${pct * 100}%`;
  fill.classList.toggle("over", m.latest && m.drivenKm > m.expectedKm && m.phase !== "before");
  $("#meter-pace").style.left = `${pacePct * 100}%`;
  $("#meter-pace").hidden = m.phase !== "during";
  $("#meter").setAttribute("aria-label", `${dist(Math.max(m.drivenKm, 0))} of ${dist(m.totalKm)} ${u} used`);
  $("#meter-left").textContent = m.latest ? `${dist(Math.max(m.drivenKm, 0))} ${u} driven` : `0 ${u} driven`;
  $("#meter-right").textContent = `${dist(m.totalKm)} ${u} allowance`;
}

function renderTiles(m) {
  const u = unit();
  const tile = (label, value, note = "") => `
    <div class="tile"><div class="tile-label">${esc(label)}</div>
      <div class="tile-value">${value}</div>${note ? `<div class="tile-note">${esc(note)}</div>` : ""}</div>`;
  const small = `<small>${u}</small>`;
  const tiles = [
    tile("Odometer", m.latest ? `${dist(m.latest.km)} ${small}` : "—", m.latest ? dateFmt(new Date(m.latest.t), { month: "short", day: "numeric" }) : ""),
    tile("Allowance left", m.latest ? `${dist(Math.max(m.remainingKm, 0))} ${small}` : "—", `of ${dist(m.totalKm)}`),
    tile("Days left", num(m.daysLeft), `Returns ${dateFmt(m.end)}`),
    tile("Projected at return", m.projectedKm != null ? `${dist(m.projectedKm)} ${small}` : "—",
      m.projectedKm != null ? `${m.projectedKm > m.totalKm ? "Over" : "Under"} by ${dist(Math.abs(m.projectedKm - m.totalKm))}` : "Needs a week of data"),
    tile("Average per day", m.avgPerDayKm != null ? `${dist(m.avgPerDayKm, 1)} ${small}` : "—",
      m.recentPerDayKm != null ? `Last 30 days: ${dist(m.recentPerDayKm, 1)}` : `Allowance: ${dist(m.totalKm / m.totalDays, 1)}`),
    state.lease.excessPerKm != null
      ? tile("Est. excess charge", m.projectedKm != null ? money(m.excessCost, state.lease.currency) : "—", m.projectedKm != null ? "At your current pace" : "")
      : tile("Allowance per day", `${dist(m.totalKm / m.totalDays, 1)} ${small}`, `${dist(state.lease.allowancePerYearKm)} a year`),
  ];
  $("#tiles").innerHTML = tiles.join("");
}

let showAllReadings = false;
function renderReadings() {
  const el = $("#readings");
  const list = [...state.readings].reverse();
  if (!list.length) {
    el.innerHTML = `<p class="empty">No readings yet.</p>`;
    return;
  }
  const visible = showAllReadings ? list : list.slice(0, 6);
  el.innerHTML = `
    <table class="readings">
      <thead><tr><th>Date</th><th class="src">Source</th><th class="num">Odometer</th><th class="act"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${visible.map((r) => `
        <tr>
          <td>${esc(dateFmt(new Date(r.t)))}</td>
          <td class="src">${r.src === "bmw" ? "BMW" : "Manual"}</td>
          <td class="num">${dist(r.km)} ${unit()}</td>
          <td class="act"><button class="icon-btn" type="button" data-delete="${esc(r.id)}" aria-label="Delete reading from ${esc(dateFmt(new Date(r.t)))}">${ICONS.trash}</button></td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${list.length > 6 ? `<button class="btn btn-quiet show-more" type="button" data-action="toggle-readings">${showAllReadings ? "Show fewer" : `Show all ${list.length}`}</button>` : ""}`;
}

function renderAccountPanel() {
  const panel = $("#account-panel");
  const s = state.bmw.status;
  if (!state.configured) {
    panel.innerHTML = `<p class="muted small">Add your CarData client ID as <code>BMW_CLIENT_ID</code> in Netlify to enable syncing.</p>`;
  } else if (s === "connected") {
    panel.innerHTML = `<p class="muted small">Connected${state.vehicle?.vin ? ` to VIN ···${esc(state.vehicle.vin.slice(-6))}` : ""}. Your odometer is read once a day.</p>
      <button class="btn btn-danger" type="button" data-action="disconnect">Disconnect BMW</button>`;
  } else {
    panel.innerHTML = `<p class="muted small">${s === "expired" ? "Your sign-in expired." : "Not connected."}</p>
      <button class="btn btn-quiet" type="button" data-action="connect">Connect BMW</button>`;
  }
}

// ---------- BMW connect flow ----------

let pollTimer = null;
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; }

async function startConnect() {
  $("#settings").close();
  const dlg = $("#connect");
  const body = $("#connect-body");
  body.innerHTML = `<div class="waiting"><span class="spinner"></span><span>Contacting BMW…</span></div>`;
  if (!dlg.open) dlg.showModal();
  try {
    const flow = await api("/connect/start", { method: "POST" });
    body.innerHTML = `
      <p class="muted">Approve this app in your My BMW account. Make sure you see this code:</p>
      <div class="code-box" aria-label="Your code">${esc(flow.userCode)}</div>
      <a class="btn btn-primary btn-block" href="${esc(flow.verificationUriComplete)}" target="_blank" rel="noopener">Open BMW sign-in</a>
      <ol class="steps">
        <li>Sign in with your My BMW login.</li>
        <li>Confirm the code above and allow access.</li>
        <li>Come back here — we'll finish automatically.</li>
      </ol>
      <div class="waiting"><span class="spinner"></span><span>Waiting for approval…</span></div>`;
    let interval = flow.interval * 1000;
    const deadline = Date.now() + flow.expiresIn * 1000;
    const poll = async () => {
      if (!dlg.open) return;
      if (Date.now() > deadline) return connectError("The code expired before it was approved.");
      try {
        const res = await api("/connect/poll", { method: "POST", body: { flow: flow.flow } });
        if (res.status === "connected") {
          state = res.state;
          body.innerHTML = `<div class="success">${ICONS.good}<h3>Connected</h3><p class="muted">${state.lastSync?.ok ? "Your odometer has been synced." : esc(state.lastSync?.error || "")}</p></div>`;
          render();
          setTimeout(() => dlg.close(), 1800);
          return;
        }
        if (res.status === "slow_down") interval += 5000;
        if (res.status === "denied") return connectError("Access was declined in your BMW account.");
        if (res.status === "expired") return connectError("The code expired before it was approved.");
        pollTimer = setTimeout(poll, interval);
      } catch (ex) {
        connectError(ex.message);
      }
    };
    pollTimer = setTimeout(poll, interval);
  } catch (ex) {
    connectError(ex.message);
  }
}

function connectError(message) {
  stopPolling();
  $("#connect-body").innerHTML = `
    <p class="form-error" style="margin:12px 0 16px">${esc(message)}</p>
    <button class="btn btn-primary btn-block" type="button" data-action="connect">Try again</button>`;
}

// ---------- Actions ----------

async function syncNow() {
  const btn = $("#sync-btn");
  btn.disabled = true;
  btn.classList.add("is-busy");
  try {
    state = await api("/sync", { method: "POST" });
    render();
    toast(state.lastSync?.ok ? "Odometer up to date" : "Sync finished");
  } catch (ex) {
    if (ex.reauth) state = await api("/state");
    render();
    toast(ex.message);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-busy");
  }
}

function openSettings() {
  const form = $("#settings-form");
  form.innerHTML = leaseFormHTML(state.lease, "Save changes");
  renderAccountPanel();
  $("#settings").showModal();
}

document.addEventListener("click", async (e) => {
  const target = e.target.closest("[data-action], [data-close], [data-delete], #open-settings, #sync-btn");
  if (!target) return;
  if (target.matches("[data-close]")) { target.closest("dialog").close(); return; }
  if (target.id === "open-settings") return openSettings();
  if (target.id === "sync-btn") return syncNow();
  if (target.dataset.delete) {
    if (!confirm("Delete this reading?")) return;
    try {
      state = await api("/readings/delete", { method: "POST", body: { id: target.dataset.delete } });
      render();
    } catch (ex) { toast(ex.message); }
    return;
  }
  switch (target.dataset.action) {
    case "connect": return startConnect();
    case "toggle-readings": showAllReadings = !showAllReadings; return renderReadings();
    case "add-reading": {
      const form = $("#reading-form");
      form.reset();
      form.elements.date.value = todayISO();
      form.elements.date.max = todayISO();
      $(".form-error", form).textContent = "";
      $("#reading").showModal();
      return;
    }
    case "disconnect":
      if (!confirm("Stop syncing with your BMW? Your readings are kept.")) return;
      state = await api("/disconnect", { method: "POST" });
      renderAccountPanel();
      return render();
    case "delete-account":
      if (!confirm("Delete your lease details and every reading? This can't be undone.")) return;
      state = await api("/delete-account", { method: "POST" });
      $("#settings").close();
      $("#onboarding-form").innerHTML = "";
      return render();
  }
});

$("#reading-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const err = $(".form-error", form);
  err.textContent = "";
  try {
    state = await api("/readings", {
      method: "POST",
      body: { date: form.elements.date.value, value: form.elements.value.value, unit: unit() },
    });
    $("#reading").close();
    render();
  } catch (ex) {
    err.textContent = ex.message;
  }
});

$("#connect").addEventListener("close", stopPolling);
bindLeaseForm($("#settings-form"), () => { $("#settings").close(); toast("Lease details saved"); });

// Close dialogs when clicking the backdrop.
document.querySelectorAll("dialog").forEach((dlg) => {
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
});

// Re-render the chart when the layout width changes.
let lastWidth = 0;
new ResizeObserver(([entry]) => {
  const w = Math.round(entry.contentRect.width);
  if (state?.lease && w !== lastWidth) {
    lastWidth = w;
    renderChart($("#chart"), computeLease(state.lease, state.readings), { fromKm, dist, unit: unit(), dateFmt, legend: $("#chart-legend"), tooltip: $("#tooltip") });
  }
}).observe($("#chart"));

// Refresh when coming back to the tab after a while.
let loadedAt = Date.now();
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible" && Date.now() - loadedAt > 10 * 60 * 1000 && state) {
    loadedAt = Date.now();
    try { state = await api("/state"); render(); } catch { /* keep current view */ }
  }
});

(async function init() {
  try {
    state = await api("/state");
    render();
  } catch (ex) {
    $("#loading").innerHTML = `<p class="muted">${esc(ex.message)}</p>`;
  }
})();
