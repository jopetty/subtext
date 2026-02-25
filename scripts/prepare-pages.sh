#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/dist-pages"

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

copy_file() {
  local src="$1"
  if [[ -f "$ROOT_DIR/$src" ]]; then
    cp "$ROOT_DIR/$src" "$OUT_DIR/"
  fi
}

copy_dir() {
  local src="$1"
  if [[ -d "$ROOT_DIR/$src" ]]; then
    cp -R "$ROOT_DIR/$src" "$OUT_DIR/"
  fi
}

# Core site entrypoints/assets.
copy_file "index.html"
copy_file "app.js"
copy_file "style.css"
copy_file "sw.js"
copy_file "manifest.webmanifest"
copy_file "CNAME"

# Icons/images referenced by index.html / manifest.
copy_file "favicon-16.png"
copy_file "favicon-32.png"
copy_file "favicon.jpg"
copy_file "apple-touch-icon.png"
copy_file "icon-192.png"
copy_file "icon-512.png"
copy_file "webcard.jpg"

# Static directories used by runtime.
copy_dir "fonts"
copy_dir "icons"

echo "Prepared Pages artifact at: $OUT_DIR"
