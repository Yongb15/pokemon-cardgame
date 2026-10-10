#!/usr/bin/env bash
# Copies only what the collector image needs into a fresh folder, so `gcloud builds submit` uploads
# nothing else (no .env, no other code): infra/collector/stage.sh <empty dir>
set -euo pipefail
out=${1:?usage: stage.sh <empty dir>}
[ -e "$out" ] && [ -n "$(ls -A "$out")" ] && { echo "$out is not empty" >&2; exit 1; }
mkdir -p "$out"
cd "$(git rev-parse --show-toplevel)"
# Tracked files only (git ls-files), minus tests and fixtures
git ls-files infra/collector scripts/collect-prices.ts server/prices server/db data/index.json data/tcgdex-map.json data/sets.json \
  | grep -vE '\.test\.ts$|/fixtures/' \
  | while read -r f; do mkdir -p "$out/$(dirname "$f")"; cp "$f" "$out/$f"; done
cp infra/collector/Dockerfile.dockerignore "$out/.dockerignore"
echo "staged $(find "$out" -type f | wc -l) files in $out"
