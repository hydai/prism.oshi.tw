/**
 * Shared helpers for data/.sync-state.json — the committed record of
 * what each streamer's local JSON files were last synced against.
 *
 * Schema (version 1):
 *   {
 *     "version": 1,
 *     "streamers": {
 *       "<slug>": {
 *         "lastSyncedAt":       ISO-8601 timestamp when sync-data last ran
 *         "maxSongUpdatedAt":   MAX(songs.updated_at) pulled that run
 *         "maxPerfUpdatedAt":   MAX(performances.updated_at) pulled that run
 *         "maxStreamUpdatedAt": MAX(streams.updated_at) pulled that run
 *         "songsCount":         COUNT of approved songs at that time
 *         "performancesCount":  COUNT of approved performances at that time
 *         "streamsCount":       COUNT of approved streams at that time
 *       }
 *     }
 *   }
 *
 * Values inside an entry may be null for a slug that has never been synced
 * (scaffolded by sync-registry but no sync-data run yet).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface SyncStateEntry {
  lastSyncedAt: string | null;
  maxSongUpdatedAt: string | null;
  maxPerfUpdatedAt: string | null;
  maxStreamUpdatedAt: string | null;
  songsCount: number;
  performancesCount: number;
  streamsCount: number;
}

export interface SyncStateFile {
  version: 1;
  streamers: Record<string, SyncStateEntry>;
}

export const EMPTY_ENTRY: SyncStateEntry = {
  lastSyncedAt: null,
  maxSongUpdatedAt: null,
  maxPerfUpdatedAt: null,
  maxStreamUpdatedAt: null,
  songsCount: 0,
  performancesCount: 0,
  streamsCount: 0,
};

export function syncStatePath(root: string): string {
  return path.join(root, 'data', '.sync-state.json');
}

export function readSyncState(root: string): SyncStateFile {
  const p = syncStatePath(root);
  if (!fs.existsSync(p)) {
    return { version: 1, streamers: {} };
  }
  const raw = fs.readFileSync(p, 'utf-8');
  const parsed = JSON.parse(raw) as SyncStateFile;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported sync-state version: ${parsed.version}`);
  }
  return parsed;
}

export function writeSyncState(root: string, state: SyncStateFile): void {
  const p = syncStatePath(root);
  const sorted: SyncStateFile = {
    version: 1,
    streamers: Object.fromEntries(
      Object.entries(state.streamers).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  fs.writeFileSync(p, JSON.stringify(sorted, null, 2) + '\n', 'utf-8');
}

export function upsertEntry(
  root: string,
  slug: string,
  entry: SyncStateEntry,
): void {
  const state = readSyncState(root);
  state.streamers[slug] = entry;
  writeSyncState(root, state);
}

export function seedIfMissing(root: string, slug: string): boolean {
  const state = readSyncState(root);
  if (state.streamers[slug]) return false;
  state.streamers[slug] = { ...EMPTY_ENTRY };
  writeSyncState(root, state);
  return true;
}
