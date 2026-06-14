#!/usr/bin/env npx tsx
/**
 * sync-stale: Auto-sync every streamer whose local data has drifted from
 * the admin D1 DB. Spawns sync-data per stale slug and leaves commits to
 * the caller (the /sync-stale slash command) so each streamer can get its
 * own conventional `data: sync <slug> ...` commit.
 *
 * Usage: npx tsx tools/sync-stale/sync.ts
 *
 * Exit code: 0 on success (even if nothing was stale), non-zero on any
 * sync-data failure.
 */

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectAll, staleSlugs } from '../sync-status/detect.ts';
import { assertValidSlug } from '../shared/slug.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const SYNC_DATA = path.resolve(ROOT, 'tools/sync-data/sync.ts');

function runSyncData(slug: string): void {
  // Defense in depth at the exact call site that hands a slug to sync-data. These
  // stale slugs already passed readRegistry's validation and sync-data re-checks on
  // entry, but validating here keeps the guarantee local to the spawn and survives
  // any future change to how stale slugs are sourced.
  assertValidSlug(slug);
  console.log(`\n── syncing ${slug} ──`);
  execFileSync('npx', ['tsx', SYNC_DATA, slug], {
    cwd: ROOT,
    stdio: 'inherit',
  });
}

function main(): void {
  console.log('sync-stale: detecting drift...');
  const statuses = detectAll(ROOT);
  const stale = staleSlugs(statuses);

  if (stale.length === 0) {
    console.log('✓ all streamers up to date, nothing to sync');
    process.exit(0);
  }

  console.log(`⚠ ${stale.length} streamer(s) stale: ${stale.join(', ')}`);

  for (const slug of stale) {
    runSyncData(slug);
  }

  console.log(`\n✓ synced ${stale.length} streamer(s). Review \`git status\` and commit.`);
}

main();
