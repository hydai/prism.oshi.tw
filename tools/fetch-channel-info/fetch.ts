#!/usr/bin/env npx tsx
/**
 * fetch-channel-info: refresh subscriber count + avatar for every approved streamer.
 *
 * Mirrors the admin "Fetch All Channel Info" button without the UI. Reuses the worker's
 * fetchChannelInfo() and formatSubscriberCount(), reads YOUTUBE_API_KEY from admin/.dev.vars,
 * and reads/writes the production Nova D1 via `wrangler ... --remote` (run from tools/nova/,
 * the same pattern as sync-registry).
 *
 * Usage: npx tsx tools/fetch-channel-info/fetch.ts
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatSubscriberCount } from '../../admin/shared/format.ts';
import type { BulkFetchSubscribersResponse, BulkFetchSubscribersResult } from '../../admin/shared/types.ts';
import { fetchChannelInfo } from '../../admin/src/youtube.ts';

// --- Paths ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const NOVA_DIR = path.resolve(ROOT, 'tools/nova');
const DEV_VARS_PATH = path.resolve(ROOT, 'admin/.dev.vars');

const NOVA_DB = 'oshi-prism-nova';

// --- SQL ---

export const APPROVED_WITH_CHANNEL_SQL =
  "SELECT id, display_name, youtube_channel_id FROM submissions WHERE status = 'approved' AND youtube_channel_id != ''";

interface ApprovedRow {
  id: string;
  display_name: string;
  youtube_channel_id: string;
}

// --- Pure helpers (unit-tested in fetch.test.ts) ---

/** wrangler d1 --json returns an array whose first element holds the result rows. */
export function parseWranglerResults<T>(raw: string): T[] {
  const parsed = JSON.parse(raw);
  return parsed[0]?.results ?? [];
}

/** Extract YOUTUBE_API_KEY from .dev.vars content; null if absent or empty. */
export function parseDevVarYoutubeKey(content: string): string | null {
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== 'YOUTUBE_API_KEY') continue;
    let value = trimmed.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")));
    if (quoted) value = value.slice(1, -1);
    return value === '' ? null : value;
  }
  return null;
}

/** Quote and escape a value as a SQLite string literal. */
export function toSqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface SubscriberUpdate {
  id: string;
  subscriberCount: string;
  avatarUrl: string;
}

/** Build one UPDATE statement per resolved streamer; empty string when there are none. */
export function buildUpdateSql(updates: SubscriberUpdate[]): string {
  return updates
    .map(
      (u) =>
        `UPDATE submissions SET subscriber_count=${toSqlStringLiteral(u.subscriberCount)}, ` +
        `avatar_url=${toSqlStringLiteral(u.avatarUrl)} WHERE id=${toSqlStringLiteral(u.id)};`,
    )
    .join('\n');
}

/** Human-readable summary, shaped like the admin UI's BulkFetchSubscribersResponse. */
export function formatSummary(response: BulkFetchSubscribersResponse): string {
  const lines = [`Updated ${response.updated}, Failed ${response.failed}`];
  for (const r of response.results) {
    lines.push(r.error ? `✗ ${r.display_name} — ${r.error}` : `✓ ${r.display_name} — ${r.subscriber_count}`);
  }
  return lines.join('\n');
}

// --- I/O ---

function queryD1<T>(sql: string): T[] {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', NOVA_DB, '--remote', '--json', `--command=${sql}`], {
    cwd: NOVA_DIR,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return parseWranglerResults<T>(raw);
}

function executeD1File(filePath: string): void {
  execFileSync('npx', ['wrangler', 'd1', 'execute', NOVA_DB, '--remote', `--file=${filePath}`], {
    cwd: NOVA_DIR,
    encoding: 'utf-8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

/**
 * Write `sql` into a freshly created, owner-only temp directory and return both paths.
 *
 * The returned file is handed to `wrangler d1 execute --file=` for a privileged write to
 * the production Nova D1, so it must not be attacker-influenceable. `fs.mkdtempSync`
 * atomically creates a directory with an unguessable random name and mode 0700, so a local
 * user has no permission to enter it — they cannot pre-plant a symlink, pre-create the
 * file, or race-replace its contents the way a predictable `${Date.now()}.sql` name
 * directly under the shared, world-writable os.tmpdir() allowed (CWE-377/CWE-379). The
 * `wx` flag + 0600 mode harden the file itself. Callers must remove `dir` recursively.
 */
export function writeSqlToPrivateTempFile(sql: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fetch-channel-info-'));
  const file = path.join(dir, 'updates.sql');
  fs.writeFileSync(file, `${sql}\n`, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
  return { dir, file };
}

export async function main(): Promise<void> {
  if (!fs.existsSync(DEV_VARS_PATH)) {
    console.error(`ERROR: ${DEV_VARS_PATH} not found. Add a line "YOUTUBE_API_KEY=<your key>".`);
    process.exit(1);
  }
  const apiKey = parseDevVarYoutubeKey(fs.readFileSync(DEV_VARS_PATH, 'utf-8'));
  if (!apiKey) {
    console.error('ERROR: YOUTUBE_API_KEY not found in admin/.dev.vars. Add a line "YOUTUBE_API_KEY=<your key>".');
    process.exit(1);
  }

  console.log('fetch-channel-info: querying approved streamers from Nova D1...');
  let rows: ApprovedRow[];
  try {
    rows = queryD1<ApprovedRow>(APPROVED_WITH_CHANNEL_SQL);
  } catch (err) {
    console.error('ERROR: failed to query Nova D1. Is wrangler authenticated? Run `npx wrangler login`.');
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (rows.length === 0) {
    console.log('Nothing to fetch — no approved streamers with a channel ID.');
    return;
  }
  console.log(`  found ${rows.length} streamer(s); fetching channel info from YouTube...`);

  const results: BulkFetchSubscribersResult[] = [];
  const updates: SubscriberUpdate[] = [];
  let updated = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const info = await fetchChannelInfo(apiKey, row.youtube_channel_id);
      if (info === null) {
        results.push({ id: row.id, display_name: row.display_name, subscriber_count: null, avatar_url: null, error: 'Hidden or not found' });
        failed++;
        continue;
      }
      const formatted = formatSubscriberCount(info.subscriberCount);
      updates.push({ id: row.id, subscriberCount: formatted, avatarUrl: info.avatarUrl });
      results.push({ id: row.id, display_name: row.display_name, subscriber_count: formatted, avatar_url: info.avatarUrl });
      updated++;
    } catch (err) {
      results.push({
        id: row.id,
        display_name: row.display_name,
        subscriber_count: null,
        avatar_url: null,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      failed++;
    }
  }

  const sql = buildUpdateSql(updates);
  if (sql) {
    const { dir, file } = writeSqlToPrivateTempFile(sql);
    try {
      executeD1File(file);
    } catch (err) {
      console.error('ERROR: failed to write updates to Nova D1 — not reporting success.');
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(formatSummary({ updated, failed, results }));
}

function isMainScript(): boolean {
  const entry = process.argv[1] ?? '';
  return entry.endsWith('tools/fetch-channel-info/fetch.ts') || entry.endsWith('tools/fetch-channel-info/fetch.js');
}

if (isMainScript()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
