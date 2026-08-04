import { effectiveSongTags } from '../src/lib/songTags';
import type { Song } from '../../shared/types';

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
  } as Song;
}

// songs.tags is dead storage on this branch: insertSong writes '[]', updateSong no longer
// accepts the field, and migration 0007 strips IDs out of it. Reading it means the page
// shows an empty tag list no matter how the song is actually tagged.
function testReadsRenditionTagsRatherThanTheDeadColumn(): void {
  const subject = song({
    tags: [],
    performances: [
      { id: 'p1', tags: ['language:ja', 'style:duet'] },
      { id: 'p2', tags: ['language:ja'] },
    ],
  } as Partial<Song>);

  assertDeepEqual(
    effectiveSongTags(subject),
    ['language:ja', 'style:duet'],
    'rendition tags are surfaced and de-duplicated',
  );
}

function testIgnoresTheLegacySongColumn(): void {
  const subject = song({
    tags: ['genre:pop'],
    performances: [{ id: 'p1', tags: [] }],
  } as Partial<Song>);

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
