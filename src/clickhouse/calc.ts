// ClickHouse observability storage sizing (logs / traces / metrics).
// All sizes are decimal: 1 GB = 1e9 B, 1 MB = 1e6 B.

export interface Inputs {
  // Traffic
  requestsPerHour: number;
  peakFactor: number;
  // Logs
  logLinesPerRequest: number;
  logExtraEps: number;
  logBytesPerLine: number;
  logCompression: number;
  // Traces
  spansPerRequest: number;
  spanBytes: number;
  traceSamplingPct: number;
  traceCompression: number;
  // Metrics
  activeSeries: number;
  scrapeIntervalSec: number;
  sampleBytes: number;
  metricCompression: number;
  // Storage
  retentionDays: number;
  extraPartitionDays: number;
  replicas: number;
  shards: number;
  maxDiskFillPct: number;
  yearlyGrowthPct: number;
  // I/O
  writeAmplification: number;
  ioBlockKB: number;
  concurrentQueries: number;
  scannedGBPerQuery: number;
  targetLatencySec: number;
}

export const defaults: Inputs = {
  requestsPerHour: 10_000_000,
  peakFactor: 3,
  logLinesPerRequest: 3,
  logExtraEps: 0,
  logBytesPerLine: 600,
  logCompression: 10,
  spansPerRequest: 8,
  spanBytes: 700,
  traceSamplingPct: 100,
  traceCompression: 8,
  activeSeries: 500_000,
  scrapeIntervalSec: 15,
  sampleBytes: 100,
  metricCompression: 20,
  retentionDays: 7,
  extraPartitionDays: 1,
  replicas: 2,
  shards: 1,
  maxDiskFillPct: 75,
  yearlyGrowthPct: 30,
  writeAmplification: 4,
  ioBlockKB: 256,
  concurrentQueries: 5,
  scannedGBPerQuery: 1,
  targetLatencySec: 5,
};

export interface Step {
  label: string;
  formula: string;
  value: string;
}

export interface SignalResult {
  name: string;
  epsAvg: number;
  epsPeak: number;
  rawGBPerDay: number;
  compressedGBPerDay: number;
  retainedGB: number; // one copy, whole cluster
  steps: Step[];
}

export interface Result {
  signals: SignalResult[];
  totalRetainedGB: number;
  clusterDiskGB: number;
  perNodeDiskGB: number;
  perNodeDiskWithGrowthGB: number;
  nodes: number;
  writeMBsAvg: number;
  writeMBsPeak: number;
  readMBs: number;
  iops: number;
  ramGB: number;
  vcpu: number;
  steps: Step[];
}

const DAY = 86_400;
const GB = 1e9;
const MB = 1e6;

export const fmt = (n: number, digits = 1): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: digits });

export function fmtBytesGB(gb: number): string {
  if (gb >= 1000) return `${fmt(gb / 1000, 2)} TB`;
  if (gb >= 1) return `${fmt(gb, 1)} GB`;
  return `${fmt(gb * 1000, 1)} MB`;
}

function signal(
  name: string,
  epsAvg: number,
  bytesPerEvent: number,
  compression: number,
  i: Inputs,
  epsStep: Step,
): SignalResult {
  const epsPeak = epsAvg * i.peakFactor;
  const rawGBPerDay = (epsAvg * bytesPerEvent * DAY) / GB;
  const compressedGBPerDay = rawGBPerDay / compression;
  const days = i.retentionDays + i.extraPartitionDays;
  const retainedGB = compressedGBPerDay * days;
  return {
    name,
    epsAvg,
    epsPeak,
    rawGBPerDay,
    compressedGBPerDay,
    retainedGB,
    steps: [
      epsStep,
      {
        label: "Peak events/s",
        formula: `${fmt(epsAvg)} × ${i.peakFactor}`,
        value: `${fmt(epsPeak)} /s`,
      },
      {
        label: "Raw per day",
        formula: `${fmt(epsAvg)} × ${fmt(bytesPerEvent)} B × 86 400 s`,
        value: fmtBytesGB(rawGBPerDay),
      },
      {
        label: "Compressed per day",
        formula: `${fmtBytesGB(rawGBPerDay)} ÷ ${compression}`,
        value: fmtBytesGB(compressedGBPerDay),
      },
      {
        label: "Retained (1 copy)",
        formula: `${fmtBytesGB(compressedGBPerDay)} × (${i.retentionDays} + ${i.extraPartitionDays}) days`,
        value: fmtBytesGB(retainedGB),
      },
    ],
  };
}

export function calculate(i: Inputs): Result {
  const rps = i.requestsPerHour / 3600;

  const logEps = rps * i.logLinesPerRequest + i.logExtraEps;
  const logs = signal("Logs", logEps, i.logBytesPerLine, i.logCompression, i, {
    label: "Avg lines/s",
    formula: `${fmt(i.requestsPerHour, 0)} ÷ 3600 × ${i.logLinesPerRequest}${i.logExtraEps ? ` + ${fmt(i.logExtraEps)}` : ""}`,
    value: `${fmt(logEps)} /s`,
  });

  const spanEps = rps * i.spansPerRequest * (i.traceSamplingPct / 100);
  const traces = signal("Traces", spanEps, i.spanBytes, i.traceCompression, i, {
    label: "Avg spans/s",
    formula: `${fmt(i.requestsPerHour, 0)} ÷ 3600 × ${i.spansPerRequest} × ${i.traceSamplingPct}%`,
    value: `${fmt(spanEps)} /s`,
  });

  const sampleEps = i.scrapeIntervalSec > 0 ? i.activeSeries / i.scrapeIntervalSec : 0;
  const metrics = signal("Metrics", sampleEps, i.sampleBytes, i.metricCompression, i, {
    label: "Avg samples/s",
    formula: `${fmt(i.activeSeries, 0)} series ÷ ${i.scrapeIntervalSec} s`,
    value: `${fmt(sampleEps)} /s`,
  });
  // Scrape load is steady; peak factor does not apply to metrics.
  metrics.epsPeak = sampleEps;
  metrics.steps[1] = {
    label: "Peak samples/s",
    formula: "scrape load is steady (peak = avg)",
    value: `${fmt(sampleEps)} /s`,
  };

  const signals = [logs, traces, metrics];
  const totalRetainedGB = signals.reduce((s, x) => s + x.retainedGB, 0);
  const fill = i.maxDiskFillPct / 100;
  const clusterDiskGB = (totalRetainedGB * i.replicas) / fill;
  const perNodeDiskGB = totalRetainedGB / i.shards / fill;
  const perNodeDiskWithGrowthGB = perNodeDiskGB * (1 + i.yearlyGrowthPct / 100);
  const nodes = i.shards * i.replicas;

  const compressedPerDay = signals.reduce((s, x) => s + x.compressedGBPerDay, 0);
  const compressedPeakPerDay = signals.reduce(
    (s, x) => s + (x.epsAvg > 0 ? x.compressedGBPerDay * (x.epsPeak / x.epsAvg) : 0),
    0,
  );
  const ingestMBs = (compressedPerDay * GB) / DAY / MB / i.shards;
  const writeMBsAvg = ingestMBs * i.writeAmplification;
  const writeMBsPeak = ((compressedPeakPerDay * GB) / DAY / MB / i.shards) * i.writeAmplification;
  const readMBs = ((i.scannedGBPerQuery * GB) / MB / i.targetLatencySec) * i.concurrentQueries / i.shards;
  const iops = ((writeMBsPeak + readMBs) * 1000) / i.ioBlockKB;

  const ramGB = Math.max(32, Math.ceil((compressedPerDay / i.shards) * 0.2 / 16) * 16);
  const vcpu = Math.max(8, Math.ceil(readMBs / 250 / 4) * 4);

  const steps: Step[] = [
    {
      label: "Total retained (1 copy)",
      formula: signals.map((s) => fmtBytesGB(s.retainedGB)).join(" + "),
      value: fmtBytesGB(totalRetainedGB),
    },
    {
      label: "Cluster disk",
      formula: `${fmtBytesGB(totalRetainedGB)} × ${i.replicas} replicas ÷ ${i.maxDiskFillPct}%`,
      value: fmtBytesGB(clusterDiskGB),
    },
    {
      label: "Disk per node",
      formula: `${fmtBytesGB(totalRetainedGB)} ÷ ${i.shards} shard ÷ ${i.maxDiskFillPct}%`,
      value: fmtBytesGB(perNodeDiskGB),
    },
    {
      label: "Disk per node + 1y growth",
      formula: `${fmtBytesGB(perNodeDiskGB)} × (1 + ${i.yearlyGrowthPct}%)`,
      value: fmtBytesGB(perNodeDiskWithGrowthGB),
    },
    {
      label: "Compressed ingest (node)",
      formula: `${fmtBytesGB(compressedPerDay)}/day ÷ 86 400 s ÷ ${i.shards} shard`,
      value: `${fmt(ingestMBs, 2)} MB/s`,
    },
    {
      label: "Write (avg)",
      formula: `${fmt(ingestMBs, 2)} MB/s × ${i.writeAmplification} (merge)`,
      value: `${fmt(writeMBsAvg)} MB/s`,
    },
    {
      label: "Write (peak)",
      formula: "logs/traces × peak factor, metrics steady",
      value: `${fmt(writeMBsPeak)} MB/s`,
    },
    {
      label: "Read",
      formula: `${i.scannedGBPerQuery} GB ÷ ${i.targetLatencySec} s × ${i.concurrentQueries} queries ÷ ${i.shards} shard`,
      value: `${fmt(readMBs)} MB/s`,
    },
    {
      label: "IOPS",
      formula: `(${fmt(writeMBsPeak)} + ${fmt(readMBs)}) MB/s ÷ ${i.ioBlockKB} KB`,
      value: fmt(iops, 0),
    },
    {
      label: "RAM (node)",
      formula: "max(32, compressed/day × 20%), rounded to 16 GB",
      value: `${ramGB} GB`,
    },
    {
      label: "vCPU (node)",
      formula: "max(8, read MB/s ÷ ~250 MB/s per core)",
      value: `${vcpu}`,
    },
  ];

  return {
    signals,
    totalRetainedGB,
    clusterDiskGB,
    perNodeDiskGB,
    perNodeDiskWithGrowthGB,
    nodes,
    writeMBsAvg,
    writeMBsPeak,
    readMBs,
    iops,
    ramGB,
    vcpu,
    steps,
  };
}

export interface Formula {
  name: string;
  symbolic: string; // with named variables
  numbers: string; // the same formula with this input's numbers
  result: string;
}

/** The key formulas, readable top to bottom: each line uses results of the lines above. */
export function formulaSheet(i: Inputs, r: Result): Formula[] {
  const [l, t, m] = r.signals;
  const rps = i.requestsPerHour / 3600;
  const perDay = r.signals.reduce((s, x) => s + x.compressedGBPerDay, 0);
  const days = i.retentionDays + i.extraPartitionDays;
  return [
    { name: "Requests/s", symbolic: "RPS = requests/hour ÷ 3600",
      numbers: `${fmt(i.requestsPerHour, 0)} ÷ 3600`, result: `${fmt(rps)} /s` },
    { name: "Log lines/s", symbolic: "L = RPS × lines/request + extra",
      numbers: `${fmt(rps)} × ${i.logLinesPerRequest} + ${fmt(i.logExtraEps)}`, result: `${fmt(l.epsAvg)} /s` },
    { name: "Spans/s", symbolic: "S = RPS × spans/request × sampling",
      numbers: `${fmt(rps)} × ${i.spansPerRequest} × ${i.traceSamplingPct}%`, result: `${fmt(t.epsAvg)} /s` },
    { name: "Samples/s", symbolic: "M = series ÷ scrape interval",
      numbers: `${fmt(i.activeSeries, 0)} ÷ ${i.scrapeIntervalSec}`, result: `${fmt(m.epsAvg)} /s` },
    { name: "Per day (compressed)", symbolic: "D = Σ events/s × bytes × 86400 ÷ compression",
      numbers: `${fmtBytesGB(l.compressedGBPerDay)} + ${fmtBytesGB(t.compressedGBPerDay)} + ${fmtBytesGB(m.compressedGBPerDay)}`,
      result: `${fmtBytesGB(perDay)} /day` },
    { name: "Stored (1 copy)", symbolic: "T = D × (retention + extra days)",
      numbers: `${fmtBytesGB(perDay)} × ${days}`, result: fmtBytesGB(r.totalRetainedGB) },
    { name: "SSD per node", symbolic: "N = T ÷ shards ÷ max fill",
      numbers: `${fmtBytesGB(r.totalRetainedGB)} ÷ ${i.shards} ÷ ${i.maxDiskFillPct}%`, result: fmtBytesGB(r.perNodeDiskGB) },
    { name: "SSD per node + growth", symbolic: "N × (1 + growth)",
      numbers: `${fmtBytesGB(r.perNodeDiskGB)} × ${1 + i.yearlyGrowthPct / 100}`, result: fmtBytesGB(r.perNodeDiskWithGrowthGB) },
    { name: "Cluster total", symbolic: "C = T × replicas ÷ max fill",
      numbers: `${fmtBytesGB(r.totalRetainedGB)} × ${i.replicas} ÷ ${i.maxDiskFillPct}%`, result: fmtBytesGB(r.clusterDiskGB) },
    { name: "Write peak", symbolic: "W = D_peak ÷ 86400 ÷ shards × write amp.",
      numbers: `${fmt(r.writeMBsPeak / i.writeAmplification, 2)} MB/s × ${i.writeAmplification}`, result: `${fmt(r.writeMBsPeak)} MB/s` },
    { name: "Read", symbolic: "R = scanned GB ÷ latency × queries ÷ shards",
      numbers: `${i.scannedGBPerQuery} GB ÷ ${i.targetLatencySec} s × ${i.concurrentQueries} ÷ ${i.shards}`, result: `${fmt(r.readMBs)} MB/s` },
    { name: "IOPS", symbolic: "(W + R) ÷ block size",
      numbers: `(${fmt(r.writeMBsPeak)} + ${fmt(r.readMBs)}) MB/s ÷ ${i.ioBlockKB} KB`, result: fmt(r.iops, 0) },
  ];
}

export const formulaTable = (f: Formula[]): string =>
  `<div class="scroll"><table class="fsheet"><thead><tr><th>Result</th><th>Formula</th><th>With your numbers</th><th class="num">=</th></tr></thead><tbody>${f
    .map((x) => `<tr><th>${x.name}</th><td class="sym">${x.symbolic}</td><td class="f">${x.numbers}</td><td class="v">${x.result}</td></tr>`)
    .join("")}</tbody></table></div>`;
