import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import { calculators } from "./src/calculators.ts";

// Multi-page: home + <slug>/index.html per calculator (+ optional guide/ and design/ subpages).
const pages: Record<string, string> = { home: resolve(__dirname, "index.html") };
for (const c of calculators.filter((c) => c.ready)) {
  pages[c.slug] = resolve(__dirname, c.slug, "index.html");
  for (const sub of ["guide", "design"]) {
    const f = resolve(__dirname, c.slug, sub, "index.html");
    if (existsSync(f)) pages[`${c.slug}-${sub}`] = f;
  }
}

export default defineConfig({
  base: "./",
  build: { rollupOptions: { input: pages } },
});
