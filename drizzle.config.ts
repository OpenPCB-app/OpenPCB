import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",

  // Module schemas (single shared SQLite DB)
  schema: ["./src/modules/*/backend/schema.ts"],

  // Optional generated migration output for Drizzle workflows
  out: "./drizzle/migrations",

  dbCredentials: {
    url: process.env.OPENPCB_DB_PATH || "./dev-data/openpcb.sqlite",
  },

  verbose: true,
  strict: true,
});
