// Inline SVG line chart: distance driven since lease start, against the
// straight-line allowance pace, with a projection to the return date.

const NS = "http://www.w3.org/2000/svg";
const DAY = 86400000;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  parent?.appendChild(node);
  return node;
}

function niceStep(max, target = 4) {
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

const compact = (n) => new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function renderChart(container, m, { fromKm, dist, unit, dateFmt, legend, tooltip }) {
  container.textContent = "";
  legend.innerHTML = `
    <li><i style="border-color:var(--accent)"></i>Driven</li>
    ${m.projectedKm != null && m.phase === "during" ? `<li><i class="dash" style="border-color:var(--accent)"></i>Projected</li>` : ""}
    <li><i style="border-color:var(--pace)"></i>Allowance pace</li>`;

  const width = container.clientWidth;
  const height = container.clientHeight;
  if (!width || !height) return;

  // Driven distance since lease start, in display units.
  const series = [
    { date: m.start, v: 0, synthetic: true },
    ...m.points
      .filter((p) => p.date >= m.start && p.date <= m.end)
      .map((p) => ({ date: p.date, v: Math.max(fromKm(p.km - m.startOdometerKm), 0), km: p.km })),
  ];
  const total = fromKm(m.totalKm);
  const projected = m.projectedKm != null && m.phase === "during" ? fromKm(m.projectedKm) : null;
  const yMaxRaw = Math.max(total, projected ?? 0, ...series.map((p) => p.v)) * 1.06;
  const step = niceStep(yMaxRaw);
  const yMax = Math.ceil(yMaxRaw / step) * step;

  const pad = { top: 12, right: 12, bottom: 28, left: 0 };
  // Leave room for the widest y label.
  pad.left = Math.max(...[0, yMax].map((v) => compact(v).length)) * 7.5 + 10;
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const t0 = m.start.getTime();
  const t1 = m.end.getTime();
  const x = (d) => pad.left + ((d.getTime() - t0) / (t1 - t0)) * iw;
  const y = (v) => pad.top + ih - (v / yMax) * ih;

  const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Distance driven since ${dateFmt(m.start)}, compared with the allowance of ${dist(m.totalKm)} ${unit}` }, container);

  // Grid + y ticks
  for (let v = 0; v <= yMax + 1e-9; v += step) {
    el("line", { class: "grid", x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }, svg);
    el("text", { x: pad.left - 8, y: y(v) + 4, "text-anchor": "end" }, svg).textContent = compact(v);
  }

  // X ticks: month starts, thinned to fit.
  const months = [];
  for (let d = new Date(m.start.getFullYear(), m.start.getMonth() + 1, 1); d <= m.end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  const maxTicks = Math.max(2, Math.floor(iw / 70));
  const every = [1, 2, 3, 6, 12, 24].find((n) => months.length / n <= maxTicks) || 24;
  months.filter((d) => d.getMonth() % every === 0 || every === 1).forEach((d) => {
    const label = d.getMonth() === 0 || every >= 12 ? dateFmt(d, { month: "short", year: "2-digit" }) : dateFmt(d, { month: "short" });
    el("text", { x: x(d), y: height - 8, "text-anchor": "middle" }, svg).textContent = label;
  });

  // Allowance pace
  el("line", { class: "pace", x1: x(m.start), y1: y(0), x2: x(m.end), y2: y(total) }, svg);

  // Today
  if (m.phase === "during") {
    const tx = x(m.now);
    el("line", { class: "today", x1: tx, x2: tx, y1: pad.top, y2: pad.top + ih }, svg);
    el("text", { x: tx + 4, y: pad.top + 10 }, svg).textContent = "Today";
  }

  const last = series[series.length - 1];
  if (series.length > 1) {
    const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
    el("path", { class: "area", d: `${path}L${x(last.date).toFixed(1)},${y(0)}L${x(m.start).toFixed(1)},${y(0)}Z` }, svg);
    if (projected != null) {
      el("line", { class: "proj", x1: x(last.date), y1: y(last.v), x2: x(m.end), y2: y(projected) }, svg);
    }
    el("path", { class: "actual", d: path }, svg);
    el("circle", { class: "dot", cx: x(last.date), cy: y(last.v), r: 5 }, svg);
    const lx = x(last.date);
    const anchor = lx > pad.left + iw * 0.8 ? "end" : "start";
    // Put the label on the side of the line away from the pace line.
    const paceAtLast = total * ((last.date - m.start) / (m.end - m.start));
    const ly = last.v < paceAtLast ? y(last.v) + 20 : y(last.v) - 10;
    el("text", { class: "end-label", x: lx + (anchor === "end" ? -10 : 10), y: ly, "text-anchor": anchor }, svg).textContent = `${compact(last.v)} ${unit}`;
  } else {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.style.cssText = "position:absolute;inset:0";
    empty.textContent = "Your driving will appear here after the first reading.";
    container.appendChild(empty);
  }

  // Hover: crosshair snaps to the day under the pointer and reads out
  // every series at that date.
  const cross = el("line", { class: "cross", y1: pad.top, y2: pad.top + ih, visibility: "hidden" }, svg);
  const hit = el("rect", { x: pad.left, y: pad.top, width: iw, height: ih, fill: "transparent" }, svg);
  const valueAt = (d) => {
    if (series.length < 2 || d < m.start) return null;
    if (d <= last.date) {
      let i = series.findIndex((p) => p.date >= d);
      if (i <= 0) return { v: series[0].v, kind: "Driven" };
      const a = series[i - 1], b = series[i];
      const f = (d - a.date) / (b.date - a.date || 1);
      return { v: a.v + (b.v - a.v) * f, kind: "Driven" };
    }
    if (projected == null) return null;
    const f = (d - last.date) / (m.end - last.date || 1);
    return { v: last.v + (projected - last.v) * f, kind: "Projected" };
  };

  const move = (e) => {
    const rect = svg.getBoundingClientRect();
    const px = Math.min(Math.max(e.clientX - rect.left, pad.left), pad.left + iw);
    const date = new Date(Math.round((t0 + ((px - pad.left) / iw) * (t1 - t0)) / DAY) * DAY);
    const snapX = x(date);
    cross.setAttribute("x1", snapX);
    cross.setAttribute("x2", snapX);
    cross.setAttribute("visibility", "visible");
    const pace = total * ((date - m.start) / (m.end - m.start));
    const actual = valueAt(date);
    tooltip.textContent = "";
    const head = document.createElement("div");
    head.className = "tt-date";
    head.textContent = dateFmt(date);
    tooltip.appendChild(head);
    const row = (color, value, label, dash) => {
      const r = document.createElement("div");
      r.className = "tt-row";
      r.innerHTML = `<i style="border-color:${color};${dash ? "border-top-style:dashed" : ""}"></i><b></b><span></span>`;
      r.querySelector("b").textContent = `${Math.round(value).toLocaleString()} ${unit}`;
      r.querySelector("span").textContent = label;
      tooltip.appendChild(r);
    };
    if (actual) row("var(--accent)", actual.v, actual.kind.toLowerCase(), actual.kind === "Projected");
    row("var(--pace)", pace, "allowance pace");
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth;
    const left = e.clientX + 16 + tw > window.innerWidth ? e.clientX - tw - 16 : e.clientX + 16;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${rect.top + pad.top}px`;
  };
  const leave = () => {
    cross.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  };
  hit.addEventListener("pointermove", move);
  hit.addEventListener("pointerdown", move);
  hit.addEventListener("pointerleave", leave);
  window.addEventListener("scroll", leave, { passive: true, once: true });
}
