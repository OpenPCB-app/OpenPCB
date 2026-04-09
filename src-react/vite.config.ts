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
      "@component-library": path.resolve(
        __dirname,
        "../modules/component-library",
      ),
    },
  },
  // Env variable support removed. Use fixed defaults below.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // Bind explicitly to IPv4 to avoid ::1 EPERM issues in some environments
    host: "127.0.0.1",
    fs: {
      allow: [path.resolve(__dirname), path.resolve(__dirname, "..")],
    },
    // Proxy API and WebSocket requests to Bun backend during frontend dev
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
    // HMR with overlay disabled to prevent error spam during dev
    hmr: {
      overlay: false,
    },
    watch: {
      // Ignore unnecessary directories to reduce CPU usage
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/dist/**",
        "**/target/**",
      ],
    },
  },
  optimizeDeps: {
    // Pre-bundle common heavy dependencies for faster dev startup
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "zustand",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "lucide-react",
    ],
    exclude: [],
  },
  build: {
    target: "safari13",
    // Use esbuild minification by default
    minify: "esbuild",
    // No debug sourcemaps by default
    sourcemap: false,
  },
});
