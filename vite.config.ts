import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { calculators } from "./src/calculators.ts";

// Multi-page: home + <slug>/index.html per calculator (+ optional <slug>/guide/index.html).
const pages: Record<string, string> = { home: resolve(__dirname, "index.html") };
for (const c of calculators.filter((c) => c.ready)) {
  pages[c.slug] = resolve(__dirname, c.slug, "index.html");
  const guide = resolve(__dirname, c.slug, "guide", "index.html");
  if (existsSync(guide)) pages[`${c.slug}-guide`] = guide;
}

export default defineConfig({
  base: "./",
  build: { rollupOptions: { input: pages } },
});
