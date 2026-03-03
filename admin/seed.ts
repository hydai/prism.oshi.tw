/**
 * Seed script: imports existing songs.json and streams.json into D1.
 * All imported entries get status='approved' since they're already live.
 *
 * Usage:
 *   npx tsx seed.ts --local          # Seed local D1 (dev)
 *   npx tsx seed.ts --remote         # Seed remote D1 (production)
 */

import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';

// ---------------------------------------------------------------------------
// Types matching the fan-site JSON format
// ---------------------------------------------------------------------------

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
  credit?: {
    author?: string;
    authorUrl?: string;
    commentUrl?: string;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DATA_DIR = resolve(__dirname, '..', 'data');
const DB_NAME = 'mizukiprism-staging';

function getMode(): string {
  const args = process.argv.slice(2);
  if (args.includes('--local')) return '--local';
  if (args.includes('--remote')) return '--remote';
  console.error('Usage: npx tsx seed.ts --local|--remote');
  process.exit(1);
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function execD1(sql: string, mode: string): void {
  const tmpFile = resolve(__dirname, '.seed-batch.sql');
  writeFileSync(tmpFile, sql, 'utf-8');
  try {
    execFileSync('npx', ['wrangler', 'd1', 'execute', DB_NAME, mode, `--file=${tmpFile}`], {
      stdio: 'inherit',
      cwd: __dirname,
    });
  } finally {
    unlinkSync(tmpFile);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const mode = getMode();

  // Load JSON data
  const songs: FanSiteSong[] = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'songs.json'), 'utf-8')
  );
  const streams: FanSiteStream[] = JSON.parse(
    readFileSync(resolve(DATA_DIR, 'streams.json'), 'utf-8')
  );

  console.log(`Loaded ${songs.length} songs, ${streams.length} streams`);

  // --- Seed streams first (referenced by performances) ---
  console.log('\nSeeding streams...');
  const BATCH_SIZE = 50;

  for (let i = 0; i < streams.length; i += BATCH_SIZE) {
    const batch = streams.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((s) => {
      const credit = JSON.stringify(s.credit ?? {});
      return `INSERT OR IGNORE INTO streams (id, title, date, video_id, youtube_url, credit, status, submitted_by)
        VALUES ('${escapeSql(s.id)}', '${escapeSql(s.title)}', '${escapeSql(s.date)}', '${escapeSql(s.videoId)}', '${escapeSql(s.youtubeUrl)}', '${escapeSql(credit)}', 'approved', 'seed-import');`;
    });
    execD1(stmts.join('\n'), mode);
    console.log(`  Streams: ${Math.min(i + BATCH_SIZE, streams.length)}/${streams.length}`);
  }

  // --- Seed songs ---
  console.log('\nSeeding songs...');
  for (let i = 0; i < songs.length; i += BATCH_SIZE) {
    const batch = songs.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((s) => {
      const tags = JSON.stringify(s.tags);
      return `INSERT OR IGNORE INTO songs (id, title, original_artist, tags, status, submitted_by)
        VALUES ('${escapeSql(s.id)}', '${escapeSql(s.title)}', '${escapeSql(s.originalArtist)}', '${escapeSql(tags)}', 'approved', 'seed-import');`;
    });
    execD1(stmts.join('\n'), mode);
    console.log(`  Songs: ${Math.min(i + BATCH_SIZE, songs.length)}/${songs.length}`);
  }

  // --- Seed performances ---
  console.log('\nSeeding performances...');
  let perfCount = 0;
  const perfBatch: string[] = [];

  for (const song of songs) {
    for (const p of song.performances) {
      perfBatch.push(
        `INSERT OR IGNORE INTO performances (id, song_id, stream_id, date, stream_title, video_id, timestamp, end_timestamp, note, status, submitted_by)
          VALUES ('${escapeSql(p.id)}', '${escapeSql(song.id)}', '${escapeSql(p.streamId)}', '${escapeSql(p.date)}', '${escapeSql(p.streamTitle)}', '${escapeSql(p.videoId)}', ${p.timestamp}, ${p.endTimestamp ?? 'NULL'}, '${escapeSql(p.note)}', 'approved', 'seed-import');`
      );
      perfCount++;

      if (perfBatch.length >= BATCH_SIZE) {
        execD1(perfBatch.join('\n'), mode);
        perfBatch.length = 0;
        process.stdout.write(`  Performances: ${perfCount}...\r`);
      }
    }
  }

  if (perfBatch.length > 0) {
    execD1(perfBatch.join('\n'), mode);
  }
  console.log(`  Performances: ${perfCount} total`);

  console.log('\nSeed complete!');
}

main();
