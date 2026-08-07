#!/usr/bin/env sh
# docs/architecture-site/ is the source of truth for the interactive
# architecture explorer. docs-site (VitePress) only publishes
# docs-site/.vitepress/dist, so this syncs a copy into docs-site/public/
# (served unprocessed by VitePress) instead of hand-maintaining a second copy.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/docs/architecture-site"
DEST="$ROOT/docs-site/public/architecture-site"

mkdir -p "$DEST"
cp "$SRC/index.html" "$SRC/app.js" "$SRC/data.js" "$SRC/styles.css" "$DEST/"
cp -r "$SRC/assets" "$DEST/"
echo "Synced $SRC -> $DEST"
