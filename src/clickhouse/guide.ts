import "../style.css";
import { bindTooltips, lineChart, stackedBar } from "../charts.ts";
import { calculate, defaults, fmt, fmtBytesGB, formulaSheet, formulaTable, type Step } from "./calc.ts";

const i = defaults;
const r = calculate(i);
const [logs, traces, metrics] = r.signals;

const steps = (s: Step[]) =>
  `<table class="steps"><tbody>${s
    .map((x) => `<tr><th>${x.label}</th><td class="f">${x.formula}</td><td class="v">${x.value}</td></tr>`)
    .join("")}</tbody></table>`;
const pick = (labels: string[]) => r.steps.filter((s) => labels.includes(s.label));

const retentionCurve = Array.from({ length: 30 }, (_, k) => {
  const days = k + 1;
  return { x: days, y: calculate({ ...i, retentionDays: days }).perNodeDiskGB };
});

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<article class="guide">
  <nav class="back"><a href="../../">← OpsCalc</a> · <a href="../">Open calculator</a> · <a href="../design/">System design</a></nav>
  <h1>How ClickHouse server sizing works</h1>
  <p class="lead">A walkthrough of every formula the calculator uses, with a worked example:
  <b>${fmt(i.requestsPerHour, 0)} requests/hour</b>, ${i.retentionDays}-day retention, ${i.replicas} replicas.</p>

  <h2>The idea in one line</h2>
  <pre class="formula">disk = events/s × bytes/event × 86 400 ÷ compression × days × replicas ÷ max fill</pre>
  <p>Everything else is splitting that line into steps and adding I/O on top.</p>

  <h2>Cheat sheet</h2>
  <p>All formulas on one screen. Read top to bottom: each line uses the results above it.</p>
  <div class="card">${formulaTable(formulaSheet(i, r))}</div>
  <p class="note">Symbols: RPS requests/s · L, S, M log lines, spans, metric samples per second · D compressed bytes per day ·
  T stored bytes (one copy) · N disk per node · C cluster disk · W, R write and read MB/s.</p>

  <h2>1. Events per second</h2>
  <p>Each request produces log lines and trace spans. Metrics don't depend on requests: Prometheus
  writes one sample per series per scrape.</p>
  <pre class="formula">lines/s   = requests/hour ÷ 3600 × lines/request
spans/s   = requests/hour ÷ 3600 × spans/request × sampling
samples/s = active series ÷ scrape interval</pre>
  <p>Peak = average × peak factor (${i.peakFactor}×). Peak doesn't change disk size, but it sets write throughput.</p>
  ${steps([logs.steps[0], traces.steps[0], metrics.steps[0]])}

  <h2>2. Raw bytes per day</h2>
  <pre class="formula">raw/day = events/s × avg event size × 86 400</pre>
  ${steps([logs.steps[2], traces.steps[2], metrics.steps[2]])}

  <h2>3. Compression</h2>
  <p>ClickHouse stores columns separately and compresses each (LZ4/ZSTD, plus Delta/Gorilla codecs for numbers).
  Typical ratios: logs 8–15×, traces 6–12×, metrics 10–30×. This is the biggest unknown — measure it on a day of real data:</p>
  <pre class="formula">SELECT table,
       sum(data_uncompressed_bytes) / sum(data_compressed_bytes) AS ratio
FROM system.parts WHERE active GROUP BY table;</pre>
  ${steps([logs.steps[3], traces.steps[3], metrics.steps[3]])}
  <h3>LZ4 or ZSTD</h3>
  <p>ClickHouse compresses every column with <b>LZ4</b> by default: fast, but weaker. <b>ZSTD(1)</b> usually saves about
  <b>30% more disk</b> for a little more CPU on insert and merge. With batched inserts that CPU is negligible. Set it as the default
  for columns that have no codec of their own (SigNoz tables already set codecs on many columns):</p>
  <pre class="formula">&lt;!-- /etc/clickhouse-server/config.d/compression.xml --&gt;
&lt;clickhouse&gt;
  &lt;compression&gt;
    &lt;case&gt;&lt;method&gt;zstd&lt;/method&gt;&lt;level&gt;1&lt;/level&gt;&lt;/case&gt;
  &lt;/compression&gt;
&lt;/clickhouse&gt;</pre>
  <p>It applies to newly written parts and to parts rewritten by merges.</p>
  <table class="steps"><tbody>
    <tr><th>LZ4 (default)</th><td class="f">logs ~6–10×, traces ~5–8×</td><td class="v">least CPU</td></tr>
    <tr><th>ZSTD(1)</th><td class="f">logs ~8–15×, traces ~6–12×</td><td class="v">recommended</td></tr>
    <tr><th>ZSTD(3+)</th><td class="f">a few % better than ZSTD(1)</td><td class="v">rarely worth it</td></tr>
  </tbody></table>
  <p>No data yet? Paste sample log lines into <a href="../#sample">Measure from sample logs</a> on the calculator: it measures the
  average line size and estimates the ratio in your browser.</p>

  <h2>4. Retention</h2>
  <p>With <code>PARTITION BY toDate(ts)</code> and a TTL, ClickHouse drops whole days, so for a while you
  hold retention + 1 day.</p>
  ${steps([logs.steps[4], traces.steps[4], metrics.steps[4]])}
  <h3>Where the space goes</h3>
  <div class="chart" id="c-split">${stackedBar(r.signals.map((s) => ({ name: s.name, gb: s.retainedGB })))}</div>
  <p class="fxline">stored per signal = per day × (retention + 1)</p>
  <p class="note">Traces usually dominate. Sampling is the cheapest lever: 10% sampling cuts them 10×.</p>

  <h2>5. Disk per node</h2>
  <p>Replicas copy the data; shards split it. Never fill a disk above ~75%: merges need free space to rewrite parts.</p>
  <pre class="formula">disk/node = retained ÷ shards ÷ max fill
cluster   = retained × replicas ÷ max fill</pre>
  ${steps(pick(["Total retained (1 copy)", "Disk per node", "Cluster disk", "Disk per node + 1y growth"]))}
  <h3>Disk per node vs retention</h3>
  <div class="chart" id="c-ret">${lineChart(retentionCurve, { xLabel: "Retention days", yFmt: fmtBytesGB, mark: i.retentionDays })}</div>
  <p class="fxline">disk/node(days) = D × (days + 1) ÷ shards ÷ max fill</p>
  <p class="note">Disk grows linearly with retention: every extra day adds the same amount.</p>

  <h2>6. Write throughput</h2>
  <p>ClickHouse writes small parts, then merges them into bigger ones in the background, so each byte is
  written several times (<b>write amplification</b>, 3–5×).</p>
  <pre class="formula">write MB/s = compressed bytes/s × write amplification   (× peak factor for peak)</pre>
  ${steps(pick(["Compressed ingest (node)", "Write (avg)", "Write (peak)"]))}

  <h2>7. Read throughput and IOPS</h2>
  <p>Writes are usually small. Reads are the real load: a dashboard query scans gigabytes and must answer in seconds.</p>
  <pre class="formula">read MB/s = GB scanned per query ÷ target latency × concurrent queries
IOPS      = (write + read) MB/s ÷ I/O block size</pre>
  ${steps(pick(["Read", "IOPS"]))}
  <p>ClickHouse reads large sequential blocks (~256 KB–1 MB), so MB/s matters more than IOPS. Prefer NVMe.</p>

  <h2>8. RAM and CPU</h2>
  ${steps(pick(["RAM (node)", "vCPU (node)"]))}
  <p>Rules of thumb only. RAM caches hot data and runs GROUP BY; CPU does decompression and scans.</p>

  <h2>Where to get the inputs</h2>
  <table class="steps"><tbody>
    <tr><th>Requests/hour</th><td class="f">sum(increase(http_requests_total[1h]))</td></tr>
    <tr><th>Spans/s</th><td class="f">rate(otelcol_receiver_accepted_spans[5m])</td></tr>
    <tr><th>Active series</th><td class="f">prometheus_tsdb_head_series</td></tr>
    <tr><th>Log bytes/s (Loki)</th><td class="f">sum(rate(loki_distributor_bytes_received_total[1h]))</td></tr>
  </tbody></table>

  <p class="cta"><a class="btn primary" href="../">Try it with your numbers →</a></p>
</article>
`;

bindTooltips(document.querySelector("#app")!);
