import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Minimal dotenv loader: prefer .env.e2e, fall back to .env. Avoids a runtime
// dep just for two-line parsing. Lines like KEY=value override process.env only
// when not already set, so CI secrets win.
function loadEnvFile(file: string): void {
  const abs = path.resolve(__dirname, file);
  if (!fs.existsSync(abs)) return;
  for (const raw of fs.readFileSync(abs, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key]) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadEnvFile(".env.e2e");
loadEnvFile(".env");

const ELECTRON_SPEC = /cloud-sync\.spec\.ts$/;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: process.env.OPENPCB_E2E_NO_WEBSERVER
    ? undefined
    : [
        {
          command:
            "rm -f /tmp/openpcb-e2e.sqlite /tmp/openpcb-e2e.sqlite-shm /tmp/openpcb-e2e.sqlite-wal && OPENPCB_DB_PATH=/tmp/openpcb-e2e.sqlite npm run dev:backend",
          url: "http://127.0.0.1:3000/api/health",
          reuseExistingServer: false,
          timeout: 120_000,
          stdout: "pipe",
          stderr: "pipe",
        },
        {
          command: "npm run dev:frontend",
          url: "http://127.0.0.1:1420",
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
  projects: [
    {
      name: "chromium",
      testIgnore: ELECTRON_SPEC,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Multi-Electron cloud-sync spec. Launches its own Electron instances
      // with isolated userData + OPENPCB_DB_PATH per machine, so this project
      // is incompatible with the chromium webServer. Run via:
      //   OPENPCB_E2E_NO_WEBSERVER=1 npx playwright test --project=electron
      name: "electron",
      testMatch: ELECTRON_SPEC,
    },
  ],
});
