#!/bin/bash
# usage: mkviteconf.sh <name> <vitePort> <backendPort>
set -euo pipefail
QA="$(cd "$(dirname "$0")/.." && pwd)"
R=/Users/andrejvysny/workspace/openpcb/OpenPCB
name=$1; vp=$2; bp=$3
cat > "$QA/vite/vite.$name.config.mts" <<CONF
import base from "$R/src/core/frontend/vite.config.ts";
const b: any = base;
export default {
  ...b,
  cacheDir: "$QA/vite/cache-$name",
  server: {
    ...b.server,
    port: $vp,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:$bp", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:$bp", ws: true, changeOrigin: true },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: $vp,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:$bp", changeOrigin: true },
      "/ws": { target: "ws://127.0.0.1:$bp", ws: true, changeOrigin: true },
    },
  },
};
CONF
echo "$QA/vite/vite.$name.config.mts"
