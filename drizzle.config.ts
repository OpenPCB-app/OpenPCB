import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // SQLite dialect for bun:sqlite
  dialect: "sqlite",

  // Schema location - supports multiple files in schema directory
  schema: ["./src-ts/src/db/schema", "./modules/*/ts/db/schema.ts"],

  // Output directory for generated migrations
  out: "./src-ts/drizzle/migrations",

  // Database file path from environment
  dbCredentials: {
    url: process.env.DB_FILE_PATH || "./data/OpenPCB.db",
  },

  // Verbose output for debugging
  verbose: true,

  // Strict mode for safer migrations
  strict: true,
});
