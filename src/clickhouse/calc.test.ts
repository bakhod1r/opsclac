import assert from "node:assert/strict";
import { calculate, defaults } from "./calc.ts";

const r = calculate(defaults);
const [logs, traces, metrics] = r.signals;

// 10M req/h ≈ 2777.8 req/s
assert.ok(Math.abs(logs.epsAvg - 8333.3) < 1);
// 8333.3 × 600 B × 86400 ≈ 432 GB/day raw
assert.ok(Math.abs(logs.rawGBPerDay - 432) < 1);
assert.ok(Math.abs(traces.rawGBPerDay - 1344) < 1);
assert.equal(metrics.epsPeak, metrics.epsAvg);
assert.ok(r.clusterDiskGB > r.perNodeDiskGB);
assert.equal(r.nodes, 2);

// Sampling halves trace volume
const half = calculate({ ...defaults, traceSamplingPct: 50 });
assert.ok(Math.abs(half.signals[1].rawGBPerDay - traces.rawGBPerDay / 2) < 1e-6);

console.log("ok");

// AWS picker
import { gp3For, pickInstance } from "./aws.ts";
const g = gp3For(4000, 3000, 500);
assert.equal(g.sizeGiB, 3840); // 4000 GB ÷ 1.0737 = 3725 GiB → 3840 (256 steps)
assert.equal(g.throughput, 500);
assert.equal(g.iops, 3000);
assert.ok(Math.abs(g.usdMonth - (3840 * 0.08 + 375 * 0.04)) < 1e-6);
const p = pickInstance(r, { family: "R", arch: "x86", cpuHeadroom: 2 }, 2);
assert.equal(p.best?.type, "r6a.4xlarge"); // needs 16 vCPU, 48 GB
const c = pickInstance(r, { family: "C", arch: "x86", cpuHeadroom: 2 }, 2);
assert.equal(c.best?.type, "c6a.8xlarge"); // 32 vCPU / 64 GiB is the first C size with ≥48 GiB
console.log("aws ok");
