# OpsCalc

Infrastructure sizing calculators. Every result shows its formula.

Live: https://bakhod1r.github.io/opsclac/

## Calculators
- **ClickHouse**: disk, throughput, IOPS, RAM and CPU for logs, traces and metrics (`src/clickhouse/calc.ts`)
  - Guide: `/clickhouse/guide/`, system design: `/clickhouse/design/`

## Development
```bash
npm install
npm run dev     # http://localhost:5173
npm test
npm run build   # static site in dist/
```
Pushing to `main` deploys to GitHub Pages (`.github/workflows/pages.yml`).

## Adding a calculator
1. Add an entry to `src/calculators.ts`.
2. Create `<slug>/index.html` and `src/<slug>/main.ts` (see `clickhouse/`).

The home page and build pick it up automatically.
