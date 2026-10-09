import "../style.css";
import { bindTooltips, stackedBar } from "../charts.ts";
import { awsDefaults, familyNames, HOURS_PER_MONTH, pickInstance, type AwsOptions } from "./aws.ts";
import { calculate, defaults, fmt, fmtBytesGB, formulaSheet, formulaTable, type Inputs, type Step } from "./calc.ts";

type Key = keyof Inputs;
interface Field {
  key: Key;
  label: string;
  unit?: string;
  hint?: string;
  step?: number;
}
interface Section {
  title: string;
  fields: Field[];
}

const sections: Section[] = [
  {
    title: "Traffic",
    fields: [
      { key: "requestsPerHour", label: "Requests / hour" },
      { key: "peakFactor", label: "Peak factor", unit: "×", step: 0.5, hint: "peak ÷ avg, usually 2–3" },
    ],
  },
  {
    title: "Logs",
    fields: [
      { key: "logLinesPerRequest", label: "Lines / request", step: 0.5 },
      { key: "logExtraEps", label: "Extra lines / s", hint: "not tied to requests (infra, k8s)" },
      { key: "logBytesPerLine", label: "Avg line size", unit: "B" },
      { key: "logCompression", label: "Compression", unit: "×", hint: "8–15 for logs" },
    ],
  },
  {
    title: "Traces",
    fields: [
      { key: "spansPerRequest", label: "Spans / request" },
      { key: "spanBytes", label: "Avg span size", unit: "B" },
      { key: "traceSamplingPct", label: "Sampling", unit: "%" },
      { key: "traceCompression", label: "Compression", unit: "×", hint: "6–12 for traces" },
    ],
  },
  {
    title: "Metrics",
    fields: [
      { key: "activeSeries", label: "Active series" },
      { key: "scrapeIntervalSec", label: "Scrape interval", unit: "s" },
      { key: "sampleBytes", label: "Raw sample size", unit: "B" },
      { key: "metricCompression", label: "Compression", unit: "×", hint: "10–30 with Delta/Gorilla" },
    ],
  },
  {
    title: "Storage",
    fields: [
      { key: "retentionDays", label: "Retention", unit: "days" },
      { key: "extraPartitionDays", label: "Extra partition", unit: "days" },
      { key: "replicas", label: "Replicas" },
      { key: "shards", label: "Shards" },
      { key: "maxDiskFillPct", label: "Max disk fill", unit: "%", hint: "keep ≤75% for merges" },
      { key: "yearlyGrowthPct", label: "Yearly growth", unit: "%" },
    ],
  },
  {
    title: "I/O & queries",
    fields: [
      { key: "writeAmplification", label: "Write amplification", unit: "×", step: 0.5, hint: "merges, 3–5" },
      { key: "ioBlockKB", label: "I/O block size", unit: "KB" },
      { key: "concurrentQueries", label: "Concurrent queries" },
      { key: "scannedGBPerQuery", label: "Scanned per query", unit: "GB", step: 0.5, hint: "compressed" },
      { key: "targetLatencySec", label: "Target latency", unit: "s" },
    ],
  },
];

const STORAGE_KEY = "opsclac.inputs";
function load(): Inputs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...defaults };
}
function save(i: Inputs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(i));
  } catch {
    /* ignore */
  }
}

let inputs = load();
const AWS_KEY = "opsclac.aws";
let aws: AwsOptions = (() => {
  try {
    const raw = localStorage.getItem(AWS_KEY);
    if (raw) return { ...awsDefaults, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...awsDefaults };
})();
function saveAws() {
  try {
    localStorage.setItem(AWS_KEY, JSON.stringify(aws));
  } catch {
    /* ignore */
  }
}
const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header>
    <nav class="back"><a href="../">← OpsCalc</a> · <a href="./guide/">How it works</a> · <a href="./design/">System design</a></nav>
    <h1>ClickHouse server sizing for logs, metrics &amp; traces</h1>
    <p>Disk, throughput and IOPS for logs, traces and metrics</p>
    <button id="reset" type="button">Reset</button>
  </header>
  <main>
    <section id="form"></section>
    <section id="out"></section>
  </main>
`;

const form = app.querySelector<HTMLElement>("#form")!;
form.innerHTML = sections
  .map(
    (s) => `
  <fieldset class="card">
    <legend>${s.title}</legend>
    ${s.fields
      .map(
        (f) => `
      <label>
        <span>${f.label}${f.unit ? ` <em>(${f.unit})</em>` : ""}</span>
        <input type="number" min="0" step="${f.step ?? 1}" data-key="${f.key}" />
        ${f.hint ? `<small>${f.hint}</small>` : ""}
      </label>`,
      )
      .join("")}
  </fieldset>`,
  )
  .join("") +
  `<fieldset class="card">
    <legend>AWS instance</legend>
    <label><span>Family</span><select data-aws="family">
      <option value="any">Any (EBS)</option>${(["C", "M", "R", "I"] as const).map((f) => `<option value="${f}">${f} · ${familyNames[f]}</option>`).join("")}
    </select></label>
    <label><span>CPU architecture</span><select data-aws="arch">
      <option value="any">Any</option><option value="x86">x86 (Intel/AMD)</option><option value="arm">ARM (Graviton)</option>
    </select></label>
    <label><span>CPU headroom <em>(×)</em></span><input type="number" min="1" step="0.5" data-aws="cpuHeadroom" />
      <small>spare CPU for peaks and heavy queries</small></label>
  </fieldset>`;

const fieldEls = [...form.querySelectorAll<HTMLInputElement>("input[data-key]")];
function fillForm() {
  for (const el of fieldEls) el.value = String(inputs[el.dataset.key as Key]);
  form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-aws]").forEach((el) => {
    el.value = String(aws[el.dataset.aws as keyof AwsOptions]);
  });
}

form.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.dataset.aws) {
    const k = el.dataset.aws as keyof AwsOptions;
    const val = k === "cpuHeadroom" ? Number(el.value) : el.value;
    if (k === "cpuHeadroom" && (!Number.isFinite(val as number) || (val as number) < 1)) return;
    aws = { ...aws, [k]: val } as AwsOptions;
    saveAws();
    render();
    return;
  }
  const v = Number(el.value);
  if (!el.dataset.key || !Number.isFinite(v) || v < 0) return;
  inputs = { ...inputs, [el.dataset.key]: v };
  save(inputs);
  render();
});

app.querySelector("#reset")!.addEventListener("click", () => {
  inputs = { ...defaults };
  aws = { ...awsDefaults };
  save(inputs);
  saveAws();
  fillForm();
  render();
});

const stepsTable = (steps: Step[]) => `
  <table class="steps">
    <tbody>
      ${steps
        .map(
          (s) => `<tr><th>${s.label}</th><td class="f">${s.formula}</td><td class="v">${s.value}</td></tr>`,
        )
        .join("")}
    </tbody>
  </table>`;

const usd = (n: number) => `$${fmt(n, 0)}`;
function awsCard(r: ReturnType<typeof calculate>) {
  const p = pickInstance(r, aws, inputs.replicas);
  const b = p.best;
  const head = b
    ? `<div class="aws-pick">
        <div><span class="lbl">Instance / node</span><b>${b.type}</b><small>${b.vcpu} vCPU · ${b.ramGiB} GiB · ${b.arch} · ${familyNames[b.family]}${b.nvmeGB ? ` · ${fmt(b.nvmeGB / 1000)} TB NVMe` : ""}</small><small>${usd(b.usdHour * HOURS_PER_MONTH)}/mo</small></div>
        ${p.gp3 ? `<div><span class="lbl">Disk / node</span><b>gp3 ${fmt(p.gp3.sizeGiB, 0)} GiB</b><small>${fmt(p.gp3.iops, 0)} IOPS · ${p.gp3.throughput} MB/s${p.gp3.volumes > 1 ? ` · ${p.gp3.volumes} volumes` : ""}</small><small>${usd(p.gp3.usdMonth)}/mo</small></div>` : ""}
        <div><span class="lbl">Total (${r.nodes} node${r.nodes > 1 ? "s" : ""})</span><b>${usd(p.clusterUsdMonth)}/mo</b><small>${usd(p.nodeUsdMonth)}/mo per node</small></div>
      </div>`
    : "";
  const alts = p.fits.slice(0, 6);
  return `<div class="card">
    <h2>AWS instance</h2>
    <p class="note" style="margin:0 0 12px">Needs per node: <b>${p.needVcpu} vCPU</b>, <b>${p.needRam} GB RAM</b>, <b>${fmtBytesGB(r.perNodeDiskWithGrowthGB)}</b> disk.</p>
    ${head}
    ${p.warnings.map((w) => `<p class="warn">⚠️ ${w}</p>`).join("")}
    ${alts.length ? `<div class="scroll"><table class="bysignal aws-t"><thead><tr><th>Fits (cheapest first)</th><th>vCPU</th><th>RAM</th><th>Arch</th><th>$/hour</th><th>$/month</th></tr></thead><tbody>
      ${alts.map((x, k) => `<tr${k === 0 ? ' class="hl"' : ""}><th>${x.type}</th><td>${x.vcpu}</td><td>${x.ramGiB} GiB</td><td>${x.arch}</td><td>$${x.usdHour.toFixed(3)}</td><td>${usd(x.usdHour * HOURS_PER_MONTH)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
    ${formulaTable(p.formulas)}
    <p class="note">Prices: approximate us-east-1 on-demand Linux. Check the AWS Pricing Calculator; Savings Plans cut instance cost ~30–40%.</p>
  </div>`;
}

const out = app.querySelector<HTMLElement>("#out")!;
function render() {
  const r = calculate(inputs);
  const d = out.querySelector("details");
  const open = !d || d.open ? " open" : "";
  out.innerHTML = `
    <div class="card summary">
      
      <div class="tiles">
        <div><b>${fmtBytesGB(r.perNodeDiskGB)}</b><span>SSD / node</span><code class="tf">T ÷ shards ÷ fill</code></div>
        <div><b>${fmtBytesGB(r.perNodeDiskWithGrowthGB)}</b><span>SSD / node (+growth)</span><code class="tf">N × (1 + growth)</code></div>
        <div><b>${fmtBytesGB(r.clusterDiskGB)}</b><span>Cluster total (${r.nodes} nodes)</span><code class="tf">T × replicas ÷ fill</code></div>
        <div><b>${fmt(r.writeMBsPeak)} MB/s</b><span>Write peak</span><code class="tf">ingest × write amp.</code></div>
        <div><b>${fmt(r.readMBs)} MB/s</b><span>Read</span><code class="tf">scan ÷ latency × queries</code></div>
        <div><b>${fmt(r.iops, 0)}</b><span>IOPS</span><code class="tf">(W + R) ÷ block</code></div>
        <div><b>${r.ramGB} GB</b><span>RAM / node</span><code class="tf">≈ 20% of daily data</code></div>
        <div><b>${r.vcpu}</b><span>vCPU / node</span><code class="tf">read MB/s ÷ 250</code></div>
      </div>
      <div class="chart">${stackedBar(r.signals.map((s) => ({ name: s.name, gb: s.retainedGB })))}</div>
      <table class="bysignal">
        <thead><tr><th></th><th>Avg/s</th><th>Peak/s</th><th>Raw/day</th><th>Compressed/day</th><th>${inputs.retentionDays}+${inputs.extraPartitionDays} days</th></tr><tr class="frow"><th>formula</th><td>RPS × n</td><td>avg × peak</td><td>avg × B × 86400</td><td>raw ÷ compression</td><td>per day × days</td></tr></thead>
        <tbody>
          ${r.signals
            .map(
              (s) =>
                `<tr><th>${s.name}</th><td>${fmt(s.epsAvg, 0)}</td><td>${fmt(s.epsPeak, 0)}</td><td>${fmtBytesGB(s.rawGBPerDay)}</td><td>${fmtBytesGB(s.compressedGBPerDay)}</td><td>${fmtBytesGB(s.retainedGB)}</td></tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>
${awsCard(r)}
    <div class="card"><h2>Formulas</h2>${formulaTable(formulaSheet(inputs, r))}</div>
    <details class="card"${open}>
      <summary>Step-by-step details</summary>
      ${r.signals.map((s) => `<h3>${s.name}</h3>${stepsTable(s.steps)}`).join("")}
      <h3>Disk, throughput, IOPS</h3>
      ${stepsTable(r.steps)}
      <p class="note">Compression ratios are estimates. Measure yours:
      <code>SELECT table, sum(data_uncompressed_bytes)/sum(data_compressed_bytes) FROM system.parts WHERE active GROUP BY table</code></p>
    </details>
  `;
  bindTooltips(out);
}

fillForm();
render();
