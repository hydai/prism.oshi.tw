#!/bin/sh
# Read-only deploy preflight: refuse to ship a worker whose code needs schema
# objects the remote D1 does not have yet.
#
# Migrations are applied manually and per file (docs/vod-export-rollout.md and
# each migration's header) — this script never applies anything. It only makes
# the standard deploy path (`npm run deploy`, /deploy-admin) fail loudly instead
# of deploying code whose first guarded write would fail at runtime.
#
# REQUIRED lists the objects the worker touches at runtime. Extend it whenever a
# migration adds such an object. Performance-only objects (indexes) are not
# gated here — a missing index degrades, it does not break.
set -eu

DB_NAME="${PRISM_ADMIN_DB_NAME:-oshi-prism-db}"
REQUIRED="merge_guards"

names="$(npx wrangler@latest d1 execute "$DB_NAME" --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type IN ('table', 'index')")"

missing=""
for object in $REQUIRED; do
  if ! printf '%s' "$names" | grep -q "\"name\": *\"$object\""; then
    missing="$missing $object"
  fi
done

if [ -n "$missing" ]; then
  echo "preflight FAILED: remote $DB_NAME is missing:$missing" >&2
  echo "Apply the pending migration(s) in admin/migrations first (each file's header has the exact command), then deploy." >&2
  exit 1
fi

echo "preflight OK: remote $DB_NAME has$(printf ' %s' $REQUIRED)"
