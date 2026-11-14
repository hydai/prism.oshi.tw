#!/bin/sh
set -eu

fresh_db="$(mktemp /tmp/prism-vod-correction-applies-fresh.XXXXXX.sqlite3)"
legacy_db="$(mktemp /tmp/prism-vod-correction-applies-legacy.XXXXXX.sqlite3)"
trap 'rm -f "$fresh_db" "$legacy_db"' EXIT

assert_sql() {
  database="$1"
  sql="$2"
  expected="$3"
  label="$4"
  actual="$(sqlite3 "$database" "$sql")"
  if [ "$actual" != "$expected" ]; then
    echo "FAIL: $label (expected $expected, got $actual)" >&2
    exit 1
  fi
}

# Every column as name:type:notnull:default:pk, so two databases can be compared column for column.
shape="SELECT group_concat(name || ':' || type || ':' || \"notnull\" || ':' || coalesce(dflt_value, '') || ':' || pk, ' | ')
       FROM pragma_table_info('vod_correction_applies');"

# --- Fresh DB: schema.sql alone must create the apply record table and its index ---
sqlite3 "$fresh_db" < schema.sql
sqlite3 "$fresh_db" < schema.sql

assert_sql "$fresh_db" \
  "SELECT group_concat(name, ',') FROM pragma_table_info('vod_correction_applies');" \
  'token,submission_id,reviewer_note,summary,actor,applied_at,announced_at' \
  'fresh schema creates vod_correction_applies with the record columns'
assert_sql "$fresh_db" \
  "SELECT name FROM pragma_table_info('vod_correction_applies') WHERE pk = 1;" \
  'token' \
  'the apply token is the whole primary key'
assert_sql "$fresh_db" \
  "SELECT group_concat(name, ',') FROM pragma_table_info('vod_correction_applies') WHERE \"notnull\" = 1;" \
  'submission_id,reviewer_note,summary,actor,applied_at' \
  'every column beside the token and announced_at is NOT NULL'
assert_sql "$fresh_db" \
  "SELECT dflt_value FROM pragma_table_info('vod_correction_applies') WHERE name = 'applied_at';" \
  "datetime('now')" \
  'applied_at defaults to the time of the insert'
assert_sql "$fresh_db" \
  "SELECT group_concat(name, ',') FROM pragma_index_info('idx_vod_correction_applies_submission');" \
  'submission_id' \
  'fresh schema indexes the records by submission'

# --- Legacy simulation: a production DB that predates this migration ---
sqlite3 "$legacy_db" < schema.sql
sqlite3 "$legacy_db" <<'SQL'
DROP INDEX idx_vod_correction_applies_submission;
DROP TABLE vod_correction_applies;
SQL
assert_sql "$legacy_db" \
  "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '%vod_correction_applies%';" \
  '0' \
  'the legacy database has no apply records yet'

sqlite3 "$legacy_db" < migrations/0011_vod_correction_applies.sql
sqlite3 "$legacy_db" < migrations/0011_vod_correction_applies.sql

assert_sql "$legacy_db" "$shape" "$(sqlite3 "$fresh_db" "$shape")" \
  'the migration creates exactly the table schema.sql creates'
assert_sql "$legacy_db" \
  "SELECT group_concat(name, ',') FROM pragma_index_info('idx_vod_correction_applies_submission');" \
  'submission_id' \
  'the migration indexes the records by submission'

# --- The log is append-only and keyed by a fresh token per apply ---
sqlite3 "$legacy_db" <<'SQL'
INSERT INTO vod_correction_applies (token, submission_id, reviewer_note, summary, actor) VALUES
  ('apply-1', 'vod-1', 'thanks', 'summary 1', 'curator@example.com'),
  ('apply-2', 'vod-1', '', 'summary 2', 'curator@example.com');
SQL
assert_sql "$legacy_db" \
  "SELECT COUNT(*) FROM vod_correction_applies WHERE submission_id = 'vod-1' AND applied_at IS NOT NULL AND announced_at IS NULL;" \
  '2' \
  'a submission applied again gets a second record, each stamped and unannounced'
if sqlite3 "$legacy_db" "INSERT INTO vod_correction_applies (token, submission_id, reviewer_note, summary, actor) VALUES ('apply-1', 'vod-2', '', 'summary', 'curator@example.com');" 2>/dev/null; then
  echo 'FAIL: a token is never written twice' >&2
  exit 1
fi

plan="$(sqlite3 "$legacy_db" "EXPLAIN QUERY PLAN SELECT token FROM vod_correction_applies WHERE submission_id = 'vod-1' AND announced_at IS NULL ORDER BY applied_at DESC, rowid DESC LIMIT 1;")"
if ! printf '%s\n' "$plan" | grep -q 'idx_vod_correction_applies_submission'; then
  echo "FAIL: the recovery's lookup reads the submission index (plan: $plan)" >&2
  exit 1
fi

assert_sql "$legacy_db" \
  'PRAGMA integrity_check;' \
  'ok' \
  'SQLite integrity after migration'

echo '✓ VOD correction apply records: schema.sql and migration 0011 agree, append-only, one row per token'
