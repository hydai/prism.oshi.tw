#!/usr/bin/env npx tsx
/**
 * sync-status: Report which streamers have drifted from admin D1 since their
 * last sync-data run.
 *
 * Usage: npx tsx tools/sync-status/sync.ts
 *
 * Exit code: 0 if every enabled streamer is fresh, 1 if any are stale.
 * Lets shell scripts and CI gate on it.
 */

import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectAll, staleSlugs, type StreamerStatus } from './detect.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');

function fmtTs(ts: string | null): string {
  if (!ts) return '-';
  // ISO with T → "2026-04-19 12:34". SQLite format "2026-04-19 10:46:11" → keep minutes.
  return ts.replace('T', ' ').slice(0, 16);
}

function fmtDelta(n: number): string {
  if (n === 0) return '0';
  return n > 0 ? `+${n}` : `${n}`;
}

function icon(s: StreamerStatus): string {
  if (s.freshness === 'fresh') return '✓';
  if (s.freshness === 'stale') return '⚠';
  return '✗';
}

function printTable(rows: StreamerStatus[]): void {
  const header = ['slug', 'status', 'last synced', 'Δsongs', 'Δperf', 'Δstreams'];
  const body = rows.map((r) => [
    r.slug,
    `${icon(r)} ${r.freshness}`,
    fmtTs(r.state.lastSyncedAt),
    fmtDelta(r.deltaSongs),
    fmtDelta(r.deltaPerformances),
    fmtDelta(r.deltaStreams),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i].length)),
  );

  const pad = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  console.log(pad(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of body) console.log(pad(row));
}

function main(): void {
  console.log('sync-status: querying admin D1...');
  const statuses = detectAll(ROOT);
  printTable(statuses);

  const stale = staleSlugs(statuses);
  console.log('');
  if (stale.length === 0) {
    console.log(`✓ all ${statuses.length} streamer(s) up to date`);
    process.exit(0);
  }
  console.log(`⚠ ${stale.length}/${statuses.length} streamer(s) stale: ${stale.join(', ')}`);
  console.log(`  run: npm run sync:stale   (auto-sync all)`);
  console.log(`   or: npm run sync:data <slug>   (one at a time)`);
  process.exit(1);
}

main();
