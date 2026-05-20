import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const require = createRequire(import.meta.url);
const wasm = require("vite-plugin-wasm") as () => Plugin;
const topLevelAwait = require("vite-plugin-top-level-await") as () => Plugin;

export default defineConfig({
  plugins: [react(), tailwind(), wasm(), topLevelAwait()],
  optimizeDeps: {
    exclude: ["occt-import-js"],
  },
  worker: {
    plugins: () => [wasm()],
  },
  resolve: {
    dedupe: [
      "react",
      "react-dom",
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "troika-three-text",
    ],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@modules": path.resolve(__dirname, "../../../src/modules"),
      "@shared": path.resolve(__dirname, "../../../src/shared"),
      "@sdks": path.resolve(__dirname, "../../../src/sdks"),
    },
  },
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    fs: {
      allow: [repoRoot],
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
    target: "es2022",
    minify: "esbuild",
    // Hidden source maps: emitted to disk so Sentry can upload them, but the
    // bundle does not advertise //# sourceMappingURL so end users don't fetch.
    sourcemap: "hidden",
    rollupOptions: {
      input: {
        app: path.resolve(__dirname, "index.html"),
      },
    },
  },
});
