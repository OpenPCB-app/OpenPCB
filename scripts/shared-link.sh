#!/usr/bin/env bash
# Link OpenPCB's node_modules to the local checkout of github.com/OpenPCB-app/shared.
# Expects a sibling directory: ../shared (override via SHARED_DIR env var).
#
# Prerequisite: from the shared/ repo, run `npm run link:all` once. That builds
# every package and registers them with npm link globally.
#
# After this script runs, edits in shared/packages/<pkg>/src/ propagate to
# OpenPCB automatically — pair with `cd ../shared && npm run dev` to keep
# dist/ rebuilt.
#
# To restore github-tag installs: `npm run shared:unlink`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENPCB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SHARED_DIR="${SHARED_DIR:-$(cd "$OPENPCB_ROOT/../shared" && pwd)}"

if [ ! -d "$SHARED_DIR/packages" ]; then
  echo "ERROR: $SHARED_DIR does not look like the shared/ monorepo (no packages/)" >&2
  echo "       Clone github.com/OpenPCB-app/shared next to this repo, or set SHARED_DIR." >&2
  exit 1
fi

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

LINK_NAMES=()
for pkg in "${PACKAGES[@]}"; do
  if [ ! -d "$SHARED_DIR/packages/$pkg/dist" ]; then
    echo "==> Building @openpcb/$pkg (dist/ missing)…"
    (cd "$SHARED_DIR/packages/$pkg" && npm run build)
  fi
  echo "==> Registering @openpcb/$pkg from $SHARED_DIR/packages/$pkg"
  (cd "$SHARED_DIR/packages/$pkg" && npm link --no-audit)
  LINK_NAMES+=("@openpcb/$pkg")
done

echo "==> Linking all @openpcb/* packages into OpenPCB"
npm link --no-audit "${LINK_NAMES[@]}"

echo ""
echo "✔ All 9 @openpcb/* packages now point at $SHARED_DIR/packages/*"
echo ""
echo "Tip: run \`cd $SHARED_DIR && npm run dev\` to keep dist/ rebuilt on source edits."
echo "Tip: run \`npm run shared:unlink\` to restore github-tag installs."
