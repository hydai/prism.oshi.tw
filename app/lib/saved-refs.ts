import type { ArchivePerformance, ArchiveSong, PerformanceRef } from '../types/archive';
import type { Track } from './player-store';

/**
 * Saved playable items (liked songs, recent plays, playlist entries) are
 * identified by `performanceId` only. Everything else they store is a
 * snapshot; at render time it is replaced by the live catalog when the
 * performance is there, kept when it is not, and left alone (no verdict)
 * while the catalog has not loaded. Nothing is written back to storage.
 * See docs/saved-playback-identity.md.
 */
export interface IndexedPerformance {
  song: ArchiveSong;
  performance: ArchivePerformance;
}

export type PerformanceIndex = ReadonlyMap<string, IndexedPerformance>;

export type SavedRefStatus = 'live' | 'missing' | 'unknown';

export interface ResolvedRef {
  ref: PerformanceRef;
  status: SavedRefStatus;
}

/** Built from the ungrouped catalog so `song` is the performance's owner. First owner wins. */
export function buildPerformanceIndex(songs: readonly ArchiveSong[]): PerformanceIndex {
  const index = new Map<string, IndexedPerformance>();
  for (const song of songs) {
    for (const performance of song.performances) {
      if (!index.has(performance.id)) index.set(performance.id, { song, performance });
    }
  }
  return index;
}

export function resolveSavedRef(ref: PerformanceRef, index: PerformanceIndex | null): ResolvedRef {
  if (index === null) return { ref, status: 'unknown' };
  const hit = index.get(ref.performanceId);
  if (!hit) return { ref, status: 'missing' };
  const { song, performance } = hit;
  return {
    status: 'live',
    ref: {
      performanceId: ref.performanceId,
      songId: song.id,
      ...(song.workId ? { workId: song.workId } : {}),
      songTitle: song.title,
      originalArtist: song.originalArtist,
      videoId: performance.videoId,
      timestamp: performance.timestamp,
      endTimestamp: performance.endTimestamp,
      streamerSlug: ref.streamerSlug,
    },
  };
}

export function resolveSavedRefs(refs: readonly PerformanceRef[], index: PerformanceIndex | null): ResolvedRef[] {
  return refs.map((ref) => resolveSavedRef(ref, index));
}

/** `deleted` only for a performance the loaded catalog does not have; `unknown` plays the snapshot. */
export function toTrack(resolved: ResolvedRef): Track {
  return { ...resolved.ref, deleted: resolved.status === 'missing' };
}

/**
 * The queue a panel hands to `playTrackWithQueue`: the first playable entry
 * at or after `startIndex`, then everything behind it (missing entries stay,
 * flagged, so the player's advance logic skips them the same way it does
 * for playlists today). `null` when nothing is playable.
 */
export function playableQueue(
  resolved: readonly ResolvedRef[],
  startIndex = 0,
): { first: Track; following: Track[] } | null {
  const tracks = resolved.slice(Math.max(0, startIndex)).map(toTrack);
  const firstIndex = tracks.findIndex((track) => !track.deleted);
  if (firstIndex === -1) return null;
  return { first: tracks[firstIndex], following: tracks.slice(firstIndex + 1) };
}
