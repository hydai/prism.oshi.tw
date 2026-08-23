import assert from 'node:assert/strict';

import { areSongCardPropsEqual, visibleSongCardTags, type SongCardProps } from './song-card';
import type { ArchivePerformance, ArchiveSong } from '../types/archive';

function performance(id: string): ArchivePerformance {
  return {
    id,
    streamId: `stream-${id}`,
    date: '2026-01-01',
    streamTitle: `Stream ${id}`,
    videoId: `video-${id}`,
    timestamp: 10,
    note: '',
    inheritedTags: ['genre:pop'],
    tags: ['language:ja'],
  };
}

function song(performances: ArchivePerformance[]): ArchiveSong {
  return {
    id: 'song-1',
    workId: 'work-1',
    title: 'Song',
    originalArtist: 'Artist',
    inheritedTags: ['genre:pop'],
    tags: ['genre:pop', 'language:ja'],
    performances,
  };
}

const firstPerformances = [performance('performance-a')];
const baseProps: SongCardProps = {
  song: song(firstPerformances),
  isExpanded: true,
  onToggleExpand: () => undefined,
  onPlay: () => undefined,
  onAddToQueue: () => undefined,
  onAddToPlaylistSuccess: () => undefined,
  isLiked: () => false,
  onToggleLike: () => undefined,
  unavailableVideoIds: new Set(),
  streamerSlug: 'tester',
};

assert.equal(
  areSongCardPropsEqual(baseProps, {
    ...baseProps,
    song: song([performance('performance-b')]),
  }),
  false,
  'an expanded card rerenders when a filter swaps in a different performance with the same count and tags',
);

assert.equal(
  areSongCardPropsEqual(baseProps, {
    ...baseProps,
    song: { ...baseProps.song, tags: [...baseProps.song.tags] },
  }),
  true,
  'equivalent tags with the same performance array keep the memoized card stable',
);

console.log('✓ SongCard memoization follows filtered performance identity');

// mergeTagIds sorts language(10) < genre(20) < mood(30) < style(40) < source(50), and the
// collapsed card only had room for three, so source:* fell off whenever a song carried
// three higher-priority tags. Clicking the Vocaloid chip then returned cards showing no
// Vocaloid chip at all — a filtered list with no visible evidence of the filter.
{
  const tags = ['language:ja', 'genre:pop', 'mood:ballad', 'source:vocaloid'];

  const filtered = visibleSongCardTags(tags, new Set(['source:vocaloid']));
  assert.ok(
    filtered.shown.includes('source:vocaloid'),
    'the tag being filtered on must be visible on every card that matched it',
  );
  assert.equal(filtered.shown.length, 3, 'the card still shows at most three chips');
  assert.equal(filtered.hidden, 1, 'the remainder is reported so truncation is not silent');

  const unfiltered = visibleSongCardTags(tags, new Set());
  assert.deepEqual(
    unfiltered.shown,
    ['language:ja', 'genre:pop', 'mood:ballad'],
    'with no tag filter the catalog ordering is preserved',
  );
  assert.equal(unfiltered.hidden, 1);

  assert.deepEqual(
    visibleSongCardTags(['genre:pop'], new Set()),
    { shown: ['genre:pop'], hidden: 0 },
    'a short tag list is shown whole with no overflow',
  );
}
