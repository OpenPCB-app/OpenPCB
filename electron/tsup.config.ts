import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "main/index": "src/main/index.ts" },
    format: "esm",
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: true,
    external: ["electron"],
  },
  {
    entry: { "preload/index": "src/preload/index.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    clean: false,
    external: ["electron"],
  },
]);
