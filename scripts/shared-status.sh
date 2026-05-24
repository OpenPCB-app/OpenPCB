#!/usr/bin/env bash
# Show whether each @openpcb/* package is currently linked (symlinked to
# ../shared/packages/<pkg>) or installed from a github tag.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENPCB_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$OPENPCB_ROOT"

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

printf "%-28s  %s\n" "package" "source"
printf "%-28s  %s\n" "----------------------------" "----------------------------------"

for pkg in "${PACKAGES[@]}"; do
  path="node_modules/@openpcb/$pkg"
  if [ -L "$path" ]; then
    target="$(readlink "$path")"
    printf "%-28s  linked → %s\n" "@openpcb/$pkg" "$target"
  elif [ -d "$path" ]; then
    version="$(node -p "require('./$path/package.json').version" 2>/dev/null || echo "?")"
    printf "%-28s  installed (v%s)\n" "@openpcb/$pkg" "$version"
  else
    printf "%-28s  NOT INSTALLED\n" "@openpcb/$pkg"
  fi
done
