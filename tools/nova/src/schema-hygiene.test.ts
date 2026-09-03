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

console.log('✓ schema.sql is DDL + state only; seed.sql holds the two demo streamers');
