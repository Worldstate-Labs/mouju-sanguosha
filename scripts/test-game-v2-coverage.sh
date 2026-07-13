#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="/tmp/mouju-game-v2-coverage-entry.mjs"
REPORTS="/tmp/mouju-game-v2-coverage"

cd "$ROOT"
./node_modules/.bin/esbuild tests/character-coverage-entry.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --sourcemap \
  --outfile="$ENTRY" \
  --log-level=warning

./node_modules/.bin/c8 \
  --all \
  --include=lib/game-v2.ts \
  --include=lib/game-v2-data.ts \
  --exclude-after-remap \
  --check-coverage \
  --statements=100 \
  --branches=100 \
  --functions=100 \
  --lines=100 \
  --reporter=text \
  --reporter=json-summary \
  --reports-dir="$REPORTS" \
  node --test "$ENTRY"
