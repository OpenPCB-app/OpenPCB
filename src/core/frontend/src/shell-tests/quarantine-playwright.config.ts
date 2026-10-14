import { defineConfig } from "@playwright/test";
import shellConfig from "./playwright.config";
export default defineConfig({ ...shellConfig, testMatch: "quarantine.e2e.ts" });
