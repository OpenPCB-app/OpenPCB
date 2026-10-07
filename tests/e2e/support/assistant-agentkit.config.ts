import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "..", testMatch: "assistant-agentkit*.spec.ts", workers: 1,
  timeout: 90_000, expect: { timeout: 15_000 },
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 },
    trace: "off", screenshot: "only-on-failure", video: "off" },
});
