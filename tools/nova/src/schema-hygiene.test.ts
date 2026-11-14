// schema.sql is a fresh-database bootstrap: DDL plus singleton state rows only.
// Demo streamer rows live in seed.sql and are applied to LOCAL databases by
// `npm run db:seed:local`; production received them through migrations 0003/0011
// and must never be re-seeded by a bootstrap file. Run with: npm run test:schema-hygiene
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const process: { exitCode?: number };

const here = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(resolve(here, '../schema.sql'), 'utf8');
const seed = readFileSync(resolve(here, '../seed.sql'), 'utf8');

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const DATA_TABLES = ['submissions', 'vod_submissions', 'vod_songs'];
for (const table of DATA_TABLES) {
  const re = new RegExp(`INSERT\\s+(OR\\s+\\w+\\s+)?INTO\\s+${table}\\b`, 'i');
  assert(!re.test(schema), `schema.sql must not insert into ${table} (demo rows belong in seed.sql)`);
}
assert(/INSERT OR IGNORE INTO vod_export_state/.test(schema), 'schema.sql keeps the vod_export_state bootstrap row');

const seedInserts = seed.match(/INSERT\s+OR\s+IGNORE\s+INTO\s+submissions\b/g) ?? [];
assert(seedInserts.length === 2, `seed.sql holds exactly two submission seeds (found ${seedInserts.length})`);
assert(/'seed-mizuki'/.test(seed) && /'seed-gabu'/.test(seed), 'seed.sql names seed-mizuki and seed-gabu');
assert(!/INSERT\s+OR\s+REPLACE/i.test(seed), 'seed.sql never replaces existing rows');
assert(!/CREATE\s+TABLE/i.test(seed), 'seed.sql contains no DDL');

// Migration 0012 replaced the UNIQUE (streamer_slug, video_id) index with a plain one so a
// VOD can be submitted more than once. A fresh database built from schema.sql must agree.
assert(
  !/CREATE\s+UNIQUE\s+INDEX[^;]*\bON\s+vod_submissions\s*\(\s*streamer_slug\s*,\s*video_id\s*\)/i.test(schema),
  'schema.sql must not declare a UNIQUE index on vod_submissions(streamer_slug, video_id) (migration 0012 made it a plain index)',
);

assert(/kind TEXT NOT NULL DEFAULT 'new' CHECK\(kind IN \('new','correction'\)\)/.test(schema), 'schema.sql declares vod_submissions.kind');
const migration0015 = readFileSync(resolve(here, '../migrations/0015_add_vod_submission_kind.sql'), 'utf8');
assert(/ALTER TABLE vod_submissions ADD COLUMN kind TEXT NOT NULL DEFAULT 'new' CHECK\(kind IN \('new','correction'\)\)/.test(migration0015), 'migration 0015 adds vod_submissions.kind');

console.log('✓ schema.sql is DDL + state only; seed.sql holds the two demo streamers');
