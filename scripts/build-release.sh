#!/bin/bash
set -euo pipefail

if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "ERROR: TAURI_SIGNING_PRIVATE_KEY env var not set"
  echo "Generate with: cargo tauri signer generate -w ~/.tauri/openpcb.key"
  exit 1
fi

echo "==> Compiling Bun sidecar..."
npm run bun:compile

echo "==> Building Tauri app (aarch64-apple-darwin)..."
npm run tauri build -- --target aarch64-apple-darwin

echo ""
echo "Build artifacts in src-tauri/target/aarch64-apple-darwin/release/bundle/"
echo "Signature files (.sig) should exist alongside installers"
echo "Updater endpoint: https://raw.githubusercontent.com/andrejvysny/OpenPCBReleases/main/latest.json"
