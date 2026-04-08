import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src-react/src/test-setup.ts"],
    include: ["src-react/src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@/": path.resolve(__dirname, "./src-react/src") + "/",
      "@shared/types": path.resolve(__dirname, "./src-ts/shared/types"),
      "@shared/sdk": path.resolve(__dirname, "./src-ts/shared/sdk"),
      "@shared/generated": path.resolve(__dirname, "./src-ts/shared/generated"),
      "@modules": path.resolve(__dirname, "./modules"),
    },
  },
});
