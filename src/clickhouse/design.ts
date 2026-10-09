import "../style.css";
import { bindTooltips, stackedBar } from "../charts.ts";
import { calculate, defaults, fmt, fmtBytesGB, type Inputs } from "./calc.ts";

// Reference workload: 3,000 req/s at the API gateway, 10 services behind it.
const RPS = 3000;

interface Scenario {
  name: string;
  services: number; // services a request passes through
  linesPerService: number;
  lineBytes: number;
  spansPerService: number;
  spanBytes: number;
  sampling: number;
  series: number;
  interval: number;
  days: number;
  comp: [number, number, number]; // logs, traces, metrics
  shards: number;
  hw: [string, string];
}

const scenarios: Scenario[] = [
  { name: "Low", services: 3, linesPerService: 2, lineBytes: 600, spansPerService: 1, spanBytes: 500, sampling: 10,
    series: 200_000, interval: 30, days: 10, comp: [12, 10, 25], shards: 1,
    hw: ["2 × i3en.2xlarge (5 TB NVMe)", "2 × r6g.2xlarge + gp3 2.5 TB"] },
  { name: "Medium", services: 5, linesPerService: 3, lineBytes: 800, spansPerService: 2, spanBytes: 700, sampling: 50,
    series: 500_000, interval: 15, days: 12, comp: [10, 8, 20], shards: 2,
    hw: ["4 × i3en.3xlarge (7.5 TB NVMe)", "4 × r6g.4xlarge + gp3 6 TB"] },
  { name: "High", services: 10, linesPerService: 5, lineBytes: 1000, spansPerService: 3, spanBytes: 1000, sampling: 100,
    series: 1_000_000, interval: 15, days: 15, comp: [8, 6, 15], shards: 4,
    hw: ["8 × i3en.6xlarge + S3 tier", "8 × r6g.8xlarge + gp3 + S3 tier"] },
];

const inputsFor = (s: Scenario): Inputs => ({
  ...defaults,
  requestsPerHour: RPS * 3600,
  peakFactor: 2,
  logLinesPerRequest: s.services * s.linesPerService + 2, // +2 at the gateway
  logBytesPerLine: s.lineBytes,
  logCompression: s.comp[0],
  spansPerRequest: s.services * s.spansPerService + 1, // +1 gateway span
  spanBytes: s.spanBytes,
  traceSamplingPct: s.sampling,
  traceCompression: s.comp[1],
  activeSeries: s.series,
  scrapeIntervalSec: s.interval,
  metricCompression: s.comp[2],
  retentionDays: s.days,
  replicas: 2,
  shards: s.shards,
  scannedGBPerQuery: 2,
});

const rows = scenarios.map((s) => ({ s, i: inputsFor(s), r: calculate(inputsFor(s)) }));
const mid = rows[1];

const th = rows.map((x) => `<th class="num">${x.s.name}</th>`).join("");
const tr = (label: string, f: (x: (typeof rows)[number]) => string, hl = false) =>
  `<tr${hl ? ' class="hl"' : ""}><th>${label}</th>${rows.map((x) => `<td class="num">${f(x)}</td>`).join("")}</tr>`;

const box = (title: string, sub: string, dark = false) =>
  `<div class="arch-box${dark ? " dark" : ""}"><b>${title}</b><span>${sub}</span></div>`;

const m = mid.r;
const [ml, mt, mm] = m.signals;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<article class="guide">
  <nav class="back"><a href="../../">← OpsCalc</a> · <a href="../">Calculator</a> · <a href="../guide/">How it works</a></nav>
  <h1>System design: observability on ClickHouse</h1>
  <p class="lead">Logs, traces and metrics for <b>${fmt(RPS, 0)} req/s</b> at the API gateway and
  <b>10 services</b> behind it, kept <b>10–15 days</b>. All numbers below are computed live by the calculator.</p>

  <h2>Requirements</h2>
  <div class="tiles">
    <div><b>${fmt(RPS, 0)}/s</b><span>requests at the gateway (peak ×2)</span></div>
    <div><b>10</b><span>services, each logs and traces</span></div>
    <div><b>10–15 days</b><span>retention for every signal</span></div>
    <div><b>2×</b><span>replicas, survive a node loss</span></div>
  </div>

  <h2>Architecture</h2>
  <div class="arch">
    ${box("Services", "10 services, OTel SDK, JSON logs")}<i>→</i>
    ${box("OTel Collector", "agent per node, gateway batches & samples")}<i>→</i>
    ${box("Kafka", "optional buffer for peaks/outages")}<i>→</i>
    ${box("ClickHouse", "shards × 2 replicas, Keeper ×3", true)}<i>→</i>
    ${box("Grafana", "dashboards, explore, alerts")}
  </div>
  <p>Only the collector writes to ClickHouse, in large batches. Services never talk to the database directly.</p>

  <h2>Ingestion rules</h2>
  <ul>
    <li><b>Batch big:</b> 10k–100k rows per insert, ~1 insert/s per table. Small inserts create too many parts.</li>
    <li><b>Sample traces:</b> tail sampling in the collector — keep all errors and slow traces, 10–50% of the rest.</li>
    <li><b>Drop noise early:</b> filter DEBUG and health-check logs before they cost disk.</li>
    <li><b>Don't lose data:</b> persistent collector queue or Kafka, so a ClickHouse restart drops nothing.</li>
  </ul>

  <h2>Data model</h2>
  <pre class="formula">CREATE TABLE otel_logs ( … )
ENGINE = ReplicatedMergeTree
PARTITION BY toDate(Timestamp)          -- TTL drops whole days
ORDER BY (ServiceName, Timestamp)       -- most queries filter by both
TTL toDate(Timestamp) + INTERVAL ${mid.s.days} DAY
SETTINGS ttl_only_drop_parts = 1;</pre>
  <p>One table per signal: <code>otel_logs</code>, <code>otel_traces</code>, <code>otel_metrics_*</code> (the OTel ClickHouse exporter's layout). ZSTD for text, Delta/Gorilla for numbers.</p>

  <h2>Sizing: three scenarios</h2>
  <div class="card"><table class="bysignal design-t">
    <thead><tr><th></th>${th}</tr></thead>
    <tbody>
      ${tr("Services per request", (x) => `${x.s.services}`)}
      ${tr("Log lines / request", (x) => `${x.i.logLinesPerRequest} × ${x.s.lineBytes} B`)}
      ${tr("Spans / request, sampling", (x) => `${x.i.spansPerRequest}, ${x.s.sampling}%`)}
      ${tr("Metric series", (x) => `${x.s.series >= 1e6 ? `${fmt(x.s.series / 1e6)}M` : `${fmt(x.s.series / 1000, 0)}k`} / ${x.s.interval} s`)}
      ${tr("Retention", (x) => `${x.s.days} days`, true)}
      ${tr("Logs / day (compressed)", (x) => fmtBytesGB(x.r.signals[0].compressedGBPerDay))}
      ${tr("Traces / day (compressed)", (x) => fmtBytesGB(x.r.signals[1].compressedGBPerDay))}
      ${tr("Metrics / day (compressed)", (x) => fmtBytesGB(x.r.signals[2].compressedGBPerDay))}
      ${tr("Stored, 1 copy", (x) => `<b>${fmtBytesGB(x.r.totalRetainedGB)}</b>`, true)}
      ${tr("Topology", (x) => `${x.s.shards} shard × 2`)}
      ${tr("Disk / node (+growth)", (x) => `<b>${fmtBytesGB(x.r.perNodeDiskWithGrowthGB)}</b>`, true)}
      ${tr("Cluster total", (x) => fmtBytesGB(x.r.clusterDiskGB))}
      ${tr("Write peak / node", (x) => `${fmt(x.r.writeMBsPeak)} MB/s`)}
      ${tr("RAM / node", (x) => `${x.r.ramGB} GB`)}
    </tbody>
  </table></div>
  <h3>Where the space goes</h3>
  ${rows.map((x) => `<p class="note">${x.s.name}: ${fmtBytesGB(x.r.totalRetainedGB)}</p><div class="chart">${stackedBar(x.r.signals.map((s) => ({ name: s.name, gb: s.retainedGB })))}</div>`).join("")}
  <p class="note">Logs drive the size. Filtering logs and sampling traces is the cheapest way to move from High to Medium.</p>

  <h2>How Medium is calculated</h2>
  <pre class="formula">Logs:    ${fmt(RPS, 0)} × ${mid.i.logLinesPerRequest} = ${fmt(ml.epsAvg, 0)} lines/s × ${mid.s.lineBytes} B × 86400 = ${fmtBytesGB(ml.rawGBPerDay)}/day ÷ ${mid.s.comp[0]} = ${fmtBytesGB(ml.compressedGBPerDay)}/day
Traces:  ${fmt(RPS, 0)} × ${mid.i.spansPerRequest} × ${mid.s.sampling}% = ${fmt(mt.epsAvg, 0)} spans/s × ${mid.s.spanBytes} B × 86400 = ${fmtBytesGB(mt.rawGBPerDay)}/day ÷ ${mid.s.comp[1]} = ${fmtBytesGB(mt.compressedGBPerDay)}/day
Metrics: ${fmt(mid.s.series, 0)} ÷ ${mid.s.interval} s = ${fmt(mm.epsAvg, 0)} samples/s × 100 B × 86400 = ${fmtBytesGB(mm.rawGBPerDay)}/day ÷ ${mid.s.comp[2]} = ${fmtBytesGB(mm.compressedGBPerDay)}/day
Stored:  ${fmtBytesGB(m.signals.reduce((a, s) => a + s.compressedGBPerDay, 0))}/day × (${mid.s.days} + 1) days = ${fmtBytesGB(m.totalRetainedGB)}
Node:    ${fmtBytesGB(m.totalRetainedGB)} ÷ ${mid.s.shards} shards ÷ 75% = ${fmtBytesGB(m.perNodeDiskGB)}  (+30% growth = ${fmtBytesGB(m.perNodeDiskWithGrowthGB)})</pre>

  <h2>Hardware</h2>
  <div class="card"><table class="bysignal design-t">
    <thead><tr><th></th><th>Option A: local NVMe</th><th>Option B: EBS</th></tr></thead>
    <tbody>${rows.map((x) => `<tr${x === mid ? ' class="hl"' : ""}><th>${x.s.name}</th><td>${x.s.hw[0]}</td><td>${x.s.hw[1]}</td></tr>`).join("")}</tbody>
  </table></div>
  <p>Plus 3 small ClickHouse Keeper nodes (t4g.small). gp3: provision 6,000+ IOPS and 500–1,000 MB/s.
  Local NVMe is lost on stop, so replicas and S3 backups are mandatory.</p>

  <h2>Operations</h2>
  <ul>
    <li><b>Replication:</b> ReplicatedMergeTree + Keeper ×3; one node down, queries keep working.</li>
    <li><b>Backup:</b> clickhouse-backup to S3 daily, restore tested monthly.</li>
    <li><b>Tiered storage:</b> last 3 days on NVMe, older on S3 — cuts SSD 3–5× in High.</li>
    <li><b>Watch:</b> disk fill, parts per partition, merge backlog, insert errors, query p95.</li>
  </ul>

  <h2>Next steps</h2>
  <ol>
    <li>Measure real GB/day per signal from current data (total size ÷ days it covers).</li>
    <li>Load one day into ClickHouse and read the real compression ratio.</li>
    <li>Agree on trace sampling and log levels.</li>
    <li>Start with Medium (4 nodes); add a shard when disk passes 70%.</li>
  </ol>
  <p class="cta"><a href="../">Recalculate with your numbers →</a></p>
</article>
`;

bindTooltips(document.querySelector("#app")!);
