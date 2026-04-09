import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared/types": path.resolve(__dirname, "../../src-ts/shared/types"),
      "@shared/generated": path.resolve(
        __dirname,
        "../../src-ts/shared/generated",
      ),
      "@shared/sdk": path.resolve(__dirname, "../../src-ts/shared/sdk"),
      "@modules": path.resolve(__dirname, "../../modules"),
      "@component-library": path.resolve(
        __dirname,
        "../../modules/component-library",
      ),
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: {
      allow: [path.resolve(__dirname, "../..")],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "safari13",
    minify: "esbuild",
    sourcemap: false,
  },
});
