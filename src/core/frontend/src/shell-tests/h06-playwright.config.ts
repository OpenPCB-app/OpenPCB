import { defineConfig } from "@playwright/test";
import shellConfig from "./playwright.config";
export default defineConfig({ ...shellConfig, testMatch: "h06.e2e.ts" });
