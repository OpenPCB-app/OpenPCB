import { defineConfig } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);
const baseURL = process.env.OPENPCB_H04_BASE_URL ?? "http://127.0.0.1:15241";

// Shell fixtures replace APIs and routes; no backend or design database is started.
export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  timeout: 30000,
  expect: { timeout: 4000 },
  workers: 1,
  use: { baseURL, screenshot: "only-on-failure", trace: "retain-on-failure" },
  outputDir: resolve(tmpdir(), "openpcb-h04-results"),
  reporter: [["list"]],
  webServer: process.env.OPENPCB_H04_BASE_URL
    ? undefined
    : {
        command:
          "npm run dev --workspace src/core/frontend -- --config src/shell-tests/vite.config.ts --port 15241 --strictPort",
        cwd: repoRoot,
        url: baseURL,
        reuseExistingServer: false,
      },
});
