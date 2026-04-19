#!/usr/bin/env npx tsx
/**
 * sync-data: Export approved songs, performances, and streams from D1 → data/{slug}/
 *
 * Usage: npx tsx tools/sync-data/sync.ts <streamer-slug>
 *
 * Queries oshi-prism-db via wrangler d1 execute (same pattern as sync-registry).
 * Writes songs.json and streams.json in the fan-site format.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncStatePath, upsertEntry, type SyncStateEntry } from '../shared/sync-state.ts';

// --- Paths ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '../..');
const ADMIN_DIR = path.resolve(ROOT, 'admin');

// --- DB row types ---

interface SongRow {
  id: string;
  title: string;
  original_artist: string;
  tags: string; // JSON array
}

interface PerformanceRow {
  id: string;
  song_id: string;
  stream_id: string;
  date: string;
  stream_title: string;
  video_id: string;
  timestamp: number;
  end_timestamp: number | null;
  note: string;
}

interface StreamRow {
  id: string;
  title: string;
  date: string;
  video_id: string;
  youtube_url: string;
  credit: string; // JSON object
}

// --- Fan-site output types ---

interface FanSitePerformance {
  id: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: number;
  endTimestamp: number | null;
  note: string;
}

interface FanSiteSong {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
  performances: FanSitePerformance[];
}

interface FanSiteStream {
  id: string;
  title: string;
  date: string;
  videoId: string;
  youtubeUrl: string;
  credit?: Record<string, unknown>;
}

// --- Query D1 ---

function queryD1<T>(sql: string): T[] {
  const raw = execFileSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'oshi-prism-db', '--remote', '--json', `--command=${sql}`],
    { cwd: ADMIN_DIR, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );

  const parsed = JSON.parse(raw);
  return (parsed[0]?.results ?? []) as T[];
}

// --- Build fan-site songs.json ---

function buildSongs(streamerId: string): FanSiteSong[] {
  const songRows = queryD1<SongRow>(
    `SELECT id, title, original_artist, tags FROM songs WHERE streamer_id = '${streamerId}' AND status = 'approved' ORDER BY id`,
  );
  const perfRows = queryD1<PerformanceRow>(
    `SELECT id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note FROM performances WHERE streamer_id = '${streamerId}' AND status = 'approved' ORDER BY date`,
  );

  const perfsBySong = new Map<string, PerformanceRow[]>();
  for (const p of perfRows) {
    const list = perfsBySong.get(p.song_id) || [];
    list.push(p);
    perfsBySong.set(p.song_id, list);
  }

  return songRows.map((row) => ({
    id: row.id,
    title: row.title,
    originalArtist: row.original_artist,
    tags: JSON.parse(row.tags) as string[],
    performances: (perfsBySong.get(row.id) || []).map((p) => ({
      id: p.id,
      streamId: p.stream_id,
      date: p.date,
      streamTitle: p.stream_title,
      videoId: p.video_id,
      timestamp: p.timestamp,
      endTimestamp: p.end_timestamp,
      note: p.note,
    })),
  }));
}

// --- Build fan-site streams.json ---

function buildStreams(streamerId: string): FanSiteStream[] {
  const rows = queryD1<StreamRow>(
    `SELECT id, title, date, video_id, youtube_url, credit FROM streams WHERE streamer_id = '${streamerId}' AND status = 'approved' ORDER BY date DESC`,
  );

  return rows.map((row) => {
    const credit = JSON.parse(row.credit);
    const stream: FanSiteStream = {
      id: row.id,
      title: row.title,
      date: row.date,
      videoId: row.video_id,
      youtubeUrl: row.youtube_url,
    };
    if (credit && Object.keys(credit).length > 0) {
      stream.credit = credit;
    }
    return stream;
  });
}

// --- Query max updated_at per table ---

interface MaxRow {
  max_ts: string | null;
}

function queryMaxUpdatedAt(table: 'songs' | 'performances' | 'streams', streamerId: string): string | null {
  const rows = queryD1<MaxRow>(
    `SELECT MAX(updated_at) AS max_ts FROM ${table} WHERE streamer_id = '${streamerId}' AND status = 'approved'`,
  );
  return rows[0]?.max_ts ?? null;
}

// --- Main ---

function main(): void {
  const slug = process.argv[2];
  if (!slug) {
    console.error('Usage: npx tsx tools/sync-data/sync.ts <streamer-slug>');
    process.exit(1);
  }

  const dataDir = path.resolve(ROOT, 'data', slug);
  if (!fs.existsSync(dataDir)) {
    console.error(`ERROR: data/${slug}/ does not exist. Run sync:registry first.`);
    process.exit(1);
  }

  console.log(`sync-data: exporting approved data for "${slug}"...`);

  const songs = buildSongs(slug);
  const streams = buildStreams(slug);

  const songsPath = path.join(dataDir, 'songs.json');
  const streamsPath = path.join(dataDir, 'streams.json');

  fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2) + '\n', 'utf-8');
  fs.writeFileSync(streamsPath, JSON.stringify(streams, null, 2) + '\n', 'utf-8');

  console.log(`  wrote ${songsPath} (${songs.length} songs)`);
  console.log(`  wrote ${streamsPath} (${streams.length} streams)`);

  const totalPerfs = songs.reduce((sum, s) => sum + s.performances.length, 0);
  console.log(`  total: ${songs.length} songs, ${totalPerfs} performances, ${streams.length} streams`);

  const entry: SyncStateEntry = {
    lastSyncedAt: new Date().toISOString(),
    maxSongUpdatedAt: queryMaxUpdatedAt('songs', slug),
    maxPerfUpdatedAt: queryMaxUpdatedAt('performances', slug),
    maxStreamUpdatedAt: queryMaxUpdatedAt('streams', slug),
    songsCount: songs.length,
    performancesCount: totalPerfs,
    streamsCount: streams.length,
  };
  upsertEntry(ROOT, slug, entry);
  console.log(`  stamped ${syncStatePath(ROOT)}`);

  console.log('sync-data: done.');
}

main();
