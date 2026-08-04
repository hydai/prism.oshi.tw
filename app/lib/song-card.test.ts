import assert from 'node:assert/strict';

import { areSongCardPropsEqual, type SongCardProps } from './song-card';
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
