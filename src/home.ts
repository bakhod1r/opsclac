import "./style.css";
import "./home.css";
import { calculators } from "./calculators.ts";
import { bindTooltips, stackedBar } from "./charts.ts";
import { calculate, defaults, fmt, fmtBytesGB } from "./clickhouse/calc.ts";

// Live example for the hero card, computed by the real calculator.
const ex = calculate({ ...defaults, requestsPerHour: 3000 * 3600, logLinesPerRequest: 17, logBytesPerLine: 800 });
const logs = ex.signals[0];
const rps = 3000;

const soon = calculators.filter((c) => !c.ready);

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
<div class="home">
  <div class="wrap">
    <header class="topnav">
      <a class="brand" href="./"><span class="mark">∑</span>OpsCalc</a>
      <nav><a href="#calculators">Calculators</a><a href="./clickhouse/guide/">Guide</a><a href="https://github.com/bakhod1r/opsclac">GitHub</a></nav>
    </header>

    <section class="hero2">
      <div>
        <span class="eyebrow">Free · open source · no sign-up</span>
        <h1>Size your infrastructure with <span class="grad">math, not guesses</span></h1>
        <p class="sub">Calculators for disk, throughput, IOPS, RAM and CPU. Enter your traffic, get the hardware —
        and see every formula behind every number.</p>
        <div class="ctas">
          <a class="b p" href="./clickhouse/">Size ClickHouse servers →</a>
          <a class="b" href="./clickhouse/design/">See a system design</a>
        </div>
      </div>
      <div class="demo" aria-label="Example calculation">
        <div class="demo-bar"><i></i><i></i><i></i><span>logs per day</span></div>
        <div class="demo-body">
          <div class="eq"><span class="k">lines/s</span> = ${fmt(rps, 0)} req/s × 17 = <b>${fmt(logs.epsAvg, 0)}</b></div>
          <div class="eq"><span class="k">raw/day</span> = ${fmt(logs.epsAvg, 0)} × 800 B × 86 400 = <b>${fmtBytesGB(logs.rawGBPerDay)}</b></div>
          <div class="eq"><span class="k">compressed</span> = ${fmtBytesGB(logs.rawGBPerDay)} ÷ ${defaults.logCompression} = <b>${fmtBytesGB(logs.compressedGBPerDay)}</b></div>
          <div class="eq"><span class="k">${defaults.retentionDays}+1 days</span> = ${fmtBytesGB(logs.compressedGBPerDay)} × ${defaults.retentionDays + 1} = <b>${fmtBytesGB(logs.retainedGB)}</b></div>
          <div class="result"><span>Disk for logs</span><b>${fmtBytesGB(logs.retainedGB)}</b></div>
        </div>
      </div>
    </section>

    <section class="sec" id="calculators">
      <h2>Calculators</h2>
      <p class="lede">Each one comes with the calculator, a step-by-step guide and a worked system design.</p>
      <div class="feature">
        <div class="info">
          <h3>ClickHouse server sizing for logs, metrics &amp; traces</h3>
          <p>Storage and hardware for logs, traces and metrics: SSD per node, cluster size, write/read MB/s, IOPS, RAM and vCPU.</p>
          <div class="chips"><span>observability</span><span>storage</span><span>OpenTelemetry</span></div>
          <div class="bar">
            <p class="note" style="margin:0 0 6px">Example split, 10M req/h, 7 days</p>
            ${stackedBar(calculate(defaults).signals.map((s) => ({ name: s.name, gb: s.retainedGB })))}
            <p class="fxline">stored = events/s × bytes × 86 400 ÷ compression × (days + 1)</p>
          </div>
        </div>
        <div class="links">
          <a href="./clickhouse/"><span class="ic">🧮</span><span><b>Calculator</b><small>disk/node = stored ÷ shards ÷ 75%</small></span><span class="go">→</span></a>
          <a href="./clickhouse/guide/"><span class="ic">📘</span><span><b>How it works</b><small>raw/day = events/s × bytes × 86 400</small></span><span class="go">→</span></a>
          <a href="./clickhouse/design/"><span class="ic">🏗️</span><span><b>System design</b><small>3,000 req/s × 10 services, 3 scenarios</small></span><span class="go">→</span></a>
        </div>
      </div>
      <div class="soon-grid">
        ${soon.map((c) => `<div class="soon-card"><b>${c.title} <span>· soon</span></b><span>${c.desc}</span></div>`).join("")}
      </div>
    </section>

    <section class="sec">
      <div class="pills">
        <div class="pill"><b>🔍 Transparent</b><span>No black box. Every result shows the formula and your numbers in it.</span></div>
        <div class="pill"><b>⚡ Instant</b><span>Runs in your browser and recalculates as you type.</span></div>
        <div class="pill"><b>💾 Remembers</b><span>Your inputs stay in your browser for next time.</span></div>
      </div>
    </section>

    <footer class="foot"><span>OpsCalc</span><a href="https://github.com/bakhod1r/opsclac">GitHub</a><a href="https://github.com/bakhod1r/opsclac/issues">Suggest a calculator</a></footer>
  </div>
</div>
`;

bindTooltips(document.querySelector("#app")!);
