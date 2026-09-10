import { effectiveSongTags } from '../src/lib/songTags';
import type { Song, Performance } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${message}: expected ${b}, got ${a}`);
}

function song(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-1',
    workId: 'work-1',
    title: 'Title',
    originalArtist: 'Artist',
    tags: [],
    status: 'approved',
    submittedBy: null,
    reviewedBy: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  };
}

function performance(id: string, tags: string[]): Performance {
  return {
    id, songId: 'song-1', streamId: 'stream-1', date: '2026-01-01', streamTitle: 'Stream',
    videoId: 'video-1', timestamp: 0, endTimestamp: null, note: '', tags,
    status: 'approved', submittedBy: null, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  };
}

// songs.tags is dead storage on this branch: insertSong writes '[]', updateSong no longer
// accepts the field, and migration 0010 strips IDs out of it. Reading it means the page
// shows an empty tag list no matter how the song is actually tagged.
function testReadsRenditionTagsRatherThanTheDeadColumn(): void {
  const subject = song({
    tags: [],
    performances: [
      performance('p1', ['language:ja', 'style:duet']),
      performance('p2', ['language:ja']),
    ],
  });

  assertDeepEqual(
    effectiveSongTags(subject),
    ['language:ja', 'style:duet'],
    'rendition tags are surfaced and de-duplicated',
  );
}

function testIgnoresTheLegacySongColumn(): void {
  const subject = song({
    tags: ['genre:pop'],
    performances: [performance('p1', [])],
  });

  assertDeepEqual(
    effectiveSongTags(subject),
    [],
    'the legacy per-song column must not be presented as the current tag state',
  );
}

function testHandlesMissingPerformances(): void {
  assert(effectiveSongTags(song()).length === 0, 'a song with no performances reports no tags');
}

function main(): void {
  testReadsRenditionTagsRatherThanTheDeadColumn();
  testIgnoresTheLegacySongColumn();
  testHandlesMissingPerformances();
  console.log('✓ song pages read rendition tags instead of the dead legacy column');
}

main();
