import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { SQLiteD1 } from './sqlite-d1';

const db = new SQLiteD1();
const sql = db.sqlite;
const migration = readFileSync(new URL('../migrations/0009_fan_export_revisions.sql', import.meta.url), 'utf8');
assert.ok(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8').includes(migration.trim()), 'fresh schema and migration must carry identical revision rules');
sql.exec(migration);
sql.exec(migration);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'fan_export_%'").get()!.n, 12);
sql.exec(`
  INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('song','alice','Song','Artist','approved');
  INSERT INTO works (id,title,original_artist) VALUES ('work','Song','Artist'), ('other','Other','Artist');
  INSERT INTO song_work_links (song_id,work_id,link_method,linked_by) VALUES ('song','work','import_exact','curator');
  INSERT INTO streams (id,streamer_id,title,date,video_id,youtube_url,status) VALUES ('stream','alice','Stream','2026-01-01','video','url','approved');
  INSERT INTO performances (id,streamer_id,song_id,stream_id,date,stream_title,video_id,timestamp,status) VALUES ('perf','alice','song','stream','2026-01-01','Stream','video',10,'approved');
`);
const revision = (slug = 'alice') => Number(sql.prepare('SELECT revision FROM fan_export_revisions WHERE streamer_id = ?').get(slug)?.revision ?? 0);
function advances(statement: string) {
  const before = revision();
  sql.exec(statement);
  assert.ok(revision() > before, statement);
}
// None of these edits changes an updated_at value; timestamps/counts alone
// cannot prove freshness, but every field exported to the fan site is covered.
advances("UPDATE performances SET note = 'encore' WHERE id = 'perf'");
advances("UPDATE streams SET credit = '{\"author\":\"curator\"}' WHERE id = 'stream'");
advances("UPDATE song_work_links SET work_id = 'other' WHERE song_id = 'song'");
advances("UPDATE songs SET title = 'Renamed' WHERE id = 'song'");
advances("DELETE FROM performances WHERE id = 'perf'");
advances("UPDATE streams SET status = 'pending' WHERE id = 'stream'");
const unchanged = revision();
sql.exec("UPDATE streams SET title = 'Not exported' WHERE id = 'stream'");
assert.equal(revision(), unchanged, 'pending-only edits do not dirty published exports');
advances("UPDATE songs SET streamer_id = 'bob' WHERE id = 'song'");
assert.ok(revision('bob') > 0, 'moving an approved row invalidates both tenants');
const seeded = revision();
sql.exec(migration);
assert.equal(revision(), seeded, 'reapplying migration never resets the clock');
sql.close();

// Upgrade an existing pre-migration database (not just a fresh schema).
const legacy = new SQLiteD1();
const triggerNames = legacy.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'fan_export_%'").all();
for (const row of triggerNames) legacy.sqlite.exec(`DROP TRIGGER ${row.name}`);
legacy.sqlite.exec("DROP TABLE fan_export_revisions; INSERT INTO songs (id,streamer_id,title,original_artist,status) VALUES ('legacy','legacy-streamer','Song','Artist','approved')");
legacy.sqlite.exec(migration);
assert.equal(legacy.sqlite.prepare("SELECT revision FROM fan_export_revisions WHERE streamer_id = 'legacy-streamer'").get()!.revision, 1);
legacy.sqlite.close();
console.log('✓ export revisions cover same-second metadata edits, links, deletes, tenant moves and idempotent migration');
