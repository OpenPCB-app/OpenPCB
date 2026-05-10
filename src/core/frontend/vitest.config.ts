import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  root: repoRoot,
  test: {
    environment: "node",
    globals: true,
    include: [
      "src/core/frontend/src/**/*.test.{ts,tsx,js,jsx}",
      "src/modules/*/frontend/**/*.test.{ts,tsx,js,jsx}",
      "src/shared/frontend/**/*.test.{ts,tsx,js,jsx}",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(repoRoot, "src/modules"),
      "@shared": path.resolve(repoRoot, "src/shared"),
    },
  },
});
