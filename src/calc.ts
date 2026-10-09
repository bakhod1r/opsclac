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
        label: "Peak hodisa/s",
        formula: `${fmt(epsAvg)} × ${i.peakFactor}`,
        value: `${fmt(epsPeak)} /s`,
      },
      {
        label: "Kunlik xom hajm",
        formula: `${fmt(epsAvg)} × ${fmt(bytesPerEvent)} B × 86 400 s`,
        value: fmtBytesGB(rawGBPerDay),
      },
      {
        label: "Kunlik siqilgan",
        formula: `${fmtBytesGB(rawGBPerDay)} ÷ ${compression}`,
        value: fmtBytesGB(compressedGBPerDay),
      },
      {
        label: "Retention davomida (1 nusxa)",
        formula: `${fmtBytesGB(compressedGBPerDay)} × (${i.retentionDays} + ${i.extraPartitionDays}) kun`,
        value: fmtBytesGB(retainedGB),
      },
    ],
  };
}

export function calculate(i: Inputs): Result {
  const rps = i.requestsPerHour / 3600;

  const logEps = rps * i.logLinesPerRequest + i.logExtraEps;
  const logs = signal("Logs", logEps, i.logBytesPerLine, i.logCompression, i, {
    label: "O'rtacha qator/s",
    formula: `${fmt(i.requestsPerHour, 0)} ÷ 3600 × ${i.logLinesPerRequest}${i.logExtraEps ? ` + ${fmt(i.logExtraEps)}` : ""}`,
    value: `${fmt(logEps)} /s`,
  });

  const spanEps = rps * i.spansPerRequest * (i.traceSamplingPct / 100);
  const traces = signal("Traces", spanEps, i.spanBytes, i.traceCompression, i, {
    label: "O'rtacha span/s",
    formula: `${fmt(i.requestsPerHour, 0)} ÷ 3600 × ${i.spansPerRequest} × ${i.traceSamplingPct}%`,
    value: `${fmt(spanEps)} /s`,
  });

  const sampleEps = i.scrapeIntervalSec > 0 ? i.activeSeries / i.scrapeIntervalSec : 0;
  const metrics = signal("Metrics", sampleEps, i.sampleBytes, i.metricCompression, i, {
    label: "O'rtacha sample/s",
    formula: `${fmt(i.activeSeries, 0)} seriya ÷ ${i.scrapeIntervalSec} s`,
    value: `${fmt(sampleEps)} /s`,
  });
  // Scrape load is steady; peak factor does not apply to metrics.
  metrics.epsPeak = sampleEps;
  metrics.steps[1] = {
    label: "Peak sample/s",
    formula: "scrape yuki doimiy (peak = o'rtacha)",
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
      label: "Jami saqlanadigan (1 nusxa)",
      formula: signals.map((s) => fmtBytesGB(s.retainedGB)).join(" + "),
      value: fmtBytesGB(totalRetainedGB),
    },
    {
      label: "Klaster diski",
      formula: `${fmtBytesGB(totalRetainedGB)} × ${i.replicas} replika ÷ ${i.maxDiskFillPct}%`,
      value: fmtBytesGB(clusterDiskGB),
    },
    {
      label: "Har bir node diski",
      formula: `${fmtBytesGB(totalRetainedGB)} ÷ ${i.shards} shard ÷ ${i.maxDiskFillPct}%`,
      value: fmtBytesGB(perNodeDiskGB),
    },
    {
      label: "Node diski + 1 yillik o'sish",
      formula: `${fmtBytesGB(perNodeDiskGB)} × (1 + ${i.yearlyGrowthPct}%)`,
      value: fmtBytesGB(perNodeDiskWithGrowthGB),
    },
    {
      label: "Siqilgan ingest (node)",
      formula: `${fmtBytesGB(compressedPerDay)}/kun ÷ 86 400 s ÷ ${i.shards} shard`,
      value: `${fmt(ingestMBs, 2)} MB/s`,
    },
    {
      label: "Yozish (o'rtacha)",
      formula: `${fmt(ingestMBs, 2)} MB/s × ${i.writeAmplification} (merge)`,
      value: `${fmt(writeMBsAvg)} MB/s`,
    },
    {
      label: "Yozish (peak)",
      formula: "logs/traces peak factor bilan, metrics doimiy",
      value: `${fmt(writeMBsPeak)} MB/s`,
    },
    {
      label: "O'qish",
      formula: `${i.scannedGBPerQuery} GB ÷ ${i.targetLatencySec} s × ${i.concurrentQueries} so'rov ÷ ${i.shards} shard`,
      value: `${fmt(readMBs)} MB/s`,
    },
    {
      label: "IOPS",
      formula: `(${fmt(writeMBsPeak)} + ${fmt(readMBs)}) MB/s ÷ ${i.ioBlockKB} KB`,
      value: fmt(iops, 0),
    },
    {
      label: "RAM (node)",
      formula: "max(32, kunlik siqilgan × 20%) — 16 GB ga yaxlitlangan",
      value: `${ramGB} GB`,
    },
    {
      label: "vCPU (node)",
      formula: "max(8, o'qish MB/s ÷ ~250 MB/s har yadro)",
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
