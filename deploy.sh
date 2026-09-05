#!/usr/bin/env bash
#
# Pull the vault and rebuild obsidian.arda.internal.
#
# Builds into a staging directory and swaps it in only on success. `quartz build`
# empties its output directory before it starts, so building straight into the
# directory nginx serves left the site blank for the ~1 minute of the build, and
# left it broken outright if the build failed.
#
set -euo pipefail

QUARTZ_DIR="/home/matt/quartz-site"
LIVE="$QUARTZ_DIR/public"
STAGE="$QUARTZ_DIR/public.new"
PREV="$QUARTZ_DIR/public.prev"

cd "$QUARTZ_DIR/content"
GIT_SSL_NO_VERIFY=1 git pull origin main

cd "$QUARTZ_DIR"
rm -rf "$STAGE"
npx quartz build -o "$STAGE"

# Guard against a "successful" build that produced nothing usable.
if [ ! -s "$STAGE/index.html" ]; then
  echo "ABORT: $STAGE/index.html missing or empty; leaving the live site alone" >&2
  rm -rf "$STAGE"
  exit 1
fi

rm -rf "$PREV"
[ -d "$LIVE" ] && mv "$LIVE" "$PREV"
mv "$STAGE" "$LIVE"

echo "Quartz site rebuilt at $(date) ($(find "$LIVE" -type f | wc -l) files; previous build kept at $PREV)"
