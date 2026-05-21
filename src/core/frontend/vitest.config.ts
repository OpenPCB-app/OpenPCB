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
      "src/core/frontend/src/**/*.spec.{ts,tsx,js,jsx}",
      "src/modules/*/frontend/**/*.test.{ts,tsx,js,jsx}",
      "src/modules/*/frontend/**/*.spec.{ts,tsx,js,jsx}",
      "src/shared/frontend/**/*.test.{ts,tsx,js,jsx}",
      "src/shared/frontend/**/*.spec.{ts,tsx,js,jsx}",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(repoRoot, "src/modules"),
      "@shared": path.resolve(repoRoot, "src/shared"),
    },
    // Symlinked `@openpcb/*` shared packages (npm run shared:link) ship their
    // own node_modules/react. Force a single instance so hooks (useMemo, etc.)
    // work inside r3f-eda-canvas.
    dedupe: ["react", "react-dom"],
  },
});
