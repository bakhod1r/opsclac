import { resolve } from "node:path";
import { defineConfig } from "vite";
import { calculators } from "./src/calculators.ts";

// Multi-page: home + one page per calculator (<slug>/index.html).
const pages = Object.fromEntries(
  calculators.filter((c) => c.ready).map((c) => [c.slug, resolve(__dirname, c.slug, "index.html")]),
);

export default defineConfig({
  base: "./",
  build: { rollupOptions: { input: { home: resolve(__dirname, "index.html"), ...pages } } },
});
