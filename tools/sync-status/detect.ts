/**
 * Shared freshness detector used by `sync:status` (report) and `sync:stale`
 * (auto-sync).
 *
 * Compares per-streamer (MAX(updated_at), COUNT(*)) in the admin D1 DB
 * against the values stamped in data/.sync-state.json at the last sync-data
 * run. Any mismatch on songs, performances, or streams means the streamer's
 * local JSON files may be out of date.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { queryD1 } from '../shared/d1.ts';
import { readSyncState, EMPTY_ENTRY, type SyncStateEntry } from '../shared/sync-state.ts';
import { assertValidSlug } from '../shared/slug.ts';
import { LATEST_UPDATED_AT_SQL } from '../shared/sync-sql.ts';

export interface StreamerRegistryEntry {
  slug: string;
  enabled?: boolean;
}

export interface RegistryFile {
  version: number;
  streamers: StreamerRegistryEntry[];
}

export interface DbSnapshot {
  maxSongUpdatedAt: string | null;
  maxPerfUpdatedAt: string | null;
  maxStreamUpdatedAt: string | null;
  songsCount: number;
  performancesCount: number;
  streamsCount: number;
}

export type Freshness = 'fresh' | 'stale' | 'never';

export interface StreamerStatus {
  slug: string;
  freshness: Freshness;
  state: SyncStateEntry;
  db: DbSnapshot;
  deltaSongs: number;
  deltaPerformances: number;
  deltaStreams: number;
}

interface AggRow {
  streamer_id: string;
  source: 'songs' | 'performances' | 'streams';
  max_ts: string | null;
  cnt: number;
}

export const AGG_SQL = `
  SELECT song.streamer_id, 'songs' AS source,
         ${LATEST_UPDATED_AT_SQL},
         COUNT(*) AS cnt
    FROM songs AS song
    LEFT JOIN song_work_links AS link ON link.song_id = song.id
    WHERE song.status = 'approved'
    GROUP BY song.streamer_id
  UNION ALL
  SELECT streamer_id, 'performances' AS source, MAX(updated_at) AS max_ts, COUNT(*) AS cnt
    FROM performances WHERE status = 'approved' GROUP BY streamer_id
  UNION ALL
  SELECT streamer_id, 'streams' AS source, MAX(updated_at) AS max_ts, COUNT(*) AS cnt
    FROM streams WHERE status = 'approved' GROUP BY streamer_id
`.trim();

function queryAdminD1(): AggRow[] {
  return queryD1<AggRow>('admin', AGG_SQL);
}

export function readRegistry(root: string): StreamerRegistryEntry[] {
  const p = path.resolve(root, 'data/registry.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as RegistryFile;
  const enabled = raw.streamers.filter((s) => s.enabled !== false);
  // Fail closed: every enabled slug here flows downstream into sync-data's D1 SQL
  // and filesystem-path sinks. A slug that fails validation can't have come from
  // Nova (which validates on submit), so its presence signals tampering — reject
  // it loudly instead of syncing it. Only enabled rows are checked: disabled ones
  // are never synced, so junk there shouldn't block the legitimate streamers.
  for (const s of enabled) {
    assertValidSlug(s.slug, 'data/registry.json');
  }
  return enabled;
}

function emptySnapshot(): DbSnapshot {
  return {
    maxSongUpdatedAt: null,
    maxPerfUpdatedAt: null,
    maxStreamUpdatedAt: null,
    songsCount: 0,
    performancesCount: 0,
    streamsCount: 0,
  };
}

function classify(state: SyncStateEntry, db: DbSnapshot): Freshness {
  const neverSynced = state.lastSyncedAt === null;
  const dbHasData = db.songsCount > 0 || db.performancesCount > 0 || db.streamsCount > 0;

  if (neverSynced) return dbHasData ? 'never' : 'fresh';

  const changed =
    state.maxSongUpdatedAt !== db.maxSongUpdatedAt ||
    state.maxPerfUpdatedAt !== db.maxPerfUpdatedAt ||
    state.maxStreamUpdatedAt !== db.maxStreamUpdatedAt ||
    state.songsCount !== db.songsCount ||
    state.performancesCount !== db.performancesCount ||
    state.streamsCount !== db.streamsCount;

  return changed ? 'stale' : 'fresh';
}

export function detectAll(root: string): StreamerStatus[] {
  const registry = readRegistry(root);
  const stateFile = readSyncState(root);
  const aggRows = queryAdminD1();

  const dbByStreamer = new Map<string, DbSnapshot>();
  for (const row of aggRows) {
    const snap = dbByStreamer.get(row.streamer_id) ?? emptySnapshot();
    if (row.source === 'songs') {
      snap.maxSongUpdatedAt = row.max_ts;
      snap.songsCount = row.cnt;
    } else if (row.source === 'performances') {
      snap.maxPerfUpdatedAt = row.max_ts;
      snap.performancesCount = row.cnt;
    } else if (row.source === 'streams') {
      snap.maxStreamUpdatedAt = row.max_ts;
      snap.streamsCount = row.cnt;
    }
    dbByStreamer.set(row.streamer_id, snap);
  }

  return registry.map(({ slug }) => {
    const state = stateFile.streamers[slug] ?? { ...EMPTY_ENTRY };
    const db = dbByStreamer.get(slug) ?? emptySnapshot();
    return {
      slug,
      freshness: classify(state, db),
      state,
      db,
      deltaSongs: db.songsCount - state.songsCount,
      deltaPerformances: db.performancesCount - state.performancesCount,
      deltaStreams: db.streamsCount - state.streamsCount,
    };
  });
}

export function staleSlugs(statuses: StreamerStatus[]): string[] {
  return statuses.filter((s) => s.freshness !== 'fresh').map((s) => s.slug);
}
