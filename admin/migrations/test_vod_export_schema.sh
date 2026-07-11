#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/vod-export-schema.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

assert_query() {
  database=$1
  query=$2
  expected=$3
  description=$4
  actual=$(sqlite3 -batch -bail "$database" "$query")
  if [ "$actual" != "$expected" ]; then
    fail "$description (expected '$expected', got '$actual')"
  fi
}

apply_sql_file() {
  database=$1
  sql_file=$2
  sqlite3 -batch -bail "$database" < "$sql_file"
}

ADMIN_MIGRATION_DB="$TMP_DIR/admin-migration.sqlite"
sqlite3 -batch -bail "$ADMIN_MIGRATION_DB" <<'SQL'
CREATE TABLE songs (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  original_artist TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE performances (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  end_timestamp INTEGER,
  status TEXT NOT NULL
);
CREATE TABLE streams (
  id TEXT PRIMARY KEY,
  streamer_id TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  video_id TEXT NOT NULL,
  status TEXT NOT NULL
);
SQL
apply_sql_file "$ADMIN_MIGRATION_DB" "$ROOT_DIR/admin/migrations/0002_add_vod_export_state.sql"
assert_query "$ADMIN_MIGRATION_DB" \
  "SELECT revision || '|' || trigger_schema_version FROM vod_export_state WHERE id = 1;" \
  "0|1" \
  "Admin migration must create the revision singleton"
assert_query "$ADMIN_MIGRATION_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'vod_export_*_revision';" \
  "9" \
  "Admin migration must create all nine source revision triggers"
assert_query "$ADMIN_MIGRATION_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'vod_export_publication_audits';" \
  "1" \
  "Admin migration must create the publication audit table"
assert_query "$ADMIN_MIGRATION_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'vod_export_publication_resolutions';" \
  "1" \
  "Admin migration must create the 30-day publication resolution table"
sqlite3 -batch -bail "$ADMIN_MIGRATION_DB" \
  "INSERT INTO songs (id, streamer_id, title, original_artist, status) VALUES ('song-1', 'streamer', 'Song', 'Artist', 'approved');"
assert_query "$ADMIN_MIGRATION_DB" \
  "SELECT revision FROM vod_export_state WHERE id = 1;" \
  "1" \
  "Admin revision trigger must increment on an export-relevant insert"

# Running the bootstrap schema after the one-time migration must be safe. This
# mirrors the repository's existing db:migrate command without pretending that
# schema.sql can add columns to an already-existing NOVA submissions table.
apply_sql_file "$ADMIN_MIGRATION_DB" "$ROOT_DIR/admin/schema.sql"
apply_sql_file "$ADMIN_MIGRATION_DB" "$ROOT_DIR/admin/schema.sql"

NOVA_MIGRATION_DB="$TMP_DIR/nova-migration.sqlite"
sqlite3 -batch -bail "$NOVA_MIGRATION_DB" <<'SQL'
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  youtube_channel_url TEXT NOT NULL,
  youtube_channel_url_normalized TEXT DEFAULT '',
  youtube_channel_id TEXT DEFAULT '',
  slug TEXT NOT NULL,
  brand_name TEXT DEFAULT '',
  display_name TEXT NOT NULL,
  description TEXT DEFAULT '',
  avatar_url TEXT DEFAULT '',
  subscriber_count TEXT DEFAULT '',
  link_youtube TEXT DEFAULT '',
  link_twitter TEXT DEFAULT '',
  link_facebook TEXT DEFAULT '',
  link_instagram TEXT DEFAULT '',
  link_twitch TEXT DEFAULT '',
  "group" TEXT DEFAULT '',
  enabled INTEGER DEFAULT 1,
  display_order INTEGER DEFAULT 999,
  theme_json TEXT DEFAULT '',
  external_url TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  submitted_at TEXT DEFAULT (datetime('now')),
  reviewed_at TEXT,
  reviewer_note TEXT DEFAULT ''
);
INSERT INTO submissions (
  id,
  youtube_channel_url,
  youtube_channel_url_normalized,
  youtube_channel_id,
  slug,
  display_name,
  status
) VALUES (
  'legacy',
  'https://www.youtube.com/channel/channel-a',
  'youtube.com/channel/channel-a',
  'channel-a',
  'legacy',
  'Legacy',
  'approved'
);
SQL
apply_sql_file "$NOVA_MIGRATION_DB" "$ROOT_DIR/tools/nova/migrations/0014_add_vod_export_state.sql"
assert_query "$NOVA_MIGRATION_DB" \
  "SELECT youtube_channel_verified_id IS NULL AND youtube_channel_verified_at IS NULL FROM submissions WHERE id = 'legacy';" \
  "1" \
  "NOVA migration must leave existing channel IDs unverified"

VERIFIED_AT='2026-07-11T00:00:00Z'
sqlite3 -batch -bail "$NOVA_MIGRATION_DB" \
  "UPDATE submissions SET youtube_channel_verified_id = youtube_channel_id, youtube_channel_verified_at = '$VERIFIED_AT' WHERE id = 'legacy';"
sqlite3 -batch -bail "$NOVA_MIGRATION_DB" \
  "UPDATE submissions SET youtube_channel_id = 'channel-b', youtube_channel_verified_id = 'channel-b', youtube_channel_verified_at = '$VERIFIED_AT' WHERE id = 'legacy';"
assert_query "$NOVA_MIGRATION_DB" \
  "SELECT youtube_channel_id || '|' || youtube_channel_verified_id || '|' || youtube_channel_verified_at FROM submissions WHERE id = 'legacy';" \
  "channel-b|channel-b|$VERIFIED_AT" \
  "An atomic re-verification must remain valid even when its timestamp is unchanged"

sqlite3 -batch -bail "$NOVA_MIGRATION_DB" \
  "UPDATE submissions SET youtube_channel_id = 'channel-c' WHERE id = 'legacy';"
assert_query "$NOVA_MIGRATION_DB" \
  "SELECT youtube_channel_verified_id IS NULL AND youtube_channel_verified_at IS NULL FROM submissions WHERE id = 'legacy';" \
  "1" \
  "A channel-only change must clear stale verification"

if sqlite3 -batch -bail "$NOVA_MIGRATION_DB" \
  "UPDATE submissions SET youtube_channel_verified_id = 'different-channel', youtube_channel_verified_at = '$VERIFIED_AT' WHERE id = 'legacy';" \
  >/dev/null 2>&1; then
  fail "Mismatched YouTube verification must be rejected"
fi

# After 0014 has added the columns, schema.sql remains safely re-runnable.
apply_sql_file "$NOVA_MIGRATION_DB" "$ROOT_DIR/tools/nova/schema.sql"
apply_sql_file "$NOVA_MIGRATION_DB" "$ROOT_DIR/tools/nova/schema.sql"
assert_query "$NOVA_MIGRATION_DB" \
  "SELECT count(*) FROM pragma_table_info('submissions') WHERE name IN ('youtube_channel_verified_id', 'youtube_channel_verified_at');" \
  "2" \
  "NOVA migration plus bootstrap schema must expose both verification columns"

ADMIN_FRESH_DB="$TMP_DIR/admin-fresh.sqlite"
apply_sql_file "$ADMIN_FRESH_DB" "$ROOT_DIR/admin/schema.sql"
apply_sql_file "$ADMIN_FRESH_DB" "$ROOT_DIR/admin/schema.sql"
assert_query "$ADMIN_FRESH_DB" \
  "SELECT revision || '|' || trigger_schema_version FROM vod_export_state WHERE id = 1;" \
  "0|1" \
  "Fresh Admin bootstrap must be idempotent and start at revision zero"
assert_query "$ADMIN_FRESH_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'vod_export_*_revision';" \
  "9" \
  "Fresh Admin bootstrap must include every source revision trigger"
assert_query "$ADMIN_FRESH_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'vod_export_publication_audits';" \
  "1" \
  "Fresh Admin bootstrap must include the publication audit table"
assert_query "$ADMIN_FRESH_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'table' AND name = 'vod_export_publication_resolutions';" \
  "1" \
  "Fresh Admin bootstrap must include the publication resolution table"

NOVA_FRESH_DB="$TMP_DIR/nova-fresh.sqlite"
apply_sql_file "$NOVA_FRESH_DB" "$ROOT_DIR/tools/nova/schema.sql"
apply_sql_file "$NOVA_FRESH_DB" "$ROOT_DIR/tools/nova/schema.sql"
assert_query "$NOVA_FRESH_DB" \
  "SELECT revision || '|' || trigger_schema_version FROM vod_export_state WHERE id = 1;" \
  "0|1" \
  "Fresh NOVA bootstrap must be idempotent and start at revision zero"
assert_query "$NOVA_FRESH_DB" \
  "SELECT count(*) FROM pragma_table_info('submissions') WHERE name IN ('youtube_channel_verified_id', 'youtube_channel_verified_at');" \
  "2" \
  "Fresh NOVA bootstrap must include both verification columns"
assert_query "$NOVA_FRESH_DB" \
  "SELECT count(*) FROM sqlite_schema WHERE type = 'trigger' AND name GLOB 'vod_export_submissions_*';" \
  "6" \
  "Fresh NOVA bootstrap must include verification guards and revision triggers"

printf 'VOD export migration and fresh-schema checks passed.\n'
