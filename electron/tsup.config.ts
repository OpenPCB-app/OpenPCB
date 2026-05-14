import { defineConfig } from "tsup";

// Build-time env baking: anything supplied via OPENPCB_SENTRY_DSN /
// OPENPCB_SENTRY_ENV at `tsup` build time is inlined into the bundle so the
// packaged main process can find its DSN without runtime env vars.
// Only inline values that are actually present at build time. Leaving the
// reference intact when unset preserves runtime env-var resolution for dev.
const define: Record<string, string> = {};
if (process.env.OPENPCB_SENTRY_DSN) {
  define["process.env.OPENPCB_SENTRY_DSN"] = JSON.stringify(
    process.env.OPENPCB_SENTRY_DSN,
  );
}
if (process.env.OPENPCB_SENTRY_ENV) {
  define["process.env.OPENPCB_SENTRY_ENV"] = JSON.stringify(
    process.env.OPENPCB_SENTRY_ENV,
  );
}

export default defineConfig([
  {
    entry: { "main/index": "src/main/index.ts" },
    format: "esm",
    platform: "node",
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    clean: true,
    external: ["electron", "better-sqlite3"],
    loader: { ".kicad_mod": "text" },
    define,
  },
  {
    entry: { "preload/index": "src/preload/index.ts" },
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    clean: false,
    external: ["electron"],
    define,
  },
]);
