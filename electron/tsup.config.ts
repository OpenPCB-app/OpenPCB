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
// Source files use `createRequire(import.meta.url)` which is an ESM
// idiom. With CJS output, `import.meta` is undefined; map it to a
// global that the banner defines.
define["import.meta.url"] = "__cjsBundleEntryUrl";

export default defineConfig([
  {
    entry: { "main/index": "src/main/index.ts" },
    // CJS, not ESM. Electron's main "electron" module is CommonJS;
    // Node 22 ESM refuses named imports from CJS, breaking the bundle
    // silently at startup. Emitting CJS sidesteps that and lets the
    // bundled OTel/Sentry/electron-log CJS code run unchanged.
    format: "cjs",
    platform: "node",
    target: "node22",
    outDir: "dist",
    sourcemap: true,
    clean: true,
    splitting: false,
    bundle: true,
    banner: {
      js: 'var __cjsBundleEntryUrl = require("url").pathToFileURL(__filename).toString();',
    },
    // Only true natives + electron runtime stay external. Everything else
    // (pure-JS deps from electron/package.json plus their transitive graph)
    // gets bundled here. This avoids npm-workspaces hoisting leaving deps
    // outside electron/node_modules where electron-forge cannot find them.
    // electron-updater pulls in a chunk of CJS deps (lzma-native, builder-util-runtime, etc.)
    // with dynamic require patterns that don't bundle cleanly — keep it external.
    external: ["electron", "better-sqlite3", "electron-updater"],
    // Bundle simple pure-JS deps. Sentry + OTel stay out of the bundle
    // because they use require-in-the-middle / dynamic-require patterns
    // that bundlers can't reliably trace; they are loaded lazily via
    // createRequire at runtime when present.
    noExternal: [
      "electron-squirrel-startup",
      "electron-log",
      "drizzle-orm",
      "zod",
    ],
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
    splitting: false,
    bundle: true,
    external: ["electron"],
    noExternal: ["electron-log", "@sentry/electron"],
    define,
  },
]);
