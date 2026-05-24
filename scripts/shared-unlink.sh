#!/usr/bin/env bash
# Restore github-tag-based installs of @openpcb/* packages. Use after a
# `shared:link` dev session.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENPCB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

PACKAGES=(
  kicad-parsers
  rendering-core
  kicad-import
  step-to-glb
  r3f-eda-canvas
  opclib-pack
  command-pattern
  contracts
  ai-core
)

cd "$OPENPCB_ROOT"

for pkg in "${PACKAGES[@]}"; do
  echo "==> Unlinking @openpcb/$pkg"
  npm unlink --no-save "@openpcb/$pkg" 2>/dev/null || true
done

echo ""
echo "==> Reinstalling pinned github-tag versions…"
npm install

echo ""
echo "✔ Restored github-tag installs."
