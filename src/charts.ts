// Tiny SVG charts (no deps). Colors = validated categorical slots 1–3.
import { fmtBytesGB } from "./clickhouse/calc.ts";

export const SERIES = ["var(--s1)", "var(--s2)", "var(--s3)"];

let tip: HTMLDivElement | null = null;
function tooltip(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "viz-tip";
    document.body.appendChild(tip);
  }
  return tip;
}
export function bindTooltips(root: HTMLElement) {
  root.querySelectorAll<SVGElement>("[data-tip]").forEach((el) => {
    el.addEventListener("pointermove", (e) => {
      const t = tooltip();
      t.innerHTML = el.dataset.tip!;
      t.style.display = "block";
      t.style.left = `${e.clientX + 12}px`;
      t.style.top = `${e.clientY + 12}px`;
    });
    el.addEventListener("pointerleave", () => (tooltip().style.display = "none"));
  });
}

/** Single horizontal stacked bar: parts of a whole. */
export function stackedBar(parts: { name: string; gb: number }[]): string {
  const total = parts.reduce((s, p) => s + p.gb, 0) || 1;
  const W = 600, H = 28, gap = 2;
  let x = 0;
  const rects = parts
    .map((p, i) => {
      const w = Math.max(0, (p.gb / total) * W - gap);
      const r = `<rect x="${x}" y="0" width="${w}" height="${H}" rx="4" fill="${SERIES[i]}"
        data-tip="<b>${p.name}</b><br>${fmtBytesGB(p.gb)} (${Math.round((p.gb / total) * 100)}%)"/>`;
      x += (p.gb / total) * W;
      return r;
    })
    .join("");
  const legend = parts
    .map(
      (p, i) =>
        `<span><i style="background:${SERIES[i]}"></i>${p.name} <b>${fmtBytesGB(p.gb)}</b></span>`,
    )
    .join("");
  return `<svg class="viz" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
    aria-label="Storage by signal">${rects}</svg><div class="legend">${legend}</div>`;
}

/** Single-series line chart with crosshair tooltip. */
export function lineChart(
  pts: { x: number; y: number }[],
  opts: { xLabel: string; yFmt: (y: number) => string; mark?: number },
): string {
  const W = 600, H = 220, L = 56, B = 28, T = 10, R = 10;
  const maxX = Math.max(...pts.map((p) => p.x)), minX = Math.min(...pts.map((p) => p.x));
  const maxY = Math.max(...pts.map((p) => p.y)) * 1.1 || 1;
  const sx = (x: number) => L + ((x - minX) / (maxX - minX || 1)) * (W - L - R);
  const sy = (y: number) => T + (1 - y / maxY) * (H - T - B);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxY * f);
  const grid = ticks
    .map(
      (t) =>
        `<line x1="${L}" x2="${W - R}" y1="${sy(t)}" y2="${sy(t)}" class="grid"/><text x="${L - 6}" y="${sy(t) + 4}" text-anchor="end">${opts.yFmt(t)}</text>`,
    )
    .join("");
  const xt = pts
    .filter((_, i) => i % Math.ceil(pts.length / 8) === 0)
    .map((p) => `<text x="${sx(p.x)}" y="${H - 8}" text-anchor="middle">${p.x}</text>`)
    .join("");
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.x)},${sy(p.y)}`).join("");
  const m = pts.find((p) => p.x === opts.mark);
  const mark = m
    ? `<circle cx="${sx(m.x)}" cy="${sy(m.y)}" r="5" fill="var(--s1)" stroke="var(--card)" stroke-width="2"/>
       <text x="${sx(m.x) + 8}" y="${sy(m.y) - 8}" class="lbl">${opts.yFmt(m.y)}</text>`
    : "";
  const step = (W - L - R) / (pts.length - 1 || 1);
  const hits = pts
    .map(
      (p) =>
        `<rect x="${sx(p.x) - step / 2}" y="${T}" width="${step}" height="${H - T - B}" fill="transparent"
          data-tip="${opts.xLabel}: <b>${p.x}</b><br>${opts.yFmt(p.y)}"/>`,
    )
    .join("");
  return `<svg class="viz line" viewBox="0 0 ${W} ${H}" role="img" aria-label="${opts.xLabel} chart">
    ${grid}${xt}<path d="${d}" fill="none" stroke="var(--s1)" stroke-width="2"/>${mark}${hits}
    <text x="${W - R}" y="${H - 8 - 14}" text-anchor="end" class="axis">${opts.xLabel} →</text></svg>`;
}
