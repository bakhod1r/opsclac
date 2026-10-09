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
