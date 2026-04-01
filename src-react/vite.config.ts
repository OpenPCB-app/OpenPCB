import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "node:path";
import tailwind from "@tailwindcss/vite";
import mdx from "@mdx-js/rollup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    mdx({
      jsxImportSource: "react",
    }),
    tailwind(),
  ],
  resolve: {
    extensions: [".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx", ".json", ".mdx"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared/types": path.resolve(__dirname, "../src-ts/shared/types"),
      "@shared/generated": path.resolve(
        __dirname,
        "../src-ts/shared/generated",
      ),
      "@shared/sdk": path.resolve(__dirname, "../src-ts/shared/sdk"),
      "@modules": path.resolve(__dirname, "../modules"),
    },
  },
  // Env variable support removed. Use fixed defaults below.
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Bind explicitly to IPv4 to avoid ::1 EPERM issues in some environments
    host: "127.0.0.1",
    fs: {
      allow: [
        path.resolve(__dirname),
        path.resolve(__dirname, ".."),
      ],
    },
    // No proxy - frontend makes direct requests to Bun using dynamic URL from BackendURLContext
    // HMR left as default (undefined) — no env-driven host configuration
    hmr: undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // Align generated bundles with the runtime engines shipped with Tauri
    // Fixed build settings (environment-driven options removed)
    target: "safari13",
    // Use esbuild minification by default
    minify: "esbuild",
    // No debug sourcemaps by default
    sourcemap: false,
  },
});
