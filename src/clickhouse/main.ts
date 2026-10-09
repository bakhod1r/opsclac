import "../style.css";
import { calculate, defaults, fmt, fmtBytesGB, type Inputs, type Step } from "./calc.ts";

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
  desc: string;
  fields: Field[];
}

const sections: Section[] = [
  {
    title: "1. Trafik",
    desc: "Backendga keladigan so'rovlar",
    fields: [
      { key: "requestsPerHour", label: "Request / soat", hint: "masalan 10 000 000" },
      { key: "peakFactor", label: "Peak koeffitsienti", unit: "×", step: 0.5, hint: "peak ÷ o'rtacha, odatda 2–3" },
    ],
  },
  {
    title: "2. Logs",
    desc: "Har bir request yozadigan log qatorlari",
    fields: [
      { key: "logLinesPerRequest", label: "Qator / request", step: 0.5 },
      { key: "logExtraEps", label: "Qo'shimcha qator / s", hint: "request'ga bog'liq bo'lmagan loglar (infra, k8s)" },
      { key: "logBytesPerLine", label: "O'rtacha qator hajmi", unit: "B" },
      { key: "logCompression", label: "Siqish", unit: "×", hint: "loglar uchun 8–15" },
    ],
  },
  {
    title: "3. Traces",
    desc: "Har bir request hosil qiladigan spanlar",
    fields: [
      { key: "spansPerRequest", label: "Span / request" },
      { key: "spanBytes", label: "O'rtacha span hajmi", unit: "B" },
      { key: "traceSamplingPct", label: "Sampling", unit: "%" },
      { key: "traceCompression", label: "Siqish", unit: "×", hint: "tracelar uchun 6–12" },
    ],
  },
  {
    title: "4. Metrics",
    desc: "Prometheus/OTel metrikalari",
    fields: [
      { key: "activeSeries", label: "Aktiv seriyalar", hint: "prometheus_tsdb_head_series" },
      { key: "scrapeIntervalSec", label: "Scrape interval", unit: "s" },
      { key: "sampleBytes", label: "Xom sample hajmi", unit: "B", hint: "label'lar bilan qator hajmi" },
      { key: "metricCompression", label: "Siqish", unit: "×", hint: "Delta/Gorilla bilan 10–30" },
    ],
  },
  {
    title: "5. Saqlash",
    desc: "Retention, replika va zaxira",
    fields: [
      { key: "retentionDays", label: "Retention", unit: "kun" },
      { key: "extraPartitionDays", label: "Qo'shimcha partitsiya", unit: "kun", hint: "TTL butun kunni o'chirguncha" },
      { key: "replicas", label: "Replika soni" },
      { key: "shards", label: "Shard soni" },
      { key: "maxDiskFillPct", label: "Disk to'lish chegarasi", unit: "%", hint: "merge uchun bo'sh joy, ≤75%" },
      { key: "yearlyGrowthPct", label: "Yillik o'sish", unit: "%" },
    ],
  },
  {
    title: "6. I/O va so'rovlar",
    desc: "Throughput va IOPS uchun",
    fields: [
      { key: "writeAmplification", label: "Write amplification", unit: "×", step: 0.5, hint: "merge tufayli 3–5" },
      { key: "ioBlockKB", label: "I/O blok hajmi", unit: "KB" },
      { key: "concurrentQueries", label: "Parallel so'rovlar" },
      { key: "scannedGBPerQuery", label: "Bitta so'rov skan qiladi", unit: "GB", step: 0.5, hint: "siqilgan hajm" },
      { key: "targetLatencySec", label: "Kutilgan javob vaqti", unit: "s" },
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
const app = document.querySelector<HTMLDivElement>("#app")!;

app.innerHTML = `
  <header>
    <a class="back" href="../">← OpsCalc</a>
    <h1>ClickHouse sizing</h1>
    <p>ClickHouse: Logs + Traces + Metrics uchun disk, throughput va IOPS kalkulyatori</p>
    <button id="reset" type="button">Standart qiymatlar</button>
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
    <p class="desc">${s.desc}</p>
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
  .join("");

const fieldEls = [...form.querySelectorAll<HTMLInputElement>("input[data-key]")];
function fillForm() {
  for (const el of fieldEls) el.value = String(inputs[el.dataset.key as Key]);
}

form.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  const v = Number(el.value);
  if (!el.dataset.key || !Number.isFinite(v) || v < 0) return;
  inputs = { ...inputs, [el.dataset.key]: v };
  save(inputs);
  render();
});

app.querySelector("#reset")!.addEventListener("click", () => {
  inputs = { ...defaults };
  save(inputs);
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

const out = app.querySelector<HTMLElement>("#out")!;
function render() {
  const r = calculate(inputs);
  out.innerHTML = `
    <div class="card summary">
      <h2>Natija</h2>
      <div class="tiles">
        <div><b>${fmtBytesGB(r.perNodeDiskGB)}</b><span>SSD / node</span></div>
        <div><b>${fmtBytesGB(r.perNodeDiskWithGrowthGB)}</b><span>SSD / node (+o'sish)</span></div>
        <div><b>${fmtBytesGB(r.clusterDiskGB)}</b><span>Klaster jami (${r.nodes} node)</span></div>
        <div><b>${fmt(r.writeMBsPeak)} MB/s</b><span>Yozish peak</span></div>
        <div><b>${fmt(r.readMBs)} MB/s</b><span>O'qish</span></div>
        <div><b>${fmt(r.iops, 0)}</b><span>IOPS</span></div>
        <div><b>${r.ramGB} GB</b><span>RAM / node</span></div>
        <div><b>${r.vcpu}</b><span>vCPU / node</span></div>
      </div>
      <table class="bysignal">
        <thead><tr><th></th><th>O'rtacha/s</th><th>Peak/s</th><th>Xom/kun</th><th>Siqilgan/kun</th><th>${inputs.retentionDays}+${inputs.extraPartitionDays} kun</th></tr></thead>
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
    <div class="card">
      <h2>Hisoblash qadamlari</h2>
      ${r.signals.map((s) => `<h3>${s.name}</h3>${stepsTable(s.steps)}`).join("")}
      <h3>Disk, throughput, IOPS</h3>
      ${stepsTable(r.steps)}
      <p class="note">Siqish koeffitsienti taxminiy. Real qiymatni o'lchash:
      <code>SELECT table, sum(data_uncompressed_bytes)/sum(data_compressed_bytes) FROM system.parts WHERE active GROUP BY table</code></p>
    </div>
  `;
}

fillForm();
render();
