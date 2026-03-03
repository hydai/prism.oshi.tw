#!/usr/bin/env bash
# eximport-all.sh — Run prismlens eximport per-stream for all approved streams.
# Supports multi-streamer: iterates over all streamers in data/registry.json.
# Usage: ./scripts/eximport-all.sh [--streamer SLUG]
set -euo pipefail

CACHE_DB="${PRISMLENS_CACHE:-$HOME/.local/share/prismlens/cache.db}"
# Resolve PRISMLENS to absolute path before cd (relative paths would break).
PRISMLENS="${PRISMLENS_CMD:-prismlens}"
if [[ "$PRISMLENS" == */* && -x "$PRISMLENS" ]]; then
  PRISMLENS="$(cd "$(dirname "$PRISMLENS")" && pwd)/$(basename "$PRISMLENS")"
fi

# Resolve repo root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# Parse --streamer argument (optional, defaults to all streamers in registry)
STREAMER_FILTER=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --streamer|-s)
      STREAMER_FILTER="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

# Get streamer slugs from registry.json
if ! command -v python3 &>/dev/null; then
  echo "Error: python3 is required to read registry.json."
  exit 1
fi

if [[ -n "$STREAMER_FILTER" ]]; then
  STREAMERS=("$STREAMER_FILTER")
else
  # Extract enabled streamer slugs from registry
  mapfile -t STREAMERS < <(
    python3 -c "
import json, sys
with open('data/registry.json') as f:
    reg = json.load(f)
for s in reg.get('streamers', []):
    if s.get('enabled', True):
        print(s['slug'])
"
  )
fi

if [[ ${#STREAMERS[@]} -eq 0 ]]; then
  echo "No streamers found in data/registry.json."
  exit 1
fi

if [[ ! -f "$CACHE_DB" ]]; then
  echo "Error: cache DB not found at $CACHE_DB"
  echo "Set PRISMLENS_CACHE to override the path."
  exit 1
fi

if ! command -v sqlite3 &>/dev/null; then
  echo "Error: sqlite3 is required but not found."
  exit 1
fi

if ! command -v "$PRISMLENS" &>/dev/null && [[ ! -x "$PRISMLENS" ]]; then
  echo "Error: prismlens CLI not found at '$PRISMLENS'."
  echo "Set PRISMLENS_CMD to override (e.g. path to venv binary)."
  exit 1
fi

for streamer in "${STREAMERS[@]}"; do
  echo "========================================"
  echo "Processing streamer: $streamer"
  echo "========================================"

  DATA_DIR="$REPO_ROOT/data/$streamer"
  if [[ ! -f "$DATA_DIR/songs.json" ]]; then
    echo "Warning: $DATA_DIR/songs.json not found. Skipping $streamer."
    continue
  fi

  # Query exportable streams
  rows=()
  while IFS= read -r line; do
    rows+=("$line")
  done < <(
    sqlite3 -separator $'\t' "$CACHE_DB" \
      "SELECT video_id, title, date FROM streams WHERE status IN ('approved', 'exported') ORDER BY date"
  )

  total=${#rows[@]}
  if [[ $total -eq 0 ]]; then
    echo "No approved/exported streams found for $streamer. Skipping."
    continue
  fi

  echo "Streams to process: $total"
  succeeded=0
  failed=0
  skipped_ids=()

  for i in "${!rows[@]}"; do
    IFS=$'\t' read -r vid title date <<< "${rows[$i]}"
    n=$((i + 1))
    echo "--- [$n/$total] $date  $vid  $title ---"

    if "$PRISMLENS" --streamer "$streamer" eximport --stream "$vid" \
         --songs-file "$DATA_DIR/songs.json" \
         --streams-file "$DATA_DIR/streams.json"; then
      ((succeeded++))
    else
      rc=$?
      echo "Warning: eximport exited with status $rc for $vid"
      ((failed++))
      skipped_ids+=("$vid")
    fi
    echo ""
  done

  echo "=== $streamer Done ==="
  echo "  Succeeded: $succeeded / $total"
  if [[ $failed -gt 0 ]]; then
    echo "  Failed:    $failed"
    for sid in "${skipped_ids[@]}"; do
      echo "    $sid"
    done
  fi
  echo ""
done
