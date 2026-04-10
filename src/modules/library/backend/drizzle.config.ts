import { defineConfig } from "drizzle-kit";

/**
 * Per-module drizzle-kit config. Run from this folder:
 *   bunx drizzle-kit generate
 * to (re)generate SQL migrations into ./migrations.
 *
 * The `dbCredentials` URL is a placeholder — drizzle-kit only uses it
 * for introspection workflows, which this module doesn't need. Schema-diff
 * generation works without a live database.
 */
export default defineConfig({
  schema: "./schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "file:./.drizzle-kit-placeholder.sqlite",
  },
});
