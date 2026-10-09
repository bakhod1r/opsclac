// AWS instance + gp3 picker for a ClickHouse node.
// Prices: approximate us-east-1 on-demand Linux, USD/hour. Check the AWS Pricing Calculator.
import { fmt, type Formula, type Result } from "./calc.ts";

export type Family = "C" | "M" | "R" | "I";
export type Arch = "x86" | "arm";

export interface Instance {
  type: string;
  family: Family;
  vcpu: number;
  ramGiB: number;
  arch: Arch;
  usdHour: number;
  nvmeGB?: number; // local instance-store NVMe (ephemeral)
}

export const HOURS_PER_MONTH = 730;

const sizes = (
  prefix: string,
  family: Family,
  arch: Arch,
  ramPerVcpu: number,
  usdPerVcpuHour: number,
  vcpus: number[],
): Instance[] =>
  vcpus.map((v) => ({
    type: `${prefix}.${v === 2 ? "large" : v === 4 ? "xlarge" : `${v / 4}xlarge`}`,
    family,
    vcpu: v,
    ramGiB: v * ramPerVcpu,
    arch,
    usdHour: +(v * usdPerVcpuHour).toFixed(4),
  }));

const STD = [8, 16, 32, 48, 64];

export const catalog: Instance[] = [
  ...sizes("c5a", "C", "x86", 2, 0.0385, STD),
  ...sizes("c6a", "C", "x86", 2, 0.03825, STD),
  ...sizes("c6g", "C", "arm", 2, 0.034, STD),
  ...sizes("m6a", "M", "x86", 4, 0.0432, STD),
  ...sizes("m6g", "M", "arm", 4, 0.0385, STD),
  ...sizes("r6a", "R", "x86", 8, 0.0567, [4, ...STD]),
  ...sizes("r6g", "R", "arm", 8, 0.0504, [4, ...STD]),
  { type: "i3.2xlarge", family: "I", vcpu: 8, ramGiB: 61, arch: "x86", usdHour: 0.624, nvmeGB: 1900 },
  { type: "i3.4xlarge", family: "I", vcpu: 16, ramGiB: 122, arch: "x86", usdHour: 1.248, nvmeGB: 3800 },
  { type: "i3.8xlarge", family: "I", vcpu: 32, ramGiB: 244, arch: "x86", usdHour: 2.496, nvmeGB: 7600 },
  { type: "i3en.2xlarge", family: "I", vcpu: 8, ramGiB: 64, arch: "x86", usdHour: 0.904, nvmeGB: 5000 },
  { type: "i3en.3xlarge", family: "I", vcpu: 12, ramGiB: 96, arch: "x86", usdHour: 1.356, nvmeGB: 7500 },
  { type: "i3en.6xlarge", family: "I", vcpu: 24, ramGiB: 192, arch: "x86", usdHour: 2.712, nvmeGB: 15000 },
];

export const familyNames: Record<Family, string> = {
  C: "Compute optimized",
  M: "General purpose",
  R: "Memory optimized",
  I: "Storage optimized (local NVMe)",
};

export interface AwsOptions {
  family: "any" | Family;
  arch: "any" | Arch;
  cpuHeadroom: number;
}

export const awsDefaults: AwsOptions = { family: "any", arch: "any", cpuHeadroom: 2 };

export interface Gp3 {
  volumes: number;
  sizeGiB: number; // total across volumes
  iops: number;
  throughput: number;
  usdMonth: number;
}

const GIB = 1.073741824; // GB per GiB
const GP3_MAX_GIB = 16384;

/** gp3 sized for one node: capacity from disk need, IOPS/throughput from I/O need. */
export function gp3For(diskGB: number, iopsNeed: number, mbsNeed: number): Gp3 {
  const sizeGiB = Math.max(256, Math.ceil(diskGB / GIB / 256) * 256);
  const volumes = Math.ceil(sizeGiB / GP3_MAX_GIB);
  const throughput = Math.min(1000, Math.max(125, Math.ceil(mbsNeed / 25) * 25));
  // gp3 rule: throughput ≤ 0.25 MB/s per provisioned IOPS
  const iops = Math.min(16000, Math.max(3000, Math.ceil(iopsNeed / 1000) * 1000, throughput * 4));
  const usdMonth = sizeGiB * 0.08 + volumes * ((iops - 3000) * 0.005 + (throughput - 125) * 0.04);
  return { volumes, sizeGiB, iops, throughput, usdMonth };
}

export interface Pick {
  needVcpu: number;
  needRam: number;
  fits: Instance[]; // cheapest first
  best?: Instance;
  gp3?: Gp3; // undefined for local-NVMe instances
  nodeUsdMonth: number;
  clusterUsdMonth: number;
  formulas: Formula[];
  warnings: string[];
}

const usd = (n: number) => `$${fmt(n, 0)}`;

export function pickInstance(r: Result, o: AwsOptions, replicas: number): Pick {
  const needVcpu = Math.max(8, Math.ceil((r.vcpu * o.cpuHeadroom) / 4) * 4);
  const needRam = r.ramGB;
  const diskGB = r.perNodeDiskWithGrowthGB;
  const ioMBs = r.readMBs + r.writeMBsPeak;

  const fits = catalog
    .filter((x) => (o.family === "any" ? x.family !== "I" : x.family === o.family))
    .filter((x) => o.arch === "any" || x.arch === o.arch)
    .filter((x) => x.vcpu >= needVcpu && x.ramGiB >= needRam && (!x.nvmeGB || x.nvmeGB >= diskGB))
    .sort((a, b) => a.usdHour - b.usdHour);
  const best = fits[0];
  const gp3 = best && !best.nvmeGB ? gp3For(diskGB, r.iops, ioMBs) : undefined;
  const nodeUsdMonth = best ? best.usdHour * HOURS_PER_MONTH + (gp3?.usdMonth ?? 0) : 0;
  const clusterUsdMonth = nodeUsdMonth * r.nodes;

  const warnings: string[] = [];
  if (!best) warnings.push("No instance in this filter fits. Widen the family/arch filter or add shards.");
  if (best?.nvmeGB && replicas < 2)
    warnings.push("Local NVMe is wiped when the instance stops. With 1 replica this means data loss — use ≥2 replicas or EBS.");
  if (gp3 && ioMBs > 1000)
    warnings.push("I/O need exceeds gp3's 1,000 MB/s: add shards, cache more in RAM, or use local NVMe with replicas.");
  if (gp3 && gp3.volumes > 1)
    warnings.push(`Disk exceeds 16 TiB per gp3 volume: use ${gp3.volumes} volumes in a ClickHouse storage policy.`);
  if (best?.arch === "arm") warnings.push("ARM (Graviton): moving from an x86 instance needs a reinstall; data files are compatible.");

  const formulas: Formula[] = [
    { name: "vCPU needed", symbolic: "max(8, vCPU × headroom), rounded up to 4",
      numbers: `max(8, ${r.vcpu} × ${o.cpuHeadroom})`, result: `${needVcpu}` },
    { name: "RAM needed", symbolic: "max(32, compressed/day × 20%)", numbers: `from calculator`, result: `${needRam} GB` },
    { name: "Instance", symbolic: "cheapest with vCPU ≥ need and RAM ≥ need",
      numbers: best ? `${best.vcpu} vCPU, ${best.ramGiB} GiB` : "—", result: best?.type ?? "none" },
    { name: "Instance cost", symbolic: "$/hour × 730",
      numbers: best ? `$${best.usdHour} × 730` : "—", result: best ? `${usd(best.usdHour * HOURS_PER_MONTH)}/mo` : "—" },
  ];
  if (gp3) {
    formulas.push(
      { name: "gp3 size", symbolic: "disk/node ÷ 1.0737 (GB→GiB), rounded up to 256 GiB",
        numbers: `${fmt(diskGB, 0)} GB ÷ 1.0737`, result: `${fmt(gp3.sizeGiB, 0)} GiB` },
      { name: "gp3 throughput", symbolic: "clamp(read + write, 125, 1000)",
        numbers: `${fmt(r.readMBs, 0)} + ${fmt(r.writeMBsPeak, 1)} MB/s`, result: `${gp3.throughput} MB/s` },
      { name: "gp3 IOPS", symbolic: "clamp(max(IOPS, throughput × 4), 3000, 16000)",
        numbers: `max(${fmt(r.iops, 0)}, ${gp3.throughput} × 4)`, result: fmt(gp3.iops, 0) },
      { name: "gp3 cost", symbolic: "GiB × $0.08 + (IOPS − 3000) × $0.005 + (MB/s − 125) × $0.04",
        numbers: `${gp3.sizeGiB} × 0.08 + ${gp3.iops - 3000} × 0.005 + ${gp3.throughput - 125} × 0.04`,
        result: `${usd(gp3.usdMonth)}/mo` },
    );
  }
  formulas.push(
    { name: "Per node", symbolic: "instance + gp3", numbers: "", result: `${usd(nodeUsdMonth)}/mo` },
    { name: "Cluster", symbolic: "per node × nodes", numbers: `${usd(nodeUsdMonth)} × ${r.nodes}`, result: `${usd(clusterUsdMonth)}/mo` },
  );

  return { needVcpu, needRam, fits, best, gp3, nodeUsdMonth, clusterUsdMonth, formulas, warnings };
}
