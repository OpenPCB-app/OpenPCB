#!/usr/bin/env bash
# Regenerate electron app icons from an SVG.
# Each raster size is rendered straight from the SVG (sharper than downscaling
# a single master). Requires: rsvg-convert, iconutil (macOS), magick (ImageMagick).
#
# Usage: ./generate-icons.sh [svg] [output-basename]
#   default: ./generate-icons.sh openpcb_icon.svg icon         -> icon.{icns,ico,png}
#   dark:    ./generate-icons.sh openpcb_icon_dark.svg icon-dark
set -euo pipefail
cd "$(dirname "$0")"

SVG="${1:-openpcb_icon.svg}"
OUT="${2:-icon}"
render() { rsvg-convert -w "$1" -h "$1" "$SVG" -o "$2"; }

# --- macOS .icns (via iconutil) ---
ICONSET="$(mktemp -d)/icon.iconset"
mkdir -p "$ICONSET"
render 16   "$ICONSET/icon_16x16.png"
render 32   "$ICONSET/icon_16x16@2x.png"
render 32   "$ICONSET/icon_32x32.png"
render 64   "$ICONSET/icon_32x32@2x.png"
render 128  "$ICONSET/icon_128x128.png"
render 256  "$ICONSET/icon_128x128@2x.png"
render 256  "$ICONSET/icon_256x256.png"
render 512  "$ICONSET/icon_256x256@2x.png"
render 512  "$ICONSET/icon_512x512.png"
render 1024 "$ICONSET/icon_512x512@2x.png"
iconutil -c icns "$ICONSET" -o "$OUT.icns"

# --- Windows .ico (multi-size) ---
ICO_DIR="$(mktemp -d)"
for s in 16 24 32 48 64 128 256; do render "$s" "$ICO_DIR/$s.png"; done
magick "$ICO_DIR"/16.png "$ICO_DIR"/24.png "$ICO_DIR"/32.png "$ICO_DIR"/48.png \
       "$ICO_DIR"/64.png "$ICO_DIR"/128.png "$ICO_DIR"/256.png "$OUT.ico"

# --- Linux .png master ---
render 1024 "$OUT.png"

echo "Generated $OUT.icns, $OUT.ico, $OUT.png from $SVG"
